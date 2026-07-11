// P6 Step B9: availability.tsのテスト。globalThis.fetchをスタブし、完全manifest/
// 部分manifest(20枚未満)/404の3パターンを検証する。

import { describe, it, expect, afterEach } from 'vitest'
import { detectAvailability, playableScenarioIds, MIN_FLOPS_FOR_PLAY } from './availability'

const originalFetch = globalThis.fetch

function manifestOf(flopCount: number): { flop: string; expl_pot_frac: number; seconds: number; bytes: number }[] {
  return Array.from({ length: flopCount }, (_, i) => ({
    flop: `flop${i}`,
    expl_pot_frac: 0.004,
    seconds: 100,
    bytes: 90000,
  }))
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('detectAvailability', () => {
  it('完全なmanifest(95枚)・部分manifest(10枚)・404の3シナリオを正しく分類する', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/full/')) return new Response(JSON.stringify(manifestOf(95)), { status: 200 })
      if (url.includes('/partial/')) return new Response(JSON.stringify(manifestOf(10)), { status: 200 })
      if (url.includes('/missing/')) return new Response('not found', { status: 404 })
      throw new Error(`unexpected url in test: ${url}`)
    }) as typeof fetch

    const availability = await detectAvailability(['full', 'partial', 'missing'])

    expect(availability.get('full')?.length).toBe(95)
    expect(availability.get('partial')?.length).toBe(10)
    expect(availability.has('missing')).toBe(false) // 404は結果から除外される

    const playable = playableScenarioIds(availability)
    expect(playable.has('full')).toBe(true)
    expect(playable.has('partial')).toBe(false) // 10 < MIN_FLOPS_FOR_PLAY
    expect(playable.has('missing')).toBe(false)
  })

  it('ちょうどMIN_FLOPS_FOR_PLAY枚のシナリオは出題可能に含まれる', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify(manifestOf(MIN_FLOPS_FOR_PLAY)), { status: 200 })) as typeof fetch
    const availability = await detectAvailability(['exact'])
    expect(playableScenarioIds(availability).has('exact')).toBe(true)
  })

  it('不正なJSON形状(配列でない)のシナリオは結果から除外される', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ not: 'an array' }), { status: 200 })) as typeof fetch
    const availability = await detectAvailability(['broken'])
    expect(availability.has('broken')).toBe(false)
  })

  it('fetch自体が例外を投げても他のシナリオの取得は妨げられない(Promise.allSettled)', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/ok/')) return new Response(JSON.stringify(manifestOf(30)), { status: 200 })
      throw new Error('network down')
    }) as typeof fetch

    const availability = await detectAvailability(['ok', 'broken-network'])
    expect(availability.get('ok')?.length).toBe(30)
    expect(availability.has('broken-network')).toBe(false)
  })
})
