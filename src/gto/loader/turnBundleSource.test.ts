import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Card } from '../../engine/types'
import { focusEligibleScenarioIds, loadTurnBundleSolution, TURN_BUNDLE_BASE_URL } from './turnBundleSource'

function pushU8String(bytes: number[], value: string): void {
  bytes.push(value.length, ...[...value].map(char => char.charCodeAt(0)))
}

function pushU16(bytes: number[], value: number): void {
  bytes.push(value & 0xff, (value >> 8) & 0xff)
}

function pushU32(bytes: number[], value: number): void {
  bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff)
}

function buildSolutionBlob(): Uint8Array {
  const bytes: number[] = [...'GTO1'].map(char => char.charCodeAt(0))
  bytes.push(1)
  pushU8String(bytes, 'srp_btn_vs_bb')
  bytes.push(51, 43, 39) // AsQsJs
  pushU32(bytes, 55)
  pushU32(bytes, 975)
  pushU16(bytes, 1)
  bytes.push(0, 1)
  pushU16(bytes, 1)
  bytes.push(2, 3)
  pushU16(bytes, 1)
  pushU8String(bytes, '')
  bytes.push(0, 1)
  pushU8String(bytes, 'check')
  pushU32(bytes, 0)
  bytes.push(255)
  pushU16(bytes, 0)
  return new Uint8Array(bytes)
}

function buildBundle(): ArrayBuffer {
  const blob = buildSolutionBlob()
  const bytes: number[] = [...'GTOB'].map(char => char.charCodeAt(0))
  bytes.push(1)
  pushU8String(bytes, 'srp_btn_vs_bb')
  bytes.push(51, 43, 39)
  pushU8String(bytes, 'check-check')
  bytes.push(1, 0) // turnCount=1, turnCardId=0 (2c)
  pushU32(bytes, 0)
  pushU32(bytes, blob.length)
  bytes.push(...blob)
  return new Uint8Array(bytes).buffer
}

const flopCards: Card[] = [
  { rank: 14, suit: 's' },
  { rank: 12, suit: 's' },
  { rank: 11, suit: 's' },
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('turnBundleSource', () => {
  it('特化モード対象を収録済みシナリオから返す', () => {
    expect(focusEligibleScenarioIds()).toEqual(['srp_btn_vs_bb'])
  })

  it.each([
    ['収録外シナリオ', 'srp_co_vs_bb', 'check-check'],
    // オールイン経路はランアウトのみで決断が無く、恒久的にバンドルを持たない。
    ['収録外経路', 'srp_btn_vs_bb', 'bet33-allin-call'],
  ])('%sではfetchしない', async (_name, scenarioId, pathId) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await loadTurnBundleSolution({
      scenarioId,
      flopId: 'AsQsJs',
      flopCards,
      pathId,
      turnCard: { rank: 2, suit: 'c' },
    })

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('収録済みバンドルから指定ターン解を復元し、正規のハイフン区切りpathIdをURLに使う', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(buildBundle(), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await loadTurnBundleSolution({
      scenarioId: 'srp_btn_vs_bb',
      flopId: 'AsQsJs',
      flopCards,
      pathId: 'check-check',
      turnCard: { rank: 2, suit: 'c' },
    })

    expect(result?.nodes.get('')?.actionLabels).toEqual(['check'])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(`${TURN_BUNDLE_BASE_URL}/srp_btn_vs_bb/AsQsJs/check-check.bin`)
  })

  it.each([
    ['ネットワークエラー', () => Promise.reject(new TypeError('offline'))],
    ['404', () => Promise.resolve(new Response(null, { status: 404 }))],
    ['不正バイト列', () => Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))],
  ])('%sを例外にせずnullへフォールバックする', async (_name, responseFactory) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(responseFactory))

    await expect(loadTurnBundleSolution({
      scenarioId: 'srp_btn_vs_bb',
      flopId: 'AsQsJs',
      flopCards,
      pathId: 'check-check',
      turnCard: { rank: 2, suit: 'c' },
    })).resolves.toBeNull()
  })
})
