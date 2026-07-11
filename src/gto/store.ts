// P4 Step C: GTOトレーナー用の独立zustandストア。既存useAppStore(キャッシュゲーム
// 密結合)とは分離する(マスタープラン「状態管理・UI骨子」参照)。
//
// P4スコープ: フロップ単発モードのみ(シナリオはsrp_btn_vs_bb固定)。
// TODO(P9): 全17マッチアップの解データが揃ったらpickWeightedScenario()+設定の
// 有効シナリオ絞り込みに切り替える(availability.ts、B9で実装予定)。
//
// P5 Step B6: レビュー画面(ReviewScreen)向けにreview/reviewFeaturesを追加。
// buildReview(同期・軽量)はchooseAction内で即座に実行するが、computeSpotFeatures
// (レンジ対レンジのエクイティ計算を含み実測約600ms)はsetTimeout(0)で1フレーム
// 遅延させ、判定バッジ(status:'graded')が先に描画されるようにする(体感ブロック回避、
// ユーザー確定済みUX仕様: 「なぜ」カードは特徴量計算完了後に表示)。
//
// P6 Step B7: 通しモード(FullHandController)をstoreへ統合する。既存の単発モードの
// 状態遷移・挙動は一切変更しない(settings.mode==='single'の間は今日と同じ)。
// 通しモードはFullHandControllerのonUpdateコールバックでfullHand/statusを更新し、
// ハンド終了(phase='over')後にopenReviewFromResult()を呼ぶとレビュー画面用の
// review/reviewFeaturesが単発モードと同じ形で構築される(ReviewScreen.tsx側は
// モードを意識しなくてよい)。

import { create } from 'zustand'
import { getScenario } from './data/scenarios'
import { pickWeightedFlop } from './data/flops'
import { loadFlopSolution } from './loader/solutionLoader'
import { createSpot, applyUserAction, type SpotState, type Seat } from './trainer/gameFlow'
import { buildReview, type ReviewData } from './trainer/reviewBuilder'
import { computeSpotFeatures, type SpotFeatures } from './explain/features'
import { FullHandController, type FullHandSnapshot } from './trainer/fullHandFlow'
import { createWorkerProviderFactory } from './worker/workerProviderFactory'
import type { NodeProviderFactory } from './trainer/nodeDataProvider'
import { loadGtoSettings, saveGtoSettings, type GtoMode, type GtoSettings } from './settings'
import type { GradeResult } from './trainer/grading'
import type { FlopDef } from './types'

const SCENARIO_ID = 'srp_btn_vs_bb' // TODO(P9): 重み抽選+設定の有効シナリオ絞り込みに切り替える

export type GtoStatus = 'idle' | 'loading' | 'userTurn' | 'graded' | 'error' | 'botThinking' | 'handOver'
export type ReviewFeaturesStatus = 'idle' | 'computing' | 'ready' | 'error'

export interface SessionTally {
  spots: number
  correct: number
  marginal: number
  totalEvLossBb: number
  /** 通しモードのみ増分(ハンド完了ごとに+1)。単発モードは常に0。 */
  hands: number
  /** 通しモードのみ増分(そのハンドの決断数)。単発モードは常に0(spotsが決断数を兼ねるため)。 */
  decisions: number
  /** 通しモードのみ増分(ハンドのuserNetBb合計、実収支)。単発モードは常に0。 */
  totalNetBb: number
}

export function initialTally(): SessionTally {
  return { spots: 0, correct: 0, marginal: 0, totalEvLossBb: 0, hands: 0, decisions: 0, totalNetBb: 0 }
}

// テスト用シーム(P6 B7): 通しモードのStreetNodeProviderFactory生成元を差し替え可能にする
// (本番はWeb Worker裏付けのcreateWorkerProviderFactory、テストはcreateInProcessProviderFactory)。
// D2「1ハンド=1 SolverClient」の通り、ハンドごとに新しいインスタンスが必要なので、
// ファクトリの「生成元」を保持し、ハンド開始のたびに呼び出す。
let providerFactoryCreator: () => NodeProviderFactory = createWorkerProviderFactory
export function __setProviderFactoryForTests(factory: () => NodeProviderFactory): void {
  providerFactoryCreator = factory
}
export function __resetProviderFactoryForTests(): void {
  providerFactoryCreator = createWorkerProviderFactory
}

export interface GtoState {
  status: GtoStatus
  spot: SpotState | null
  grading: GradeResult | null
  /** ユーザーが選択したアクションラベル(採点後の表示用)。単発モードのみ使用。 */
  chosenLabel: string | null
  errorMessage: string | null
  sessionTally: SessionTally

  settings: GtoSettings
  setMode: (mode: GtoMode) => void
  setScenarioEnabled: (id: string, enabled: boolean) => void

  /** 通しモードの現在ハンドのスナップショット。単発モードでは常にnull。 */
  fullHand: FullHandSnapshot | null
  /** 通しモード内部コントローラの参照(dispose/chooseAction委譲用)。単発モードでは常にnull。 */
  fullHandController: FullHandController | null

  /** レビュー画面用データ。単発:chooseAction直後/通し:openReviewFromResult直後に構築される。 */
  review: ReviewData | null
  /** review.decisionsと同じ長さ。未計算の間はnull。 */
  reviewFeatures: (SpotFeatures | null)[]
  reviewFeaturesStatus: ReviewFeaturesStatus
  /** レビューのステッパー現在位置。 */
  activeDecisionIdx: number
  setActiveDecisionIdx: (i: number) => void

  /**
   * reviewFeatures[idx]が未計算なら計算をキックする(表示中の決断のみオンデマンド計算、
   * P6 B6)。既に計算済み・計算中でもreview自体が無い場合は何もしない。
   */
  ensureFeatures: (idx: number) => void

  startNewSpot: () => Promise<void>
  /** 単発モード: applyUserActionで直接採点。通しモード: fullHandControllerへ委譲(採点は保留)。 */
  chooseAction: (label: string) => void
  /** 通しモード専用: ハンド終了(phase='over')後にレビュー画面用データを構築して開く。 */
  openReviewFromResult: () => void
  nextSpot: () => Promise<void>
}

export const useGtoStore = create<GtoState>((set, get) => ({
  status: 'idle',
  spot: null,
  grading: null,
  chosenLabel: null,
  errorMessage: null,
  sessionTally: initialTally(),

  settings: loadGtoSettings(),
  setMode: (mode: GtoMode) => {
    const next: GtoSettings = { ...get().settings, mode }
    saveGtoSettings(next)
    set({ settings: next })
  },
  setScenarioEnabled: (id: string, enabled: boolean) => {
    const { settings } = get()
    const has = settings.enabledScenarioIds.includes(id)
    if (enabled === has) return
    const enabledScenarioIds = enabled ? [...settings.enabledScenarioIds, id] : settings.enabledScenarioIds.filter((x) => x !== id)
    const next: GtoSettings = { ...settings, enabledScenarioIds }
    saveGtoSettings(next)
    set({ settings: next })
  },

  fullHand: null,
  fullHandController: null,

  review: null,
  reviewFeatures: [],
  reviewFeaturesStatus: 'idle',
  activeDecisionIdx: 0,
  setActiveDecisionIdx: (i: number) => {
    set({ activeDecisionIdx: i })
    get().ensureFeatures(i)
  },

  ensureFeatures: (idx: number) => {
    const { review, reviewFeatures } = get()
    if (!review) return
    if (idx < 0 || idx >= review.decisions.length) return
    if (reviewFeatures[idx] != null) return // 計算済み

    set({ reviewFeaturesStatus: 'computing' })
    // computeSpotFeatures(レンジ対レンジのエクイティ計算を含み実測約600ms)を
    // setTimeout(0)で1フレーム遅延させ、判定バッジが先に描画されるようにする。
    setTimeout(() => {
      // 別スポットへ遷移済みなら結果を書き込まない(古い計算結果の混入防止)。
      if (get().review !== review) return
      try {
        const features = computeSpotFeatures(review, idx)
        set((state) => {
          if (state.review !== review) return {}
          const next = [...state.reviewFeatures]
          next[idx] = features
          return { reviewFeatures: next, reviewFeaturesStatus: 'ready' }
        })
      } catch {
        set((state) => (state.review === review ? { reviewFeaturesStatus: 'error' } : {}))
      }
    }, 0)
  },

  startNewSpot: async () => {
    // 進行中の通しモードコントローラがあれば必ず破棄してから次へ(D2: 1ハンド=1
    // SolverClient。ソルブ途中でも安全にキャンセル+Worker terminateする)。
    get().fullHandController?.dispose()

    set({
      status: 'loading',
      spot: null,
      grading: null,
      chosenLabel: null,
      errorMessage: null,
      fullHand: null,
      fullHandController: null,
      review: null,
      reviewFeatures: [],
      reviewFeaturesStatus: 'idle',
      activeDecisionIdx: 0,
    })

    const { settings } = get()
    try {
      const scenario = getScenario(SCENARIO_ID)
      const flop: FlopDef = pickWeightedFlop()
      const flopId = flop.cards.join('')
      const flopSolution = await loadFlopSolution(SCENARIO_ID, flopId)
      const userSeat: Seat = Math.random() < 0.5 ? 0 : 1

      if (settings.mode === 'full') {
        const controller = new FullHandController({
          scenario,
          flop,
          flopSolution,
          userSeat,
          rng: Math.random,
          providerFactory: providerFactoryCreator(),
          onUpdate: (snap) => {
            set({
              fullHand: snap,
              status: snap.phase === 'userTurn' ? 'userTurn' : snap.phase === 'over' ? 'handOver' : 'botThinking',
            })
          },
          onError: (err) => set({ status: 'error', errorMessage: err.message }),
        })
        set({ fullHandController: controller })
        controller.start()
        return
      }

      const spot = createSpot(scenario, flop, flopSolution, userSeat, Math.random)
      set({ status: 'userTurn', spot, grading: null, chosenLabel: null, errorMessage: null })
    } catch (e) {
      set({ status: 'error', errorMessage: e instanceof Error ? e.message : String(e) })
    }
  },

  chooseAction: (label: string) => {
    const { settings, fullHandController, spot, sessionTally } = get()
    if (settings.mode === 'full') {
      fullHandController?.chooseAction(label)
      return
    }
    if (!spot) return
    const grading = applyUserAction(spot, label)
    const nextTally: SessionTally = {
      ...sessionTally,
      spots: sessionTally.spots + 1,
      correct: sessionTally.correct + (grading.verdict === 'correct' ? 1 : 0),
      marginal: sessionTally.marginal + (grading.verdict === 'marginal' ? 1 : 0),
      totalEvLossBb: sessionTally.totalEvLossBb + Math.max(0, grading.evLossBb),
    }
    const review = buildReview(spot, grading, label)
    set({
      status: 'graded',
      grading,
      chosenLabel: label,
      sessionTally: nextTally,
      review,
      reviewFeatures: new Array(review.decisions.length).fill(null),
      reviewFeaturesStatus: 'idle',
      activeDecisionIdx: 0,
    })
    // 単発モードは常にdecisions.length===1なので、表示中(idx=0)の決断だけを
    // 計算すれば全件計算と同じ挙動になる(P6 B6: ensureFeaturesへ委譲)。
    get().ensureFeatures(0)
  },

  openReviewFromResult: () => {
    const { fullHand, fullHandController, sessionTally } = get()
    if (!fullHandController || !fullHand || fullHand.phase !== 'over' || !fullHand.result) return
    const review = fullHandController.getReview()
    const result = fullHand.result
    const nextTally: SessionTally = {
      ...sessionTally,
      hands: sessionTally.hands + 1,
      decisions: sessionTally.decisions + review.decisions.length,
      correct: sessionTally.correct + review.decisions.filter((d) => d.grading.verdict === 'correct').length,
      marginal: sessionTally.marginal + review.decisions.filter((d) => d.grading.verdict === 'marginal').length,
      totalEvLossBb: sessionTally.totalEvLossBb + review.decisions.reduce((sum, d) => sum + Math.max(0, d.grading.evLossBb), 0),
      totalNetBb: sessionTally.totalNetBb + result.userNetBb,
    }
    set({
      status: 'graded',
      sessionTally: nextTally,
      review,
      reviewFeatures: new Array(review.decisions.length).fill(null),
      reviewFeaturesStatus: 'idle',
      activeDecisionIdx: 0,
    })
    get().ensureFeatures(0)
  },

  nextSpot: async () => {
    await get().startNewSpot()
  },
}))
