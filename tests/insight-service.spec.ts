/**
 * 洞察服务：状态机、去重、缓存复用、取消、路由。
 *
 * 用假的会话源 + 假的 llm 跑完整条管线；不触网、不读真实 `~/.dsh`。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { access, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { InsightService } from '../src/host/insight/service.ts'
import type { InsightServiceDeps } from '../src/host/insight/service.ts'
import type { LlmLike } from '../src/host/insight/analyze.ts'
import type { SessionSource } from '../src/host/insight/collect.ts'
import { ROUTES } from '../src/shared/types.ts'
import { makeTmpDir, removeTmpDir } from './helpers.ts'

const BASE = 'http://127.0.0.1:51082'

let tmp = ''
let clock = new Date('2026-11-17T16:20:00+08:00')

beforeEach(async () => {
  tmp = await makeTmpDir('dco-insight')
  clock = new Date('2026-11-17T16:20:00+08:00')
})

afterEach(async () => {
  await removeTmpDir(tmp)
})

/** 伪造的两条人工会话 + 一条子代理会话。 */
function makeSource(): SessionSource {
  const events = [
    {
      type: 'user/message',
      seq: 1,
      time: clock.getTime(),
      data: { content: [{ type: 'text', text: '把导出按钮改成图标' }], source: { kind: 'user' } },
    },
    {
      type: 'assistant/message',
      seq: 2,
      time: clock.getTime(),
      data: {
        message: { role: 'assistant', content: [{ type: 'text', text: '改好了' }], source: { provider: 'p', model: 'm' } },
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    },
  ]
  const headers = [
    { header: { id: 's1', cwd: '/repo/demo', createdAt: clock.getTime() }, live: false },
    { header: { id: 's2', cwd: '/repo/demo', createdAt: clock.getTime() - 1000 }, live: false },
    { header: { id: 'sub', cwd: '/repo/demo', createdAt: clock.getTime(), origin: 'subagent' }, live: false },
  ]
  return {
    listSessions: async () => headers,
    readSession: async (id) => ({ events: id === 'sub' ? [] : events }),
  }
}

/** 汇总 JSON；sessions 里的编号必须来自真实会话。 */
const AGGREGATE = {
  glance: { working: '先写约束', friction: '需求分几次说', next: '加一条复述规则' },
  frictions: [
    {
      title: '需求分几次说全',
      detail: '方向到第三轮才发现不对',
      sessions: [1, 2],
      examples: [{ n: 1, quote: '不是这个意思' }],
    },
  ],
  wins: [{ title: '先写设计约束', detail: '返工更少' }],
  suggestions: [{ title: '先复述再动手', detail: '确认后再改', where: 'agents', snippet: '先复述目标' }],
  fun: '凌晨两点还在改树',
}

/** 模型返回的标签 JSON。 */
const FACET = {
  goal: '改图标',
  outcome: '完成',
  sessionType: '新功能',
  frictions: ['没说清要哪个图标'],
  wins: ['一次说清了验收'],
  summary: '把导出按钮换成图标',
}

interface FakeLlm {
  readonly llm: LlmLike
  /** 每次调用记一笔：facet 还是 aggregate。 */
  readonly calls: { kind: 'facet' | 'aggregate' }[]
  /** aggregate 前额外等待的毫秒数；用来制造「运行中」。 */
  readonly slowMs?: number
}

/** 造一个会按 prompt 区分阶段的假模型。 */
function makeLlm(options: { slowMs?: number } = {}): FakeLlm {
  const calls: { kind: 'facet' | 'aggregate' }[] = []
  const llm: LlmLike = {
    stream(request) {
      const prompt = request.messages[0]?.content[0]?.text ?? ''
      const kind = prompt.includes('请输出汇总 JSON') ? 'aggregate' : 'facet'
      calls.push({ kind })
      return (async function* generate() {
        if (options.slowMs !== undefined) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, options.slowMs)
            request.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer)
                reject(new Error('aborted'))
              },
              { once: true },
            )
          })
        }
        yield { type: 'text-delta', text: JSON.stringify(kind === 'facet' ? FACET : AGGREGATE) }
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  return { llm, calls }
}

/** 等一个条件成立；超时直接失败，避免测试挂住。 */
async function waitFor<T>(check: () => Promise<T | null>, timeoutMs = 5000): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = await check()
    if (value !== null) return value
    if (Date.now() - started > timeoutMs) throw new Error('等待超时')
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
}

/** 服务工厂。 */
function makeService(overrides: Partial<InsightServiceDeps> = {}): InsightService {
  return new InsightService({
    dir: join(tmp, 'insight'),
    sessionQuery: makeSource(),
    llm: makeLlm().llm,
    defaultSelection: () => ({ provider: 'magpie', model: 'demo-model' }),
    now: () => clock,
    readTimeoutMs: 0,
    concurrency: 2,
    facetConcurrency: 2,
    ...overrides,
  })
}

/** 一直等到运行结束。 */
async function waitDone(service: InsightService): Promise<ReturnType<InsightService['status']>> {
  return waitFor(async () => {
    const status = service.status()
    return status.status === 'running' ? null : status
  })
}

describe('发起与完成', () => {
  it('跑完一次分析，落盘报告并写索引', async () => {
    const fake = makeLlm()
    const service = makeService({ llm: fake.llm })
    const started = await service.start({ days: 30, provider: 'magpie', model: 'demo-model' })
    expect(started.status).toBe('running')
    expect(started.phases.map((phase) => phase.key)).toEqual(['collect', 'facets', 'aggregate', 'write'])

    const done = await waitDone(service)
    expect(done.status).toBe('done')
    expect(done.reportId).not.toBeNull()
    // 两个人工会话各一次标签 + 一次汇总；子代理会话不参与。
    expect(fake.calls.filter((call) => call.kind === 'facet')).toHaveLength(2)
    expect(fake.calls.filter((call) => call.kind === 'aggregate')).toHaveLength(1)

    const report = await service.report(done.reportId ?? '')
    expect(report.report.stats.sessions).toBe(2)
    expect(report.report.stats.excludedSubagent).toBe(1)
    expect(report.report.glance.working).toBe('先写约束')
    expect(report.report.frictions[0]?.count).toBe(2)
    await expect(access(report.htmlPath)).resolves.toBeUndefined()

    const history = await service.history()
    expect(history.entries).toHaveLength(1)
    expect(history.entries[0]?.status).toBe('done')
  })

  it('第二次分析复用标签缓存，只调一次汇总', async () => {
    const source = makeSource()
    const first = makeLlm()
    const service = makeService({ llm: first.llm, sessionQuery: source })
    await service.start({ days: null, provider: 'magpie', model: 'demo-model' })
    await waitDone(service)

    clock = new Date(clock.getTime() + 60_000)
    const second = makeLlm()
    const again = makeService({ llm: second.llm, sessionQuery: source })
    await again.start({ days: null, provider: 'magpie', model: 'demo-model' })
    const done = await waitDone(again)
    expect(done.status).toBe('done')
    expect(second.calls.filter((call) => call.kind === 'facet')).toHaveLength(0)
    expect(second.calls.filter((call) => call.kind === 'aggregate')).toHaveLength(1)
  })

  it('同一时间只允许一次运行', async () => {
    const fake = makeLlm({ slowMs: 400 })
    const service = makeService({ llm: fake.llm })
    await service.start({ days: 30, provider: 'magpie', model: 'demo-model' })
    await expect(service.start({ days: 30, provider: 'magpie', model: 'demo-model' })).rejects.toMatchObject({
      code: 'busy',
    })
    service.cancel()
    await waitDone(service)
  })

  it('并发发起只有一个能成功，不会跑两轮', async () => {
    const fake = makeLlm({ slowMs: 200 })
    const service = makeService({ llm: fake.llm })
    const body = { days: 30, provider: 'magpie', model: 'demo-model' }
    const results = await Promise.allSettled([service.start(body), service.start(body)])
    const fulfilled = results.filter((item) => item.status === 'fulfilled')
    const rejected = results.filter((item) => item.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'busy' })
    service.cancel()
    await waitDone(service)
  })

  it('可以取消正在跑的分析', async () => {
    const service = makeService({ llm: makeLlm({ slowMs: 400 }).llm })
    await service.start({ days: 30, provider: 'magpie', model: 'demo-model' })
    service.cancel()
    const done = await waitDone(service)
    expect(done.status).toBe('cancelled')
    expect(done.reportId).toBeNull()
    const history = await service.history()
    expect(history.entries).toHaveLength(0)
  })

  it('缺会话服务或模型服务时明确报错', async () => {
    await expect(
      makeService({ sessionQuery: undefined }).start({ days: 30, provider: 'p', model: 'm' }),
    ).rejects.toMatchObject({ code: 'analysis-failed' })
    await expect(
      makeService({ llm: undefined }).start({ days: 30, provider: 'p', model: 'm' }),
    ).rejects.toMatchObject({ code: 'analysis-failed' })
  })

  it('参数不合法时拒绝', async () => {
    const service = makeService()
    await expect(service.start({ days: -1, provider: 'p', model: 'm' })).rejects.toMatchObject({
      code: 'invalid-request',
    })
    await expect(service.start({ days: 30, provider: '', model: 'm' })).rejects.toMatchObject({
      code: 'invalid-request',
    })
    await expect(service.start(null)).rejects.toMatchObject({ code: 'invalid-request' })
  })

  it('模型全部失败时整轮失败并带上原因', async () => {
    const broken: LlmLike = {
      stream() {
        return (async function* generate() {
          yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', message: 'no key' } } }
        })()
      },
    }
    const service = makeService({ llm: broken })
    await service.start({ days: 30, provider: 'p', model: 'm' })
    const done = await waitDone(service)
    expect(done.status).toBe('failed')
    expect(done.error).toContain('所有会话都没能打上标签')
  })
})

describe('历史、报告与删除', () => {
  it('读不存在的报告返回 not-found', async () => {
    const service = makeService()
    await expect(service.report('2026-11-17T16-20-00')).rejects.toMatchObject({ code: 'not-found' })
    await expect(service.report('../escape')).rejects.toMatchObject({ code: 'not-found' })
  })

  it('删除报告同时清索引', async () => {
    const service = makeService()
    const started = await service.start({ days: 30, provider: 'magpie', model: 'demo-model' })
    const done = await waitDone(service)
    const id = done.reportId ?? started.runId ?? ''
    await service.remove(id)
    expect((await service.history()).entries).toHaveLength(0)
    await expect(service.report(id)).rejects.toMatchObject({ code: 'not-found' })
  })

  it('索引丢失时能从磁盘恢复历史', async () => {
    const service = makeService()
    await service.start({ days: 30, provider: 'magpie', model: 'demo-model' })
    const done = await waitDone(service)
    expect(done.status).toBe('done')
    // 模拟索引被删：直接删文件后 history 应该靠报告目录重建。
    await rm(join(tmp, 'insight', 'index.json'), { force: true })
    const history = await service.history()
    expect(history.entries).toHaveLength(1)
  })
})

describe('模型列表兜底', () => {
  it('读 provider 与模型并标出默认项', async () => {
    const llm: LlmLike = {
      listProviders: () => [{ id: 'magpie', name: 'Magpie' }],
      listModels: async () => [
        { provider: 'magpie', id: 'demo-model', name: 'Demo' },
        { provider: 'magpie', id: 'other', name: 'Other' },
      ],
      stream: makeLlm().llm.stream,
    }
    const service = makeService({ llm })
    const payload = await service.models()
    expect(payload.options).toHaveLength(2)
    expect(payload.options.find((option) => option.isDefault)?.model).toBe('demo-model')
    expect(payload.defaultProvider).toBe('magpie')
  })

  it('没有模型服务时返回诊断而不是抛错', async () => {
    const payload = await makeService({ llm: undefined }).models()
    expect(payload.options).toEqual([])
    expect(payload.error).not.toBeNull()
  })

  it('默认模型不在目录里时仍然保留为一项', async () => {
    const llm: LlmLike = {
      listProviders: () => [{ id: 'magpie', name: 'Magpie' }],
      listModels: async () => [{ provider: 'magpie', id: 'other', name: 'Other' }],
      stream: makeLlm().llm.stream,
    }
    const payload = await makeService({ llm }).models()
    expect(payload.options[0]?.isDefault).toBe(true)
    expect(payload.options[0]?.model).toBe('demo-model')
  })
})

describe('路由', () => {
  it('start / status / history / report / remove 走通', async () => {
    const service = makeService()
    const startResponse = await service.handle(
      new Request(`${BASE}${ROUTES.insightStart}`, {
        method: 'POST',
        body: JSON.stringify({ days: 30, provider: 'magpie', model: 'demo-model' }),
      }),
    )
    expect(startResponse.status).toBe(200)

    const done = await waitDone(service)
    const statusResponse = await service.handle(new Request(`${BASE}${ROUTES.insightStatus}`))
    await expect(statusResponse.json()).resolves.toMatchObject({ status: 'done' })

    const historyResponse = await service.handle(new Request(`${BASE}${ROUTES.insightHistory}`))
    const history = (await historyResponse.json()) as { entries: unknown[] }
    expect(history.entries).toHaveLength(1)

    const id = done.reportId ?? ''
    const reportResponse = await service.handle(
      new Request(`${BASE}${ROUTES.insightReport}?${new URLSearchParams({ id }).toString()}`),
    )
    expect(reportResponse.status).toBe(200)

    const removeResponse = await service.handle(
      new Request(`${BASE}${ROUTES.insightRemove}`, { method: 'POST', body: JSON.stringify({ id }) }),
    )
    expect(removeResponse.status).toBe(200)
  })

  it('新报告默认未读，标已读之后历史里带时间', async () => {
    const service = makeService()
    await service.handle(
      new Request(`${BASE}${ROUTES.insightStart}`, {
        method: 'POST',
        body: JSON.stringify({ days: 30, provider: 'magpie', model: 'demo-model' }),
      }),
    )
    const done = await waitDone(service)
    const id = done.reportId ?? ''

    const before = (await (
      await service.handle(new Request(`${BASE}${ROUTES.insightHistory}`))
    ).json()) as { entries: { id: string; readAt: string | null }[] }
    expect(before.entries[0]).toMatchObject({ id, readAt: null })

    const readResponse = await service.handle(
      new Request(`${BASE}${ROUTES.insightRead}`, { method: 'POST', body: JSON.stringify({ id }) }),
    )
    expect(readResponse.status).toBe(200)

    const after = (await (
      await service.handle(new Request(`${BASE}${ROUTES.insightHistory}`))
    ).json()) as { entries: { id: string; readAt: string | null }[] }
    expect(typeof after.entries[0]?.readAt).toBe('string')
  })

  it('标已读时 id 不存在返回 404', async () => {
    const service = makeService()
    const response = await service.handle(
      new Request(`${BASE}${ROUTES.insightRead}`, { method: 'POST', body: JSON.stringify({ id: 'nope' }) }),
    )
    expect(response.status).toBe(404)
  })

  it('重复发起返回 409', async () => {
    const service = makeService({ llm: makeLlm({ slowMs: 300 }).llm })
    const body = JSON.stringify({ days: 30, provider: 'magpie', model: 'demo-model' })
    const first = await service.handle(new Request(`${BASE}${ROUTES.insightStart}`, { method: 'POST', body }))
    expect(first.status).toBe(200)
    const second = await service.handle(new Request(`${BASE}${ROUTES.insightStart}`, { method: 'POST', body }))
    expect(second.status).toBe(409)
    await service.handle(new Request(`${BASE}${ROUTES.insightCancel}`, { method: 'POST' }))
    await waitDone(service)
  })

  it('坏 JSON 返回统一错误体', async () => {
    const service = makeService()
    const response = await service.handle(
      new Request(`${BASE}${ROUTES.insightStart}`, { method: 'POST', body: '{oops' }),
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('invalid-request')
  })

  it('未知端点返回 404', async () => {
    const response = await makeService().handle(new Request(`${BASE}/api/context-optimize.insight.nope`))
    expect(response.status).toBe(404)
  })
})
