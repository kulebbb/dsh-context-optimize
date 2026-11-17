import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { access, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
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
	return `${skillsDir.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]+$/, "")}/skills-archived`;
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
	busy: 409,
	"analysis-failed": 500,
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
/** 路由前缀；所有端点都是 `${ROUTE_PREFIX}.<action>` 或 `.insight.<action>` 的形式。 */
const ROUTE_PREFIX = "/api/context-optimize";
/** 面板会用到的全部端点（相对路径，客户端直接 fetch）。 */
const ROUTES = {
	overview: `${ROUTE_PREFIX}.overview`,
	skills: `${ROUTE_PREFIX}.skills`,
	projects: `${ROUTE_PREFIX}.projects`,
	archive: `${ROUTE_PREFIX}.archive`,
	restore: `${ROUTE_PREFIX}.restore`,
	version: `${ROUTE_PREFIX}.version`,
	insightModels: `${ROUTE_PREFIX}.insight.models`,
	insightStart: `${ROUTE_PREFIX}.insight.start`,
	insightStatus: `${ROUTE_PREFIX}.insight.status`,
	insightCancel: `${ROUTE_PREFIX}.insight.cancel`,
	insightHistory: `${ROUTE_PREFIX}.insight.history`,
	insightReport: `${ROUTE_PREFIX}.insight.report`,
	insightRemove: `${ROUTE_PREFIX}.insight.remove`,
	insightRead: `${ROUTE_PREFIX}.insight.read`
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
* 全流程**没有删除**。归档 = 把 skill 从 skills 目录搬到同级的 skills-archived；
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
const MAX_SESSIONS$1 = 5e3;
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
	if (ids.length <= MAX_SESSIONS$1) return cache;
	const sorted = ids.sort((a, b) => {
		const left = cache.sessions[a];
		const right = cache.sessions[b];
		const leftHas = left !== void 0 && Object.keys(left.days).length > 0 ? 1 : 0;
		return (right !== void 0 && Object.keys(right.days).length > 0 ? 1 : 0) - leftHas || (right?.lastSeq ?? 0) - (left?.lastSeq ?? 0);
	});
	const kept = {};
	for (const id of sorted.slice(0, MAX_SESSIONS$1)) {
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
// src/host/release-check.ts
/**
* 版本检查：只在「从 npm 同名安装」时给面板一个「新版本」入口。
*
* 判据与 DSH 插件页保持一致——否则会出现「我们点亮了、插件页却没有更新按钮」的死路：
* 1. 安装来源必须是 registry（依赖值是版本号 / 范围 / tag）；`link:`、`file:`、Git 一律不参与；
* 2. 只认 `dist-tags.latest` 指向的正式版（latest 端点只返回正式版；带 `-` 的预发布不提示），
*    且该版本清单里声明了 `dsh.bundle`（否则装了也起不来）；
* 3. 只有比当前版本高才提示。
*
* 失败一律静默：网络、超时、坏 JSON 都返回「不提示」，不给面板添噪音。
*/
/** 安装源：先官方源，失败再问国内镜像（与 dsh-context 的做法一致）。 */
const RELEASE_REGISTRIES = ["https://registry.npmjs.org", "https://registry.npmmirror.com"];
const OK_TTL_MS = 36e5;
const FAIL_TTL_MS = 3e5;
const TIMEOUT_MS = 4e3;
/** 预发布阶段的大小：同一版本号下 alpha < beta < rc < 正式版。 */
const PRE_RANK = {
	alpha: 1,
	beta: 2,
	rc: 3
};
const STABLE_RANK = 4;
/**
* 解析 `1.2.3` / `v1.2.3` / `1.2.3-rc.1` 这类版本串；不认识的返回 null。
* 只覆盖本包会用到的形态，不追求完整的 semver。
*/
function parseVersion(input) {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)(?:\.(\d+))?)?(?:\+[0-9a-z.-]+)?$/i.exec(input.trim());
	if (match === null) return null;
	const stage = match[4]?.toLowerCase();
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		rank: stage === void 0 ? STABLE_RANK : PRE_RANK[stage] ?? 0,
		serial: match[5] === void 0 ? 0 : Number(match[5])
	};
}
/** 比较两个版本；任一不可解析时返回 null（调用方按「不提示」处理）。 */
function compareVersions(left, right) {
	const a = parseVersion(left);
	const b = parseVersion(right);
	if (a === null || b === null) return null;
	for (const key of [
		"major",
		"minor",
		"patch",
		"rank",
		"serial"
	]) if (a[key] !== b[key]) return a[key] - b[key];
	return 0;
}
/** 是否是正式版（无 alpha/beta/rc 后缀）。 */
function isStableVersion(input) {
	return parseVersion(input)?.rank === STABLE_RANK;
}
/**
* 把 profile 依赖值分类。只有 registry 才可能应用内更新。
*
* 形如 `0.1.2`、`^0.1.2`、`latest` 的都算 registry；`link:`、`file:`、`workspace:`、
* `git+https://…#sha`、`github:owner/repo`、裸 URL 与本地路径都算 other。
*/
function classifyInstallSource(spec) {
	if (spec === void 0 || spec.trim() === "") return "unknown";
	const value = spec.trim();
	if (/^(link|file|workspace|portal):/i.test(value)) return "other";
	if (/^(git\+|git:|github:|gitlab:|bitbucket:|ssh:)/i.test(value)) return "other";
	if (/^(npm|patch|catalog):/i.test(value)) return "other";
	if (/^[\w.-]+@[\w.-]+:/.test(value)) return "other";
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return "other";
	if (/^(\.{1,2}\/|\/|~\/)/.test(value)) return "other";
	if (/^[a-z]:[\\/]/i.test(value) || /^\\\\/.test(value)) return "other";
	return "registry";
}
/**
* 推导 profile 目录：优先用 DSH 注入的 `DSH_PROFILE_DIR`，其次按 `DSH_PROFILE` 拼。
* 两者都没有时返回 undefined——此时安装来源未知，不提示。
*/
function resolveProfileDir(env, dshHome) {
	const explicit = env.DSH_PROFILE_DIR?.trim();
	if (explicit !== void 0 && explicit !== "") return explicit;
	const profile = env.DSH_PROFILE?.trim();
	if (profile !== void 0 && profile !== "") return join(dshHome, "profiles", profile);
}
/** 从 profile 的 package.json 里取本包的依赖值；三类依赖都看一遍。 */
function installSpecOf(manifest, packageName) {
	if (typeof manifest !== "object" || manifest === null) return void 0;
	for (const field of [
		"dependencies",
		"devDependencies",
		"optionalDependencies"
	]) {
		const deps = manifest[field];
		if (typeof deps !== "object" || deps === null) continue;
		const spec = deps[packageName];
		if (typeof spec === "string") return spec;
	}
}
/** 读 profile 清单里的依赖值；文件缺失或坏 JSON 都当作「未知」。 */
async function readInstallSpec(profileDir, packageName) {
	if (profileDir === void 0) return void 0;
	try {
		const text = await readFile(join(profileDir, "package.json"), "utf8");
		return installSpecOf(JSON.parse(text), packageName);
	} catch {
		return;
	}
}
/**
* 读本包自己的版本号：打包后 `lib/index.js` 的上一级是包根；
* 直接跑源码时（`src/host/`）要再上一级。用包名做校验，避免误读别的 package.json。
*/
async function readOwnVersion() {
	for (const candidate of ["../package.json", "../../package.json"]) try {
		const text = await readFile(new URL(candidate, import.meta.url), "utf8");
		const parsed = JSON.parse(text);
		if (typeof parsed !== "object" || parsed === null) continue;
		const record = parsed;
		if (record.name !== "@kulebbb/dsh-context-optimize") continue;
		if (typeof record.version !== "string" || record.version === "") continue;
		return record.version;
	} catch {}
	return null;
}
/**
* 从宿主的 `profileContext` 服务取 profile 目录。
*
* 注意：`DSH_PROFILE_DIR` 只存在于「shell 工具调用」的环境快照里，宿主进程环境本身没有它，
* 所以这里必须以服务为准，环境变量只作为 CLI / 开发场景的兜底。
*/
function profileDirOfContext(ctx) {
	try {
		const dir = (ctx.get?.("profileContext"))?.dir;
		return typeof dir === "string" && dir !== "" ? dir : void 0;
	} catch {
		return;
	}
}
/** 问一个安装源「latest 是哪个版本、能不能装」；失败返回 null。 */
async function fetchLatest(base, name, fetchImpl, timeoutMs) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetchImpl(`${base}/${encodeURIComponent(name).replace(/^%40/, "@")}/latest`, {
			headers: { accept: "application/json" },
			signal: controller.signal
		});
		if (!response.ok) return null;
		const body = await response.json();
		const manifest = typeof body === "object" && body !== null ? body : null;
		const version = typeof manifest?.version === "string" ? manifest.version : null;
		if (version === null || version === "") return null;
		const dsh = typeof manifest?.dsh === "object" && manifest.dsh !== null ? manifest.dsh : null;
		return {
			version,
			hasBundle: dsh?.bundle !== void 0 && dsh.bundle !== null
		};
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
/**
* 版本检查器：带 1 小时成功缓存 / 5 分钟失败缓存 + 并发去重。
* 一个进程一个实例即可，面板反复挂载不会重复请求安装源。
*/
var ReleaseCheck = class {
	packageName;
	registries;
	fetchImpl;
	now;
	timeoutMs;
	okTtlMs;
	failTtlMs;
	readVersion;
	readSpec;
	cache = null;
	inflight = null;
	constructor(options = {}) {
		this.packageName = options.packageName ?? "@kulebbb/dsh-context-optimize";
		this.registries = options.registries ?? RELEASE_REGISTRIES;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.now = options.now ?? Date.now;
		this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
		this.okTtlMs = options.okTtlMs ?? OK_TTL_MS;
		this.failTtlMs = options.failTtlMs ?? FAIL_TTL_MS;
		this.readVersion = options.readVersion ?? readOwnVersion;
		this.readSpec = options.readSpec ?? (() => readInstallSpec(options.profileDir, this.packageName));
	}
	/** 查一次版本；缓存有效时直接返回上次结果，并发调用共享同一个请求。 */
	async check() {
		const cached = this.cache;
		if (cached !== null && this.now() - cached.at < (cached.ok ? this.okTtlMs : this.failTtlMs)) return cached.payload;
		if (this.inflight !== null) return this.inflight;
		const run = this.run().finally(() => {
			this.inflight = null;
		});
		this.inflight = run;
		return run;
	}
	settle(ok, payload) {
		this.cache = {
			at: this.now(),
			ok,
			payload
		};
		return payload;
	}
	async run() {
		const current = await this.readVersion();
		if (current === null) return this.settle(false, {
			current: "",
			latest: null,
			updateAvailable: false,
			installSource: "unknown"
		});
		const installSource = classifyInstallSource(await this.readSpec());
		if (installSource !== "registry") return this.settle(true, {
			current,
			latest: null,
			updateAvailable: false,
			installSource
		});
		let found = null;
		for (const base of this.registries) {
			found = await fetchLatest(base, this.packageName, this.fetchImpl, this.timeoutMs);
			if (found !== null) break;
		}
		if (found === null) return this.settle(false, {
			current,
			latest: null,
			updateAvailable: false,
			installSource
		});
		const order = compareVersions(found.version, current);
		const updateAvailable = found.hasBundle && isStableVersion(found.version) && order !== null && order > 0;
		return this.settle(true, {
			current,
			latest: found.version,
			updateAvailable,
			installSource
		});
	}
};
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
	versionCheck;
	constructor(deps) {
		this.deps = deps;
		this.versionCheck = deps.versionCheck ?? new ReleaseCheck({ profileDir: deps.profileDir });
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
	/**
	* 版本检查：只有「从 npm 同名安装」且安装源上有更高正式版时才提示；
	* 其余情况（本地目录 / Git / 查不到 / 超时）一律返回不提示，不抛错。
	*/
	async version() {
		return this.versionCheck.check();
	}
	/** 路由入口：按 `request.url` 的 pathname 分发。 */
	async handle(request) {
		const url = new URL(request.url);
		try {
			switch (url.pathname) {
				case ROUTES.overview: return json$1(await this.overview());
				case ROUTES.skills: return json$1(await this.skills(parseSkillsQuery(url)));
				case ROUTES.projects: return json$1(await this.projects());
				case ROUTES.archive: return json$1(await this.move(request, "archive"));
				case ROUTES.restore: return json$1(await this.move(request, "restore"));
				case ROUTES.version: return json$1(await this.version());
				default: throw new OptimizeError("not-found", `未知端点 ${url.pathname}`);
			}
		} catch (error) {
			const { code, message } = normalizeError(error);
			return json$1({ error: {
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
	/**
	* 配置卫生快照：给「洞察」报告用。
	*
	* 只读扫描结果，不调模型、不碰磁盘，所以放在这份服务里零额外成本。
	* 取「近 30 天从未被调用」的生效条目，按占用从大到小给出示例名。
	*/
	async hygieneSnapshot() {
		const effective = (await this.scan()).entries.filter((entry) => entry.effective);
		const unused = effective.filter((entry) => entry.calls30d === 0).sort(compareByTokens);
		return {
			active: effective.length,
			unused30d: unused.length,
			unusedTokens: unused.reduce((sum, entry) => sum + entry.approxTokens, 0),
			examples: unused.slice(0, 3).map((entry) => entry.name),
			complete: this.cache.backfill.state === "done"
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
		const usage = indexUsage(this.cache.sessions, this.now());
		const entries = markEffective(withUsage(scanned, usage));
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
		const projectRootsSeen = /* @__PURE__ */ new Set();
		for (const workspace of this.deps.workspaceRegistry?.list() ?? []) {
			if (!await pathExists(workspace.path)) continue;
			projectRootsSeen.add(await this.projectRootOf(workspace));
		}
		const projectRootDefs = [...projectRootsSeen].flatMap((projectRoot) => projectRoots(projectRoot));
		for (const root of projectRootDefs) for (const entry of await scanSkillRoot(root)) knownNames.add(entry.name);
		if ([...usage.keys()].some((name) => !knownNames.has(name))) for (const root of projectRootDefs) for (const entry of await scanArchiveDir(archiveDirFor(root.path), root.id)) knownNames.add(entry.name);
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
					const snapshot = await withTimeout$2(query.readSession(id), this.deps.sessionReadTimeoutMs ?? 3e4);
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
async function withTimeout$2(promise, ms) {
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
function json$1(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store"
		}
	});
}
// src/host/insight/collect.ts
/** 会改动文件的工具；用来从 tool/result 的 meta 里数「改了几个文件」。 */
const WRITE_TOOLS = /* @__PURE__ */ new Set([
	"write",
	"edit",
	"apply_patch",
	"str_replace_editor"
]);
/** 默认预算：与 Claude Code 的口径接近，够模型判断模式又不至于烧 token。 */
const DEFAULT_DIGEST_BUDGET = {
	userLines: 10,
	userChars: 400,
	assistantLines: 4,
	assistantChars: 240,
	failureLines: 5,
	failureChars: 120,
	maxChars: 6e3
};
/** 把一个未知值当对象读；不是对象就给空对象。 */
function asRecord(value) {
	return typeof value === "object" && value !== null ? value : {};
}
/** 从事件 data 里取数组字段。 */
function contentBlocks(value) {
	const content = asRecord(value)["content"];
	return Array.isArray(content) ? content : [];
}
/** 把内容块里的文本拼起来；没有文本返回空串。 */
function textOf(blocks) {
	const parts = [];
	for (const block of blocks) {
		const record = asRecord(block);
		if (record["type"] !== "text") continue;
		const text = record["text"];
		if (typeof text === "string") parts.push(text);
	}
	return parts.join("\n").trim();
}
/** 截断到 n 个字符，超出加省略号。 */
function clip(text, n) {
	const clean = text.replace(/\s+/g, " ").trim();
	return clean.length <= n ? clean : `${clean.slice(0, n)}…`;
}
/** 本地时区的 `YYYY-MM-DD`。 */
function toLocalDateKey(timestamp) {
	const date = new Date(timestamp);
	const pad = (n) => String(n).padStart(2, "0");
	return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
/** 本地时区的小时（0–23）。 */
function toLocalHour(timestamp) {
	return new Date(timestamp).getHours();
}
/** FNV-1a 32 位哈希，够用来判断摘要是否变化。 */
function hashText(text) {
	let hash = 2166136261;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}
/**
* 判断一个会话是不是「人工会话」。
*
* 子代理会话会大幅拉偏结论（本机 803 个会话里 632 个是子代理），
* 播种会话（isSeeded）是父会话的副本，都不计入。
*/
function isHumanSession(header) {
	if (header.parentSession !== void 0 && header.parentSession !== "") return false;
	if (header.origin === "subagent") return false;
	if ((header.delegationDepth ?? 0) > 0) return false;
	if (header.isSeeded === true) return false;
	return true;
}
/** 取 cwd 的最后一段作为项目名；路径为空时给 `unknown`。 */
function projectNameOf(cwd) {
	if (cwd === null || cwd === void 0 || cwd === "") return "unknown";
	const parts = cwd.split(/[\\/]/).filter((part) => part !== "");
	return parts.length === 0 ? cwd : parts[parts.length - 1] ?? cwd;
}
/** 从 `exit code: 2` / `signal: SIGTERM` 判断这次命令算不算失败。 */
function failureOfJob(status, detail) {
	if (status === "failed" || status === "killed") return true;
	if (typeof detail !== "string") return false;
	const match = /exit code:\s*(\d+)/i.exec(detail);
	if (match !== null) return (match[1] ?? "0") !== "0";
	return /signal:/i.test(detail);
}
/**
* 把一个会话的事件折叠成摘要 + 统计。
*
* @param header - 会话头（id / cwd / createdAt）。
* @param events - `readSession` 返回的原始事件。
* @param budget - 摘要预算；测试可注入更小的值。
*/
function foldSession(header, events, budget = DEFAULT_DIGEST_BUDGET) {
	const createdAt = typeof header.createdAt === "number" ? header.createdAt : 0;
	let firstTime = Number.POSITIVE_INFINITY;
	let lastTime = 0;
	let turns = 0;
	let steps = 0;
	let userMessages = 0;
	let assistantMessages = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let title = "";
	let lastSeq = 0;
	const models = /* @__PURE__ */ new Set();
	const filePaths = /* @__PURE__ */ new Set();
	const userTexts = [];
	const assistantTexts = [];
	const failures = [];
	const toolCounts = /* @__PURE__ */ new Map();
	/** 失败的调用 id；job 与 tool/result 两路来源在这里去重。 */
	const failedCalls = /* @__PURE__ */ new Set();
	const callNames = /* @__PURE__ */ new Map();
	for (const raw of events) {
		const event = asRecord(raw);
		const type = event["type"];
		const time = event["time"];
		if (typeof time === "number") {
			if (time < firstTime) firstTime = time;
			if (time > lastTime) lastTime = time;
		}
		const seq = event["seq"];
		if (typeof seq === "number" && seq > lastSeq) lastSeq = seq;
		const data = asRecord(event["data"]);
		if (type === "turn/start") turns += 1;
		else if (type === "step/end") steps += 1;
		else if (type === "user/message") {
			if (asRecord(data["source"])["kind"] !== "user") continue;
			const text = textOf(contentBlocks(data));
			if (text === "") continue;
			userMessages += 1;
			if (userTexts.length < budget.userLines) userTexts.push(clip(text, budget.userChars));
		} else if (type === "assistant/message") {
			assistantMessages += 1;
			const message = asRecord(data["message"]);
			const text = textOf(contentBlocks(message));
			if (text !== "") {
				assistantTexts.push(clip(text, budget.assistantChars));
				if (assistantTexts.length > budget.assistantLines) assistantTexts.shift();
			}
			const usage = asRecord(data["usage"]);
			inputTokens += typeof usage["inputTokens"] === "number" ? usage["inputTokens"] : 0;
			outputTokens += typeof usage["outputTokens"] === "number" ? usage["outputTokens"] : 0;
			cacheReadTokens += typeof usage["cacheReadTokens"] === "number" ? usage["cacheReadTokens"] : 0;
			const source = asRecord(message["source"]);
			if (typeof source["provider"] === "string" && typeof source["model"] === "string") models.add(`${source["provider"]}/${source["model"]}`);
		} else if (type === "tool/call") {
			const name = data["name"];
			const callId = data["callId"];
			if (typeof name === "string") {
				if ((typeof callId === "string" ? callNames.get(callId) : void 0) === void 0) toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
				if (typeof callId === "string") callNames.set(callId, name);
			}
		} else if (type === "job/settled") {
			if (failureOfJob(data["status"], data["detail"])) {
				const callId = asRecord(data["toolCall"])["callId"];
				if (typeof callId === "string") failedCalls.add(callId);
				const detail = data["detail"];
				const label = data["label"];
				const text = typeof label === "string" && label !== "" ? `${label}${typeof detail === "string" && detail !== "" ? ` (${detail})` : ""}` : typeof detail === "string" ? detail : "";
				if (text !== "" && failures.length < budget.failureLines) failures.push(clip(text, budget.failureChars));
			}
		} else if (type === "tool/result") {
			const meta = asRecord(data["meta"]);
			const callId = data["toolCallId"];
			const name = typeof callId === "string" ? callNames.get(callId) : void 0;
			if (asRecord(data["message"])["isError"] === true && typeof callId === "string" && !failedCalls.has(callId)) {
				failedCalls.add(callId);
				if (failures.length < budget.failureLines) failures.push(clip(`${name ?? "工具"} 返回错误`, budget.failureChars));
			}
			if (name !== void 0 && WRITE_TOOLS.has(name)) {
				const path = meta["path"];
				if (typeof path === "string" && path !== "") filePaths.add(path);
				const diffs = meta["diffs"];
				if (Array.isArray(diffs)) for (const diff of diffs) {
					const diffPath = asRecord(diff)["path"];
					if (typeof diffPath === "string" && diffPath !== "") filePaths.add(diffPath);
				}
			}
		} else if (type === "session/title") {
			const next = data["title"];
			if (typeof next === "string" && next.trim() !== "") title = next.trim();
		}
	}
	const start = Number.isFinite(firstTime) ? firstTime : createdAt;
	const end = lastTime > 0 ? lastTime : start;
	const toolCalls = [...toolCounts.values()].reduce((sum, value) => sum + value, 0);
	const toolFailures = /* @__PURE__ */ new Map();
	for (const callId of failedCalls) {
		const name = callNames.get(callId);
		if (name !== void 0) toolFailures.set(name, (toolFailures.get(name) ?? 0) + 1);
	}
	const toolFailuresTotal = failedCalls.size;
	const project = projectNameOf(header.cwd);
	const lines = [];
	lines.push(`项目：${project}`);
	if (title !== "") lines.push(`标题：${clip(title, 120)}`);
	lines.push(`日期：${toLocalDateKey(start)} · 时长 ${String(Math.max(1, Math.round((end - start) / 6e4)))} 分钟 · ${String(turns)} 轮 · ${String(userMessages)} 条你的消息`);
	if (userTexts.length > 0) {
		lines.push("你说了：");
		for (const text of userTexts) lines.push(`- ${text}`);
	}
	if (assistantTexts.length > 0) {
		lines.push("助手结论：");
		for (const text of assistantTexts) lines.push(`- ${text}`);
	}
	const toolSummary = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => `${name}×${String(count)}`).join(" ");
	if (toolSummary !== "") lines.push(`工具：${toolSummary}`);
	if (filePaths.size > 0) lines.push(`改动文件：${String(filePaths.size)} 个`);
	if (failures.length > 0) {
		lines.push("失败：");
		for (const failure of failures) lines.push(`- ${failure}`);
	}
	let digest = lines.join("\n");
	if (digest.length > budget.maxChars) digest = `${digest.slice(0, budget.maxChars)}\n（已截断）`;
	return {
		digest: {
			id: header.id,
			title: title === "" ? clip(userTexts[0] ?? project, 60) : clip(title, 60),
			project,
			createdAt,
			updatedAt: end,
			turns,
			steps,
			userMessages,
			assistantMessages,
			toolCalls,
			toolFailures: toolFailuresTotal,
			inputTokens,
			outputTokens,
			cacheReadTokens,
			filesTouched: filePaths.size,
			models: [...models],
			lastSeq,
			digest,
			digestHash: hashText(digest)
		},
		toolCounts,
		toolFailures
	};
}
/** 给 promise 加超时。 */
async function withTimeout$1(promise, ms, label) {
	if (ms <= 0) return promise;
	let timer;
	try {
		return await Promise.race([promise, new Promise((_resolve, reject) => {
			timer = setTimeout(() => {
				reject(/* @__PURE__ */ new Error(`${label} 超时（${String(ms)}ms）`));
			}, ms);
			timer.unref?.();
		})]);
	} finally {
		if (timer !== void 0) clearTimeout(timer);
	}
}
/** 并发受限的 map；保持结果顺序与输入一致。 */
async function mapLimit$1(items, limit, worker) {
	const results = new Array(items.length).fill(void 0);
	let cursor = 0;
	const run = async () => {
		while (cursor < items.length) {
			const index = cursor;
			cursor += 1;
			const item = items[index];
			if (item === void 0) continue;
			results[index] = await worker(item, index).catch(() => void 0);
		}
	};
	await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, run));
	return results;
}
/**
* 扫描并折叠全部人工会话。
*
* 先按时间和类型过滤，再并发读日志；单个会话读失败只跳过它，不会让整轮失败。
*/
async function collectCorpus(options) {
	const { source, signal } = options;
	const now = options.now().getTime();
	const windowMs = options.days === null ? null : options.days * 864e5;
	const budget = options.budget ?? DEFAULT_DIGEST_BUDGET;
	const listed = await source.listSessions(signal);
	let excludedSubagent = 0;
	let excludedOld = 0;
	let excludedCapped = 0;
	const selected = [];
	for (const item of listed) {
		const header = item.header;
		if (!isHumanSession(header)) {
			excludedSubagent += 1;
			continue;
		}
		const createdAt = typeof header.createdAt === "number" ? header.createdAt : 0;
		if (windowMs !== null && now - createdAt > windowMs) {
			excludedOld += 1;
			continue;
		}
		selected.push({
			header,
			createdAt
		});
	}
	selected.sort((a, b) => b.createdAt - a.createdAt);
	const maxSessions = options.maxSessions ?? 300;
	if (selected.length > maxSessions) {
		excludedCapped = selected.length - maxSessions;
		selected.length = maxSessions;
	}
	let done = 0;
	const total = selected.length;
	const folded = await mapLimit$1(selected, options.concurrency ?? 4, async (item) => {
		if (signal?.aborted) throw new Error("aborted");
		let events = [];
		try {
			events = (await withTimeout$1(source.readSession(item.header.id), options.readTimeoutMs ?? 2e4, `读取会话 ${item.header.id}`)).events;
		} catch (error) {
			options.logger?.warn?.(`[dsh-context-optimize] 洞察：读取会话 ${item.header.id} 失败`, error);
			events = [];
		}
		const result = foldSession(item.header, events, budget);
		done += 1;
		options.onProgress?.(done, total, result.digest.title);
		if (signal?.aborted) throw new Error("aborted");
		return result;
	});
	const sessions = [];
	const projectCounts = /* @__PURE__ */ new Map();
	const toolCounts = /* @__PURE__ */ new Map();
	const hourCounts = new Array(24).fill(0);
	const activeDates = /* @__PURE__ */ new Set();
	let messages = 0;
	let toolCalls = 0;
	let toolFailures = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let durationMs = 0;
	let characters = 0;
	for (const item of folded) {
		if (item === void 0) continue;
		const digest = item.digest;
		sessions.push(digest);
		projectCounts.set(digest.project, (projectCounts.get(digest.project) ?? 0) + 1);
		activeDates.add(toLocalDateKey(digest.createdAt));
		hourCounts[toLocalHour(digest.createdAt)] = (hourCounts[toLocalHour(digest.createdAt)] ?? 0) + 1;
		messages += digest.userMessages;
		toolCalls += digest.toolCalls;
		toolFailures += digest.toolFailures;
		inputTokens += digest.inputTokens;
		outputTokens += digest.outputTokens;
		cacheReadTokens += digest.cacheReadTokens;
		durationMs += Math.max(0, digest.updatedAt - digest.createdAt);
		characters += digest.digest.length;
		for (const [name, count] of item.toolCounts) {
			const entry = toolCounts.get(name) ?? {
				calls: 0,
				failures: 0
			};
			entry.calls += count;
			toolCounts.set(name, entry);
		}
		for (const [name, count] of item.toolFailures) {
			const entry = toolCounts.get(name) ?? {
				calls: 0,
				failures: 0
			};
			entry.failures += count;
			toolCounts.set(name, entry);
		}
	}
	return {
		sessions,
		projects: [...projectCounts.entries()].map(([name, sessions]) => ({
			name,
			sessions
		})).sort((a, b) => b.sessions - a.sessions),
		tools: [...toolCounts.entries()].map(([name, stat]) => ({
			name,
			calls: stat.calls,
			failures: stat.failures
		})).sort((a, b) => b.calls - a.calls),
		hours: hourCounts.map((sessions, hour) => ({
			hour,
			sessions
		})),
		stats: {
			sessions: sessions.length,
			messages,
			toolCalls,
			toolFailures,
			activeDays: activeDates.size,
			inputTokens,
			outputTokens,
			cacheReadTokens,
			durationMs,
			characters,
			excludedSubagent,
			excludedOld,
			excludedCapped
		}
	};
}
// src/host/insight/analyze.ts
/**
* 模型层：两次调用——逐会话打标签、全局汇总。
*
* 这里只管「怎么问、怎么解析、怎么兜底」，不关心并发、缓存和落盘（那是 service 的事）。
* 解析失败统一重试一次；仍失败就抛出，由上层决定跳过这个会话还是整轮失败。
*/
/** 默认单次调用超时。 */
const DEFAULT_TIMEOUT_MS = 18e4;
/** 模型返回了无法解析的内容。 */
var InsightModelError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "InsightModelError";
	}
};
/** 模型输出被 maxTokens 截断；单列出来，免得只剩一句「JSON 解析失败」。 */
var InsightTruncatedError = class extends InsightModelError {
	constructor(limit) {
		super(`模型输出太长被截断（已经放宽到 ${String(limit)} token 还没写完），这次没拿到完整 JSON；可以把范围缩小一档，或换一个输出上限更大的模型`);
		this.name = "InsightTruncatedError";
	}
};
/** 单次调用超时；重试只会再等一轮，所以调用方不再重试。 */
var InsightTimeoutError = class extends InsightModelError {
	constructor(timeoutMs) {
		super(`模型 ${String(Math.round(timeoutMs / 1e3))} 秒内没写完，已中止；可以缩小范围或换更快的模型`);
		this.name = "InsightTimeoutError";
	}
};
/** 从文本里抠出第一个 JSON 对象；容忍 ```json 围栏和前后废话。 */
function extractJsonObject(text) {
	let body = text.trim();
	const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(body);
	if (fence !== null && fence[1] !== void 0) body = fence[1].trim();
	const start = body.indexOf("{");
	const end = body.lastIndexOf("}");
	if (start < 0 || end <= start) throw new InsightModelError("模型没有返回 JSON 对象");
	try {
		return JSON.parse(body.slice(start, end + 1));
	} catch (error) {
		throw new InsightModelError(`模型返回的 JSON 解析失败：${error instanceof Error ? error.message : "未知错误"}`);
	}
}
/** 把未知值读成字符串，顺带截断。 */
function str(value, max) {
	if (typeof value !== "string") return "";
	const clean = value.replace(/\s+/g, " ").trim();
	return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}
/** 把未知值读成字符串数组。 */
function strList(value, max, maxItems) {
	if (!Array.isArray(value)) return [];
	const out = [];
	for (const item of value) {
		const text = str(item, max);
		if (text !== "") out.push(text);
		if (out.length >= maxItems) break;
	}
	return out;
}
function recordOf(value) {
	return typeof value === "object" && value !== null ? value : {};
}
/**
* 调一次模型并收集文本。
*
* 流必须正常收尾；`error` / `aborted` / 超时一律变成异常，交给上层决定跳过还是中止。
* 截断（max-tokens）不在这里抛：文本可能已经是完整 JSON，只有解析失败才算真失败。
*/
async function complete(llm, selection, options) {
	const controller = new AbortController();
	const onAbort = () => controller.abort();
	options.signal?.addEventListener("abort", onAbort, { once: true });
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	let timedOut = false;
	let timer;
	if (timeoutMs > 0) {
		timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeoutMs);
		timer.unref?.();
	}
	let text = "";
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let failure = null;
	let truncated = false;
	let finished = false;
	let streamError;
	try {
		const stream = llm.stream({
			provider: selection.provider,
			model: selection.model,
			system: options.system,
			messages: [{
				role: "user",
				content: [{
					type: "text",
					text: options.prompt
				}]
			}],
			signal: controller.signal,
			...options.maxTokens === void 0 ? {} : { maxTokens: options.maxTokens },
			...options.temperature === void 0 ? {} : { temperature: options.temperature }
		});
		try {
			for await (const raw of stream) {
				const chunk = recordOf(raw);
				if (chunk["type"] === "text-delta" && typeof chunk["text"] === "string") text += chunk["text"];
				else if (chunk["type"] === "usage") {
					const usage = recordOf(chunk["usage"]);
					if (typeof usage["inputTokens"] === "number") inputTokens += usage["inputTokens"];
					if (typeof usage["outputTokens"] === "number") outputTokens += usage["outputTokens"];
					if (typeof usage["cacheReadTokens"] === "number") cacheReadTokens += usage["cacheReadTokens"];
				} else if (chunk["type"] === "finish") {
					finished = true;
					const reason = recordOf(chunk["reason"]);
					if (reason["kind"] === "error" || reason["kind"] === "aborted") {
						const detail = recordOf(reason["failure"]);
						const code = typeof detail["code"] === "string" ? detail["code"] : reason["kind"];
						const message = typeof detail["message"] === "string" ? detail["message"] : "";
						failure = `${code}${message === "" ? "" : `：${message}`}`;
					} else if (reason["kind"] === "max-tokens") truncated = true;
				}
			}
		} catch (error) {
			streamError = error;
		}
	} finally {
		if (timer !== void 0) clearTimeout(timer);
		options.signal?.removeEventListener("abort", onAbort);
	}
	const usage = {
		text,
		inputTokens,
		outputTokens,
		cacheReadTokens,
		truncated
	};
	if (options.signal?.aborted === true) throw new Error("已取消");
	if (timedOut) throw new InsightTimeoutError(timeoutMs);
	if (failure !== null) throw new InsightModelError(failure);
	if (streamError !== void 0) throw new InsightModelError(streamError instanceof Error ? streamError.message : "模型调用失败");
	if (!finished) throw new InsightModelError("模型流意外中断，没有收到结束标记");
	if (text.trim() === "") throw new InsightModelError("模型返回了空内容");
	return usage;
}
/** 打标签的输出上限：标签本身很短，这里只是防跑飞。 */
const FACET_MAX_TOKENS = 1200;
/**
* 汇总的输出上限。
*
* 上限本身不产生费用（模型写完就停），但给太小会被截断、只留下一句「JSON 解析失败」，
* 所以按「够用 + 宽裕」给：实测汇总正文 2~4k token。
*/
const AGGREGATE_MAX_TOKENS = 16e3;
/**
* 模型这轮真正能写多少 token。
*
* 显式传给 `ctx.llm` 的 maxTokens 不会被钳制，超过模型上限时 provider 直接拒绝，
* 所以先用 `resolveModelInfo` 问清楚；问不到就当没有上限。
*/
async function outputLimitOf(llm, selection, timeoutMs = 5e3) {
	if (llm.resolveModelInfo === void 0) return Number.POSITIVE_INFINITY;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	timer.unref?.();
	try {
		const limit = (await llm.resolveModelInfo(selection.provider, selection.model, controller.signal)).defaultMaxTokens;
		return typeof limit === "number" && limit > 0 ? limit : Number.POSITIVE_INFINITY;
	} catch {
		return Number.POSITIVE_INFINITY;
	} finally {
		clearTimeout(timer);
	}
}
/** 本轮预算：想要的量和模型上限取小。 */
function budgetOf(desired, attempt, limit) {
	return Math.min(desired * (attempt + 1), limit);
}
/** 按预算估一个超时；预算越大给的时间越长，免得写完一半就被掐断。 */
function timeoutFor(budget) {
	if (!Number.isFinite(budget)) return 6e5;
	return Math.min(9e5, Math.max(24e4, budget * 25));
}
/**
* 这次失败还值不值得再调一次。
*
* 超时重试只会再等一轮；截断则要预算还能翻倍才有意义。
*/
function shouldRetry(error, budget, limit) {
	if (error instanceof InsightTimeoutError) return false;
	if (error instanceof InsightTruncatedError) return budget < limit;
	return true;
}
/** 解析模型输出的 JSON；被截断时换成「截断」的说法，而不是解析器的报错。 */
function parseOrThrow(text, truncated, limit) {
	try {
		return recordOf(extractJsonObject(text));
	} catch (error) {
		if (truncated) throw new InsightTruncatedError(limit);
		throw error;
	}
}
/** 打标签的系统提示。 */
const FACET_SYSTEM = [
	"你是 DSH（DeepSeek Harness）的使用方式分析师。",
	"你会读到一次编程会话的压缩摘要，需要判断这次会话做了什么、结果如何、哪里卡住、哪里配合得好。",
	"只输出一个 JSON 对象，不要任何解释、Markdown 或代码围栏。",
	"字段：goal（用户想做什么，20 字内）、outcome（结果：完成/部分完成/放弃/方向被推翻，20 字内）、",
	"sessionType（调试/新功能/重构/文档/调研/其他，10 字内）、frictions（字符串数组，0-3 条，每条 30 字内，用户在这一轮里卡住的点）、",
	"wins（字符串数组，0-3 条，每条 30 字内，配合得好或省事的地方）、summary（一句话总结，40 字内）。",
	"信息不足时按已知内容保守填写，不要编造。"
].join("\n");
/** 汇总的系统提示。 */
const AGGREGATE_SYSTEM = [
	"你是 DSH（DeepSeek Harness）的使用方式分析师，正在为一位开发者写月度工作方式复盘。",
	"你会读到很多会话的标签，需要归纳出跨会话的模式。只输出一个 JSON 对象，不要解释、Markdown 或代码围栏。",
	"要求：结论必须能落到「下一次怎么做」，不要写空话；例子必须来自给出的会话。"
].join("\n");
/** 单会话打标签；`limit` 是模型这轮能写的 token 上限。 */
async function labelSession(llm, selection, session, signal, limit = Number.POSITIVE_INFINITY) {
	const prompt = [
		"下面是这次会话的摘要：",
		"---",
		session.digest,
		"---",
		"请输出标签 JSON。"
	].join("\n");
	let lastError;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const budget = budgetOf(FACET_MAX_TOKENS, attempt, limit);
		try {
			const result = await complete(llm, selection, {
				system: FACET_SYSTEM,
				prompt,
				signal,
				maxTokens: budget,
				temperature: .2
			});
			const value = parseOrThrow(result.text, result.truncated, budget);
			return {
				facet: {
					goal: str(value["goal"], 80),
					outcome: str(value["outcome"], 40),
					sessionType: str(value["sessionType"], 30),
					frictions: strList(value["frictions"], 80, 3),
					wins: strList(value["wins"], 80, 3),
					summary: str(value["summary"], 120)
				},
				inputTokens: result.inputTokens,
				outputTokens: result.outputTokens,
				cacheReadTokens: result.cacheReadTokens
			};
		} catch (error) {
			lastError = error;
			if (signal?.aborted === true) throw error;
			if (!shouldRetry(error, budget, limit)) throw error;
		}
	}
	throw lastError instanceof Error ? lastError : new InsightModelError("打标签失败");
}
const WHERE_VALUES = [
	"agents",
	"skill",
	"workflow",
	"config",
	"other"
];
/** 把模型给的 where 归一到固定枚举。 */
function whereOf(value) {
	return typeof value === "string" && WHERE_VALUES.includes(value) ? value : "other";
}
/** 汇总上限：超出的会话按时间取最新的一批，避免 prompt 无限膨胀。 */
const MAX_AGGREGATE_SESSIONS = 400;
/**
* 把全部会话标签汇总成报告主体。
*
* 摩擦的「次数」由 host 从模型给的会话编号反推，而不是信模型给的数字——
* 模型擅长归类，不擅长计数。
*/
async function aggregateReport(llm, selection, inputs, stats, signal, limit = Number.POSITIVE_INFINITY) {
	const kept = inputs.slice(0, MAX_AGGREGATE_SESSIONS);
	const corpus = kept.map((item, index) => ({
		n: index + 1,
		project: item.session.project,
		date: toLocalDateKey(item.session.createdAt),
		digits: {
			turns: item.session.turns,
			toolCalls: item.session.toolCalls,
			messages: item.session.userMessages
		},
		facet: item.facet
	}));
	const prompt = [
		`本次分析覆盖 ${String(stats.sessions)} 个会话、${String(stats.messages)} 条用户消息、${String(stats.toolCalls)} 次工具调用、${String(stats.projects)} 个目录。`,
		"会话标签如下（JSON 数组，字段 n 是会话编号）：",
		"---",
		JSON.stringify(corpus),
		"---",
		"请输出汇总 JSON，结构：",
		"{",
		"  \"glance\": {\"working\": \"什么在起作用，60 字内\", \"friction\": \"什么最拖后腿，60 字内\", \"next\": \"先改哪一件事，60 字内，要具体\"},",
		"  \"frictions\": [{\"title\": \"摩擦类型，20 字内\", \"detail\": \"为什么反复发生，80 字内\", \"sessions\": [出现该问题的会话编号，如 3], \"examples\": [{\"n\": 会话编号, \"quote\": \"该会话里的原话或行为，40 字内\"}]}],",
		"  \"wins\": [{\"title\": \"有效习惯，20 字内\", \"detail\": \"为什么有效，80 字内\"}],",
		"  \"suggestions\": [{\"title\": \"建议，20 字内\", \"detail\": \"怎么做，80 字内\", \"where\": \"agents|skill|workflow|config|other\", \"snippet\": \"可直接复制的文字或命令，没有就给空串\"}],",
		"  \"fun\": \"从会话里挑一个有趣或难忘的瞬间，50 字内\"",
		"}",
		"约束：frictions 最多 3 条，wins 最多 3 条，suggestions 最多 4 条；每条 frictions 至少给 1 个 example，examples 最多 2 条；",
		"sessions 里写编号数字（不是 id 字符串），必须来自上面出现过的 n；不要编造编号、数字或原话；",
		"输出单行 JSON，不要缩进、换行或多余空格。"
	].join("\n");
	let lastError;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const budget = budgetOf(AGGREGATE_MAX_TOKENS, attempt, limit);
		try {
			const result = await complete(llm, selection, {
				system: AGGREGATE_SYSTEM,
				prompt,
				signal,
				maxTokens: budget,
				temperature: .3,
				timeoutMs: timeoutFor(budget)
			});
			const value = parseOrThrow(result.text, result.truncated, budget);
			const byId = new Map(kept.map((item) => [item.session.id, item]));
			/** 编号（1 起）→ 会话；越界一律丢掉。 */
			const byNumber = (raw) => {
				const index = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
				if (typeof index !== "number" || !Number.isInteger(index)) return void 0;
				return kept[index - 1];
			};
			/** 模型可能回编号，也可能（不听话时）回 id，两种都认。 */
			const refOf = (raw) => {
				if (typeof raw === "string") {
					const hit = byId.get(str(raw, 80));
					if (hit !== void 0) return hit;
				}
				return byNumber(raw);
			};
			const glanceRaw = recordOf(value["glance"]);
			const glance = {
				working: str(glanceRaw["working"], 160),
				friction: str(glanceRaw["friction"], 160),
				next: str(glanceRaw["next"], 160)
			};
			const frictions = [];
			for (const item of Array.isArray(value["frictions"]) ? value["frictions"] : []) {
				const raw = recordOf(item);
				const ids = [];
				const entries = Array.isArray(raw["sessions"]) ? raw["sessions"].slice(0, MAX_AGGREGATE_SESSIONS) : [];
				for (const entry of entries) {
					const session = refOf(entry);
					if (session === void 0) continue;
					if (!ids.includes(session.session.id)) ids.push(session.session.id);
				}
				const examples = [];
				for (const example of Array.isArray(raw["examples"]) ? raw["examples"] : []) {
					const exampleRecord = recordOf(example);
					const session = refOf(exampleRecord["n"]) ?? refOf(exampleRecord["sessionId"]);
					if (session === void 0) continue;
					examples.push({
						quote: str(exampleRecord["quote"], 120),
						project: session.session.project,
						date: toLocalDateKey(session.session.createdAt),
						sessionId: session.session.id
					});
					if (examples.length >= 2) break;
				}
				frictions.push({
					title: str(raw["title"], 60),
					detail: str(raw["detail"], 200),
					count: ids.length > 0 ? ids.length : new Set(examples.map((example) => example.sessionId)).size,
					examples
				});
				if (frictions.length >= 3) break;
			}
			const wins = [];
			for (const item of Array.isArray(value["wins"]) ? value["wins"] : []) {
				const raw = recordOf(item);
				const title = str(raw["title"], 60);
				if (title === "") continue;
				wins.push({
					title,
					detail: str(raw["detail"], 200)
				});
				if (wins.length >= 3) break;
			}
			const suggestions = [];
			for (const item of Array.isArray(value["suggestions"]) ? value["suggestions"] : []) {
				const raw = recordOf(item);
				const title = str(raw["title"], 60);
				if (title === "") continue;
				suggestions.push({
					title,
					detail: str(raw["detail"], 200),
					where: whereOf(raw["where"]),
					snippet: str(raw["snippet"], 400)
				});
				if (suggestions.length >= 4) break;
			}
			return {
				glance,
				frictions,
				wins,
				suggestions,
				fun: str(value["fun"], 160),
				inputTokens: result.inputTokens,
				outputTokens: result.outputTokens,
				cacheReadTokens: result.cacheReadTokens
			};
		} catch (error) {
			lastError = error;
			if (signal?.aborted === true) throw error;
			if (!shouldRetry(error, budget, limit)) throw error;
		}
	}
	throw lastError instanceof Error ? lastError : new InsightModelError("汇总失败");
}
// src/host/insight/facets.ts
/**
* 标签缓存：每个会话一张标签卡，存在 `<insightDir>/facets/<sessionId>.json`。
*
* 缓存的意义不是省磁盘而是省 token：第二次分析只对摘要变化过的会话重新打标签。
* 缓存损坏时直接跳过（当作没缓存），不能让一份坏文件挡住整轮分析。
*/
/** facets 目录。 */
function facetsDirOf(insightDir) {
	return join(insightDir, "facets");
}
/** 只接受看起来像会话 id 的文件名，防止读到目录里的杂物。 */
const FACET_FILE = /^[A-Za-z0-9._-]+\.json$/;
/** 会话 id 的合法字符；写入路径前再校验一次，作为纵深防御。 */
const SESSION_ID = /^[A-Za-z0-9._-]+$/;
/**
* 读取全部缓存。
*
* @param insightDir - `~/.dsh/insight`。
* @returns 会话 id → 标签记录；目录不存在或单文件坏掉都给空/跳过。
*/
async function loadFacets(insightDir) {
	const dir = facetsDirOf(insightDir);
	const result = /* @__PURE__ */ new Map();
	let files;
	try {
		files = await readdir(dir);
	} catch {
		return result;
	}
	for (const file of files) {
		if (!FACET_FILE.test(file)) continue;
		try {
			const raw = await readFile(join(dir, file), "utf8");
			const record = JSON.parse(raw);
			if (typeof record.sessionId !== "string" || typeof record.digestHash !== "string" || typeof record.updatedAt !== "string" || record.facet === void 0) continue;
			result.set(record.sessionId, record);
		} catch {}
	}
	return result;
}
/** 写入一份缓存；先写临时文件再改名，避免进程中断留下半个 JSON。 */
async function saveFacet(insightDir, record) {
	if (!SESSION_ID.test(record.sessionId) || record.sessionId.includes("..")) throw new Error(`非法的会话 id：${record.sessionId}`);
	const dir = facetsDirOf(insightDir);
	await mkdir(dir, { recursive: true });
	const target = join(dir, `${record.sessionId}.json`);
	const temp = `${target}.tmp`;
	await writeFile(temp, JSON.stringify(record, null, 2), "utf8");
	await rename(temp, target);
}
/** 这条会话的摘要是否变了；变了才需要重新打标签。 */
function facetStale(cached, digest) {
	if (cached === void 0) return true;
	return cached.digestHash !== digest.digestHash;
}
// src/host/insight/html.ts
/** HTML 转义。 */
function escapeHtml(value) {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function pad2(value) {
	return value < 10 ? `0${String(value)}` : String(value);
}
/** ISO → 本地 `YYYY-MM-DD HH:mm`。 */
function formatTime(iso) {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return `${String(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
/** 千分位。 */
function num(value) {
	return value.toLocaleString("en-US");
}
/** 分钟数。 */
function minutes(ms) {
	return `${String(Math.max(1, Math.round(ms / 6e4)))} 分钟`;
}
/** token 的简短写法。 */
function tokens(value) {
	if (value >= 1e4) return `${(value / 1e4).toFixed(1)} 万`;
	return num(value);
}
const WHERE_LABEL = {
	agents: "AGENTS.md",
	skill: "skill",
	workflow: "workflow",
	config: "配置",
	other: "其他"
};
/** 样式：与 DSH 面板的深色气质一致，但不依赖宿主的 token。 */
const CSS = `
:root{color-scheme:light dark;--paper:#fbfaf9;--surface:#fff;--ink:#15171c;--ink2:#4a505e;--ink3:#838b9c;
--line:#e4e2de;--line2:#efeef0;--blue:#2e63d8;--green:#1b8656;--green-bg:#e8f5ee;--red:#b03a2e;--red-bg:#fbeae7;
--amber:#a8690c;--amber-bg:#fbf1e0;--violet:#7343c9;--violet-bg:#f2ecfc;--code:#f4f3f0}
@media (prefers-color-scheme:dark){:root{--paper:#101216;--surface:#171a20;--ink:#eceae6;--ink2:#a8aebc;--ink3:#6e7688;
--line:#282c35;--line2:#21252c;--blue:#7ba3f5;--green:#4cc08a;--green-bg:#10281e;--red:#e58579;--red-bg:#33201c;
--amber:#dfa64a;--amber-bg:#2a2013;--violet:#b48cf0;--violet-bg:#221836;--code:#1c2027}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC",sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:56px 24px 90px;display:flex;flex-direction:column;gap:34px}
h1{font-size:28px;line-height:1.35;margin:0 0 10px;letter-spacing:-.01em}
h2{font-size:18px;margin:0 0 14px;padding-bottom:9px;border-bottom:1.5px solid var(--ink)}
h3{font-size:15px;margin:0}
p{margin:0}
.eyebrow{font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3)}
.lede{margin-top:12px;color:var(--ink2);max-width:64ch}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.tag{font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code);border:1px solid var(--line2);
color:var(--ink2);border-radius:4px;padding:3px 9px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
@media (max-width:720px){.grid3{grid-template-columns:1fr}}
.card{border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:6px}
.card .k{font:10.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase}
.card.good{background:var(--green-bg)} .card.good .k{color:var(--green)}
.card.bad{background:var(--red-bg)} .card.bad .k{color:var(--red)}
.card.next{background:var(--violet-bg)} .card.next .k{color:var(--violet)}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:var(--line);border:1px solid var(--line);
border-radius:8px;overflow:hidden}
@media (max-width:760px){.stats{grid-template-columns:repeat(3,1fr)}}
.stat{background:var(--surface);padding:13px 15px;display:flex;flex-direction:column;gap:2px}
.stat b{font:600 20px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.stat span{font-size:11.5px;color:var(--ink3)}
.panel{border:1px solid var(--line);border-radius:8px;padding:18px 20px;background:var(--surface)}
.bars{display:flex;flex-direction:column;gap:8px}
.brow{display:grid;grid-template-columns:150px 1fr 78px;gap:10px;align-items:center;font-size:12.5px}
.brow .lab{color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.brow .track{height:8px;border-radius:99px;background:var(--code);overflow:hidden}
.brow .track i{display:block;height:100%;background:var(--blue);border-radius:99px}
.brow .n{text-align:right;font-family:ui-monospace,Menlo,monospace;color:var(--ink3);font-size:12px;white-space:nowrap}
.hours{display:flex;align-items:flex-end;gap:3px;height:84px;margin-top:8px}
.hours i{flex:1;min-height:2px;background:var(--blue);opacity:.55;border-radius:2px 2px 0 0}
.hours i.hot{background:var(--violet);opacity:.9}
.hours-x{display:flex;gap:3px;margin-top:5px;font:10px ui-monospace,Menlo,monospace;color:var(--ink3)}
.hours-x span{flex:1;text-align:center}
.fric{border:1px solid var(--line2);border-radius:8px;padding:12px 14px;margin-bottom:10px;background:var(--code)}
.fric .t{display:flex;gap:10px;align-items:baseline}
.fric .t b{font-size:13.5px}
.fric .t .n{margin-left:auto;font:12px ui-monospace,Menlo,monospace;color:var(--red)}
.fric .d{font-size:12.5px;color:var(--ink2);margin-top:4px}
.ex{margin-top:8px;padding-left:10px;border-left:2px solid var(--line);font-size:12.5px;color:var(--ink2)}
.ex .src{font:11px ui-monospace,Menlo,monospace;color:var(--ink3);margin-top:2px}
ol.clean{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:9px}
ol.clean li{display:flex;gap:10px;font-size:13px;color:var(--ink2)}
ol.clean li .n{font:12px ui-monospace,Menlo,monospace;color:var(--green);flex:none}
ol.clean li b{color:var(--ink)}
.sugg{border:1px solid var(--line2);border-radius:8px;padding:11px 13px;margin-bottom:9px;display:grid;
grid-template-columns:auto 1fr;gap:10px;align-items:start}
.where{font:10px/1.6 ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.08em;
background:var(--violet-bg);color:var(--violet);border-radius:4px;padding:2px 6px;white-space:nowrap}
.sugg .what b{display:block;font-size:13px;color:var(--ink)}
.sugg .what span{font-size:12.5px;color:var(--ink2)}
.sugg code{display:block;margin-top:6px;font:12px/1.6 ui-monospace,Menlo,monospace;background:var(--code);
border-radius:4px;padding:6px 8px;color:var(--ink2);white-space:pre-wrap;word-break:break-word}
.hyg{display:flex;gap:18px;flex-wrap:wrap;align-items:center}
.hyg .big{font:600 24px/1.2 ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums}
.hyg .big small{font:12px/1.4 inherit;color:var(--ink3);margin-left:3px;font-weight:400}
.hyg .cap{font-size:12px;color:var(--ink3)}
.foot{border-top:1px solid var(--line);padding-top:16px;font:12px/1.7 ui-monospace,Menlo,monospace;color:var(--ink3)}
`;
/** 生成完整 HTML。 */
function renderReportHtml(report) {
	const { meta, glance, stats, projects, tools, hours } = report;
	const maxProject = Math.max(1, ...projects.map((item) => item.sessions));
	const maxTool = Math.max(1, ...tools.map((item) => item.calls));
	const maxHour = Math.max(1, ...hours.map((item) => item.sessions));
	const windowLabel = meta.days === null ? "全部历史" : `近 ${String(meta.days)} 天`;
	const projectRows = projects.slice(0, 8).map((item) => `<div class="brow"><span class="lab">${escapeHtml(item.name)}</span><span class="track"><i style="width:${String(Math.round(item.sessions / maxProject * 100))}%"></i></span><span class="n">${num(item.sessions)}</span></div>`).join("");
	const toolRows = tools.slice(0, 8).map((item) => `<div class="brow"><span class="lab">${escapeHtml(item.name)}</span><span class="track"><i style="width:${String(Math.round(item.calls / maxTool * 100))}%"></i></span><span class="n">${num(item.calls)}${item.failures > 0 ? ` · ${String(item.failures)} 败` : ""}</span></div>`).join("");
	const hourBars = hours.map((item) => `<i class="${item.hour >= 21 || item.hour === 0 ? "hot" : ""}" style="height:${String(Math.max(2, Math.round(item.sessions / maxHour * 100)))}%"></i>`).join("");
	const hourAxis = [
		0,
		3,
		6,
		9,
		12,
		15,
		18,
		21,
		24
	].map((hour) => `<span>${String(hour)}</span>`).join("");
	const frictionHtml = report.frictions.map((friction) => `<div class="fric">
  <div class="t"><b>${escapeHtml(friction.title)}</b><span class="n">${String(friction.count)} 次</span></div>
  <div class="d">${escapeHtml(friction.detail)}</div>
  ${friction.examples.map((example) => `<div class="ex">「${escapeHtml(example.quote)}」
    <div class="src">${escapeHtml(example.project)} · ${escapeHtml(example.date)} · 会话 ${escapeHtml(example.sessionId)}</div>
  </div>`).join("\n  ")}
</div>`).join("\n");
	const winsHtml = report.wins.map((win, index) => `<li><span class="n">${pad2(index + 1)}</span><span><b>${escapeHtml(win.title)}</b> ${escapeHtml(win.detail)}</span></li>`).join("");
	const suggestionsHtml = report.suggestions.map((item) => `<div class="sugg"><span class="where">${escapeHtml(WHERE_LABEL[item.where] ?? "其他")}</span>
  <span class="what"><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.detail)}</span>${item.snippet === "" ? "" : `<code>${escapeHtml(item.snippet)}</code>`}</span></div>`).join("");
	const hygieneHtml = report.hygiene === null ? "" : `<section class="panel"><h2>上下文卫生</h2>
  <div class="hyg">
    <div><div class="big">${String(report.hygiene.active)}<small>个常驻 skill</small></div><div class="cap">每次会话固定开销</div></div>
    <div><div class="big" style="color:var(--amber)">${String(report.hygiene.unused30d)}<small>个近 30 天未用</small></div><div class="cap">占 ${num(report.hygiene.unusedTokens)} tokens</div></div>
    ${report.hygiene.examples.length > 0 ? `<div class="cap">例如 ${escapeHtml(report.hygiene.examples.join("、"))}，可以在面板里归档。</div>` : ""}
    ${report.hygiene.complete ? "" : "<div class=\"cap\" style=\"color:var(--amber)\">频次统计还没回填完成，这里的数字可能偏高。</div>"}
  </div></section>`;
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>洞察报告 · ${escapeHtml(formatTime(meta.startedAt))}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="eyebrow">DSH 洞察 · ${escapeHtml(formatTime(meta.startedAt))}</div>
    <h1>这段时间你是怎么用 DSH 的</h1>
    <p class="lede">读本机会话得到的复盘：先看哪些习惯有效、哪些摩擦反复出现，再挑一件事改。数字来自会话日志，文字判断来自模型。</p>
    <div class="meta">
      <span class="tag">${escapeHtml(windowLabel)}</span>
      <span class="tag">${String(stats.sessions)} 个会话</span>
      <span class="tag">${escapeHtml(meta.provider)}/${escapeHtml(meta.model)}</span>
      <span class="tag">用时 ${minutes(meta.durationMs)}</span>
      <span class="tag">${tokens(meta.tokens)} tokens</span>
    </div>
  </header>

  <section>
    <h2>先看这三条</h2>
    <div class="grid3">
      <div class="card good"><span class="k">在起作用的</span><span>${escapeHtml(glance.working)}</span></div>
      <div class="card bad"><span class="k">最拖后腿的</span><span>${escapeHtml(glance.friction)}</span></div>
      <div class="card next"><span class="k">先改一件事</span><span>${escapeHtml(glance.next)}</span></div>
    </div>
  </section>

  <div class="stats">
    <div class="stat"><b>${num(stats.sessions)}</b><span>分析的会话</span></div>
    <div class="stat"><b>${num(stats.messages)}</b><span>你的消息</span></div>
    <div class="stat"><b>${num(stats.toolCalls)}</b><span>工具调用</span></div>
    <div class="stat"><b>${num(stats.activeDays)}</b><span>活跃天数</span></div>
    <div class="stat"><b>${num(stats.toolFailures)}</b><span>失败的工具调用</span></div>
  </div>

  <section class="panel">
    <h2>你在哪些项目上花时间</h2>
    <div class="bars">${projectRows}</div>
  </section>

  <section class="panel">
    <h2>最常用的工具</h2>
    <div class="bars">${toolRows}</div>
  </section>

  <section class="panel">
    <h2>一天里的节奏</h2>
    <div class="hours">${hourBars}</div>
    <div class="hours-x">${hourAxis}</div>
  </section>

  <section>
    <h2>反复卡住的 ${String(report.frictions.length)} 类事</h2>
    ${frictionHtml}
  </section>

  <section class="panel">
    <h2>有效的习惯</h2>
    <ol class="clean">${winsHtml}</ol>
  </section>

  <section class="panel">
    <h2>建议：只挑一条改</h2>
    ${suggestionsHtml}
  </section>

  ${hygieneHtml}

  <section class="panel">
    <h2>顺手记下的一幕</h2>
    <p style="color:var(--ink2);font-size:13px">${escapeHtml(report.fun)}</p>
  </section>

  <div class="foot">
    分析于 ${escapeHtml(formatTime(meta.startedAt))} · 用时 ${minutes(meta.durationMs)} · ${tokens(meta.tokens)} tokens<br>
    覆盖 ${num(stats.sessions)} 个会话（已排除 ${num(stats.excludedSubagent)} 个非人工会话、${num(stats.excludedOld)} 个超出时间窗口${stats.excludedCapped > 0 ? `、${num(stats.excludedCapped)} 个超出单次上限` : ""}）· 其中 ${num(stats.failedSessions)} 个打标签失败
  </div>
</div>
</body>
</html>`;
}
// src/host/insight/report.ts
/**
* 报告落盘：把各层结果组装成一份 `report.json`，并写出 `report.html` 与索引。
*
* 目录约定（`~/.dsh/insight/`）：
*   - `runs/<id>/report.json`、`runs/<id>/report.html`
*   - `facets/<sessionId>.json`
*   - `index.json`
*/
/** 索引里最多留多少条；旧报告仍在磁盘上，只是不再列出来。 */
const MAX_INDEX_ENTRIES = 50;
/** runs 目录。 */
function runsDirOf(insightDir) {
	return join(insightDir, "runs");
}
/** 单次运行的目录。 */
function runDirOf(insightDir, id) {
	return join(runsDirOf(insightDir), id);
}
/** 运行 id 只允许这些字符，防止路径穿越。 */
const RUN_ID_PATTERN = /^[0-9A-Za-z-]{8,40}$/;
/**
* 用本地时间生成运行 id：`2026-11-17T16-20-00`。
*
* 不做时区转换（用户看到的就是本地时间），同一秒内重复时由调用方加后缀。
*/
function runIdOf(date) {
	const pad = (n) => String(n).padStart(2, "0");
	return [`${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, `T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`].join("");
}
/** 把两层结果合成一份可渲染的报告。 */
function buildReport(input) {
	const { collect, aggregate } = input;
	return {
		version: 1,
		meta: {
			id: input.id,
			startedAt: input.startedAt.toISOString(),
			finishedAt: input.finishedAt.toISOString(),
			days: input.days,
			provider: input.provider,
			model: input.model,
			durationMs: input.finishedAt.getTime() - input.startedAt.getTime(),
			tokens: input.inputTokens + input.outputTokens + input.cacheReadTokens
		},
		glance: aggregate.glance,
		stats: {
			...collect.stats,
			failedSessions: input.failedSessions
		},
		projects: collect.projects,
		tools: collect.tools,
		hours: collect.hours,
		frictions: aggregate.frictions,
		wins: aggregate.wins,
		suggestions: aggregate.suggestions,
		hygiene: input.hygiene,
		fun: aggregate.fun
	};
}
/**
* 从报告派生索引行。
*
* `readAt` 只由「标记已读」写入，所以这里给默认值：
* 新生成的报告是未读（null），从磁盘反推出来的历史当作已读（用完成时间占位）。
*/
function historyEntryOf(report, status, readAt = null) {
	return {
		id: report.meta.id,
		startedAt: report.meta.startedAt,
		finishedAt: report.meta.finishedAt,
		status,
		days: report.meta.days,
		sessions: report.stats.sessions,
		tokens: report.meta.tokens,
		provider: report.meta.provider,
		model: report.meta.model,
		durationMs: report.meta.durationMs,
		failedSessions: report.stats.failedSessions,
		readAt
	};
}
/**
* 写一份报告：先写临时目录再改名，避免面板读到半个文件。
*
* @param insightDir - `~/.dsh/insight`。
* @param report - 组装好的报告。
* @returns 报告目录与 HTML 绝对路径。
*/
async function writeReport(insightDir, report) {
	const dir = runDirOf(insightDir, report.meta.id);
	const temp = `${dir}.tmp`;
	await rm(temp, {
		recursive: true,
		force: true
	});
	await mkdir(temp, { recursive: true });
	await writeFile(join(temp, "report.json"), JSON.stringify(report, null, 2), "utf8");
	await writeFile(join(temp, "report.html"), renderReportHtml(report), "utf8");
	await rm(dir, {
		recursive: true,
		force: true
	});
	await rename(temp, dir);
	return {
		dir,
		htmlPath: join(dir, "report.html")
	};
}
/** 读一份报告；不存在或损坏时抛错，由路由层转成 404。 */
async function readReport(insightDir, id) {
	if (!RUN_ID_PATTERN.test(id)) return null;
	try {
		const raw = await readFile(join(runDirOf(insightDir, id), "report.json"), "utf8");
		const parsed = JSON.parse(raw);
		return parsed.version === 1 ? parsed : null;
	} catch {
		return null;
	}
}
/** 删除一次运行的目录；索引条目由调用方一并清掉。 */
async function removeRun(insightDir, id) {
	if (!RUN_ID_PATTERN.test(id)) return false;
	const dir = runDirOf(insightDir, id);
	try {
		await access(dir);
	} catch {
		return false;
	}
	try {
		await rm(dir, {
			recursive: true,
			force: true
		});
		return true;
	} catch {
		return false;
	}
}
/** 目录里实际存在的报告 id（新的在前）。 */
async function listRunIds(insightDir) {
	try {
		return (await readdir(runsDirOf(insightDir))).filter((name) => RUN_ID_PATTERN.test(name)).sort().reverse();
	} catch {
		return [];
	}
}
/** 时间字段都缺失的损坏条目用它兜底，避免出现 undefined。 */
const EPOCH = "1970-01-01T00:00:00.000Z";
/** 读索引；没有或损坏时返回空索引。 */
async function loadIndex(insightDir) {
	try {
		const raw = await readFile(join(insightDir, "index.json"), "utf8");
		const parsed = JSON.parse(raw);
		if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return {
			version: 1,
			entries: []
		};
		const entries = [];
		for (const raw of parsed.entries) {
			if (typeof raw !== "object" || raw === null) continue;
			const entry = raw;
			if (typeof entry.id !== "string") continue;
			const readAt = typeof entry.readAt === "string" ? entry.readAt : entry.readAt === null ? null : entry.finishedAt ?? entry.startedAt ?? EPOCH;
			entries.push({
				...entry,
				readAt
			});
		}
		return {
			version: 1,
			entries
		};
	} catch {
		return {
			version: 1,
			entries: []
		};
	}
}
/**
* 索引写操作的串行队列（按目录）。
*
* 索引是「读—改—写」：两个窗口同时标已读、或者刚跑完又有人标已读时，不加锁就会
* 后写覆盖先写——丢一次 readAt，甚至把刚追加的历史整条写没。
*/
const indexQueues = /* @__PURE__ */ new Map();
function withIndexLock(insightDir, task) {
	const run = (indexQueues.get(insightDir) ?? Promise.resolve()).then(task, task);
	indexQueues.set(insightDir, run.catch(() => void 0));
	return run;
}
/** 临时文件名带随机后缀：并发写不会互相踩到同一个 tmp。 */
function tempPathOf(target) {
	return `${target}.${String(process.pid)}.${Math.random().toString(36).slice(2, 10)}.tmp`;
}
/** 写索引；同样先写临时文件再改名。 */
async function saveIndex(insightDir, entries) {
	await mkdir(insightDir, { recursive: true });
	const sorted = [...entries].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, MAX_INDEX_ENTRIES);
	const target = join(insightDir, "index.json");
	const temp = tempPathOf(target);
	await writeFile(temp, JSON.stringify({
		version: 1,
		entries: sorted
	}, null, 2), "utf8");
	await rename(temp, target);
}
/** 追加一条索引（同 id 覆盖，新的在前）。 */
function appendIndex(insightDir, entry) {
	return withIndexLock(insightDir, async () => {
		await saveIndex(insightDir, [entry, ...(await loadIndex(insightDir)).entries.filter((item) => item.id !== entry.id)]);
	});
}
/** 把一条标记为已读；本来就已读时什么都不改。 */
function markIndexRead(insightDir, id, at) {
	return withIndexLock(insightDir, async () => {
		const index = await loadIndex(insightDir);
		const target = index.entries.find((entry) => entry.id === id);
		if (target === void 0) return false;
		if (target.readAt !== null) return true;
		await saveIndex(insightDir, index.entries.map((entry) => entry.id === id ? {
			...entry,
			readAt: at
		} : entry));
		return true;
	});
}
/** 从索引里删掉一条。 */
function removeIndexEntry(insightDir, id) {
	return withIndexLock(insightDir, async () => {
		await saveIndex(insightDir, (await loadIndex(insightDir)).entries.filter((item) => item.id !== id));
	});
}
// src/host/insight/service.ts
/**
* 洞察服务：一次分析的完整生命周期（开始 → 采集 → 打标签 → 汇总 → 落盘）与路由。
*
* 设计约束：
* - 同一时间只允许一次运行，第二次直接 busy；
* - 运行状态只在内存里，进程重启后变回 idle（已完成的报告仍在磁盘上）；
* - 任何一层失败都落成 `failed` 并把原因带出来，不用猜；
* - 取消靠 AbortController 贯穿读取、模型调用和落盘前的检查。
*/
/** 阶段顺序；进度条按它渲染。 */
const PHASES = [
	"collect",
	"facets",
	"aggregate",
	"write"
];
/** 打标签的并发；太高会把模型额度打到限流。 */
const FACET_CONCURRENCY = 3;
/** 单次分析最多处理多少个会话。 */
const MAX_SESSIONS = 300;
/** `GET .insight.models` 里探测每个 provider 的超时。 */
const MODEL_LIST_TIMEOUT_MS = 4e3;
/** 并发受限的 map；结果顺序与输入一致，单个失败返回 undefined。 */
async function mapLimit(items, limit, worker) {
	const results = new Array(items.length).fill(void 0);
	let cursor = 0;
	const run = async () => {
		while (cursor < items.length) {
			const index = cursor;
			cursor += 1;
			const item = items[index];
			if (item === void 0) continue;
			results[index] = await worker(item, index).catch(() => void 0);
		}
	};
	await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, run));
	return results;
}
/** 给 promise 加超时。 */
async function withTimeout(promise, ms, label) {
	if (ms <= 0) return promise;
	let timer;
	try {
		return await Promise.race([promise, new Promise((_resolve, reject) => {
			timer = setTimeout(() => {
				reject(/* @__PURE__ */ new Error(`${label} 超时`));
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
/** 校验非空短字符串。 */
function requiredString(value, field, max) {
	if (typeof value !== "string" || value.trim() === "") throw new OptimizeError("invalid-request", `${field} 不能为空`);
	const clean = value.trim();
	if (clean.length > max) throw new OptimizeError("invalid-request", `${field} 太长`);
	if (/[\u0000-\u001f]/.test(clean)) throw new OptimizeError("invalid-request", `${field} 含非法字符`);
	return clean;
}
/** 校验分析窗口。 */
function parseDays(value) {
	if (value === null || value === void 0) return null;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 3650) throw new OptimizeError("invalid-request", "days 必须是 1–3650 的整数或 null");
	return value;
}
var InsightService = class {
	deps;
	run = null;
	/** 正在做准备（校验 + 占目录）的同步占位；挡住并发 start 的检查窗口。 */
	starting = false;
	constructor(deps) {
		this.deps = deps;
	}
	/** 停掉正在跑的分析；插件卸载时调用。 */
	async dispose() {
		this.run?.controller.abort();
	}
	/** 路由入口。 */
	async handle(request) {
		const url = new URL(request.url);
		try {
			switch (url.pathname) {
				case ROUTES.insightStatus: return json(this.status());
				case ROUTES.insightModels: return json(await this.models());
				case ROUTES.insightHistory: return json(await this.history());
				case ROUTES.insightReport: {
					const id = url.searchParams.get("id") ?? "";
					return json(await this.report(id));
				}
				case ROUTES.insightStart: return json(await this.start(await readJson(request)));
				case ROUTES.insightCancel: return json(this.cancel());
				case ROUTES.insightRemove: {
					const body = await readJson(request);
					return json(await this.remove(parseId(body)));
				}
				case ROUTES.insightRead: {
					const body = await readJson(request);
					return json(await this.markRead(parseId(body)));
				}
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
	/** `GET .insight.status` */
	status() {
		const run = this.run;
		if (run === null) return {
			status: "idle",
			runId: null,
			phases: PHASES.map((key) => ({
				key,
				state: "pending",
				done: 0,
				total: 0
			})),
			current: null,
			startedAt: null,
			elapsedMs: 0,
			error: null,
			reportId: null
		};
		const end = run.finishedAt ?? this.now().getTime();
		return {
			status: run.status,
			runId: run.id,
			phases: run.phases.map((phase) => ({ ...phase })),
			current: run.current,
			startedAt: new Date(run.startedAt).toISOString(),
			elapsedMs: Math.max(0, end - run.startedAt),
			error: run.error,
			reportId: run.reportId
		};
	}
	/** `POST .insight.start` */
	async start(body) {
		if (this.deps.sessionQuery === void 0) throw new OptimizeError("analysis-failed", "宿主没有会话服务，无法读取会话日志");
		if (this.deps.llm === void 0) throw new OptimizeError("analysis-failed", "宿主没有模型服务，无法分析");
		if (this.run?.status === "running" || this.starting) throw new OptimizeError("busy", "已有一次分析在进行，等它结束或先取消");
		if (typeof body !== "object" || body === null) throw new OptimizeError("invalid-request", "请求体必须是对象");
		this.starting = true;
		try {
			const record = body;
			const request = {
				days: parseDays(record["days"]),
				provider: requiredString(record["provider"], "provider", 200),
				model: requiredString(record["model"], "model", 200)
			};
			const now = this.now();
			const run = {
				id: await this.reserveRunId(now),
				status: "running",
				phases: PHASES.map((key) => ({
					key,
					state: "pending",
					done: 0,
					total: 0
				})),
				current: null,
				startedAt: now.getTime(),
				finishedAt: null,
				error: null,
				reportId: null,
				controller: new AbortController(),
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0
			};
			this.run = run;
			this.execute(run, request);
			return this.status();
		} finally {
			this.starting = false;
		}
	}
	/**
	* 用「建目录」而不是「查目录」来抢运行 id。
	*
	* 同一秒内重复发起、甚至桌面端与 CLI 同时发起时，mkdir 的原子性保证只有一个能拿到该 id；
	* 空目录同时充当这次运行的占位，失败或取消时会被清掉。
	*/
	async reserveRunId(now) {
		await mkdir(runsDirOf(this.deps.dir), { recursive: true });
		const base = runIdOf(now);
		for (let suffix = 1; suffix <= 20; suffix += 1) {
			const id = suffix === 1 ? base : `${base}-${String(suffix)}`;
			try {
				await mkdir(runDirOf(this.deps.dir, id), { recursive: false });
				return id;
			} catch (error) {
				if (error.code === "EEXIST") continue;
				throw error;
			}
		}
		throw new OptimizeError("analysis-failed", "无法分配报告目录");
	}
	/** `POST .insight.cancel` */
	cancel() {
		if (this.run?.status === "running") this.run.controller.abort();
		return this.status();
	}
	/** `GET .insight.history` */
	async history() {
		let entries = [...(await loadIndex(this.deps.dir)).entries];
		if (entries.length === 0) entries = await this.recoverIndex();
		entries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
		return {
			entries,
			running: this.run?.status === "running"
		};
	}
	/** `GET .insight.report?id=` */
	async report(id) {
		if (id === "") throw new OptimizeError("invalid-request", "缺少报告 id");
		const report = await readReport(this.deps.dir, id);
		if (report === null) throw new OptimizeError("not-found", "这份报告不存在或已删除");
		return {
			id,
			report,
			htmlPath: join(runDirOf(this.deps.dir, id), "report.html")
		};
	}
	/** `POST .insight.remove` */
	async remove(id) {
		if (this.run?.status === "running" && this.run.id === id) throw new OptimizeError("busy", "正在分析的这一次不能删除");
		if (!await removeRun(this.deps.dir, id)) throw new OptimizeError("not-found", "这份报告不存在或已删除");
		await removeIndexEntry(this.deps.dir, id);
		return { ok: true };
	}
	/** `GET .insight.models`：客户端拿不到 DSH 模型目录时的兜底。 */
	async models() {
		const llm = this.deps.llm;
		const selection = this.deps.defaultSelection?.() ?? null;
		if (llm === void 0) return {
			options: [],
			defaultProvider: selection?.provider ?? null,
			defaultModel: selection?.model ?? null,
			error: "宿主没有模型服务"
		};
		const options = [];
		let error = null;
		let providers = [];
		try {
			providers = llm.listProviders?.() ?? [];
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "读取模型列表失败";
		}
		for (const provider of providers) {
			if (llm.listModels === void 0) break;
			try {
				const models = await withTimeout(llm.listModels(provider.id), MODEL_LIST_TIMEOUT_MS, "读取模型列表");
				for (const model of models) options.push({
					provider: provider.id,
					providerName: provider.name,
					model: model.id,
					name: model.name,
					isDefault: selection !== null && selection.provider === provider.id && selection.model === model.id
				});
			} catch (cause) {
				error ??= `${provider.name}: ${cause instanceof Error ? cause.message : "读取失败"}`;
			}
		}
		if (selection !== null && !options.some((option) => option.isDefault)) options.unshift({
			provider: selection.provider,
			providerName: selection.provider,
			model: selection.model,
			name: selection.model,
			isDefault: true
		});
		return {
			options,
			defaultProvider: selection?.provider ?? null,
			defaultModel: selection?.model ?? null,
			error
		};
	}
	/** 当前时刻；测试可注入。 */
	now() {
		return this.deps.now?.() ?? /* @__PURE__ */ new Date();
	}
	/** 把某个阶段切到 running 并记下总量。 */
	beginPhase(run, key, total) {
		for (const phase of run.phases) if (phase.key === key) {
			phase.state = "running";
			phase.total = total;
			phase.done = 0;
		}
	}
	/** 收尾一个阶段。 */
	endPhase(run, key, state) {
		for (const phase of run.phases) if (phase.key === key) phase.state = state;
	}
	/** 更新阶段进度。 */
	progress(run, key, done, total) {
		for (const phase of run.phases) if (phase.key === key) {
			phase.done = done;
			phase.total = total;
		}
	}
	/** 真正跑一次分析。 */
	async execute(run, request) {
		const startedAt = new Date(run.startedAt);
		const selection = {
			provider: request.provider,
			model: request.model
		};
		let written = false;
		try {
			const source = this.deps.sessionQuery;
			const llm = this.deps.llm;
			if (source === void 0 || llm === void 0) throw new Error("服务未就绪");
			const outputLimit = await outputLimitOf(llm, selection);
			this.beginPhase(run, "collect", 0);
			const collect = await collectCorpus({
				source,
				days: request.days,
				now: () => this.now(),
				signal: run.controller.signal,
				concurrency: this.deps.concurrency ?? 4,
				...this.deps.readTimeoutMs === void 0 ? {} : { readTimeoutMs: this.deps.readTimeoutMs },
				maxSessions: this.deps.maxSessions ?? MAX_SESSIONS,
				logger: this.deps.logger,
				onProgress: (done, total, title) => {
					this.progress(run, "collect", done, total);
					run.current = title;
				}
			});
			this.endPhase(run, "collect", "done");
			if (run.controller.signal.aborted) throw new Error("已取消");
			this.beginPhase(run, "facets", collect.sessions.length);
			const cached = await loadFacets(this.deps.dir);
			const stale = collect.sessions.filter((session) => facetStale(cached.get(session.id), session));
			const reused = collect.sessions.length - stale.length;
			this.progress(run, "facets", reused, collect.sessions.length);
			let failedSessions = 0;
			const facets = /* @__PURE__ */ new Map();
			for (const session of collect.sessions) {
				const hit = cached.get(session.id);
				if (hit !== void 0 && !facetStale(hit, session)) facets.set(session.id, hit.facet);
			}
			let done = reused;
			await mapLimit(stale, this.deps.facetConcurrency ?? FACET_CONCURRENCY, async (session) => {
				if (run.controller.signal.aborted) throw new Error("已取消");
				run.current = session.title;
				try {
					const labelled = await labelSession(llm, selection, session, run.controller.signal, outputLimit);
					facets.set(session.id, labelled.facet);
					run.inputTokens += labelled.inputTokens;
					run.outputTokens += labelled.outputTokens;
					run.cacheReadTokens += labelled.cacheReadTokens;
					const record = {
						sessionId: session.id,
						digestHash: session.digestHash,
						lastSeq: session.lastSeq,
						updatedAt: this.now().toISOString(),
						facet: labelled.facet
					};
					await saveFacet(this.deps.dir, record);
				} catch (error) {
					failedSessions += 1;
					this.deps.logger?.warn?.(`[dsh-context-optimize] 洞察：会话 ${session.id} 打标签失败`, error);
				} finally {
					done += 1;
					this.progress(run, "facets", done, collect.sessions.length);
				}
			});
			this.endPhase(run, "facets", failedSessions >= collect.sessions.length ? "skipped" : "done");
			if (run.controller.signal.aborted) throw new Error("已取消");
			if (facets.size === 0) throw new Error("所有会话都没能打上标签，请检查模型是否可用");
			this.beginPhase(run, "aggregate", 1);
			const inputs = [];
			for (const session of collect.sessions) {
				const facet = facets.get(session.id);
				if (facet !== void 0) inputs.push({
					session,
					facet
				});
			}
			const aggregate = await aggregateReport(llm, selection, inputs, {
				sessions: collect.stats.sessions,
				messages: collect.stats.messages,
				toolCalls: collect.stats.toolCalls,
				projects: collect.projects.length
			}, run.controller.signal, outputLimit);
			run.inputTokens += aggregate.inputTokens;
			run.outputTokens += aggregate.outputTokens;
			run.cacheReadTokens += aggregate.cacheReadTokens;
			this.progress(run, "aggregate", 1, 1);
			this.endPhase(run, "aggregate", "done");
			if (run.controller.signal.aborted) throw new Error("已取消");
			this.beginPhase(run, "write", 1);
			if (run.controller.signal.aborted) throw new Error("已取消");
			const hygiene = this.deps.hygiene === void 0 ? null : await this.deps.hygiene().catch(() => null);
			if (run.controller.signal.aborted) throw new Error("已取消");
			const report = buildReport({
				id: run.id,
				startedAt,
				finishedAt: this.now(),
				days: request.days,
				provider: selection.provider,
				model: selection.model,
				inputTokens: run.inputTokens,
				outputTokens: run.outputTokens,
				cacheReadTokens: run.cacheReadTokens,
				failedSessions,
				collect,
				aggregate,
				hygiene
			});
			await writeReport(this.deps.dir, report);
			written = true;
			await appendIndex(this.deps.dir, historyEntryOf(report, "done"));
			this.progress(run, "write", 1, 1);
			this.endPhase(run, "write", "done");
			run.status = "done";
			run.reportId = run.id;
			run.current = null;
			run.finishedAt = this.now().getTime();
		} catch (error) {
			run.finishedAt = this.now().getTime();
			run.current = null;
			if (run.controller.signal.aborted || error instanceof Error && error.message === "已取消") {
				run.status = "cancelled";
				run.error = null;
			} else {
				run.status = "failed";
				run.error = error instanceof Error ? error.message : "分析失败";
				this.deps.logger?.warn?.("[dsh-context-optimize] 洞察分析失败", error);
			}
			if (!written) await removeRun(this.deps.dir, run.id).catch(() => void 0);
		}
	}
	/** `POST .insight.read`：报告真正显示出来时由客户端调用。 */
	async markRead(id) {
		if (id === "") throw new OptimizeError("invalid-request", "缺少报告 id");
		if (!await markIndexRead(this.deps.dir, id, this.now().toISOString())) throw new OptimizeError("not-found", "这份报告不存在或已删除");
		return { ok: true };
	}
	/** 索引为空时，从磁盘上的报告反推历史条目。 */
	async recoverIndex() {
		const ids = await listRunIds(this.deps.dir);
		const entries = [];
		for (const id of ids.slice(0, 50)) {
			const report = await readReport(this.deps.dir, id);
			if (report === null) continue;
			entries.push(historyEntryOf(report, "done", report.meta.finishedAt));
		}
		return entries;
	}
};
/** 读 JSON 请求体；空体返回 null。 */
async function readJson(request) {
	const text = await request.text();
	if (text.trim() === "") return null;
	try {
		return JSON.parse(text);
	} catch {
		throw new OptimizeError("invalid-request", "请求体不是合法 JSON");
	}
}
/** 从请求体里取 id。 */
function parseId(body) {
	if (typeof body !== "object" || body === null) throw new OptimizeError("invalid-request", "请求体必须是对象");
	const id = body["id"];
	if (typeof id !== "string" || id === "") throw new OptimizeError("invalid-request", "缺少报告 id");
	return id;
}
// src/index.ts
/**
* 宿主（node 半）入口：注册认证路由、订阅会话事件做频次增量、启动时读缓存并后台补齐历史。
*
* 依赖两个 DSH 宿主服务：
*   - `connection`：认证路由（与 dsh-output 同一套写法）；
*   - `sessionQuery` / `workspaceRegistry`：可选注入——缺了也能跑，只是频次为空 / 项目页为空；
*   - `llm` / `agentDefaultModel`：可选注入——缺了只是「洞察」不能发起分析，历史报告仍可看。
*/
/** Cordis 函数插件名。 */
const name = "@kulebbb/dsh-context-optimize";
/** 只有路由载体是硬依赖；其余服务用 scoped inject 可选接入。 */
const inject = ["connection"];
/** 洞察端点的公共前缀：以后只往 ROUTES 加一条也会自动归到洞察服务。 */
const INSIGHT_PREFIX = `${ROUTE_PREFIX}.insight.`;
/** 走 POST 的洞察端点。 */
const INSIGHT_WRITE_ROUTES = /* @__PURE__ */ new Set([
	ROUTES.insightStart,
	ROUTES.insightCancel,
	ROUTES.insightRemove,
	ROUTES.insightRead
]);
/**
* 注册插件。
* @param ctx - 宿主上下文。
*/
function apply(ctx) {
	const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), ".dsh");
	const cachePath = join(dshHome, "storages", "dsh-context-optimize", "frequency.v2.json");
	let sessionQuery;
	let workspaceRegistry;
	let llm;
	let defaultSelection;
	ctx.inject(["sessionQuery"], (scope) => {
		sessionQuery = scope["sessionQuery"];
	});
	ctx.inject(["workspaceRegistry"], (scope) => {
		workspaceRegistry = scope["workspaceRegistry"];
	});
	ctx.inject(["llm"], (scope) => {
		llm = scope["llm"];
	});
	ctx.inject(["agentDefaultModel"], (scope) => {
		const service = scope["agentDefaultModel"];
		if (service === void 0) return;
		defaultSelection = () => {
			try {
				const selection = service.currentSelection();
				return {
					provider: selection.provider,
					model: selection.model
				};
			} catch {
				return null;
			}
		};
	});
	const service = new ContextOptimizeService({
		dshHome,
		cachePath,
		profileDir: profileDirOfContext(ctx) ?? resolveProfileDir(process.env, dshHome),
		logger: ctx.logger,
		get sessionQuery() {
			return sessionQuery;
		},
		get workspaceRegistry() {
			return workspaceRegistry;
		}
	});
	const insight = new InsightService({
		dir: join(dshHome, "insight"),
		logger: ctx.logger,
		get llm() {
			return llm;
		},
		get sessionQuery() {
			return sessionQuery;
		},
		get defaultSelection() {
			return defaultSelection;
		},
		hygiene: () => service.hygieneSnapshot()
	});
	ctx.effect(() => {
		service.initialize();
		return () => {
			service.dispose();
		};
	}, "dsh-context-optimize: cache");
	ctx.effect(() => () => {
		insight.dispose();
	}, "dsh-context-optimize: insight");
	for (const path of Object.values(ROUTES)) {
		const owner = path.startsWith(INSIGHT_PREFIX) ? insight : service;
		const methods = path === ROUTES.archive || path === ROUTES.restore || INSIGHT_WRITE_ROUTES.has(path) ? ["POST"] : ["GET"];
		ctx.effect(() => ctx.connection.fetch.register({
			path,
			methods,
			requestBody: "buffered",
			fetch: (request) => owner.handle(request)
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
