/**
 * 路由层：五个端点、参数校验、错误码映射、归档 / 还原闭环。
 *
 * 这里不启动真实 DSH：三个 home 路径全指到 os.tmpdir() 下，sessionQuery / workspaceRegistry
 * 用假对象注入。每条错误用例都同时断言 HTTP 状态与响应体里的 code —— 客户端只认 code。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { ContextOptimizeService } from '../src/host/service.ts'
import type { WorkspaceRegistryLike } from '../src/host/service.ts'
import { ROUTES } from '../src/shared/types.ts'
import type {
  ErrorCode,
  ErrorPayload,
  MovePayload,
  OverviewPayload,
  ProjectsPayload,
  SkillsPayload,
} from '../src/shared/types.ts'
import {
  exists,
  makeSkillDir,
  makeTmpDir,
  removeTmpDir,
} from './helpers.ts'

const NOW = new Date(2026, 10, 11, 10, 0, 0)
const ENV_KEYS = ['DSH_HOME', 'DSH_AGENTS_HOME', 'DSH_BUNDLED_SKILL_DIR'] as const
const BASE = 'http://127.0.0.1:51082'

let savedEnv: Record<string, string | undefined> = {}
let tmp = ''
let dshHome = ''
let agentsHome = ''
let bundledDir = ''
let projectDir = ''
/** 项目根按 realpath 解析（macOS 的 /var 是 /private/var 的软链），断言必须用同一个基准。 */
let realProject = ''
let service: ContextOptimizeService
let workspaces: { id: string; title: string; path: string }[] = []

beforeEach(async () => {
  savedEnv = {}
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]

  tmp = await makeTmpDir('dco-service')
  dshHome = join(tmp, 'dsh-home')
  agentsHome = join(tmp, 'agents-home')
  bundledDir = join(tmp, 'bundled-skills')
  projectDir = join(tmp, 'proj')

  // 服务构造时读 homePaths()（环境变量），所以必须先把环境指到临时目录再 new。
  process.env.DSH_HOME = dshHome
  process.env.DSH_AGENTS_HOME = agentsHome
  process.env.DSH_BUNDLED_SKILL_DIR = bundledDir

  await makeSkillDir(join(dshHome, 'skills'), 'global-dsh-skill', '---\nname: global-dsh-skill\ndescription: 用户 dsh 根\n---\n')
  await makeSkillDir(join(agentsHome, 'skills'), 'global-agents-skill', '---\nname: global-agents-skill\ndescription: 用户 agents 根\n---\n')
  // 同名 skill 出现在两个根：内置根 rank 大，应当被用户根压住。
  await makeSkillDir(join(agentsHome, 'skills'), 'shared', '---\nname: shared\ndescription: 用户版本\n---\n')
  await makeSkillDir(bundledDir, 'bundled-skill', '---\nname: bundled-skill\ndescription: 内置根\n---\n')
  await makeSkillDir(bundledDir, 'shared', '---\nname: shared\ndescription: 内置版本\n---\n')

  await mkdir(join(projectDir, '.git'), { recursive: true })
  realProject = await realpath(projectDir)
  await makeSkillDir(join(projectDir, '.dsh', 'skills'), 'proj-skill', '---\nname: proj-skill\ndescription: 项目 skill\n---\n')

  workspaces = [
    { id: 'w1', title: 'Proj', path: projectDir },
    { id: 'gone', title: 'Gone', path: join(tmp, 'gone-workspace') },
  ]
  const workspaceRegistry: WorkspaceRegistryLike = { list: () => workspaces }

  service = new ContextOptimizeService({
    dshHome,
    cachePath: join(tmp, 'state', 'frequency.json'),
    workspaceRegistry,
    now: () => NOW,
    logger: { warn: () => undefined },
  })
  await service.initialize()
})

afterEach(async () => {
  await service.dispose()
  for (const key of ENV_KEYS) {
    const value = savedEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await removeTmpDir(tmp)
})

function get(path: string): Request {
  return new Request(`${BASE}${path}`)
}

function post(path: string, body: unknown, rawBody?: string): Request {
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawBody ?? JSON.stringify(body),
  })
}

/** 断言错误响应的状态码、错误体形状与 code。 */
async function expectError(request: Request, status: number, code: ErrorCode): Promise<ErrorPayload> {
  const response = await service.handle(request)
  expect(response.status).toBe(status)
  expect(response.headers.get('content-type')).toContain('application/json')
  const body = (await response.json()) as ErrorPayload
  expect(body).toEqual({
    error: { code, message: expect.any(String) as string },
  })
  expect(body.error.message.length).toBeGreaterThan(0)
  return body
}

describe('五个端点都返回 200 与合法 JSON', () => {
  it('GET overview', async () => {
    const response = await service.handle(get(ROUTES.overview))
    expect(response.status).toBe(200)
    const body = (await response.json()) as OverviewPayload
    expect(body.generatedAt).toBe(NOW.toISOString())
    expect(body.roots.map((root) => root.id)).toEqual(['user-dsh', 'user-agents', 'bundled'])
    expect(body.roots.map((root) => root.exists)).toEqual([true, true, true])
    expect(body.roots.map((root) => root.count)).toEqual([1, 2, 1])
    // 5 条扫描结果里 bundled 的 shared 被 user-agents 的 shared 压住 → 全局生效 4 条；
    // 根内 count 也按全局生效集合算，所以 bundled 只计 1。
    expect(body.totals.active).toBe(4)
    expect(body.totals.neverCalled).toBe(4)
    expect(body.totals.catalogChars).toBeGreaterThan(0)
    expect(body.totals.catalogTokens).toBeGreaterThan(0)
    expect(['idle', 'running', 'done', 'partial']).toContain(body.backfill.state)
    expect(body.globalArchiveDir).toBe(join(agentsHome, 'skill-archive'))
  })

  it('GET skills（全局）：含被压住的条目，且不带项目 skill', async () => {
    const response = await service.handle(get(`${ROUTES.skills}?scope=global&state=all`))
    expect(response.status).toBe(200)
    const body = (await response.json()) as SkillsPayload
    expect(body.scope).toBe('global')
    expect(body.state).toBe('all')
    expect(body.total).toBe(5)
    expect(body.archiveDir).toBe(join(agentsHome, 'skill-archive'))
    const names = body.entries.map((entry) => entry.name)
    expect(names).toContain('global-dsh-skill')
    expect(names).not.toContain('proj-skill')
    const shared = body.entries.filter((entry) => entry.name === 'shared')
    expect(shared).toHaveLength(2)
    expect(shared.find((entry) => entry.source === 'user-agents')?.effective).toBe(true)
    expect(shared.find((entry) => entry.source === 'bundled')).toMatchObject({
      effective: false,
      overriddenBy: 'user-agents',
    })
    for (const entry of body.entries) {
      expect(entry.dirRealPath).toBeTypeOf('string')
      expect(entry.approxTokens).toBe(Math.round(entry.descriptionChars / 3.5))
    }
  })

  it('GET skills（项目）：只返回该项目根下两个目录里的条目，不混入全局', async () => {
    const response = await service.handle(get(`${ROUTES.skills}?scope=project&workspaceId=w1&state=all`))
    expect(response.status).toBe(200)
    const body = (await response.json()) as SkillsPayload
    expect(body.scope).toBe('project')
    expect(body.workspaceId).toBe('w1')
    expect(body.total).toBe(1)
    expect(body.entries.map((entry) => entry.name)).toEqual(['proj-skill'])
    expect(body.entries[0]?.rootId).toBe('project-dsh')
    expect(body.archiveDir).toBe(join(realProject, '.dsh', 'skill-archive'))
  })

  it('GET skills（全局）state=never-called 只返回 0 次调用的条目', async () => {
    const response = await service.handle(get(`${ROUTES.skills}?scope=global&state=never-called`))
    expect(response.status).toBe(200)
    const body = (await response.json()) as SkillsPayload
    expect(body.state).toBe('never-called')
    expect(body.total).toBe(body.entries.length)
    expect(body.entries.every((entry) => entry.calls === 0)).toBe(true)
    expect(body.entries.length).toBeGreaterThan(0)
  })

  it('GET projects：列出工作区、标记失效、给出预览', async () => {
    const response = await service.handle(get(ROUTES.projects))
    expect(response.status).toBe(200)
    const body = (await response.json()) as ProjectsPayload
    expect(body.total).toBe(2)
    expect(body.missing).toBe(1)
    const proj = body.projects.find((entry) => entry.id === 'w1')
    expect(proj).toMatchObject({
      title: 'Proj',
      path: projectDir,
      exists: true,
      root: realProject,
      skillCount: 1,
      archivedCount: 0,
    })
    expect(proj?.approxTokens).toBeGreaterThan(0)
    expect(proj?.preview.map((entry) => entry.name)).toEqual(['proj-skill'])
    expect(body.projects.find((entry) => entry.id === 'gone')).toMatchObject({
      exists: false,
      skillCount: 0,
      preview: [],
    })
  })

  it('并发读多个端点都返回 200，且 overview 与 skills 的生效数自洽', async () => {
    const [overview, globalSkills, projectSkills, projects] = await Promise.all([
      service.handle(get(ROUTES.overview)),
      service.handle(get(`${ROUTES.skills}?scope=global&state=all`)),
      service.handle(get(`${ROUTES.skills}?scope=project&workspaceId=w1&state=all`)),
      service.handle(get(ROUTES.projects)),
    ])
    expect([overview.status, globalSkills.status, projectSkills.status, projects.status]).toEqual([200, 200, 200, 200])
    const overviewBody = (await overview.json()) as OverviewPayload
    const skillsBody = (await globalSkills.json()) as SkillsPayload
    expect(overviewBody.totals.active).toBe(skillsBody.entries.filter((entry) => entry.effective).length)
  })
})

describe('ServiceDeps.home 注入', () => {
  it('只靠 home 注入就能把三个根指到临时目录，同时压过 deps.dshHome', async () => {
    const injected = join(tmp, 'injected')
    const injDsh = join(injected, 'dsh')
    const injAgents = join(injected, 'agents')
    const injBundled = join(injected, 'bundled')
    await makeSkillDir(join(injDsh, 'skills'), 'inj-dsh', '---\nname: inj-dsh\n---\n')
    await makeSkillDir(join(injAgents, 'skills'), 'inj-agents', '---\nname: inj-agents\n---\n')
    await makeSkillDir(injBundled, 'inj-bundled', '---\nname: inj-bundled\n---\n')

    const injectedService = new ContextOptimizeService({
      // 这个值若被误用，下面的 startsWith(injected) 断言会立刻红。
      dshHome: join(tmp, 'should-not-be-used'),
      cachePath: join(injected, 'cache.json'),
      home: { dshHome: injDsh, agentsHome: injAgents, bundledSkillDir: injBundled },
      now: () => NOW,
    })
    try {
      const overview = await injectedService.overview()
      expect(overview.roots.map((root) => root.path)).toEqual([
        join(injDsh, 'skills'),
        join(injAgents, 'skills'),
        injBundled,
      ])
      expect(overview.roots.every((root) => root.path.startsWith(injected))).toBe(true)
      expect(overview.globalArchiveDir).toBe(join(injAgents, 'skill-archive'))
      expect(overview.globalArchiveDir.startsWith(injected)).toBe(true)
      expect(overview.totals.active).toBe(3)

      const skills = await injectedService.skills({ scope: 'global', state: 'all' })
      expect(skills.archiveDir).toBe(join(injAgents, 'skill-archive'))
    } finally {
      await injectedService.dispose()
    }
  })

  it('home 只覆盖部分字段时，其余按环境变量回退（dshHome 走注入值）', async () => {
    const injDsh = join(tmp, 'partial-dsh')
    await makeSkillDir(join(injDsh, 'skills'), 'partial-dsh', '---\nname: partial-dsh\n---\n')
    const partial = new ContextOptimizeService({
      dshHome: join(tmp, 'deps-dsh-fallback'),
      cachePath: join(tmp, 'partial-cache.json'),
      // 只覆盖 dshHome；agentsHome / bundledSkillDir 回退到 beforeEach 设置的环境变量。
      home: { dshHome: injDsh },
      now: () => NOW,
    })
    try {
      const overview = await partial.overview()
      expect(overview.roots.map((root) => root.path)).toEqual([
        join(injDsh, 'skills'),
        join(agentsHome, 'skills'),
        bundledDir,
      ])
      expect(overview.globalArchiveDir).toBe(join(agentsHome, 'skill-archive'))
    } finally {
      await partial.dispose()
    }
  })
})

describe('依赖缺失时的降级', () => {
  it('没有 workspaceRegistry 时 projects 返回空列表，而不是抛错', async () => {
    const bare = new ContextOptimizeService({ dshHome, cachePath: join(tmp, 'bare.json'), now: () => NOW })
    const response = await bare.handle(get(ROUTES.projects))
    expect(response.status).toBe(200)
    const body = (await response.json()) as ProjectsPayload
    expect(body).toEqual({ projects: [], total: 0, missing: 0 })
    await bare.dispose()
  })
})

describe('参数校验', () => {
  it('scope 非法 → 400 invalid-request', async () => {
    await expectError(get(`${ROUTES.skills}?scope=everywhere`), 400, 'invalid-request')
    await expectError(get(ROUTES.skills), 400, 'invalid-request')
  })

  it('state 非法 → 400 invalid-request', async () => {
    await expectError(get(`${ROUTES.skills}?scope=global&state=nope`), 400, 'invalid-request')
  })

  it('项目范围缺 workspaceId → 400 invalid-request', async () => {
    await expectError(get(`${ROUTES.skills}?scope=project`), 400, 'invalid-request')
    await expectError(get(`${ROUTES.skills}?scope=project&workspaceId=`), 400, 'invalid-request')
  })

  it('未知工作区 → 404 not-found', async () => {
    await expectError(get(`${ROUTES.skills}?scope=project&workspaceId=nope`), 404, 'not-found')
  })

  it('未知路径 → 404 not-found', async () => {
    await expectError(get('/api/context-optimize.unknown'), 404, 'not-found')
    await expectError(get('/api/completely-else'), 404, 'not-found')
  })
})

describe('归档 / 还原闭环（全局范围）', () => {
  it('归档后出现在归档状态里，还原后回到原处', async () => {
    const archiveResponse = await service.handle(
      post(ROUTES.archive, { scope: 'global', rootId: 'user-agents', dirName: 'global-agents-skill' }),
    )
    expect(archiveResponse.status).toBe(200)
    const archived = (await archiveResponse.json()) as MovePayload
    expect(archived).toMatchObject({
      ok: true,
      rootId: 'user-agents',
      dirName: 'global-agents-skill',
      to: join(agentsHome, 'skill-archive', 'global-agents-skill'),
      archiveDir: join(agentsHome, 'skill-archive'),
    })
    expect(archived.renamedTo).toBeUndefined()
    await expect(exists(join(agentsHome, 'skills', 'global-agents-skill'))).resolves.toBe(false)

    const listArchived = (await (
      await service.handle(get(`${ROUTES.skills}?scope=global&state=archived`))
    ).json()) as SkillsPayload
    expect(listArchived.entries.map((entry) => entry.dirName)).toEqual(['global-agents-skill'])
    expect(listArchived.entries[0]?.effective).toBe(false)
    expect(listArchived.entries[0]?.archivedAt).toBeTypeOf('string')

    const restoreResponse = await service.handle(
      post(ROUTES.restore, { scope: 'global', rootId: 'user-agents', dirName: 'global-agents-skill' }),
    )
    expect(restoreResponse.status).toBe(200)
    await expect(exists(join(agentsHome, 'skills', 'global-agents-skill', 'SKILL.md'))).resolves.toBe(true)

    const listArchivedAgain = (await (
      await service.handle(get(`${ROUTES.skills}?scope=global&state=archived`))
    ).json()) as SkillsPayload
    expect(listArchivedAgain.entries).toHaveLength(0)
  })

  it('归档内置根 → 403 readonly-root', async () => {
    const body = await expectError(
      post(ROUTES.archive, { scope: 'global', rootId: 'bundled', dirName: 'bundled-skill' }),
      403,
      'readonly-root',
    )
    expect(body.error.message).toContain('内置')
    // 内置 skill 还在原地。
    await expect(exists(join(bundledDir, 'bundled-skill'))).resolves.toBe(true)
  })
})

describe('归档 / 还原（项目范围）', () => {
  it('项目 skill 归档进项目的 .dsh/skill-archive', async () => {
    const response = await service.handle(
      post(ROUTES.archive, { scope: 'project', workspaceId: 'w1', rootId: 'project-dsh', dirName: 'proj-skill' }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as MovePayload
    expect(body.to).toBe(join(realProject, '.dsh', 'skill-archive', 'proj-skill'))
    expect(body.archiveDir).toBe(join(realProject, '.dsh', 'skill-archive'))

    const archived = (await (
      await service.handle(get(`${ROUTES.skills}?scope=project&workspaceId=w1&state=archived`))
    ).json()) as SkillsPayload
    expect(archived.entries.map((entry) => entry.dirName)).toEqual(['proj-skill'])

    const restored = await service.handle(
      post(ROUTES.restore, { scope: 'project', workspaceId: 'w1', rootId: 'project-dsh', dirName: 'proj-skill' }),
    )
    expect(restored.status).toBe(200)
    await expect(exists(join(projectDir, '.dsh', 'skills', 'proj-skill', 'SKILL.md'))).resolves.toBe(true)
  })

  it('项目 skill 归档后不会被误报成「已移除」（归档是可逆的）', async () => {
    // 造一条历史调用：归档前它是项目 skill，归档后它仍在磁盘上，只是换了目录。
    service.ingest('sess-1', projectDir, NOW.getTime(), {
      type: 'tool/call',
      seq: 1,
      time: NOW.getTime(),
      data: { name: 'skill', arguments: JSON.stringify({ name: 'proj-skill' }) },
    })
    expect((await service.overview()).totals.removed).toBe(0)

    const moved = await service.handle(
      post(ROUTES.archive, { scope: 'project', workspaceId: 'w1', rootId: 'project-dsh', dirName: 'proj-skill' }),
    )
    expect(moved.status).toBe(200)

    // 项目归档不进全局的「已归档」计数（那是全局三根的账），但也不能算成「已移除」。
    const afterArchive = await service.overview()
    expect(afterArchive.totals.archived).toBe(0)
    expect(afterArchive.totals.removed).toBe(0)

    const archivedList = (await (
      await service.handle(get(`${ROUTES.skills}?scope=project&workspaceId=w1&state=archived`))
    ).json()) as SkillsPayload
    expect(archivedList.entries.map((entry) => entry.name)).toEqual(['proj-skill'])
  })

  it('项目范围缺 workspaceId → 400 invalid-request', async () => {
    await expectError(
      post(ROUTES.archive, { scope: 'project', rootId: 'project-dsh', dirName: 'proj-skill' }),
      400,
      'invalid-request',
    )
  })

  it('项目范围传全局根 → 400 unknown-root', async () => {
    await expectError(
      post(ROUTES.archive, { scope: 'project', workspaceId: 'w1', rootId: 'user-agents', dirName: 'x' }),
      400,
      'unknown-root',
    )
  })

  it('未知工作区的归档 → 404 not-found', async () => {
    await expectError(
      post(ROUTES.archive, { scope: 'project', workspaceId: 'nope', rootId: 'project-dsh', dirName: 'x' }),
      404,
      'not-found',
    )
  })
})

describe('请求体校验', () => {
  it('非法 JSON → 400 invalid-request', async () => {
    await expectError(post(ROUTES.archive, undefined, '{ not json'), 400, 'invalid-request')
  })

  it('请求体不是对象、scope 非法、缺 dirName → 400 invalid-request', async () => {
    await expectError(post(ROUTES.archive, ['array']), 400, 'invalid-request')
    await expectError(post(ROUTES.archive, { scope: 'x', rootId: 'user-dsh', dirName: 'a' }), 400, 'invalid-request')
    await expectError(post(ROUTES.archive, { scope: 'global', rootId: 'user-dsh' }), 400, 'invalid-request')
    await expectError(post(ROUTES.archive, { scope: 'global', rootId: 'user-dsh', dirName: '' }), 400, 'invalid-request')
  })

  it('rootId 不在枚举里 → 400 unknown-root', async () => {
    await expectError(post(ROUTES.archive, { scope: 'global', rootId: 'nope', dirName: 'a' }), 400, 'unknown-root')
  })

  it('dirName 路径穿越 → 400 path-escape', async () => {
    for (const dirName of ['../evil', 'a/b', '.', '..']) {
      await expectError(post(ROUTES.archive, { scope: 'global', rootId: 'user-agents', dirName }), 400, 'path-escape')
    }
  })

  it('归档端点只接受 POST', async () => {
    await expectError(get(ROUTES.archive), 400, 'invalid-request')
    await expectError(get(ROUTES.restore), 400, 'invalid-request')
  })

  it('源不存在 → 404 not-found', async () => {
    await expectError(
      post(ROUTES.archive, { scope: 'global', rootId: 'user-agents', dirName: 'ghost' }),
      404,
      'not-found',
    )
  })
})

describe('错误响应体形状', () => {
  it('所有错误都是 { error: { code, message } }，且 message 非空', async () => {
    const requests: [Request, number, ErrorCode][] = [
      [get(`${ROUTES.skills}?scope=bad`), 400, 'invalid-request'],
      [get('/api/context-optimize.unknown'), 404, 'not-found'],
      [post(ROUTES.archive, { scope: 'global', rootId: 'bundled', dirName: 'x' }), 403, 'readonly-root'],
      [post(ROUTES.archive, undefined, 'broken'), 400, 'invalid-request'],
    ]
    for (const [request, status, code] of requests) {
      const response = await service.handle(request)
      expect(response.status).toBe(status)
      const body = (await response.json()) as ErrorPayload
      expect(Object.keys(body)).toEqual(['error'])
      expect(Object.keys(body.error).sort()).toEqual(['code', 'message'])
      expect(body.error.code).toBe(code)
      expect(body.error.message.length).toBeGreaterThan(0)
    }
  })
})

describe('审查补测：并发、降级与失效工作区', () => {
  it('并发归档同一条 skill：只成功一次，档案内容不丢', async () => {
    const dir = join(agentsHome, 'skills', 'dup-target')
    await makeSkillDir(join(agentsHome, 'skills'), 'dup-target', '---\nname: dup-target\ndescription: 并发\n---\n唯一内容\n')

    const body = { scope: 'global', rootId: 'user-agents', dirName: 'dup-target' }
    const [first, second] = await Promise.all([
      service.handle(post(ROUTES.archive, body)),
      service.handle(post(ROUTES.archive, body)),
    ])
    const statuses = [first.status, second.status].sort()
    // 一个成功、一个找不到（已被前一个移走）——关键是不能两个都成功导致覆盖
    expect(statuses).toEqual([200, 404])

    const archived = await exists(join(agentsHome, 'skill-archive', 'dup-target', 'SKILL.md'))
    expect(archived).toBe(true)
    expect(await exists(dir)).toBe(false)
  })

  it('缓存文件结构坏掉（session 为 null）时降级为空缓存，不返回 500', async () => {
    const brokenCache = join(tmp, 'broken-cache.json')
    await mkdir(join(tmp), { recursive: true })
    await (await import('node:fs/promises')).writeFile(
      brokenCache,
      JSON.stringify({ version: 2, generatedAt: 0, sessions: { bad: null }, backfill: { state: 'done', done: 1, total: 1 } }),
      'utf8',
    )
    const fresh = new ContextOptimizeService({
      dshHome,
      cachePath: brokenCache,
      workspaceRegistry: { list: () => workspaces },
      now: () => NOW,
      logger: { warn: () => undefined },
    })
    await fresh.initialize()
    const overview = await fresh.overview()
    expect(overview.totals.active).toBeGreaterThan(0)
    expect((await fresh.handle(get(ROUTES.skills + '?scope=global&state=all'))).status).toBe(200)
    await fresh.dispose()
  })

  it('失效工作区不会解析到祖先项目，读写都拒绝', async () => {
    const projects = await service.projects()
    const gone = projects.projects.find((project) => project.id === 'gone')
    expect(gone?.exists).toBe(false)
    // 关键：不能因为祖先目录有 .git 就把项目根算到祖先上
    expect(gone?.root).toBe(join(tmp, 'gone-workspace'))

    const read = await service.handle(get(`${ROUTES.skills}?scope=project&workspaceId=gone&state=all`))
    expect(read.status).toBe(404)
    expect(((await read.json()) as ErrorPayload).error.code).toBe('not-found')

    const write = await service.handle(
      post(ROUTES.archive, { scope: 'project', workspaceId: 'gone', rootId: 'project-agents', dirName: 'x' }),
    )
    expect(write.status).toBe(404)
  })

  it('项目级 skill 全归档后，projects 仍报告 archivedCount（界面据此保留入口）', async () => {
    const before = await service.projects()
    expect(before.projects.find((project) => project.id === 'w1')?.skillCount).toBe(1)

    const moved = await service.handle(
      post(ROUTES.archive, { scope: 'project', workspaceId: 'w1', rootId: 'project-dsh', dirName: 'proj-skill' }),
    )
    expect(moved.status).toBe(200)

    const after = await service.projects()
    const project = after.projects.find((entry) => entry.id === 'w1')
    expect(project?.skillCount).toBe(0)
    expect(project?.archivedCount).toBe(1)
  })
})
