// P4 Step C: GTOトレーナー用の独立zustandストア。既存useAppStore(キャッシュゲーム
// 密結合)とは分離する(マスタープラン「状態管理・UI骨子」参照)。
//
// P4スコープ: フロップ単発モードのみ(シナリオはsrp_btn_vs_bb固定)。
// P6 Step B9: availability.ts(manifest.json自動検出)+設定の有効シナリオ絞り込みで
// pickWeightedScenario()/pickWeightedFlop()に切り替え済み(下記selectScenarioPool/
// selectFlopPool参照)。バッチ生成が進むにつれ自動的に出題対象が広がる。
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
import { pickWeightedScenario, SCENARIOS } from './data/scenarios'
import { pickWeightedFlop, FLOPS } from './data/flops'
import { loadFlopSolution } from './loader/solutionLoader'
import { detectAvailability, playableScenarioIds } from './loader/availability'
import { createSpot, applyUserAction, type SpotState, type Seat } from './trainer/gameFlow'
import { buildReview, type ReviewData } from './trainer/reviewBuilder'
import { computeSpotFeatures, type SpotFeatures } from './explain/features'
import { FullHandController, type FullHandSnapshot } from './trainer/fullHandFlow'
import { createWorkerProviderFactory } from './worker/workerProviderFactory'
import type { NodeProviderFactory } from './trainer/nodeDataProvider'
import { loadGtoSettings, saveGtoSettings, type GtoMode, type GtoSettings } from './settings'
import { saveBookmark, loadBookmark, type SaveBookmarkResult } from './bookmarks/storage'
import type { GradeResult } from './trainer/grading'
import type { Scenario, FlopDef } from './types'

/** availability未ロード・生成済みシナリオが1つも無い場合の最終フォールバック。 */
const FALLBACK_SCENARIO_ID = 'srp_btn_vs_bb'

/**
 * 出題対象シナリオの絞り込み(設定で有効化されている、かつMIN_FLOPS_FOR_PLAY以上生成済み)。
 * 空になる場合は段階的にフォールバックする: (1)出題可能な全シナリオ→(2)FALLBACK_SCENARIO_IDのみ。
 * 純粋関数として切り出し、startNewSpot本体を経由せず直接テストできるようにしている。
 */
export function selectScenarioPool(scenarios: readonly Scenario[], enabledScenarioIds: readonly string[], playable: ReadonlySet<string>): Scenario[] {
  let pool = scenarios.filter((s) => enabledScenarioIds.includes(s.id) && playable.has(s.id))
  if (pool.length === 0) pool = scenarios.filter((s) => playable.has(s.id))
  if (pool.length === 0) pool = scenarios.filter((s) => s.id === FALLBACK_SCENARIO_ID)
  return pool
}

/** シナリオの生成済みフロップ一覧でFLOPSを絞り込む。未取得(undefined)・絞り込み結果が空ならFLOPS全体を返す。 */
export function selectFlopPool(flops: readonly FlopDef[], availableFlopIds: readonly string[] | undefined): FlopDef[] {
  if (!availableFlopIds) return [...flops]
  const filtered = flops.filter((f) => availableFlopIds.includes(f.cards.join('')))
  return filtered.length > 0 ? filtered : [...flops]
}

export type GtoStatus = 'idle' | 'loading' | 'userTurn' | 'graded' | 'error' | 'botThinking' | 'handOver'
export type ReviewFeaturesStatus = 'idle' | 'computing' | 'ready' | 'error'
/** GtoTrainerViewのサブ画面タブ。P6 B10からstoreへ引き上げた(openBookmark/closeBookmarkが
 *  UI側にコールバックを配線せず直接タブ遷移できるようにするため)。 */
export type GtoTab = 'play' | 'review' | 'bookmarks' | 'settings'
/** 表示中のreviewの由来。'bookmark'ならReviewScreenの「次のハンド」を「一覧へ戻る」に差し替える。 */
export type ReviewSource = 'live' | 'bookmark'

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

// GtoTrainerViewマウント時のloadAvailability()とstartNewSpot()内の呼び出しが
// ほぼ同時に発生しうるため、同時呼び出しを1回のdetectAvailabilityへ重複排除する。
let availabilityInflight: Promise<Map<string, string[]>> | null = null
export function __resetAvailabilityInflightForTests(): void {
  availabilityInflight = null
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

  activeTab: GtoTab
  setActiveTab: (tab: GtoTab) => void

  /** シナリオID→生成済みフロップID配列。未ロードの間はnull(GTOタブ初回マウントでloadAvailability()を呼ぶ想定)。 */
  availability: Map<string, string[]> | null
  /** 未ロードなら1回だけdetectAvailabilityを実行してキャッシュする(セッション内メモリ保持、多重ロード防止)。 */
  loadAvailability: () => Promise<void>

  /** 通しモードの現在ハンドのスナップショット。単発モードでは常にnull。 */
  fullHand: FullHandSnapshot | null
  /** 通しモード内部コントローラの参照(dispose/chooseAction委譲用)。単発モードでは常にnull。 */
  fullHandController: FullHandController | null

  /** レビュー画面用データ。単発:chooseAction直後/通し:openReviewFromResult直後/保存済み:openBookmark直後に構築される。 */
  review: ReviewData | null
  /** reviewが今表示中のライブ採点結果か、保存済みブックマークを開いたものか。 */
  reviewSource: ReviewSource
  /** review.decisionsと同じ長さ。未計算の間はnull。 */
  reviewFeatures: (SpotFeatures | null)[]
  reviewFeaturesStatus: ReviewFeaturesStatus
  /** レビューのステッパー現在位置。 */
  activeDecisionIdx: number
  setActiveDecisionIdx: (i: number) => void

  /** 表示中のreviewをブックマーク保存する。review自体が無ければnull。 */
  saveCurrentReview: () => SaveBookmarkResult | null
  /** 保存済みブックマークを開き、reviewSource:'bookmark'としてレビュー画面(playタブ)へ遷移する。 */
  openBookmark: (id: string) => void
  /** ブックマーク表示を終了し、保存済み一覧タブへ戻る。 */
  closeBookmark: () => void

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

  activeTab: 'play',
  setActiveTab: (tab: GtoTab) => set({ activeTab: tab }),

  settings: loadGtoSettings(),
  setMode: (mode: GtoMode) => {
    const { settings } = get()
    if (settings.mode === mode) return
    const next: GtoSettings = { ...settings, mode }
    saveGtoSettings(next)
    set({ settings: next })
    // モード切替時は進行中のスポット/ハンドの状態(statusやspot/fullHand)が新モードの
    // 画面と噛み合わなくなる(例: 単発のuserTurnのままFullHandPlayScreenへ切り替わると
    // 読み込み中判定に引っかからず空白画面になる)ため、必ず新モードでスポットを取り直す。
    void get().startNewSpot()
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

  availability: null,
  loadAvailability: async () => {
    if (get().availability) return // 既にロード済み(セッション内メモリ保持、多重ロード防止)
    if (!availabilityInflight) {
      availabilityInflight = detectAvailability(SCENARIOS.map((s) => s.id))
    }
    const map = await availabilityInflight
    set({ availability: map })
  },

  fullHand: null,
  fullHandController: null,

  review: null,
  reviewSource: 'live',
  reviewFeatures: [],
  reviewFeaturesStatus: 'idle',
  activeDecisionIdx: 0,
  setActiveDecisionIdx: (i: number) => {
    set({ activeDecisionIdx: i })
    get().ensureFeatures(i)
  },

  saveCurrentReview: () => {
    const { review, settings, fullHand } = get()
    if (!review) return null
    const netBb = settings.mode === 'full' ? (fullHand?.result?.userNetBb ?? null) : null
    return saveBookmark(review, { mode: settings.mode, netBb })
  },
  openBookmark: (id: string) => {
    const review = loadBookmark(id)
    if (!review) return
    set({
      status: 'graded',
      review,
      reviewSource: 'bookmark',
      reviewFeatures: new Array(review.decisions.length).fill(null),
      reviewFeaturesStatus: 'idle',
      activeDecisionIdx: 0,
      activeTab: 'play',
    })
    get().ensureFeatures(0)
  },
  closeBookmark: () => {
    set({
      review: null,
      reviewSource: 'live',
      reviewFeatures: [],
      reviewFeaturesStatus: 'idle',
      activeDecisionIdx: 0,
      activeTab: 'bookmarks',
    })
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
      reviewSource: 'live',
      reviewFeatures: [],
      reviewFeaturesStatus: 'idle',
      activeDecisionIdx: 0,
    })

    await get().loadAvailability() // 既にロード済みなら即return(セッション内メモリ保持)
    const { settings, availability } = get()
    try {
      const playable = availability ? playableScenarioIds(availability) : new Set<string>()
      const pool = selectScenarioPool(SCENARIOS, settings.enabledScenarioIds, playable)
      const scenario = pickWeightedScenario(pool)

      const flopPool = selectFlopPool(FLOPS, availability?.get(scenario.id))
      const flop: FlopDef = pickWeightedFlop(flopPool)
      const flopId = flop.cards.join('')
      const flopSolution = await loadFlopSolution(scenario.id, flopId)
      const userSeat: Seat = Math.random() < 0.5 ? 0 : 1

      if (settings.mode === 'full') {
        // P7-6b: onUpdateは自分自身(controller)を後から参照する必要があるため、
        // 先に変数を宣言してからコンストラクタへ渡す(onUpdateが実際に呼ばれるのは
        // start()経由の非同期継続以降で、その時点ではcontrollerは必ず代入済み)。
        let controller: FullHandController
        controller = new FullHandController({
          scenario,
          flop,
          flopSolution,
          userSeat,
          rng: Math.random,
          providerFactory: providerFactoryCreator(),
          onUpdate: (snap) => {
            const state = get()
            if (state.status === 'graded') {
              // 既にhandOver→gradedへ遷移済み(レビュー画面表示中、または既に別画面に
              // 移動済み)。ここでstatusを'handOver'へ戻すと、リファイン完了などの
              // フォローアップemit(phase='over'のまま)でレビュー閲覧中の画面が
              // サマリーへ引き戻されてしまう(P7-6bのバグ修正)。表示中のreviewが
              // このハンド自身のライブレビューであれば、リファイン後の内容へ差し替える。
              if (state.reviewSource === 'live' && state.fullHandController === controller && state.review) {
                const oldReview = state.review
                const newReview = controller.getReview()
                set((s) => {
                  const nextFeatures =
                    oldReview.decisions.length === newReview.decisions.length
                      ? newReview.decisions.map((d, i) => (d === oldReview.decisions[i] ? (s.reviewFeatures[i] ?? null) : null))
                      : new Array(newReview.decisions.length).fill(null)
                  return { fullHand: snap, review: newReview, reviewFeatures: nextFeatures, reviewFeaturesStatus: 'idle' }
                })
                get().ensureFeatures(get().activeDecisionIdx)
              } else {
                set({ fullHand: snap })
              }
              return
            }
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
      reviewSource: 'live',
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
      reviewSource: 'live',
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
