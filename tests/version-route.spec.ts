/**
 * `/version` 路由：走真实 service.handle，只把版本检查器换成假的。
 *
 * 这里验证的是「接线」——路径命中、GET 可用、载荷原样返回、异常不外暴。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ContextOptimizeService } from '../src/host/service.ts'
import { apply } from '../src/index.ts'
import { ROUTES } from '../src/shared/types.ts'
import type { VersionPayload } from '../src/shared/types.ts'
import { makeTmpDir, removeTmpDir } from './helpers.ts'

const BASE = 'http://127.0.0.1:51082'
const ENV_KEYS = ['DSH_HOME', 'DSH_AGENTS_HOME', 'DSH_BUNDLED_SKILL_DIR'] as const

let savedEnv: Record<string, string | undefined> = {}
let tmp = ''
let service: ContextOptimizeService

const PAYLOAD: VersionPayload = {
  current: '0.1.2',
  latest: '0.2.0',
  updateAvailable: true,
  installSource: 'registry',
}

beforeEach(async () => {
  savedEnv = {}
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  tmp = await makeTmpDir('dco-version')
  process.env.DSH_HOME = join(tmp, 'dsh-home')
  process.env.DSH_AGENTS_HOME = join(tmp, 'agents-home')
  process.env.DSH_BUNDLED_SKILL_DIR = join(tmp, 'bundled')
  service = new ContextOptimizeService({
    dshHome: join(tmp, 'dsh-home'),
    cachePath: join(tmp, 'state', 'frequency.json'),
    versionCheck: { check: async () => PAYLOAD },
  })
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

describe('GET /version', () => {
  it('返回版本检查器的载荷', async () => {
    const response = await service.handle(new Request(`${BASE}${ROUTES.version}`))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(PAYLOAD)
  })

  it('路径命中新端点，不会落到 not-found', async () => {
    const response = await service.handle(new Request(`${BASE}${ROUTES.version}`))
    const body = (await response.json()) as { error?: unknown }
    expect(response.status).toBe(200)
    expect(body.error).toBeUndefined()
  })

  it('检查器抛错时仍是统一错误体，不外暴堆栈', async () => {
    const failing = new ContextOptimizeService({
      dshHome: join(tmp, 'dsh-home'),
      cachePath: join(tmp, 'state', 'frequency.json'),
      versionCheck: {
        check: async () => {
          throw new Error('boom')
        },
      },
    })
    try {
      const response = await failing.handle(new Request(`${BASE}${ROUTES.version}`))
      expect(response.status).toBe(500)
      const body = (await response.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('internal')
      expect(body.error.message).toBe('boom')
    } finally {
      await failing.dispose()
    }
  })
})

describe('插件入口的接线', () => {
  interface RegisteredRoute {
    path: string
    methods: string[]
    fetch(request: Request): Promise<Response>
  }

  it('profileContext.dir 一路传到版本检查：link 安装不提示', async () => {
    const linkProfile = join(tmp, 'linked-profile')
    await mkdir(linkProfile, { recursive: true })
    await writeFile(
      join(linkProfile, 'package.json'),
      JSON.stringify({ dependencies: { '@kulebbb/dsh-context-optimize': 'link:/tmp/plugin' } }),
      'utf8',
    )

    const routes: RegisteredRoute[] = []
    const ctx = {
      get: (name: string) => (name === 'profileContext' ? { dir: linkProfile } : undefined),
      connection: {
        fetch: {
          register: (route: RegisteredRoute) => {
            routes.push(route)
            return () => undefined
          },
        },
      },
      // effect 立即执行工厂：apply 正是在里面注册路由的；没有 sessionQuery，回溯会自己跳过
      effect: (factory: () => (() => void) | void) => {
        factory()
        return () => undefined
      },
      inject: () => undefined,
      on: () => () => undefined,
      logger: { warn: () => undefined },
    }
    apply(ctx as never)

    const route = routes.find((item) => item.path === ROUTES.version)
    expect(route).toBeDefined()
    expect(route?.methods).toEqual(['GET'])
    const response = await route?.fetch(new Request(`${BASE}${ROUTES.version}`))
    const payload = (await response?.json()) as VersionPayload
    expect(payload.installSource).toBe('other')
    expect(payload.updateAvailable).toBe(false)
    expect(payload.current).toMatch(/^\d+\.\d+\.\d+/)
  })
})
