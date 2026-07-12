/// <reference types="node" />
// P4 Step C: useGtoStoreの統合テスト。loadFlopSolutionはモックせず、globalThis.fetchを
// スタブして実際の.binファイル(public/gto/solutions/)をディスクから返すことで、
// フェッチ→デコード→スポット生成→採点の一連の流れを実データで検証する。
// process.cwd()基準のパス解決を使う(grading.test.tsで判明したimport.meta.url問題を回避)。

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  useGtoStore,
  initialTally,
  __setProviderFactoryForTests,
  __resetProviderFactoryForTests,
  selectScenarioPool,
  selectFlopPool,
  __resetAvailabilityInflightForTests,
} from './store'
import { __resetSolutionCacheForTests } from './loader/solutionLoader'
import { createInProcessProviderFactory } from './trainer/inProcessProviderFactory'
import type { NodeProviderFactory, StreetNodeProvider } from './trainer/nodeDataProvider'
import type { FullHandSnapshot } from './trainer/fullHandFlow'
import { SCENARIOS } from './data/scenarios'
import { FLOPS } from './data/flops'

const originalFetch = globalThis.fetch

const binFetchStub = (async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input.toString()
  const match = url.match(/\/gto\/solutions\/([^/]+)\/([^/]+)\.bin$/)
  if (!match) throw new Error(`unexpected fetch url in test stub: ${url}`)
  const [, scenarioId, flopId] = match
  const filePath = join(process.cwd(), 'public/gto/solutions', scenarioId, `${flopId}.bin`)
  const buf = await readFile(filePath)
  const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Response(arrayBuf, { status: 200 })
}) as typeof fetch

beforeAll(() => {
  globalThis.fetch = binFetchStub
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
    sessionTally: initialTally(),
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

describe('useGtoStore (通しモード, P6 B7)', () => {
  // Web WorkerはjsdomでexecuteできないためcreateInProcessProviderFactory(B4のテスト
  // シーム)を__setProviderFactoryForTestsで注入する。低イテレーションで高速化。
  beforeEach(() => {
    __setProviderFactoryForTests(() => createInProcessProviderFactory({ maxIterations: 15, targetExploitability: 0.1 }))
    useGtoStore.setState({
      status: 'idle',
      spot: null,
      grading: null,
      chosenLabel: null,
      errorMessage: null,
      sessionTally: initialTally(),
      settings: { mode: 'full', enabledScenarioIds: [] },
      fullHand: null,
      fullHandController: null,
      review: null,
      reviewFeatures: [],
      reviewFeaturesStatus: 'idle',
      activeDecisionIdx: 0,
    })
  })

  afterEach(() => {
    __resetProviderFactoryForTests()
  })

  /** statusがユーザー入力待ち(userTurn)またはハンド終了(handOver/error)になるまで待つ。 */
  async function waitForStorePause(timeoutMs = 30000): Promise<void> {
    const start = Date.now()
    while (!['userTurn', 'handOver', 'error'].includes(useGtoStore.getState().status)) {
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for store pause (status=${useGtoStore.getState().status})`)
      await new Promise((r) => setTimeout(r, 20))
    }
  }

  it('fullモードでcheckを選び続けるとhandOverに到達し、fullHand.resultが設定される', async () => {
    await useGtoStore.getState().startNewSpot()
    await waitForStorePause()

    let guard = 0
    while (useGtoStore.getState().status === 'userTurn') {
      guard++
      if (guard > 15) throw new Error('too many user decisions, possible infinite loop')
      const snap = useGtoStore.getState().fullHand
      if (!snap) throw new Error('fullHand should be set while status===userTurn')
      const label = snap.actionsWithAmounts.find((a) => a.label === 'check')?.label ?? snap.actionsWithAmounts[0].label
      useGtoStore.getState().chooseAction(label)
      await waitForStorePause()
    }

    expect(useGtoStore.getState().status).toBe('handOver')
    expect(useGtoStore.getState().fullHand?.result).not.toBeNull()
  }, 30_000)

  it('openReviewFromResultでhandOver後にreview(複数決断もありうる)が構築され、statusがgradedになりtallyのhands/decisionsが増える', async () => {
    await useGtoStore.getState().startNewSpot()
    await waitForStorePause()
    let guard = 0
    while (useGtoStore.getState().status === 'userTurn') {
      guard++
      if (guard > 15) throw new Error('too many user decisions, possible infinite loop')
      const snap = useGtoStore.getState().fullHand!
      const label = snap.actionsWithAmounts.find((a) => a.label === 'check')?.label ?? snap.actionsWithAmounts[0].label
      useGtoStore.getState().chooseAction(label)
      await waitForStorePause()
    }
    expect(useGtoStore.getState().status).toBe('handOver')

    useGtoStore.getState().openReviewFromResult()

    const state = useGtoStore.getState()
    expect(state.status).toBe('graded')
    expect(state.review).not.toBeNull()
    expect(state.review!.decisions.length).toBeGreaterThanOrEqual(1)
    expect(state.reviewFeatures.length).toBe(state.review!.decisions.length)
    expect(state.sessionTally.hands).toBe(1)
    expect(state.sessionTally.decisions).toBe(state.review!.decisions.length)
  }, 30_000)

  it('P7-6b: レビュー閲覧中(status=graded)にターンのバックグラウンドリファインが完了しても、statusがhandOverへ引き戻されずreview/featuresだけが差し替わる', async () => {
    // in-processファクトリは同期的に解くため、通常はreviewを開く前にリファインまで
    // 完了してしまい、レース自体を再現できない。3回目のforLiveStreet呼び出し
    // (ターン+リバーのプレイ用ソルブに続く、ターンのリファイン呼び出し)だけ、
    // readyの解決を手動でゲートして「レビュー画面を開いた後にリファインが完了する」
    // 状況を確定的に再現する。
    // ボットの行動は(store.tsがMath.randomを直接使うため)このテストからは
    // 決定論的に制御できない。ユーザー側はcheck優先・無ければcallを選び続けることで、
    // ターンへ到達する前にフォールド/オールインへ逸れる確率を実用上無視できる水準まで
    // 下げつつ、万一に備えて数ハンド分リトライする。
    // waitForStorePause()はstatusが停止集合に「現在」含まれるかどうかしか見ておらず、
    // 直前のポーズをまだ消費していない状態で連続してchooseActionを呼ぶと、真に新しい
    // ポーズを待たずに古い(既に消費済みの)fullHandスナップショットへ基づいてラベルを
    // 選んでしまうことがある(applyActionの「unknown label」throwやガード無限ループの
    // 原因になりうる)。ここでは`fullHand`オブジェクトの参照が実際に更新されたことを
    // 条件に含めることで、真に新しいポーズを確定的に待つ。基準スナップショットは
    // 「これから行うアクションの直前」に呼び出し側が明示的に渡す(待ち関数の内部で
    // 遅延取得すると、アクションが呼び出し側の`await`で既に完了済みの場合に「今の状態」を
    // 基準として捕捉してしまい、既に到達済みの新しいポーズ自体を「まだ来ていない」と
    // 誤認して無期限に待ち続けるバグになる)。
    function waitForFreshPause(seenFullHand: FullHandSnapshot | null): Promise<void> {
      return new Promise((resolve, reject) => {
        const isFresh = () => {
          const s = useGtoStore.getState()
          if (s.status === 'handOver' || s.status === 'error') return true
          return s.status === 'userTurn' && s.fullHand !== seenFullHand
        }
        if (isFresh()) {
          resolve()
          return
        }
        const timer = setTimeout(() => {
          unsub()
          const s = useGtoStore.getState()
          reject(new Error(`waitForFreshPause timed out: status=${s.status} phase=${s.fullHand?.phase} street=${s.fullHand?.street}`))
        }, 15_000)
        const unsub = useGtoStore.subscribe(() => {
          if (isFresh()) {
            clearTimeout(timer)
            unsub()
            resolve()
          }
        })
      })
    }

    let callIdx = 0
    let gate = new Promise<void>(() => {})
    let releaseRefine: (() => void) | null = null
    __setProviderFactoryForTests(() => {
      const inner = createInProcessProviderFactory({ maxIterations: 15, targetExploitability: 0.1 })
      const wrapped: NodeProviderFactory = {
        forFlop: (s, b) => inner.forFlop(s, b),
        forLiveStreet: (input) => {
          callIdx++
          const real = inner.forLiveStreet(input) // in-processは呼び出し時点で既に同期的に解いている
          if (callIdx <= 2) return real
          const gated: StreetNodeProvider = { ...real, ready: gate.then(() => real.ready) }
          return gated
        },
        dispose: () => inner.dispose(),
      }
      return wrapped
    })

    let reachedTurnRefine = false
    for (let attempt = 0; attempt < 8 && !reachedTurnRefine; attempt++) {
      callIdx = 0
      gate = new Promise<void>((resolve) => {
        releaseRefine = resolve
      })
      const beforeStart = useGtoStore.getState().fullHand
      if (attempt === 0) await useGtoStore.getState().startNewSpot()
      else await useGtoStore.getState().nextSpot()
      await waitForFreshPause(beforeStart)
      let guard = 0
      while (useGtoStore.getState().status === 'userTurn') {
        guard++
        if (guard > 15) throw new Error('too many user decisions, possible infinite loop')
        const snap = useGtoStore.getState().fullHand!
        const label =
          snap.actionsWithAmounts.find((a) => a.label === 'check')?.label ?? snap.actionsWithAmounts.find((a) => a.label === 'call')?.label ?? snap.actionsWithAmounts[0].label
        useGtoStore.getState().chooseAction(label)
        await waitForFreshPause(snap)
      }
      expect(useGtoStore.getState().status).toBe('handOver')
      reachedTurnRefine = callIdx === 3 // ターン+リバーのプレイ用+ターンのリファイン(ゲートされ未完了)
    }
    expect(reachedTurnRefine).toBe(true)

    useGtoStore.getState().openReviewFromResult()
    expect(useGtoStore.getState().status).toBe('graded')
    const reviewAtOpen = useGtoStore.getState().review!
    const turnIdx = reviewAtOpen.decisions.findIndex((d) => d.street === 'turn')
    expect(turnIdx).toBeGreaterThanOrEqual(0)
    // 表示中の決断(idx=0)のfeaturesが計算されるのを待つ。
    await waitForReviewFeatures()
    // ターン決断のfeaturesも表示させて計算済みにしておく(リファイン後に無効化されることを検証するため)。
    useGtoStore.getState().setActiveDecisionIdx(turnIdx)
    await waitForReviewFeatures()
    expect(useGtoStore.getState().reviewFeatures[turnIdx]).not.toBeNull()

    // ここでリファインの完了を解放する。finishOrRefineが決断を差し替え、
    // onUpdateがphase='over'のフォローアップemitを発行する。
    releaseRefine!()
    {
      const start = Date.now()
      while (useGtoStore.getState().fullHand?.refining) {
        if (Date.now() - start > 10_000) {
          const s = useGtoStore.getState()
          throw new Error(`timed out waiting for refining to settle: status=${s.status} refining=${s.fullHand?.refining} reviewFeaturesStatus=${s.reviewFeaturesStatus}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }

    const state = useGtoStore.getState()
    expect(state.status).toBe('graded') // handOverへ引き戻されていない(P7-6bのバグ修正の核心)
    expect(state.reviewSource).toBe('live')
    expect(state.review).not.toBeNull()
    expect(state.review!.decisions.length).toBe(reviewAtOpen.decisions.length)
    expect(state.review).not.toBe(reviewAtOpen) // リファイン後の新しいReviewDataへ差し替わっている
    // リファインで差し替わったターン決断のfeaturesは選択的に無効化され(表示中のidxなので
    // 自動的に再計算がキックされる)、いずれ再びnon-nullに戻る。
    await waitForReviewFeatures()
    expect(useGtoStore.getState().reviewFeatures[turnIdx]).not.toBeNull()
  }, 60_000)

  it('ソルブ途中でnextSpotを呼んでも、進行中のコントローラがクリーンにdisposeされる(factory.disposeを検証)', async () => {
    let disposedCount = 0
    __setProviderFactoryForTests(() => {
      const inner = createInProcessProviderFactory({ maxIterations: 15, targetExploitability: 0.1 })
      const wrapped: NodeProviderFactory = {
        forFlop: (s, b) => inner.forFlop(s, b),
        forLiveStreet: (input) => inner.forLiveStreet(input),
        dispose: () => {
          disposedCount++
          inner.dispose()
        },
      }
      return wrapped
    })

    await useGtoStore.getState().startNewSpot()
    await waitForStorePause()
    expect(useGtoStore.getState().status).toBe('userTurn') // まだハンド途中

    await useGtoStore.getState().nextSpot()

    expect(disposedCount).toBeGreaterThanOrEqual(1)
  }, 30_000)

  it('単発モードの既存動作には影響しない(settings.modeで完全に分岐)', async () => {
    useGtoStore.setState({ settings: { mode: 'single', enabledScenarioIds: [] } })
    await useGtoStore.getState().startNewSpot()
    const state = useGtoStore.getState()
    expect(state.status).toBe('userTurn')
    expect(state.spot).not.toBeNull()
    expect(state.fullHand).toBeNull()
    expect(state.fullHandController).toBeNull()
  })

  it('setModeは古いstatus/spotを残さず、新モードでスポットを取り直す(空白画面バグの回帰テスト)', async () => {
    // 単発モードで採点済み(status:'graded')の状態を作り、そのまま通しモードへ切り替える。
    // setMode内でstartNewSpot()を呼ばないと、statusが'graded'のまま残りFullHandPlayScreenの
    // どのブランチにも一致せず空白画面になっていた(実際にブラウザで確認したバグ)。
    useGtoStore.setState({ settings: { mode: 'single', enabledScenarioIds: [] } })
    await useGtoStore.getState().startNewSpot()
    const spot = useGtoStore.getState().spot
    if (!spot) throw new Error('spot should be set')
    useGtoStore.getState().chooseAction(spot.decodedNode.actionLabels[0])
    expect(useGtoStore.getState().status).toBe('graded')

    useGtoStore.getState().setMode('full')
    await waitForStorePause()

    const state = useGtoStore.getState()
    expect(['userTurn', 'handOver']).toContain(state.status)
    expect(state.spot).toBeNull()
    expect(state.fullHand).not.toBeNull()
    expect(state.fullHandController).not.toBeNull()
  }, 30_000)

  it('setModeは実際にモードが変わらない場合は何もしない(不要な再スタートを避ける)', () => {
    useGtoStore.setState({ settings: { mode: 'full', enabledScenarioIds: [] }, status: 'userTurn' })
    const before = useGtoStore.getState()
    useGtoStore.getState().setMode('full')
    const after = useGtoStore.getState()
    expect(after.status).toBe('userTurn')
    expect(after.fullHandController).toBe(before.fullHandController) // startNewSpotが呼ばれていれば別インスタンスに変わるはず
  })
})

describe('selectScenarioPool (P6 B9)', () => {
  it('有効化+出題可能な組み合わせのシナリオのみを返す', () => {
    const playable = new Set(['srp_btn_vs_bb', 'srp_co_vs_bb'])
    const pool = selectScenarioPool(SCENARIOS, ['srp_btn_vs_bb'], playable)
    expect(pool.map((s) => s.id)).toEqual(['srp_btn_vs_bb'])
  })

  it('設定で無効化されたシナリオは、出題可能でも選ばれない', () => {
    const playable = new Set(['srp_btn_vs_bb', 'srp_co_vs_bb'])
    const pool = selectScenarioPool(SCENARIOS, ['srp_co_vs_bb'], playable)
    expect(pool.map((s) => s.id)).toEqual(['srp_co_vs_bb'])
  })

  it('有効化+出題可能の組み合わせが空なら、出題可能な全体へフォールバックする', () => {
    const playable = new Set(['srp_co_vs_bb']) // srp_co_vs_bbのみ生成済みだが設定では無効化されている
    const pool = selectScenarioPool(SCENARIOS, ['srp_btn_vs_bb'], playable) // srp_btn_vs_bbは未生成
    expect(pool.map((s) => s.id)).toEqual(['srp_co_vs_bb'])
  })

  it('出題可能なシナリオが1つも無ければFALLBACK_SCENARIO_ID(srp_btn_vs_bb)のみへフォールバックする', () => {
    const pool = selectScenarioPool(SCENARIOS, [], new Set())
    expect(pool.map((s) => s.id)).toEqual(['srp_btn_vs_bb'])
  })
})

describe('selectFlopPool (P6 B9)', () => {
  it('生成済みフロップIDのみに絞り込む', () => {
    const someFlopId = FLOPS[0].cards.join('')
    const pool = selectFlopPool(FLOPS, [someFlopId])
    expect(pool.length).toBe(1)
    expect(pool[0].cards.join('')).toBe(someFlopId)
  })

  it('availableFlopIdsがundefined(availability未取得、またはそのシナリオがavailabilityに無い)ならFLOPS全体を返す', () => {
    const pool = selectFlopPool(FLOPS, undefined)
    expect(pool.length).toBe(FLOPS.length)
  })

  it('絞り込み結果が空(該当フロップが実在しない)ならFLOPS全体へフォールバックする', () => {
    const pool = selectFlopPool(FLOPS, ['nonexistent-flop-id'])
    expect(pool.length).toBe(FLOPS.length)
  })
})

describe('loadAvailability (P6 B9)', () => {
  beforeEach(() => {
    __resetAvailabilityInflightForTests()
    useGtoStore.setState({ availability: null })
  })

  afterEach(() => {
    globalThis.fetch = binFetchStub // このdescribe内でglobalThis.fetchを差し替えるため、ファイル共通の.binスタブへ戻す
  })

  it('manifest.jsonを取得してavailabilityへセットし、同時に複数回呼んでもfetchは1シナリオにつき1回だけ発生する', async () => {
    let manifestFetchCount = 0
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (!url.endsWith('manifest.json')) throw new Error(`unexpected fetch url in test stub: ${url}`)
      manifestFetchCount++
      if (url.includes('/srp_btn_vs_bb/')) {
        const filePath = join(process.cwd(), 'public/gto/solutions/srp_btn_vs_bb/manifest.json')
        const buf = await readFile(filePath, 'utf8')
        return new Response(buf, { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }) as typeof fetch

    await Promise.all([useGtoStore.getState().loadAvailability(), useGtoStore.getState().loadAvailability()])

    const availability = useGtoStore.getState().availability
    expect(availability).not.toBeNull()
    expect(availability!.get('srp_btn_vs_bb')?.length).toBe(95)
    expect(manifestFetchCount).toBe(SCENARIOS.length) // 2回目のloadAvailability()は同時実行中のPromiseを再利用し、追加fetchしない

    // 既にロード済みの状態でもう一度呼んでも、追加fetchは発生しない。
    await useGtoStore.getState().loadAvailability()
    expect(manifestFetchCount).toBe(SCENARIOS.length)
  })
})
