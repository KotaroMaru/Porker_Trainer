/// <reference types="node" />
// P4 Step C: useGtoStoreの統合テスト。loadFlopSolutionはモックせず、globalThis.fetchを
// スタブして実際の.binファイル(public/gto/solutions/)をディスクから返すことで、
// フェッチ→デコード→スポット生成→採点の一連の流れを実データで検証する。
// process.cwd()基準のパス解決を使う(grading.test.tsで判明したimport.meta.url問題を回避)。

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { useGtoStore } from './store'

const originalFetch = globalThis.fetch

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    const match = url.match(/\/gto\/solutions\/([^/]+)\/([^/]+)\.bin$/)
    if (!match) throw new Error(`unexpected fetch url in test stub: ${url}`)
    const [, scenarioId, flopId] = match
    const filePath = join(process.cwd(), 'public/gto/solutions', scenarioId, `${flopId}.bin`)
    const buf = await readFile(filePath)
    const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    return new Response(arrayBuf, { status: 200 })
  }) as typeof fetch
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

beforeEach(() => {
  useGtoStore.setState({
    status: 'idle',
    spot: null,
    grading: null,
    errorMessage: null,
    sessionTally: { spots: 0, correct: 0, marginal: 0, totalEvLossBb: 0 },
  })
})

describe('useGtoStore', () => {
  it('startNewSpotでstatusがuserTurnになりspotが設定される', async () => {
    await useGtoStore.getState().startNewSpot()
    const state = useGtoStore.getState()
    expect(state.status).toBe('userTurn')
    expect(state.spot).not.toBeNull()
    expect(state.errorMessage).toBeNull()
  })

  it('chooseActionでstatusがgradedになりgradingとtallyが更新される', async () => {
    await useGtoStore.getState().startNewSpot()
    const spot = useGtoStore.getState().spot
    if (!spot) throw new Error('spot should be set')
    const label = spot.decodedNode.actionLabels[0]

    useGtoStore.getState().chooseAction(label)

    const state = useGtoStore.getState()
    expect(state.status).toBe('graded')
    expect(state.grading).not.toBeNull()
    expect(['correct', 'marginal', 'incorrect']).toContain(state.grading?.verdict)
    expect(state.sessionTally.spots).toBe(1)
    expect(state.sessionTally.totalEvLossBb).toBeGreaterThanOrEqual(0)
  })

  it('nextSpotで新しいスポットに切り替わりgradingがリセットされる', async () => {
    await useGtoStore.getState().startNewSpot()
    const firstSpot = useGtoStore.getState().spot
    if (!firstSpot) throw new Error('spot should be set')
    useGtoStore.getState().chooseAction(firstSpot.decodedNode.actionLabels[0])
    expect(useGtoStore.getState().status).toBe('graded')

    await useGtoStore.getState().nextSpot()

    const state = useGtoStore.getState()
    expect(state.status).toBe('userTurn')
    expect(state.grading).toBeNull()
    expect(state.spot).not.toBeNull()
  })

  it('複数スポットを連続で解いてもtallyが正しく累積する', async () => {
    for (let i = 0; i < 5; i++) {
      await useGtoStore.getState().startNewSpot()
      const spot = useGtoStore.getState().spot
      if (!spot) throw new Error('spot should be set')
      useGtoStore.getState().chooseAction(spot.decodedNode.actionLabels[0])
    }
    const tally = useGtoStore.getState().sessionTally
    expect(tally.spots).toBe(5)
    expect(tally.correct + tally.marginal).toBeLessThanOrEqual(tally.spots)
    expect(tally.totalEvLossBb).toBeGreaterThanOrEqual(0)
  })

  it('fetch失敗時はstatusがerrorになりエラーメッセージが設定される', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as typeof fetch
    try {
      await useGtoStore.getState().startNewSpot()
      const state = useGtoStore.getState()
      expect(state.status).toBe('error')
      expect(state.errorMessage).toBeTruthy()
    } finally {
      // 後続テストへ影響しないようbeforeAllのスタブへ戻す
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        const match = url.match(/\/gto\/solutions\/([^/]+)\/([^/]+)\.bin$/)
        if (!match) throw new Error(`unexpected fetch url in test stub: ${url}`)
        const [, scenarioId, flopId] = match
        const filePath = join(process.cwd(), 'public/gto/solutions', scenarioId, `${flopId}.bin`)
        const buf = await readFile(filePath)
        const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
        return new Response(arrayBuf, { status: 200 })
      }) as typeof fetch
    }
  })
})
