/// <reference types="node" />
// P4 Step C: useGtoStoreの統合テスト。loadFlopSolutionはモックせず、globalThis.fetchを
// スタブして実際の.binファイル(public/gto/solutions/)をディスクから返すことで、
// フェッチ→デコード→スポット生成→採点の一連の流れを実データで検証する。
// process.cwd()基準のパス解決を使う(grading.test.tsで判明したimport.meta.url問題を回避)。

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { useGtoStore } from './store'
import { __resetSolutionCacheForTests } from './loader/solutionLoader'

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
    review: null,
    reviewFeatures: [],
    reviewFeaturesStatus: 'idle',
    activeDecisionIdx: 0,
  })
})

/** setTimeout(0)で遅延実行されるcomputeSpotFeaturesの完了を待つ(実測約600ms/回)。 */
async function waitForReviewFeatures(timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (useGtoStore.getState().reviewFeaturesStatus === 'computing') {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for reviewFeaturesStatus to leave "computing"')
    await new Promise((r) => setTimeout(r, 20))
  }
}

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
    // loadFlopSolutionのLRUキャッシュ(モジュールレベル・このテストファイルの
    // 生存期間中共有)に、直前のテストでキャッシュ済みのフロップがpickWeightedFlop()に
    // 偶然選ばれるとfetchを経由せず成功してしまう(実際に観測されたフレーク)。
    // 必ずfetchを呼ばせるため事前にクリアする。
    __resetSolutionCacheForTests()
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

  it('chooseAction直後にreviewが同期的に設定され、reviewFeaturesStatusはcomputingになる', async () => {
    await useGtoStore.getState().startNewSpot()
    const spot = useGtoStore.getState().spot
    if (!spot) throw new Error('spot should be set')
    const label = spot.decodedNode.actionLabels[0]

    useGtoStore.getState().chooseAction(label)

    const state = useGtoStore.getState()
    expect(state.review).not.toBeNull()
    expect(state.review?.decisions.length).toBe(1)
    expect(state.reviewFeatures).toEqual([null])
    expect(state.reviewFeaturesStatus).toBe('computing')
    expect(state.activeDecisionIdx).toBe(0)
  })

  it('reviewFeaturesStatusはやがてreadyになり、reviewFeaturesにSpotFeaturesが入る', async () => {
    await useGtoStore.getState().startNewSpot()
    const spot = useGtoStore.getState().spot
    if (!spot) throw new Error('spot should be set')
    useGtoStore.getState().chooseAction(spot.decodedNode.actionLabels[0])

    await waitForReviewFeatures()

    const state = useGtoStore.getState()
    expect(state.reviewFeaturesStatus).toBe('ready')
    expect(state.reviewFeatures.length).toBe(1)
    expect(state.reviewFeatures[0]).not.toBeNull()
    expect(state.reviewFeatures[0]?.handClass).toBeDefined()
  })

  it('nextSpotでreview/reviewFeatures/reviewFeaturesStatus/activeDecisionIdxがリセットされる', async () => {
    await useGtoStore.getState().startNewSpot()
    const spot = useGtoStore.getState().spot
    if (!spot) throw new Error('spot should be set')
    useGtoStore.getState().chooseAction(spot.decodedNode.actionLabels[0])
    await waitForReviewFeatures()
    expect(useGtoStore.getState().reviewFeaturesStatus).toBe('ready')

    await useGtoStore.getState().nextSpot()

    const state = useGtoStore.getState()
    expect(state.review).toBeNull()
    expect(state.reviewFeatures).toEqual([])
    expect(state.reviewFeaturesStatus).toBe('idle')
    expect(state.activeDecisionIdx).toBe(0)
  })

  it('setActiveDecisionIdxでactiveDecisionIdxが更新される', () => {
    useGtoStore.getState().setActiveDecisionIdx(2)
    expect(useGtoStore.getState().activeDecisionIdx).toBe(2)
  })

  it('ensureFeaturesは指定idxのみ計算し、他のidxはnullのまま(表示中の決断のみオンデマンド計算)', async () => {
    await useGtoStore.getState().startNewSpot()
    const spot = useGtoStore.getState().spot
    if (!spot) throw new Error('spot should be set')
    useGtoStore.getState().chooseAction(spot.decodedNode.actionLabels[0])
    await waitForReviewFeatures()
    const baseReview = useGtoStore.getState().review
    if (!baseReview) throw new Error('review should be set')

    // FullHandController統合(B7)前でも、reviewBuilder.tsの型だけで合成した
    // 2決断のReviewDataでensureFeaturesの「表示中のみ計算」挙動を検証できる。
    const syntheticDecision2 = { ...baseReview.decisions[0], nodeId: 'synthetic-decision-2' }
    const syntheticReview = { ...baseReview, decisions: [baseReview.decisions[0], syntheticDecision2] }
    useGtoStore.setState({ review: syntheticReview, reviewFeatures: [null, null], reviewFeaturesStatus: 'idle' })

    useGtoStore.getState().ensureFeatures(1)
    expect(useGtoStore.getState().reviewFeaturesStatus).toBe('computing')
    expect(useGtoStore.getState().reviewFeatures[0]).toBeNull()

    await waitForReviewFeatures()
    expect(useGtoStore.getState().reviewFeatures[1]).not.toBeNull()
    expect(useGtoStore.getState().reviewFeatures[0]).toBeNull()
  })

  it('ensureFeaturesは計算済みのidxを再計算しない(no-op)', async () => {
    await useGtoStore.getState().startNewSpot()
    const spot = useGtoStore.getState().spot
    if (!spot) throw new Error('spot should be set')
    useGtoStore.getState().chooseAction(spot.decodedNode.actionLabels[0])
    await waitForReviewFeatures()
    expect(useGtoStore.getState().reviewFeaturesStatus).toBe('ready')

    useGtoStore.getState().ensureFeatures(0)
    // 既にreviewFeatures[0]が計算済みなので即returnし、'computing'には戻らない。
    expect(useGtoStore.getState().reviewFeaturesStatus).toBe('ready')
  })

  it('reviewが無い状態、または範囲外のidxを渡した場合ensureFeaturesは何もしない', () => {
    useGtoStore.getState().ensureFeatures(0)
    expect(useGtoStore.getState().reviewFeaturesStatus).toBe('idle')
  })

  it('setActiveDecisionIdxはactiveDecisionIdxを更新すると同時に、そのidxのensureFeaturesをキックする', async () => {
    await useGtoStore.getState().startNewSpot()
    const spot = useGtoStore.getState().spot
    if (!spot) throw new Error('spot should be set')
    useGtoStore.getState().chooseAction(spot.decodedNode.actionLabels[0])
    await waitForReviewFeatures()
    const baseReview = useGtoStore.getState().review
    if (!baseReview) throw new Error('review should be set')

    const alreadyComputedFeatures = useGtoStore.getState().reviewFeatures[0]
    const syntheticDecision2 = { ...baseReview.decisions[0], nodeId: 'synthetic-decision-2' }
    const syntheticReview = { ...baseReview, decisions: [baseReview.decisions[0], syntheticDecision2] }
    useGtoStore.setState({ review: syntheticReview, reviewFeatures: [alreadyComputedFeatures, null] })

    useGtoStore.getState().setActiveDecisionIdx(1)
    expect(useGtoStore.getState().activeDecisionIdx).toBe(1)
    expect(useGtoStore.getState().reviewFeaturesStatus).toBe('computing')

    await waitForReviewFeatures()
    expect(useGtoStore.getState().reviewFeatures[1]).not.toBeNull()
  })

  it('計算完了前に次のスポットへ進んでも、古いreviewFeatures計算結果が新しいreviewへ混入しない', async () => {
    await useGtoStore.getState().startNewSpot()
    const firstSpot = useGtoStore.getState().spot
    if (!firstSpot) throw new Error('spot should be set')
    useGtoStore.getState().chooseAction(firstSpot.decodedNode.actionLabels[0])
    const firstReview = useGtoStore.getState().review

    // computeSpotFeaturesの完了(約600ms)を待たずに次のスポットへ進む
    await useGtoStore.getState().nextSpot()
    expect(useGtoStore.getState().review).not.toBe(firstReview)

    // 元のsetTimeoutコールバックが後から発火しても、reviewFeaturesStatusが
    // 'idle'のまま(新スポットはまだ採点されていない)であることを確認する
    await new Promise((r) => setTimeout(r, 800))
    expect(useGtoStore.getState().reviewFeaturesStatus).toBe('idle')
    expect(useGtoStore.getState().review).toBeNull()
  })
})
