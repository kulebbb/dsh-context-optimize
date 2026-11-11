import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { access, lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { parse } from "yaml";
// src/shared/roots.ts
/** 同名冲突时的优先级；数字小的赢，和 DSH 保持一致。 */
const ROOT_RANK = {
	"project-dsh": 100,
	"project-agents": 200,
	"user-dsh": 400,
	"user-agents": 500,
	bundled: 600
};
/** 根 → 面板上的来源标签（目前与 RootId 同名，单独保留一层便于将来合并显示）。 */
function sourceOfRoot(id) {
	return id;
}
/** 只有内置根是只读的：它是 App 安装包里的资源，升级会被覆盖。 */
function isRemovableRoot(id) {
	return id !== "bundled";
}
/**
* 由 skills 目录推导归档目录：**与 skills 目录同级**，不建在它里面。
*
* 放在 skills 内部虽然也不会被 DSH 当成 skill 扫到（它只认第一层 .md 和含 SKILL.md 的目录），
* 但等于把垃圾箱建在仓库里，一眼看目录会误会；同级更干净，也不怕将来扫描规则变化。
*
* @param skillsDir - 某个根的绝对路径，末尾不带分隔符。
* @returns 该根的归档目录绝对路径。
*/
function archiveDirFor(skillsDir) {
	return `${skillsDir.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]+$/, "")}/skill-archive`;
}
/**
* 由「用户 home 路径」渲染展示用的符号路径。
*
* @param absolute - 绝对路径。
* @param home - home 目录绝对路径（不带末尾分隔符）。
* @returns 位于 home 下时返回 `~/...`，否则原样返回。
*/
function displayPath(absolute, home) {
	const normalizedHome = home.replace(/[\\/]+$/, "");
	if (absolute === normalizedHome) return "~";
	if (absolute.startsWith(`${normalizedHome}/`)) return `~${absolute.slice(normalizedHome.length)}`;
	return absolute;
}
/** 归档目录里给重名文件加的时间后缀，形如 `@20261111-134501`。 */
function archiveSuffix(now) {
	const pad = (n) => String(n).padStart(2, "0");
	return `@${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
// src/shared/catalog.ts
/**
* 纯计算：token 估算、同名覆盖判定、排序、相对时间文案。
*
* 这些逻辑两半都要用（宿主算 token、客户端排列表与渲染「上次使用」），
* 所以放在 shared 里，且不能 import 任何 node 内置模块。
*/
/** 字符 → token 的估算系数；偏保守，宁可高估占用。 */
const CHARS_PER_TOKEN = 3.5;
/**
* 估算 token 数。
* @param chars - 字符数。
* @returns 四舍五入后的 token 数。
*/
function approxTokens(chars) {
	return Math.round(chars / CHARS_PER_TOKEN);
}
/**
* 一条 skill 在会话目录里占用的字符数：名字 + 描述 + 固定分隔符。
*
* 固定 8 个字符对应目录里 `- \`name\`: ` 这段固定前缀与换行，够近似。
* @param name - skill 名。
* @param description - 描述正文。
* @returns 字符数。
*/
function descriptionChars(name, description) {
	return name.length + description.length + 8;
}
/**
* 标记同名覆盖：rank 小的生效，其余标 effective=false 并给出压住它的来源。
*
* 入参不会被修改；返回新数组。
* @param entries - 一个范围内的条目。
* @returns 带 effective / overriddenBy 的新条目。
*/
function markEffective(entries) {
	const winner = /* @__PURE__ */ new Map();
	for (const entry of entries) {
		const current = winner.get(entry.name);
		if (current === void 0 || ROOT_RANK[entry.rootId] < ROOT_RANK[current.rootId]) winner.set(entry.name, entry);
	}
	return entries.map((entry) => {
		const best = winner.get(entry.name);
		if (best === void 0 || best === entry) return {
			...entry,
			effective: true
		};
		return {
			...entry,
			effective: false,
			overriddenBy: best.source
		};
	});
}
/** 按调用次数降序；同次数按占用降序，再按名字升序保证稳定。 */
function compareByCalls(a, b) {
	return b.calls - a.calls || b.approxTokens - a.approxTokens || a.name.localeCompare(b.name);
}
/** 按占用降序；同占用按调用次数升序（越没用越靠前）。 */
function compareByTokens(a, b) {
	return b.approxTokens - a.approxTokens || a.calls - b.calls || a.name.localeCompare(b.name);
}
/**
* 按状态筛选条目。
*
* @param entries - 待筛选条目（archived 状态传归档条目）。
* @param state - 目标状态。
* @param archived - 归档条目列表；`state='archived'` 时返回它。
* @returns 筛选后的条目。
*/
function filterByState(entries, state, archived = []) {
	if (state === "archived") return archived;
	if (state === "never-called") return entries.filter((entry) => entry.calls === 0);
	return entries;
}
/**
* 把毫秒时间戳转成 `YYYY-MM-DD`（本地时区）。
* @param ms - 毫秒时间戳。
* @returns 日期字符串。
*/
function toDateKey(ms) {
	const date = new Date(ms);
	const pad = (n) => String(n).padStart(2, "0");
	return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
// src/shared/errors.ts
/** 宿主侧统一抛出的错误：带 code，路由层原样映射成 HTTP 状态与错误体。 */
var OptimizeError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "OptimizeError";
		this.code = code;
	}
};
/** 错误码 → HTTP 状态。 */
const STATUS_BY_CODE = {
	"invalid-request": 400,
	"unknown-root": 400,
	"readonly-root": 403,
	"not-found": 404,
	"target-exists": 409,
	"path-escape": 400,
	"move-failed": 500,
	internal: 500
};
/**
* 把任意异常归一成 `{ code, message }`。
*
* @param error - 捕获到的异常。
* @returns 已知错误保留 code，其余归为 internal。
*/
function normalizeError(error) {
	if (error instanceof OptimizeError) return {
		code: error.code,
		message: error.message
	};
	if (error instanceof Error) return {
		code: "internal",
		message: error.message
	};
	return {
		code: "internal",
		message: "未知错误"
	};
}
// src/shared/types.ts
/**
* dsh-context-optimize 的跨半边契约：宿主算出来的数据、客户端面板消费的载荷。
*
* 这里只放类型与纯常量，不 import 任何 node 内置模块，客户端 bundle 也能安全引用。
*/
/** 路由前缀；五个端点都是 `${ROUTE_PREFIX}.<action>` 的形式。 */
const ROUTE_PREFIX = "/api/context-optimize";
/** 面板会用到的全部端点（相对路径，客户端直接 fetch）。 */
const ROUTES = {
	overview: `${ROUTE_PREFIX}.overview`,
	skills: `${ROUTE_PREFIX}.skills`,
	projects: `${ROUTE_PREFIX}.projects`,
	archive: `${ROUTE_PREFIX}.archive`,
	restore: `${ROUTE_PREFIX}.restore`
};
// src/host/paths.ts
/**
* 路径安全：把「客户端给的根 ID + 目录名」变成可信的绝对路径。
*
* 边界只有一条：**客户端永远不传绝对路径**。它能传的只有根 ID（枚举）、工作区 ID 和目录名，
* 绝对路径全部由宿主自己拼。拼完还要过三道检查，防止 `../` 穿越到根外面。
*/
/** 目录名长度上限，避免构造出超长路径。 */
const MAX_NAME_LENGTH = 128;
/**
* 校验一个「skill 目录名」是否单段、非特殊、不含分隔符。
*
* DSH 的 skill 目录名可以和 frontmatter 里的 name 不同，所以这里不按 kebab-case 校验，
* 只保证它是根的**直接子项**、跳不出去。
*
* @param dirName - 客户端传来的目录名（目录包或扁平 .md 的文件名，不含扩展名）。
* @returns 校验通过的目录名（原样）。
* @throws OptimizeError 当名字为空、过长、含分隔符、或为 `.` / `..` 时。
*/
function assertSafeDirName(dirName) {
	if (typeof dirName !== "string" || dirName.length === 0) throw new OptimizeError("invalid-request", "目录名不能为空");
	if (dirName.length > MAX_NAME_LENGTH) throw new OptimizeError("invalid-request", `目录名超过 ${String(MAX_NAME_LENGTH)} 个字符`);
	if (dirName === "." || dirName === "..") throw new OptimizeError("path-escape", "目录名不能是 . 或 ..");
	if (dirName.includes("/") || dirName.includes("\\") || dirName.includes("\0")) throw new OptimizeError("path-escape", "目录名不能包含路径分隔符");
	if (isAbsolute(dirName)) throw new OptimizeError("path-escape", "目录名不能是绝对路径");
	return dirName;
}
/**
* 断言 `child` 确实是 `parent` 的直接子项（不做软链解析，纯字符串层面）。
*
* @param parent - 父目录绝对路径。
* @param child - 待检查的绝对路径。
* @returns 校验通过的 child。
* @throws OptimizeError 当 child 不在 parent 下、或不是直接子项时。
*/
function assertDirectChild(parent, child) {
	const normalizedParent = resolve(parent);
	const normalizedChild = resolve(child);
	const rel = relative(normalizedParent, normalizedChild);
	if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new OptimizeError("path-escape", "目标路径不在预期的目录里");
	if (rel.includes(sep)) throw new OptimizeError("path-escape", "目标必须是指定目录的直接子项");
	return normalizedChild;
}
/**
* 解软链；路径不存在时原样返回。
*
* 「打开目录」必须用解过软链的真实路径——DSH 校验路径的方式是「解一次软链再要求与传入值完全相等」，
* 传拼接路径在软链 skill 上会被拒绝，表现为点了没反应。
*
* @param path - 绝对路径。
* @returns 真实路径，解不出时返回入参。
*/
async function safeRealpath(path) {
	try {
		return await realpath(path);
	} catch {
		return path;
	}
}
// src/host/workspaces.ts
/**
* 工作区 → 项目根。
*
* DSH 判断「项目根」的方式是**往上找最近一个含 `.git` 的目录**，找不到就用工作区路径本身。
* 项目级 skill 就放在项目根下的 `.dsh/skills` 与 `.agents/skills`。
*
* 注意这和 DSH 的工作区列表是两件事：工作区是用户在侧边栏看到的东西，项目根是磁盘上的事实。
* 面板以工作区为准（用户心智），每个工作区再按这条规则解析项目根（DSH 事实）。
*/
/**
* 判断路径是否存在（不关心类型）。
* @param path - 绝对路径。
* @returns 是否存在。
*/
async function pathExists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
/**
* 从工作区路径往上找最近一个含 `.git` 的目录。
*
* 到根目录还没找到时返回入参本身——和 DSH 的行为一致，避免把 skill 根算到文件系统根上。
*
* @param workspacePath - 工作区绝对路径。
* @returns 项目根绝对路径。
*/
async function resolveProjectRoot(workspacePath) {
	const start = resolve(workspacePath);
	let current = start;
	for (;;) {
		if (await pathExists(join(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return start;
		current = parent;
	}
}
/**
* 取工作区路径的真实路径；目录已失效时返回入参。
*
* 用 realpath 是为了让「按 cwd 前缀过滤会话」这一判断能对上——会话日志里记的是真实路径。
*
* @param path - 工作区路径。
* @returns 真实路径或原路径。
*/
async function realWorkspacePath(path) {
	try {
		return await realpath(path);
	} catch {
		return path;
	}
}
// src/host/archive.ts
/**
* 归档 / 还原：真正的目录移动。
*
* 全流程**没有删除**。归档 = 把 skill 从 skills 目录搬到同级的 skill-archive；
* 还原 = 搬回来。所以两个动作天然可逆，失败时也不会丢数据。
*/
/**
* 在一个根里定位 skill：先当目录找，再当扁平 `.md` 找。
*
* @param rootDir - 根目录绝对路径。
* @param dirName - 客户端传来的目录名（扁平型不带扩展名）。
* @returns 定位结果。
* @throws OptimizeError 两边都不存在时抛 not-found。
*/
async function locateSkill(rootDir, dirName) {
	const asDirectory = join(rootDir, dirName);
	if (await pathExists(asDirectory)) return {
		path: assertDirectChild(rootDir, asDirectory),
		fileName: dirName
	};
	const asFlat = join(rootDir, `${dirName}.md`);
	if (await pathExists(asFlat)) return {
		path: assertDirectChild(rootDir, asFlat),
		fileName: `${dirName}.md`
	};
	throw new OptimizeError("not-found", `在 ${rootDir} 里找不到 ${dirName}`);
}
/**
* 把一条 skill 移进它的归档目录。
*
* 目标已存在时**绝不覆盖**：自动追加时间后缀并回传，界面如实展示。
*
* @param skillsDir - 根目录绝对路径。
* @param dirName - skill 目录名（扁平型不带扩展名）。
* @param now - 当前时刻，用于重名后缀。
* @returns 移动结果。
*/
async function moveToArchive(skillsDir, dirName, now = /* @__PURE__ */ new Date()) {
	assertSafeDirName(dirName);
	const source = await locateSkill(skillsDir, dirName);
	const archiveDir = archiveDirFor(skillsDir);
	await mkdir(archiveDir, { recursive: true });
	const baseName = source.fileName;
	const extension = extname(baseName);
	const stem = extension === "" ? baseName : baseName.slice(0, -extension.length);
	let target = join(archiveDir, baseName);
	let renamedTo;
	if (await pathExists(target)) {
		const suffix = archiveSuffix(now);
		let attempt = 1;
		for (;;) {
			const candidate = attempt === 1 ? `${stem}${suffix}${extension}` : `${stem}${suffix}-${String(attempt)}${extension}`;
			const candidatePath = join(archiveDir, candidate);
			if (!await pathExists(candidatePath)) {
				target = candidatePath;
				renamedTo = attempt === 1 ? `${stem}${suffix}` : `${stem}${suffix}-${String(attempt)}`;
				break;
			}
			attempt += 1;
			if (attempt > 100) throw new OptimizeError("target-exists", `归档目录里已有太多同名条目：${stem}`);
		}
	}
	assertDirectChild(archiveDir, target);
	try {
		await rename(source.path, target);
	} catch (error) {
		throw new OptimizeError("move-failed", `归档失败：${errorText(error)}`);
	}
	return renamedTo === void 0 ? { to: target } : {
		to: target,
		renamedTo
	};
}
/**
* 把一条 skill 从归档目录放回 skills 目录。
*
* 原位已有同名条目时直接拒绝，不猜也不覆盖——让用户先处理冲突。
*
* @param skillsDir - 根目录绝对路径。
* @param dirName - skill 目录名（扁平型不带扩展名）。
* @returns 移动结果。
*/
async function restoreFromArchive(skillsDir, dirName) {
	assertSafeDirName(dirName);
	const source = await locateSkill(archiveDirFor(skillsDir), dirName);
	const restoredName = stripArchiveSuffix(source.fileName);
	await mkdir(skillsDir, { recursive: true });
	const target = join(skillsDir, restoredName);
	assertDirectChild(skillsDir, target);
	const conflict = target.endsWith(".md") ? target.slice(0, -3) : `${target}.md`;
	if (await pathExists(target) || await pathExists(conflict)) throw new OptimizeError("target-exists", `原位已有 ${restoredName.replace(/\.md$/, "")}，请先处理冲突`);
	try {
		await rename(source.path, target);
	} catch (error) {
		throw new OptimizeError("move-failed", `还原失败：${errorText(error)}`);
	}
	return { to: target };
}
/**
* 去掉归档时追加的时间后缀。
* @param fileName - 归档里的文件名（可能含 `@YYYYMMDD-HHmmss`）。
* @returns 还原后的文件名。
*/
function stripArchiveSuffix(fileName) {
	const extension = extname(fileName);
	return `${(extension === "" ? fileName : fileName.slice(0, -extension.length)).replace(/@\d{8}-\d{6}(?:-\d+)?$/, "")}${extension}`;
}
/** 取错误文本，非 Error 也能读。 */
function errorText(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
// src/host/skill-scan.ts
/**
* 扫描 skill 根：把磁盘上的目录结构读成条目。
*
* 扫描规则和 DSH 自己的 `dsh-skill-filesystem` 保持一致：
* - 根下**第一层**的目录，且内含 `SKILL.md` → 目录型 skill；
* - 根下**第一层**的 `.md` 文件 → 扁平型 skill；
* - 其余一律忽略（所以归档目录放在 skills 里面也不会被误认，但我们仍把它放同级）。
*/
/**
* 解析 DSH 的三个路径。环境变量名与 `@deepseek-ai/dsh-home-paths` 一致，避免和宿主判断不一致。
* @returns 路径集合。
*/
function homePaths() {
	const home = homedir();
	const dshHome = process.env.DSH_HOME?.trim() || join(home, ".dsh");
	const agentsHome = process.env.DSH_AGENTS_HOME?.trim() || join(home, ".agents");
	const bundled = process.env.DSH_BUNDLED_SKILL_DIR?.trim();
	return {
		dshHome,
		agentsHome,
		...bundled !== void 0 && bundled.length > 0 ? { bundledSkillDir: bundled } : {}
	};
}
/**
* 全局三个根的绝对路径与展示名。
* @param paths - 已解析的 home 路径。
* @returns 根列表；内置根缺失时不出现在列表里。
*/
function globalRoots(paths) {
	const home = homedir();
	const roots = [{
		id: "user-dsh",
		path: join(paths.dshHome, "skills"),
		display: displayPath(join(paths.dshHome, "skills"), home),
		removable: true
	}, {
		id: "user-agents",
		path: join(paths.agentsHome, "skills"),
		display: displayPath(join(paths.agentsHome, "skills"), home),
		removable: true
	}];
	if (paths.bundledSkillDir !== void 0) roots.push({
		id: "bundled",
		path: paths.bundledSkillDir,
		display: "App 内置 office-skills",
		removable: false
	});
	return roots;
}
/**
* 项目范围的两个根。
* @param projectRoot - 项目根绝对路径。
* @returns 根列表。
*/
function projectRoots(projectRoot) {
	return [{
		id: "project-dsh",
		path: join(projectRoot, ".dsh", "skills"),
		display: ".dsh/skills",
		removable: true
	}, {
		id: "project-agents",
		path: join(projectRoot, ".agents", "skills"),
		display: ".agents/skills",
		removable: true
	}];
}
/**
* 读 SKILL.md 的 frontmatter，取 name 与 description。
*
* 用真正的 YAML 解析器而不是正则：本机就有 skill 用了 `description: |` 块语法，
* 手写正则会把这类描述解析成空串，token 统计随之失真。
*
* @param file - SKILL.md 或扁平 .md 的绝对路径。
* @param fallbackName - frontmatter 缺 name 时用的名字（目录名 / 文件名）。
* @returns 元信息；文件读不到时返回 undefined。
*/
async function readSkillMeta(file, fallbackName) {
	let raw;
	try {
		raw = await readFile(file, "utf8");
	} catch {
		return;
	}
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
	if (match === null) return {
		name: fallbackName,
		description: "",
		declared: false
	};
	let frontmatter;
	try {
		frontmatter = parse(match[1] ?? "");
	} catch {
		return {
			name: fallbackName,
			description: "",
			declared: false
		};
	}
	if (typeof frontmatter !== "object" || frontmatter === null) return {
		name: fallbackName,
		description: "",
		declared: false
	};
	const record = frontmatter;
	const rawName = record["name"];
	if (typeof rawName !== "string" || rawName.trim() === "") return {
		name: fallbackName,
		description: "",
		declared: false
	};
	const description = typeof record["description"] === "string" ? record["description"].trim() : "";
	return {
		name: rawName.trim(),
		description,
		declared: true
	};
}
/**
* 扫描一个 skill 根。
*
* @param root - 根定义（绝对路径、ID、可卸载性）。
* @returns 条目列表；根不存在时返回空数组。
*/
async function scanSkillRoot(root) {
	let names;
	try {
		names = (await readdir(root.path, { withFileTypes: true })).map((dirent) => dirent.name);
	} catch {
		return [];
	}
	const skills = [];
	for (const entryName of names) {
		if (entryName.startsWith(".")) continue;
		const childPath = join(root.path, entryName);
		const info = await safeStat(childPath);
		if (info === void 0) continue;
		const isSymlink = await isSymlinkPath(childPath);
		let kind;
		let skillFile;
		let dirName;
		if (info.isDirectory) {
			kind = "directory";
			skillFile = join(childPath, "SKILL.md");
			dirName = entryName;
			if (!await isFile(skillFile)) continue;
		} else if (extname(entryName) === ".md") {
			kind = "flat";
			skillFile = childPath;
			dirName = basename(entryName, ".md");
		} else continue;
		const meta = await readSkillMeta(skillFile, dirName);
		if (meta === void 0 || !meta.declared) continue;
		const chars = descriptionChars(meta.name, meta.description);
		skills.push({
			dirName,
			name: meta.name,
			description: meta.description,
			rootId: root.id,
			source: sourceOfRoot(root.id),
			kind,
			dirRealPath: await safeRealpath(kind === "directory" ? childPath : root.path),
			skillFile,
			removable: root.removable && isRemovableRoot(root.id),
			isSymlink,
			descriptionChars: chars,
			approxTokens: approxTokens(chars)
		});
	}
	return skills.sort((a, b) => a.name.localeCompare(b.name));
}
/**
* 扫描一个归档目录，条目带上归档时间。
*
* @param archiveDir - 归档目录绝对路径。
* @param rootId - 条目原本所属的根。
* @returns 归档条目；目录不存在时返回空数组。
*/
async function scanArchiveDir(archiveDir, rootId) {
	let dirents;
	try {
		dirents = await readdir(archiveDir, { withFileTypes: true });
	} catch {
		return [];
	}
	const entries = [];
	for (const dirent of dirents) {
		if (dirent.name.startsWith(".")) continue;
		const childPath = join(archiveDir, dirent.name);
		const info = await safeStat(childPath);
		if (info === void 0) continue;
		const isDir = info.isDirectory;
		const dirName = isDir ? dirent.name : basename(dirent.name, ".md");
		if (!isDir && extname(dirent.name) !== ".md") continue;
		const skillFile = isDir ? join(childPath, "SKILL.md") : childPath;
		const meta = await readSkillMeta(skillFile, dirName);
		if (meta === void 0 || !meta.declared) continue;
		const chars = descriptionChars(meta.name, meta.description);
		entries.push({
			dirName,
			name: meta.name,
			description: meta.description,
			rootId,
			source: sourceOfRoot(rootId),
			kind: isDir ? "directory" : "flat",
			dirRealPath: await safeRealpath(isDir ? childPath : archiveDir),
			skillFile,
			removable: true,
			isSymlink: await isSymlinkPath(childPath),
			effective: false,
			descriptionChars: chars,
			approxTokens: approxTokens(chars),
			calls: 0,
			calls30d: 0,
			lastUsedAt: null,
			...info === void 0 ? {} : { archivedAt: new Date(info.ctimeMs).toISOString() }
		});
	}
	return entries.sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
}
/** 是否是软链（用 lstat，不跟进目标）。 */
async function isSymlinkPath(path) {
	try {
		return (await lstat(path)).isSymbolicLink();
	} catch {
		return false;
	}
}
/** 是否是普通文件。 */
async function isFile(path) {
	return (await safeStat(path))?.isFile === true;
}
/** stat 的安全版本，出错返回 undefined。 */
async function safeStat(path) {
	try {
		const info = await stat(path);
		return {
			isFile: info.isFile(),
			isDirectory: info.isDirectory(),
			mtimeMs: info.mtimeMs,
			ctimeMs: info.ctimeMs
		};
	} catch {
		return;
	}
}
/** 会话保留上限；超出的按「有记录优先、seq 大的优先」裁剪，避免缓存无限增长。 */
const MAX_SESSIONS = 5e3;
/**
* 新建空缓存。
* @returns 初始缓存。
*/
function emptyCache() {
	return {
		version: 2,
		generatedAt: 0,
		sessions: {},
		backfill: {
			state: "idle",
			done: 0,
			total: 0
		}
	};
}
/**
* 读缓存。文件不存在、损坏或版本不符时返回空缓存，绝不抛错——首次运行是正常路径。
*
* @param path - 缓存文件绝对路径。
* @returns 缓存对象。
*/
async function loadCache(path) {
	let raw;
	try {
		raw = await readFile(path, "utf8");
	} catch {
		return emptyCache();
	}
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return emptyCache();
		const record = parsed;
		if (record.version !== 2 || typeof record.sessions !== "object" || record.sessions === null) return emptyCache();
		return {
			version: 2,
			generatedAt: typeof record.generatedAt === "number" ? record.generatedAt : 0,
			sessions: normalizeSessions(record.sessions),
			backfill: normalizeBackfill(record.backfill)
		};
	} catch {
		return emptyCache();
	}
}
/**
* 原子写缓存：先写临时文件再 rename，断电或崩溃不会留下半个文件。
*
* @param path - 目标路径。
* @param cache - 缓存对象。
*/
async function saveCache(path, cache) {
	await mkdir(dirname(path), { recursive: true });
	const pruned = pruneSessions({
		...cache,
		generatedAt: Date.now()
	});
	const tmp = `${path}.${String(process.pid)}.${Math.random().toString(36).slice(2, 8)}.tmp`;
	await writeFile(tmp, JSON.stringify(pruned), "utf8");
	await rename(tmp, path);
}
/**
* 裁剪会话表，避免长期使用后无界增长。
*
* 规则：有调用记录的会话优先保留；同组内按已处理 seq 从大到小截断到上限。
* @param cache - 原缓存。
* @returns 可能裁剪过的副本。
*/
function pruneSessions(cache) {
	const ids = Object.keys(cache.sessions);
	if (ids.length <= MAX_SESSIONS) return cache;
	const sorted = ids.sort((a, b) => {
		const left = cache.sessions[a];
		const right = cache.sessions[b];
		const leftHas = left !== void 0 && Object.keys(left.days).length > 0 ? 1 : 0;
		return (right !== void 0 && Object.keys(right.days).length > 0 ? 1 : 0) - leftHas || (right?.lastSeq ?? 0) - (left?.lastSeq ?? 0);
	});
	const kept = {};
	for (const id of sorted.slice(0, MAX_SESSIONS)) {
		const record = cache.sessions[id];
		if (record !== void 0) kept[id] = record;
	}
	return {
		...cache,
		sessions: kept
	};
}
/**
* 逐条校验会话记账。结构坏的一条只丢自己，不能因为它让整个面板 500——
* `indexUsage` 会对 `record.days` 做 Object.entries，null 会让每个请求都炸。
*
* @param value - 缓存文件里的 sessions 字段。
* @returns 只含合法记录的会话表。
*/
function normalizeSessions(value) {
	if (typeof value !== "object" || value === null) return {};
	const out = {};
	for (const [id, raw] of Object.entries(value)) {
		if (typeof raw !== "object" || raw === null) continue;
		const record = raw;
		const days = record["days"];
		if (typeof days !== "object" || days === null || Array.isArray(days)) continue;
		const cleanDays = {};
		for (const [name, perDay] of Object.entries(days)) {
			if (typeof perDay !== "object" || perDay === null || Array.isArray(perDay)) continue;
			const cleanPerDay = {};
			for (const [day, count] of Object.entries(perDay)) if (typeof count === "number" && Number.isFinite(count) && count > 0) cleanPerDay[day] = count;
			if (Object.keys(cleanPerDay).length > 0) cleanDays[name] = cleanPerDay;
		}
		const lastSeq = typeof record["lastSeq"] === "number" && Number.isFinite(record["lastSeq"]) ? record["lastSeq"] : -1;
		const cwd = typeof record["cwd"] === "string" ? record["cwd"] : null;
		const createdAt = typeof record["createdAt"] === "number" ? record["createdAt"] : void 0;
		out[id] = {
			lastSeq,
			cwd,
			days: cleanDays,
			...createdAt === void 0 ? {} : { createdAt }
		};
	}
	return out;
}
/** 把任意 backfill 字段归一成合法状态。 */
function normalizeBackfill(value) {
	if (typeof value !== "object" || value === null) return {
		state: "idle",
		done: 0,
		total: 0
	};
	const record = value;
	const state = record.state;
	return {
		state: state === "idle" || state === "running" || state === "done" || state === "partial" ? state : "idle",
		done: typeof record.done === "number" ? record.done : 0,
		total: typeof record.total === "number" ? record.total : 0
	};
}
// src/host/frequency.ts
/**
* 频次记账：把会话日志折叠成「哪个 skill 哪天被用了几次」。
*
* 两个来源：
* 1. **历史回溯**：首次启用时把本机全部会话日志读一遍（本机实测约 45 秒），结果落盘；
* 2. **实时增量**：会话跑着的时候订阅 `session/event`，按 seq 水位去重后直接加。
*
* 计的是「模型通过 skill 工具加载该 skill」的次数，外加用户手敲 `/skill名` 直接触发的次数。
*/
/**
* 从一条事件里取出它加载的 skill 名。
*
* 认两种形态：
* - `tool/call` 且工具名是 `skill`，参数里带 `name`；
* - `user/message` 且 `source.kind === 'skill-invocation'`（用户手敲 `/skill名`）。
*
* @param event - 一条会话事件。
* @returns skill 名；不是这两类事件时返回 undefined。
*/
function skillNameOf(event) {
	const data = event.data;
	if (typeof data !== "object" || data === null) return void 0;
	const record = data;
	if (event.type === "tool/call") {
		if (record["name"] !== "skill") return void 0;
		const raw = record["arguments"];
		if (typeof raw !== "string") return void 0;
		try {
			const parsed = JSON.parse(raw);
			if (typeof parsed !== "object" || parsed === null) return void 0;
			const name = parsed["name"];
			return typeof name === "string" && name !== "" ? name : void 0;
		} catch {
			return;
		}
	}
	if (event.type === "user/message") {
		const source = record["source"];
		if (typeof source !== "object" || source === null) return void 0;
		if (source["kind"] !== "skill-invocation") return void 0;
		const name = source["name"];
		return typeof name === "string" && name !== "" ? name : void 0;
	}
}
/**
* 把一批事件折叠进一个会话的记账里。
*
* 入参 `record` 会被原地修改；`lastSeq` 只增不减，因此同一批事件重复折叠不会重复计数。
*
* **事件必须按 seq 递增传入**：实现是顺序推进水位、跳过 `seq <= lastSeq` 的事件，
* 乱序传入会把低 seq 的事件当成已处理而丢掉。回溯（日志本身有序）与实时推送（单条）
* 都满足这个前提；将来若批量重放，先排序再调用。
*
* @param record - 该会话的记账（可以是新建的空账本）。
* @param events - 事件列表，按 seq 递增。
* @returns 更新后的记账。
*/
function foldEvents(record, events) {
	for (const event of events) {
		const seq = typeof event.seq === "number" ? event.seq : -1;
		if (seq <= record.lastSeq) continue;
		record.lastSeq = seq;
		const name = skillNameOf(event);
		if (name === void 0) continue;
		const day = toDateKey(typeof event.time === "number" ? event.time : Date.now());
		const perDay = record.days[name] ?? {};
		perDay[day] = (perDay[day] ?? 0) + 1;
		record.days[name] = perDay;
	}
	return record;
}
/**
* 新建一个空账本。
* @param cwd - 会话工作目录。
* @param createdAt - 会话创建时刻（毫秒）；用于算统计范围的起止日期。
* @returns 空记账。
*/
function newSessionRecord(cwd, createdAt) {
	return {
		lastSeq: -1,
		cwd,
		days: {},
		...createdAt === void 0 ? {} : { createdAt }
	};
}
/**
* 把整份缓存汇总成 skill → 用量。可按工作目录前缀过滤，用于项目范围。
*
* @param sessions - 会话记账表。
* @param now - 基准时刻。
* @param cwdUnder - 仅统计 cwd 落在该前缀下的会话；省略表示全部。
* @returns 汇总结果。
*/
function indexUsage(sessions, now = /* @__PURE__ */ new Date(), cwdUnder) {
	const cutoff = toDateKey(now.getTime() - 25056e5);
	const index = /* @__PURE__ */ new Map();
	for (const record of Object.values(sessions)) {
		if (cwdUnder !== void 0 && !isUnder(record.cwd, cwdUnder)) continue;
		for (const [name, perDay] of Object.entries(record.days)) {
			const current = index.get(name) ?? {
				calls: 0,
				calls30d: 0,
				lastUsedAt: null
			};
			for (const [day, count] of Object.entries(perDay)) {
				current.calls += count;
				if (day >= cutoff) current.calls30d += count;
				if (current.lastUsedAt === null || day > current.lastUsedAt) current.lastUsedAt = day;
			}
			index.set(name, current);
		}
	}
	return index;
}
/**
* 判断 cwd 是否落在某个目录下。
* @param cwd - 会话工作目录。
* @param prefix - 目录前缀。
* @returns 是否在目录下。
*/
function isUnder(cwd, prefix) {
	if (cwd === null) return false;
	const normalizedPrefix = prefix.replace(/[\\/]+$/, "");
	return cwd === normalizedPrefix || cwd.startsWith(`${normalizedPrefix}/`) || cwd.startsWith(`${normalizedPrefix}\\`);
}
// src/host/service.ts
/**
* 宿主半的中枢：把「磁盘上的 skill」「工作区列表」「会话日志里的调用记录」三件事拼成面板要的数据，
* 并承担归档 / 还原这两个会动磁盘的写操作。
*
* 设计约束（来自 docs/02-项目结构.html）：
* - 客户端只传根 ID、工作区 ID、目录名，绝对路径全部由这里拼；
* - 依赖全部注入，测试里不启动 DSH 也能跑；
* - 读操作可以先给近似值（回溯未完成时频次为空），绝不为统计把面板卡住。
*/
/** 扫描结果的内存缓存时长：面板 5 秒轮询一次，没必要每次都把磁盘读一遍。 */
const SCAN_TTL_MS = 2e3;
/** 落盘防抖：实时事件可能很密，攒一下再写。 */
const SAVE_DEBOUNCE_MS = 2e3;
/** 回溯并发；太高会把 CPU 打满，本机实测 4 很稳。 */
const BACKFILL_CONCURRENCY = 4;
var ContextOptimizeService = class {
	deps;
	home;
	cache = emptyCache();
	memo;
	/**
	* 频次数据的版本号。任何改变频次的动作（回溯完成、实时事件落账）都要 +1，
	* 让扫描缓存失效——否则面板会短暂显示「有目录但调用次数全是 0」的错表。
	*/
	usageRevision = 0;
	/** 缓存读完之前收到的实时事件先排队，读完再重放，避免被 initialize 覆盖掉。 */
	ready = false;
	pendingEvents = [];
	/** 按根串行化 move，堵住 check-then-rename 的并发窗口。 */
	moveChains = /* @__PURE__ */ new Map();
	/** 串行化落盘，避免多个 flush 抢同一个临时文件、用旧快照盖新数据。 */
	flushChain = Promise.resolve();
	backfillPromise;
	saveTimer;
	disposed = false;
	constructor(deps) {
		this.deps = deps;
		const envHome = homePaths();
		const bundled = deps.home?.bundledSkillDir ?? envHome.bundledSkillDir;
		this.home = {
			dshHome: deps.home?.dshHome ?? deps.dshHome,
			agentsHome: deps.home?.agentsHome ?? envHome.agentsHome,
			...bundled === void 0 ? {} : { bundledSkillDir: bundled }
		};
	}
	/** 当前时刻；测试可注入。 */
	now() {
		return this.deps.now?.() ?? /* @__PURE__ */ new Date();
	}
	/** 读缓存并启动首次回溯（后台，不阻塞任何请求）。 */
	async initialize() {
		const loaded = await loadCache(this.deps.cachePath);
		this.cache = {
			...loaded,
			sessions: { ...loaded.sessions }
		};
		this.ready = true;
		const queued = this.pendingEvents.splice(0, this.pendingEvents.length);
		for (const item of queued) this.ingest(item.id, item.cwd, item.createdAt, item.event);
		if (this.cache.backfill.state !== "done") this.startBackfill();
	}
	/** 停掉后台任务并冲一次盘。 */
	async dispose() {
		this.disposed = true;
		if (this.saveTimer !== void 0) {
			clearTimeout(this.saveTimer);
			this.saveTimer = void 0;
		}
		await this.flush();
	}
	/** 收到一条实时会话事件。 */
	ingest(sessionId, cwd, createdAt, event) {
		if (!this.ready) {
			this.pendingEvents.push({
				id: sessionId,
				cwd,
				...createdAt === void 0 ? {} : { createdAt },
				event
			});
			return;
		}
		const record = this.cache.sessions[sessionId] ?? newSessionRecord(cwd, createdAt);
		if (record.cwd === null && cwd !== null) record.cwd = cwd;
		const before = record.lastSeq;
		foldEvents(record, [event]);
		if (record.lastSeq === before) return;
		this.cache.sessions[sessionId] = record;
		this.usageRevision += 1;
		this.scheduleSave();
	}
	/** 路由入口：按 `request.url` 的 pathname 分发。 */
	async handle(request) {
		const url = new URL(request.url);
		try {
			switch (url.pathname) {
				case ROUTES.overview: return json(await this.overview());
				case ROUTES.skills: return json(await this.skills(parseSkillsQuery(url)));
				case ROUTES.projects: return json(await this.projects());
				case ROUTES.archive: return json(await this.move(request, "archive"));
				case ROUTES.restore: return json(await this.move(request, "restore"));
				default: throw new OptimizeError("not-found", `未知端点 ${url.pathname}`);
			}
		} catch (error) {
			const { code, message } = normalizeError(error);
			return json({ error: {
				code,
				message
			} }, STATUS_BY_CODE[code]);
		}
	}
	/** `GET .overview` */
	async overview() {
		const scan = await this.scan();
		const effective = scan.entries.filter((entry) => entry.effective);
		const neverCalled = effective.filter((entry) => entry.calls === 0);
		const onDisk = new Set(scan.knownNames);
		for (const entry of scan.entries) onDisk.add(entry.name);
		for (const entry of scan.archived) onDisk.add(entry.name);
		const usageNames = indexUsage(this.cache.sessions, this.now());
		let removed = 0;
		for (const name of usageNames.keys()) if (!onDisk.has(name)) removed += 1;
		return {
			generatedAt: this.now().toISOString(),
			roots: scan.roots,
			totals: {
				active: effective.length,
				archived: scan.archived.length,
				catalogChars: effective.reduce((sum, entry) => sum + entry.descriptionChars, 0),
				catalogTokens: effective.reduce((sum, entry) => sum + entry.approxTokens, 0),
				calls: effective.reduce((sum, entry) => sum + entry.calls, 0),
				calls30d: effective.reduce((sum, entry) => sum + entry.calls30d, 0),
				neverCalled: neverCalled.length,
				neverCalledTokens: neverCalled.reduce((sum, entry) => sum + entry.approxTokens, 0),
				removed
			},
			backfill: this.cache.backfill,
			corpusRange: this.corpusRange(),
			globalArchiveDir: archiveDirFor(join(this.home.agentsHome, "skills"))
		};
	}
	/** 频次统计覆盖的会话起止日期与会话数。 */
	corpusRange() {
		let from = null;
		let to = null;
		const sessions = Object.values(this.cache.sessions);
		for (const record of sessions) {
			const createdAt = record.createdAt;
			if (createdAt === void 0) continue;
			if (from === null || createdAt < from) from = createdAt;
			if (to === null || createdAt > to) to = createdAt;
		}
		return {
			from: from === null ? null : toDateKey(from),
			to: to === null ? null : toDateKey(to),
			sessions: sessions.length
		};
	}
	/** `GET .skills` */
	async skills(query) {
		if (query.scope === "global") {
			const scan = await this.scan();
			const selected = filterByState(scan.entries, query.state, scan.archived);
			const entries = query.state === "archived" ? [...selected] : [...selected].sort(compareByCalls);
			return {
				scope: "global",
				state: query.state,
				entries,
				total: entries.length,
				archiveDir: archiveDirFor(join(this.home.agentsHome, "skills"))
			};
		}
		const workspaceId = query.workspaceId;
		if (workspaceId === void 0 || workspaceId === "") throw new OptimizeError("invalid-request", "项目范围必须带 workspaceId");
		const workspace = this.findWorkspace(workspaceId);
		if (workspace === void 0) throw new OptimizeError("not-found", "找不到该工作区");
		if (!await pathExists(workspace.path)) throw new OptimizeError("not-found", "该工作区路径已失效，不能读取或操作它的 skill");
		const projectRoot = await this.projectRootOf(workspace);
		const roots = projectRoots(projectRoot);
		const usage = indexUsage(this.cache.sessions, this.now(), projectRoot);
		const scanned = [];
		for (const root of roots) scanned.push(...await scanSkillRoot(root));
		const marked = markEffective(withUsage(scanned, usage));
		const archived = [];
		for (const root of roots) archived.push(...await scanArchiveDir(archiveDirFor(root.path), root.id));
		const selected = filterByState(marked, query.state, archived);
		const entries = query.state === "archived" ? [...selected] : [...selected].sort(compareByCalls);
		return {
			scope: "project",
			workspaceId,
			state: query.state,
			entries,
			total: entries.length,
			archiveDir: archiveDirFor(roots[0]?.path ?? projectRoot)
		};
	}
	/** `GET .projects` */
	async projects() {
		const workspaces = this.deps.workspaceRegistry?.list() ?? [];
		const projects = [];
		for (const workspace of workspaces) {
			const exists = await pathExists(workspace.path);
			const projectRoot = exists ? await this.projectRootOf(workspace) : workspace.path;
			const roots = projectRoots(projectRoot);
			const scanned = [];
			if (exists) for (const root of roots) scanned.push(...await scanSkillRoot(root));
			const marked = markEffective(withUsage(scanned, indexUsage(this.cache.sessions, this.now(), projectRoot))).filter((entry) => entry.effective);
			marked.sort(compareByTokens);
			let archivedCount = 0;
			if (exists) for (const root of roots) archivedCount += (await scanArchiveDir(archiveDirFor(root.path), root.id)).length;
			projects.push({
				id: workspace.id,
				title: workspace.title,
				path: workspace.path,
				exists,
				root: projectRoot,
				skillCount: marked.length,
				archivedCount,
				approxTokens: marked.reduce((sum, entry) => sum + entry.approxTokens, 0),
				preview: marked.slice(0, 6)
			});
		}
		projects.sort((a, b) => b.skillCount - a.skillCount || a.title.localeCompare(b.title));
		return {
			projects,
			total: projects.length,
			missing: projects.filter((project) => !project.exists).length
		};
	}
	/** 归档 / 还原。 */
	async move(request, action) {
		if (request.method !== "POST") throw new OptimizeError("invalid-request", "该端点只接受 POST");
		let body;
		try {
			body = await request.json();
		} catch {
			throw new OptimizeError("invalid-request", "请求体不是合法 JSON");
		}
		const parsed = parseMoveRequest(body);
		const skillsDir = await this.resolveRootDir(parsed);
		const result = await this.serializeMove(skillsDir, async () => action === "archive" ? await moveToArchive(skillsDir, parsed.dirName, this.now()) : await restoreFromArchive(skillsDir, parsed.dirName));
		this.memo = void 0;
		return {
			ok: true,
			rootId: parsed.rootId,
			dirName: parsed.dirName,
			to: result.to,
			archiveDir: archiveDirFor(skillsDir),
			...result.renamedTo === void 0 ? {} : { renamedTo: result.renamedTo }
		};
	}
	/** 按 key 串行执行一个异步任务。 */
	serializeMove(key, task) {
		const next = (this.moveChains.get(key) ?? Promise.resolve()).then(task, task);
		this.moveChains.set(key, next.then(() => void 0, () => void 0));
		return next;
	}
	/** 把 (scope, workspaceId?, rootId) 解析成一个可信的根目录。 */
	async resolveRootDir(request) {
		if (request.rootId === "bundled") throw new OptimizeError("readonly-root", "内置 skill 是 App 自带的只读资源，不能归档");
		const globalIds = ["user-dsh", "user-agents"];
		const projectIds = ["project-dsh", "project-agents"];
		if (request.scope === "global") {
			if (!globalIds.includes(request.rootId)) throw new OptimizeError("unknown-root", `全局范围不接受根 ${request.rootId}`);
			const root = globalRoots(this.home).find((candidate) => candidate.id === request.rootId);
			if (root === void 0) throw new OptimizeError("unknown-root", `根 ${request.rootId} 当前不可用`);
			return root.path;
		}
		if (!projectIds.includes(request.rootId)) throw new OptimizeError("unknown-root", `项目范围不接受根 ${request.rootId}`);
		const workspaceId = request.workspaceId;
		if (workspaceId === void 0 || workspaceId === "") throw new OptimizeError("invalid-request", "项目范围必须带 workspaceId");
		const workspace = this.findWorkspace(workspaceId);
		if (workspace === void 0) throw new OptimizeError("not-found", "找不到该工作区");
		if (!await pathExists(workspace.path)) throw new OptimizeError("not-found", "该工作区路径已失效，不能读取或操作它的 skill");
		const root = projectRoots(await this.projectRootOf(workspace)).find((candidate) => candidate.id === request.rootId);
		if (root === void 0) throw new OptimizeError("unknown-root", `根 ${request.rootId} 当前不可用`);
		return root.path;
	}
	/** 找工作区；没有 workspaceRegistry 时一律找不到。 */
	findWorkspace(id) {
		return this.deps.workspaceRegistry?.list().find((workspace) => workspace.id === id);
	}
	/** 工作区 → 项目根（先解析真实路径，否则会话 cwd 前缀匹配会对不上）。 */
	async projectRootOf(workspace) {
		if (!await pathExists(workspace.path)) return workspace.path;
		return resolveProjectRoot(await realWorkspacePath(workspace.path));
	}
	/** 扫全局三个根，带 2 秒内存缓存。 */
	async scan() {
		const cached = this.memo;
		const at = Date.now();
		if (cached !== void 0 && cached.usageRevision === this.usageRevision && at - cached.at < SCAN_TTL_MS) return cached;
		const startedRevision = this.usageRevision;
		const roots = globalRoots(this.home);
		const scanned = [];
		for (const root of roots) scanned.push(...await scanSkillRoot(root));
		const entries = markEffective(withUsage(scanned, indexUsage(this.cache.sessions, this.now())));
		const rootInfos = [];
		for (const root of roots) rootInfos.push({
			id: root.id,
			scope: "global",
			display: root.display,
			path: root.path,
			removable: root.removable,
			exists: await pathExists(root.path),
			count: entries.filter((entry) => entry.rootId === root.id && entry.effective).length
		});
		const archived = [];
		for (const root of roots) {
			if (!root.removable) continue;
			archived.push(...await scanArchiveDir(archiveDirFor(root.path), root.id));
		}
		archived.sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
		const knownNames = /* @__PURE__ */ new Set();
		for (const entry of entries) knownNames.add(entry.name);
		for (const entry of archived) knownNames.add(entry.name);
		for (const workspace of this.deps.workspaceRegistry?.list() ?? []) {
			if (!await pathExists(workspace.path)) continue;
			const projectRoot = await this.projectRootOf(workspace);
			for (const root of projectRoots(projectRoot)) for (const entry of await scanSkillRoot(root)) knownNames.add(entry.name);
		}
		const memo = {
			at,
			usageRevision: startedRevision,
			knownNames,
			roots: rootInfos,
			entries,
			archived
		};
		this.memo = startedRevision === this.usageRevision ? memo : void 0;
		return memo;
	}
	/** 启动回溯；重复调用只跑一次。 */
	startBackfill() {
		if (this.backfillPromise !== void 0 || this.disposed) return;
		this.backfillPromise = this.runBackfill().finally(() => {
			this.backfillPromise = void 0;
		});
	}
	/** 把还没处理过的会话日志读一遍。 */
	async runBackfill() {
		const query = this.deps.sessionQuery;
		if (query === void 0) {
			this.cache.backfill = {
				state: "partial",
				done: 0,
				total: 0
			};
			return;
		}
		let records;
		try {
			records = await query.listSessions();
		} catch (error) {
			this.deps.logger?.warn?.("[dsh-context-optimize] 列出会话失败：", error);
			this.cache.backfill = {
				state: "partial",
				done: 0,
				total: 0
			};
			return;
		}
		const liveIds = new Set(records.filter((record) => record.live).map((record) => record.header.id));
		const pending = records.filter((record) => this.cache.sessions[record.header.id] === void 0 || liveIds.has(record.header.id));
		this.cache.backfill = {
			state: "running",
			done: records.length - pending.length,
			total: records.length
		};
		let done = records.length - pending.length;
		let failures = 0;
		let index = 0;
		const worker = async () => {
			for (;;) {
				const current = index;
				index += 1;
				const record = pending[current];
				if (record === void 0) return;
				const id = record.header.id;
				try {
					const snapshot = await withTimeout(query.readSession(id), this.deps.sessionReadTimeoutMs ?? 3e4);
					const createdAt = snapshot.session?.createdAt ?? record.header.createdAt;
					const usage = this.cache.sessions[id] ?? newSessionRecord(snapshot.session?.cwd ?? record.header.cwd ?? null, createdAt);
					if (usage.cwd === null) usage.cwd = snapshot.session?.cwd ?? record.header.cwd ?? null;
					if (usage.createdAt === void 0 && createdAt !== void 0) usage.createdAt = createdAt;
					foldEvents(usage, snapshot.events);
					this.cache.sessions[id] = usage;
				} catch (error) {
					failures += 1;
					this.deps.logger?.warn?.(`[dsh-context-optimize] 读取会话 ${id} 失败，下次启动会重试：`, error);
				}
				done += 1;
				this.cache.backfill = {
					state: "running",
					done,
					total: records.length
				};
			}
		};
		const workers = Array.from({ length: Math.min(BACKFILL_CONCURRENCY, Math.max(1, pending.length)) }, worker);
		await Promise.all(workers);
		this.cache.backfill = {
			state: failures > 0 ? "partial" : "done",
			done: records.length - failures,
			total: records.length
		};
		this.usageRevision += 1;
		this.memo = void 0;
		await this.flush();
	}
	/** 攒一下再落盘。 */
	scheduleSave() {
		if (this.disposed) return;
		if (this.saveTimer !== void 0) return;
		this.saveTimer = setTimeout(() => {
			this.saveTimer = void 0;
			this.flush();
		}, SAVE_DEBOUNCE_MS);
		this.saveTimer.unref?.();
	}
	/** 立即落盘；多次调用会串行执行，后一次一定写更新的快照。 */
	flush() {
		this.flushChain = this.flushChain.then(() => this.writeCache());
		return this.flushChain;
	}
	async writeCache() {
		try {
			await saveCache(this.deps.cachePath, this.cache);
		} catch (error) {
			this.deps.logger?.warn?.("[dsh-context-optimize] 写频次缓存失败：", error);
		}
	}
};
/** 给扫描结果补上频次字段。 */
function withUsage(entries, usage) {
	return entries.map((entry) => {
		const stat = usage.get(entry.name);
		return {
			...entry,
			effective: true,
			calls: stat?.calls ?? 0,
			calls30d: stat?.calls30d ?? 0,
			lastUsedAt: stat?.lastUsedAt ?? null
		};
	});
}
/** 解析 skills 查询参数。 */
function parseSkillsQuery(url) {
	const scope = url.searchParams.get("scope");
	if (scope !== "global" && scope !== "project") throw new OptimizeError("invalid-request", "scope 必须是 global 或 project");
	const rawState = url.searchParams.get("state") ?? "all";
	if (rawState !== "all" && rawState !== "never-called" && rawState !== "archived") throw new OptimizeError("invalid-request", "state 不合法");
	const workspaceId = url.searchParams.get("workspaceId") ?? void 0;
	return workspaceId === void 0 ? {
		scope,
		state: rawState
	} : {
		scope,
		workspaceId,
		state: rawState
	};
}
/** 解析并校验归档 / 还原请求体。 */
function parseMoveRequest(body) {
	if (typeof body !== "object" || body === null) throw new OptimizeError("invalid-request", "请求体必须是对象");
	const record = body;
	const scope = record["scope"];
	const rootId = record["rootId"];
	const dirName = record["dirName"];
	if (scope !== "global" && scope !== "project") throw new OptimizeError("invalid-request", "scope 不合法");
	if (typeof rootId !== "string" || ![
		"user-dsh",
		"user-agents",
		"project-dsh",
		"project-agents",
		"bundled"
	].includes(rootId)) throw new OptimizeError("unknown-root", "rootId 不合法");
	if (typeof dirName !== "string" || dirName === "") throw new OptimizeError("invalid-request", "dirName 不能为空");
	const workspaceId = record["workspaceId"];
	return {
		scope,
		rootId,
		dirName,
		...typeof workspaceId === "string" && workspaceId !== "" ? { workspaceId } : {}
	};
}
/** 给 promise 加超时。 */
async function withTimeout(promise, ms) {
	if (ms <= 0) return promise;
	let timer;
	try {
		return await Promise.race([promise, new Promise((_resolve, reject) => {
			timer = setTimeout(() => {
				reject(new OptimizeError("internal", `会话读取超时（${String(ms)}ms）`));
			}, ms);
			timer.unref?.();
		})]);
	} finally {
		if (timer !== void 0) clearTimeout(timer);
	}
}
/** JSON 响应。 */
function json(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store"
		}
	});
}
// src/index.ts
/**
* 宿主（node 半）入口：注册五条认证路由、订阅会话事件做频次增量、启动时读缓存并后台补齐历史。
*
* 依赖两个 DSH 宿主服务：
*   - `connection`：认证路由（与 dsh-output 同一套写法）；
*   - `sessionQuery` / `workspaceRegistry`：可选注入——缺了也能跑，只是频次为空 / 项目页为空。
*/
/** Cordis 函数插件名。 */
const name = "@kulebbb/dsh-context-optimize";
/** 只有路由载体是硬依赖；其余服务用 scoped inject 可选接入。 */
const inject = ["connection"];
/**
* 注册插件。
* @param ctx - 宿主上下文。
*/
function apply(ctx) {
	const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), ".dsh");
	const cachePath = join(dshHome, "storages", "dsh-context-optimize", "frequency.v2.json");
	let sessionQuery;
	let workspaceRegistry;
	ctx.inject(["sessionQuery"], (scope) => {
		sessionQuery = scope["sessionQuery"];
	});
	ctx.inject(["workspaceRegistry"], (scope) => {
		workspaceRegistry = scope["workspaceRegistry"];
	});
	const service = new ContextOptimizeService({
		dshHome,
		cachePath,
		logger: ctx.logger,
		get sessionQuery() {
			return sessionQuery;
		},
		get workspaceRegistry() {
			return workspaceRegistry;
		}
	});
	ctx.effect(() => {
		service.initialize();
		return () => {
			service.dispose();
		};
	}, "dsh-context-optimize: cache");
	for (const path of Object.values(ROUTES)) {
		const methods = path === ROUTES.archive || path === ROUTES.restore ? ["POST"] : ["GET"];
		ctx.effect(() => ctx.connection.fetch.register({
			path,
			methods,
			requestBody: "buffered",
			fetch: (request) => service.handle(request)
		}), `dsh-context-optimize: ${path}`);
	}
	ctx.effect(() => ctx.on("session/event", (session, event) => {
		const id = session?.id === void 0 ? "" : String(session.id);
		if (id === "") return;
		const cwd = typeof session.header?.cwd === "string" ? session.header.cwd : null;
		const createdAt = typeof session.header?.createdAt === "number" ? session.header.createdAt : void 0;
		service.ingest(id, cwd, createdAt, event);
	}), "dsh-context-optimize: live session events");
}
export { apply, inject, name };
