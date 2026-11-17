/**
 * 页头的「新版本 vX」入口：只提示，不安装。
 *
 * 显示条件由宿主判定（npm 同名安装 + 安装源上有更高的正式版 + 声明了 dsh.bundle），
 * 客户端只认 `updateAvailable`，因此不会出现「点亮了、插件页却没有更新按钮」的情况。
 *
 * 点击优先让 DSH 插件页打开本包详情（更新在那一页）；没有该服务时退化成打开 npm 页面。
 * 请求失败一律静默：面板上多一个「检查失败」比不提示更打扰。
 */
import { useEffect, useState } from 'react'
import type { ContextOptimizeApi } from '../api.ts'
import type { Translate } from '../dsh.ts'
import { PACKAGE_NAME } from '../../shared/types.ts'
import type { VersionPayload } from '../../shared/types.ts'

/** 客户端缓存：面板反复挂载时不必重复问宿主。 */
const CLIENT_CACHE_MS = 10 * 60 * 1000

/** 没有 DSH 导航服务时的兜底出口。 */
const NPM_PAGE = `https://www.npmjs.com/package/${PACKAGE_NAME}`

let cached: { at: number; data: VersionPayload | null } | null = null
let inflight: Promise<VersionPayload | null> | null = null

/** 清掉模块级缓存；测试用。 */
export function resetUpdateHintCache(): void {
  cached = null
  inflight = null
}

/** 缓存条目本身可能装着「失败」（data 为 null），所以要区分「没缓存」和「缓存了 null」。 */
function freshEntry(): { at: number; data: VersionPayload | null } | null {
  if (cached === null || Date.now() - cached.at >= CLIENT_CACHE_MS) return null
  return cached
}

/**
 * 取一次版本信息（命中缓存则不发请求）。
 * 失败也写进缓存——失败重试留给宿主侧的 5 分钟缓存，面板不做重试风暴。
 */
function loadVersion(api: ContextOptimizeApi): Promise<VersionPayload | null> {
  const entry = freshEntry()
  if (entry !== null) return Promise.resolve(entry.data)
  if (inflight !== null) return inflight
  const run = api
    .version()
    .then((data) => {
      cached = { at: Date.now(), data }
      return data
    })
    .catch(() => {
      cached = { at: Date.now(), data: null }
      return null
    })
    .finally(() => {
      inflight = null
    })
  inflight = run
  return run
}

export interface UpdateHintProps {
  t: Translate
  api: ContextOptimizeApi
}

export function UpdateHint({ t, api }: UpdateHintProps): JSX.Element | null {
  const [data, setData] = useState<VersionPayload | null>(() => freshEntry()?.data ?? null)

  useEffect(() => {
    let alive = true
    void loadVersion(api).then((value) => {
      if (alive) setData(value)
    })
    return () => {
      alive = false
    }
  }, [api])

  if (data === null || !data.updateAvailable || data.latest === null) return null

  const tip = t('update.tip', { version: data.latest })
  return (
    <button
      type="button"
      className="dscx-update"
      aria-label={tip}
      onClick={() => {
        if (!api.openPluginPage()) window.open(NPM_PAGE, '_blank', 'noopener,noreferrer')
      }}
    >
      <span className="dscx-update-label">{t('update.label')}</span>
      <span className="dscx-update-v">{`v${data.latest}`}</span>
      <span className="dscx-update-tip" aria-hidden="true">
        {tip}
      </span>
    </button>
  )
}
