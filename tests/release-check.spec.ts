/**
 * 版本检查的判据：来源分类、版本比较、安装源探测、缓存与失败静默。
 *
 * 纪律：这里不联网。fetch 全部注入假实现，时间也注入，断言的是「什么时候提示」。
 */
import { describe, expect, it } from 'vitest'
import {
  ReleaseCheck,
  classifyInstallSource,
  compareVersions,
  installSpecOf,
  isStableVersion,
  parseVersion,
  profileDirOfContext,
  resolveProfileDir,
} from '../src/host/release-check.ts'
import { PACKAGE_NAME } from '../src/shared/types.ts'

/** 造一个 latest 端点的响应体：默认带 dsh.bundle。 */
function manifest(version: string, bundle: unknown = { patch: './cordis.patch.yml' }): Record<string, unknown> {
  return { name: PACKAGE_NAME, version, ...(bundle === null ? {} : { dsh: { bundle } }) }
}

function respond(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  )
}

describe('classifyInstallSource', () => {
  it('版本号、范围与 tag 都算 registry（唯一可能应用内更新的来源）', () => {
    for (const spec of ['0.1.2', '^0.1.2', '~0.2.0', 'latest', '>=0.1.0 <0.3.0', '0.1.x']) {
      expect(classifyInstallSource(spec), spec).toBe('registry')
    }
  })

  it('本地目录、Git 与裸 URL 都不是 registry', () => {
    for (const spec of [
      'link:/Volumes/work/dsh-context-optimize',
      'file:../dsh-context-optimize',
      'workspace:*',
      'git+https://github.com/kulebbb/dsh-context-optimize.git#abc123',
      'github:kulebbb/dsh-context-optimize',
      'https://github.com/kulebbb/dsh-context-optimize',
      './local-package',
      '../up',
      '/abs/path',
      'C:\\plugins\\dsh-context-optimize',
      '\\\\fileserver\\plugins',
      'npm:@kulebbb/dsh-context-optimize@0.1.2',
      'patch:@kulebbb/dsh-context-optimize@0.1.2#./fix.patch',
      'git@github.com:kulebbb/dsh-context-optimize.git',
    ]) {
      expect(classifyInstallSource(spec), spec).toBe('other')
    }
  })

  it('缺失依赖值算未知', () => {
    expect(classifyInstallSource(undefined)).toBe('unknown')
    expect(classifyInstallSource('   ')).toBe('unknown')
  })
})

describe('compareVersions / parseVersion', () => {
  it('按数字位比较，支持 v 前缀', () => {
    expect(compareVersions('0.2.0', '0.1.2')).toBeGreaterThan(0)
    expect(compareVersions('0.1.2', '0.1.2')).toBe(0)
    expect(compareVersions('v0.2.0', '0.2.0')).toBe(0)
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0)
  })

  it('预发布低于同号正式版，rc 按序号递增', () => {
    expect(compareVersions('0.2.0-rc.1', '0.2.0')).toBeLessThan(0)
    expect(compareVersions('0.2.0-rc.2', '0.2.0-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0-beta.1', '0.2.0-rc.1')).toBeLessThan(0)
    expect(isStableVersion('0.2.0')).toBe(true)
    expect(isStableVersion('0.2.0-rc.1')).toBe(false)
  })

  it('认不出的版本串返回 null，不抛错', () => {
    expect(parseVersion('not-a-version')).toBeNull()
    expect(compareVersions('x', '0.1.0')).toBeNull()
    expect(isStableVersion('')).toBe(false)
  })
})

describe('installSpecOf / resolveProfileDir', () => {
  it('三类依赖都看，取到即返回', () => {
    expect(installSpecOf({ dependencies: { [PACKAGE_NAME]: '^0.1.2' } }, PACKAGE_NAME)).toBe('^0.1.2')
    expect(installSpecOf({ devDependencies: { [PACKAGE_NAME]: '0.1.2' } }, PACKAGE_NAME)).toBe('0.1.2')
    expect(installSpecOf({ optionalDependencies: { [PACKAGE_NAME]: 'link:x' } }, PACKAGE_NAME)).toBe('link:x')
    expect(installSpecOf({ dependencies: {} }, PACKAGE_NAME)).toBeUndefined()
    expect(installSpecOf(null, PACKAGE_NAME)).toBeUndefined()
  })

  it('优先 DSH_PROFILE_DIR，其次按 DSH_PROFILE 拼，都没有则为 undefined', () => {
    expect(resolveProfileDir({ DSH_PROFILE_DIR: '/p/x', DSH_PROFILE: 'web' }, '/home/.dsh')).toBe('/p/x')
    expect(resolveProfileDir({ DSH_PROFILE: 'web' }, '/home/.dsh')).toBe('/home/.dsh/profiles/web')
    expect(resolveProfileDir({}, '/home/.dsh')).toBeUndefined()
  })
})

/** 造一个只会回答 profileContext 的最小上下文（按 Cordis 的泛型签名收口）。 */
function ctxWith(getter: (name: string) => unknown): { get: <T = unknown>(name: string) => T | undefined } {
  return {
    get: <T,>(name: string) => getter(name) as T | undefined,
  }
}

describe('profileDirOfContext', () => {
  it('以宿主的 profileContext 服务为准', () => {
    expect(profileDirOfContext(ctxWith((name) => (name === 'profileContext' ? { dir: '/p/desktop' } : undefined)))).toBe(
      '/p/desktop',
    )
  })

  it('服务缺失、dir 非字符串或 get 抛错时返回 undefined', () => {
    expect(profileDirOfContext({})).toBeUndefined()
    expect(profileDirOfContext(ctxWith(() => ({})))).toBeUndefined()
    expect(profileDirOfContext(ctxWith(() => ({ dir: 42 })))).toBeUndefined()
    expect(
      profileDirOfContext(
        ctxWith(() => {
          throw new Error('not ready')
        }),
      ),
    ).toBeUndefined()
  })
})

describe('ReleaseCheck', () => {
  const base = { readVersion: async () => '0.1.2', readSpec: async () => '^0.1.2' }

  it('registry 安装 + 更高的正式版 + 有 bundle → 提示', async () => {
    const check = new ReleaseCheck({
      ...base,
      fetchImpl: (() => respond(manifest('0.2.0'))) as unknown as typeof fetch,
    })
    await expect(check.check()).resolves.toEqual({
      current: '0.1.2',
      latest: '0.2.0',
      updateAvailable: true,
      installSource: 'registry',
    })
  })

  it('同版本、预发布、无 bundle 都不提示', async () => {
    const same = new ReleaseCheck({
      ...base,
      fetchImpl: (() => respond(manifest('0.1.2'))) as unknown as typeof fetch,
    })
    expect((await same.check()).updateAvailable).toBe(false)

    const pre = new ReleaseCheck({
      ...base,
      fetchImpl: (() => respond(manifest('0.2.0-rc.1'))) as unknown as typeof fetch,
    })
    expect((await pre.check()).updateAvailable).toBe(false)

    const noBundle = new ReleaseCheck({
      ...base,
      fetchImpl: (() => respond(manifest('0.2.0', null))) as unknown as typeof fetch,
    })
    expect((await noBundle.check()).updateAvailable).toBe(false)
  })

  it('本地 / Git 安装完全不发请求', async () => {
    for (const spec of ['link:/tmp/plugin', 'github:kulebbb/dsh-context-optimize']) {
      let calls = 0
      const check = new ReleaseCheck({
        readVersion: async () => '0.1.2',
        readSpec: async () => spec,
        fetchImpl: (() => {
          calls += 1
          return respond(manifest('0.2.0'))
        }) as unknown as typeof fetch,
      })
      const payload = await check.check()
      expect(payload.updateAvailable, spec).toBe(false)
      expect(payload.installSource, spec).toBe('other')
      expect(calls, spec).toBe(0)
    }
  })

  it('安装来源未知时不发请求', async () => {
    let calls = 0
    const check = new ReleaseCheck({
      readVersion: async () => '0.1.2',
      readSpec: async () => undefined,
      fetchImpl: (() => {
        calls += 1
        return respond(manifest('0.2.0'))
      }) as unknown as typeof fetch,
    })
    const payload = await check.check()
    expect(payload.installSource).toBe('unknown')
    expect(payload.updateAvailable).toBe(false)
    expect(calls).toBe(0)
  })

  it('首选源不可用时自动换备选源', async () => {
    const urls: string[] = []
    const check = new ReleaseCheck({
      ...base,
      registries: ['https://registry.npmjs.org', 'https://registry.npmmirror.com'],
      fetchImpl: ((url: string) => {
        urls.push(url)
        return url.includes('npmjs') ? respond({}, 500) : respond(manifest('0.2.0'))
      }) as unknown as typeof fetch,
    })
    const payload = await check.check()
    expect(urls).toHaveLength(2)
    expect(urls[1]).toContain('npmmirror')
    expect(payload.updateAvailable).toBe(true)
  })

  it('两个源都失败时静默，不抛错', async () => {
    const check = new ReleaseCheck({
      ...base,
      fetchImpl: (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch,
    })
    await expect(check.check()).resolves.toEqual({
      current: '0.1.2',
      latest: null,
      updateAvailable: false,
      installSource: 'registry',
    })
  })

  it('请求超时按失败处理', async () => {
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })) as unknown as typeof fetch
    const check = new ReleaseCheck({
      ...base,
      timeoutMs: 5,
      registries: ['https://registry.npmjs.org'],
      fetchImpl: hanging,
    })
    await expect(check.check()).resolves.toMatchObject({ updateAvailable: false, latest: null })
  })

  it('成功结果缓存 1 小时，失败只缓存 5 分钟', async () => {
    let now = 0
    let calls = 0
    const ok = new ReleaseCheck({
      ...base,
      now: () => now,
      fetchImpl: (() => {
        calls += 1
        return respond(manifest('0.2.0'))
      }) as unknown as typeof fetch,
    })
    await ok.check()
    await ok.check()
    expect(calls).toBe(1)
    now += 60 * 60 * 1000 + 1
    await ok.check()
    expect(calls).toBe(2)

    now = 0
    calls = 0
    const failing = new ReleaseCheck({
      ...base,
      now: () => now,
      registries: ['https://registry.npmjs.org'],
      fetchImpl: (() => {
        calls += 1
        return Promise.reject(new Error('offline'))
      }) as unknown as typeof fetch,
    })
    await failing.check()
    await failing.check()
    expect(calls).toBe(1)
    now += 5 * 60 * 1000 + 1
    await failing.check()
    expect(calls).toBe(2)
  })

  it('并发调用共享同一次请求', async () => {
    let calls = 0
    const check = new ReleaseCheck({
      ...base,
      fetchImpl: (() => {
        calls += 1
        return respond(manifest('0.2.0'))
      }) as unknown as typeof fetch,
    })
    const [a, b] = await Promise.all([check.check(), check.check()])
    expect(calls).toBe(1)
    expect(a).toEqual(b)
  })

  it('读不到自身版本时不提示，也不发请求', async () => {
    let calls = 0
    const check = new ReleaseCheck({
      readVersion: async () => null,
      readSpec: async () => '^0.1.2',
      fetchImpl: (() => {
        calls += 1
        return respond(manifest('0.2.0'))
      }) as unknown as typeof fetch,
    })
    const payload = await check.check()
    expect(payload).toEqual({ current: '', latest: null, updateAvailable: false, installSource: 'unknown' })
    expect(calls).toBe(0)
  })
})
