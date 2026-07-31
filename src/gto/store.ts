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
import type { Card } from '../engine/types'
import type { Combo } from '../analysis/range'
import { computeCustomHandReview, type CustomHandInput, type CustomStreetAction } from './trainer/customHandReview'
import { DAILY_HAND_COUNT, aggregateDailyAnswer, applyDailyResultToRank, computeDailyScore, dailyDateKey, pickDailySpotSeeds, type DailyAnswer } from './dailyChallenge/dailyChallenge'
import { loadDailyRank, loadDailyResults, saveDailyRank, saveDailyResult } from './dailyChallenge/storage'
import { accumulateDivergence, initialDivergenceTally, type DivergenceTally } from './stats/divergence'
import { loadDivergenceTally, saveDivergenceTally, resetDivergenceTally } from './stats/storage'

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
 *  UI側にコールバックを配線せず直接タブ遷移できるようにするため)。
 *  P12 Phase A-3: 'range'(ヨコサワレンジ表)・'tierquiz'(ヨコサワ色当て)を追加。
 *  新GTOアプリ(GtoApp.tsx)の「学習」トップタブのサブタブとして使う(旧アプリの
 *  StudyView/QuizViewから共有抽出した表示のみをGTOアプリ側から差し込む、ロジック非接触)。 */
export type GtoTab = 'play' | 'review' | 'bookmarks' | 'settings' | 'daily' | 'divergence' | 'range' | 'tierquiz'
/** 表示中のreviewの由来。'bookmark'ならReviewScreenの「次のハンド」を「一覧へ戻る」に差し替える。 */
export type ReviewSource = 'live' | 'bookmark' | 'custom'

export interface CustomAnalyzerState {
  scenario: Scenario | null
  /**
   * P12 Phase C: ユーザーが自由に選んだ生のフロップ3枚(ピッカー途中はnullを含み得る)。
   * 入力中(手札・ターン・リバー・各ストリートのアクション)はこちらを「盤面」として使う
   * (収録済みフロップかどうかは解析実行(submit)時までチェックしない、という
   * タスクパケットの方針)。
   */
  flopCards: [Card | null, Card | null, Card | null]
  /** 解析実行時に確定した、実際にソルブ済みデータへ解決されたフロップ(P12以前と同じ意味・
   *  用途のまま)。flopCardsが収録済みと厳密一致 or スート読み替えで確定した時だけ入る。 */
  flop: FlopDef | null
  userSeat: Seat | null
  /** ピッカー途中はnullを含み得る。submit時だけ完全なComboへ絞り込む。 */
  userCombo: [Card | null, Card | null] | null
  turnCard: Card | null
  riverCard: Card | null
  streetActions: { flop: CustomStreetAction[]; turn: CustomStreetAction[]; river: CustomStreetAction[] }
  phase: 'input' | 'solving' | 'error'
  error: string | null
}

function initialCustomAnalyzer(): CustomAnalyzerState {
  return { scenario: null, flopCards: [null, null, null], flop: null, userSeat: null, userCombo: null, turnCard: null, riverCard: null, streetActions: { flop: [], turn: [], river: [] }, phase: 'input', error: null }
}

/**
 * computeCustomHandReviewの内部エラー(comboIndex.tsのlookupComboIndex等)は英語+生の
 * rank/suit形式で投げられる。選択した手札がそのシナリオ・ポジションの想定レンジに
 * 含まれない場合(例: 3betポットで4betレンジ側に分類されているハンド)に発生しうる、
 * ユーザーにとって現実的な入力ミスなので、日本語の分かりやすいメッセージへ変換する。
 */
function describeCustomHandError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  if (message.includes('combo not found in solution combo table')) {
    return '選択した手札は、このマッチアップ・ポジションの想定レンジに含まれていません(例: 3betポットで本来4ベットされる手など)。別の手札を選ぶか、ポジションを変更してください。'
  }
  return message
}

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

export interface DailyChallengeState {
  dateKey: string
  handIndex: number
  totalHands: number
  results: DailyAnswer[]
  /** P11 Phase C: 'reviewing'を追加。1問(単発)/1ハンド(通し)答えるたびに'reviewing'を
   *  経由してからdismissDailyReview()で次へ進む(または最終問なら'done')。 */
  phase: 'idle' | 'playing' | 'reviewing' | 'done'
  ratingBefore: number
  ratingAfter: number | null
  /** P11 Phase C: このチャレンジの単発/通しモード(startDailyChallengeの引数で確定、以後不変)。 */
  mode: GtoMode
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

  /** P11 Phase D-3: 実プレイ全体(単発・通し・デイリー、custom/bookmark除く)を横断して
   *  積み上げるGTOズレ集計。単一のtallyとして扱う(デイリー用に分けない)。 */
  divergenceTally: DivergenceTally
  /** divergenceTallyを初期値へ戻し、永続化層(localStorage)からも削除する。 */
  resetDivergenceStats: () => void

  settings: GtoSettings
  setMode: (mode: GtoMode) => void
  setScenarioEnabled: (id: string, enabled: boolean) => void

  activeTab: GtoTab
  setActiveTab: (tab: GtoTab) => void

  dailyChallenge: DailyChallengeState | null
  dailyRank: number
  startDailyChallenge: (mode: GtoMode) => Promise<void>
  /** デイリー用に次の固定問題をロードする。UIはstartDailyChallenge/dismissDailyReview経由でのみ使う。 */
  advanceDailyChallenge: () => Promise<void>
  /** P11 Phase C: デイリーの'reviewing'フェーズから抜ける唯一の入口。次のハンド/問題へ
   *  進める(phase:'playing'で再びadvanceDailyChallenge)、または最終問なら'done'にする。 */
  dismissDailyReview: () => void

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

  customAnalyzer: CustomAnalyzerState | null
  startCustomAnalysis: () => Promise<void>
  updateCustomAnalysis: (update: Partial<Omit<CustomAnalyzerState, 'streetActions' | 'phase' | 'error'>>) => void
  addCustomAction: (street: 'flop' | 'turn' | 'river', action: CustomStreetAction) => void
  /** P12 Phase C: ステップ式ウィザードの「戻る」。直近に入力済みの1項目(直近ストリートの
   *  アクション→カード→…の順)を取り消して1ステップ前の状態へ戻す。 */
  goBackCustomStep: () => void
  submitCustomHand: () => Promise<void>
  closeCustomAnalysis: () => void

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

export const useGtoStore = create<GtoState>((set, get) => {
  // P11 Phase D-3: 1件の確定済み決断(GradeResult.actionBreakdown+選択ラベル)を
  // divergenceTallyへ積み上げ、永続化する共通ヘルパー。ReviewDecision(grading/
  // chosenLabelを持つ)をそのまま渡せるよう、構造的部分型で受け取る(単発は1件配列、
  // 通し/デイリー通しはreview.decisionsをそのまま渡す)。
  const recordDivergenceDecisions = (decisions: readonly { grading: GradeResult; chosenLabel: string }[]): void => {
    let next = get().divergenceTally
    for (const d of decisions) {
      next = accumulateDivergence(next, d.grading.actionBreakdown, d.chosenLabel)
    }
    saveDivergenceTally(next)
    set({ divergenceTally: next })
  }

  return {
  status: 'idle',
  spot: null,
  grading: null,
  chosenLabel: null,
  errorMessage: null,
  sessionTally: initialTally(),

  divergenceTally: loadDivergenceTally(),
  resetDivergenceStats: () => {
    resetDivergenceTally()
    set({ divergenceTally: initialDivergenceTally() })
  },

  activeTab: 'play',
  setActiveTab: (tab: GtoTab) => set({ activeTab: tab }),

  dailyChallenge: null,
  dailyRank: loadDailyRank(),
  startDailyChallenge: async (mode: GtoMode) => {
    const dateKey = dailyDateKey()
    const existing = loadDailyResults()[dateKey]
    const current = get().dailyChallenge
    if (existing) {
      const rating = get().dailyRank
      // 完了済み表示にmodeは使われないため、引数のmodeをそのまま入れておけば十分。
      set({
        dailyChallenge: { dateKey, handIndex: existing.handCount, totalHands: existing.handCount, results: [], phase: 'done', ratingBefore: rating, ratingAfter: rating, mode },
      })
      return
    }
    if (current?.phase === 'playing' && current.dateKey === dateKey) return
    const rating = get().dailyRank
    set({ dailyChallenge: { dateKey, handIndex: 0, totalHands: DAILY_HAND_COUNT, results: [], phase: 'playing', ratingBefore: rating, ratingAfter: null, mode } })
    await get().advanceDailyChallenge()
  },
  advanceDailyChallenge: async () => {
    const challenge = get().dailyChallenge
    // P11 Phase C: startDailyChallenge直後('playing')に加え、dismissDailyReview経由
    // ('reviewing'→次の問題/ハンドへ進める場合)からも呼ばれる。
    if (!challenge || (challenge.phase !== 'playing' && challenge.phase !== 'reviewing')) return
    const seeds = pickDailySpotSeeds(challenge.dateKey, challenge.totalHands)[challenge.handIndex]
    if (!seeds) return
    get().fullHandController?.dispose()
    set({
      status: 'loading', spot: null, grading: null, chosenLabel: null, errorMessage: null,
      fullHand: null, fullHandController: null, review: null, reviewSource: 'live', reviewFeatures: [], reviewFeaturesStatus: 'idle', activeDecisionIdx: 0,
      dailyChallenge: { ...challenge, phase: 'playing' },
    })
    try {
      await get().loadAvailability()
      const { settings, availability } = get()
      const playable = availability ? playableScenarioIds(availability) : new Set<string>()
      const pool = selectScenarioPool(SCENARIOS, settings.enabledScenarioIds, playable)
      const scenario = pickWeightedScenario(pool, seeds.scenarioRng)
      const flop = pickWeightedFlop(selectFlopPool(FLOPS, availability?.get(scenario.id)), seeds.flopRng)
      const flopSolution = await loadFlopSolution(scenario.id, flop.cards.join(''))
      const userSeat: Seat = seeds.seatRng() < 0.5 ? 0 : 1
      // 非同期ロード中に別の日/問題へ切り替わっていた場合、古い問題を表示しない
      // (single/full共通で使う、controller構築直前・spot確定直後どちらでも呼べる純関数)。
      const stale = () => get().dailyChallenge?.dateKey !== challenge.dateKey || get().dailyChallenge?.handIndex !== challenge.handIndex

      if (challenge.mode === 'full') {
        if (stale()) return
        // onUpdateクロージャは自分自身(controller)を後から参照するが、実際に呼ばれるのは
        // コンストラクタ完了後(start()経由の非同期継続以降)なので、const代入でTDZ問題は
        // 起きない(prefer-const)。
        const controller: FullHandController = new FullHandController({
          scenario,
          flop,
          flopSolution,
          userSeat,
          rng: seeds.handRng, // 決定性のため(startNewSpotのMath.randomとは異なる)
          providerFactory: providerFactoryCreator(),
          onUpdate: (snap) => {
            const state = get()
            // 使い捨てられた(disposeされ差し替わった)コントローラからの遅延emitを無視する。
            if (state.fullHandController !== controller) return
            if (state.status === 'graded') {
              // 初回のhandOver処理(下のsnap.phase==='over'分岐)は完了済み(レビュー画面
              // 表示中)。ここに来るのはターンのバックグラウンドリファイン完了などの
              // フォローアップemit(phase='over'のまま)のみなので、スコア集計・
              // handIndex加算は再実行せず、reviewを最新のリファイン結果へ差し替えるだけに
              // とどめる(デイリー通しモードはレビュー閲覧中に別レビューを覗き見る導線が
              // 無いため、startNewSpot側ほど厳密な差分保持は不要、単純化してよい仕様)。
              if (state.reviewSource === 'live' && state.review) {
                const newReview = controller.getReview()
                set({ fullHand: snap, review: newReview, reviewFeatures: new Array(newReview.decisions.length).fill(null), reviewFeaturesStatus: 'idle' })
                get().ensureFeatures(get().activeDecisionIdx)
              } else {
                set({ fullHand: snap })
              }
              return
            }
            if (snap.phase === 'over') {
              const dc = get().dailyChallenge
              if (!dc) {
                set({ fullHand: snap })
                return
              }
              const review = controller.getReview()
              // P11 Phase D-3: デイリーチャレンジの通しプレイも実プレイなので、
              // ハンド中の全決断をGTOズレ集計へ積む(単発デイリー・通常通しと同じtally)。
              recordDivergenceDecisions(review.decisions)
              const answer = aggregateDailyAnswer(review.decisions)
              const results = [...dc.results, answer]
              const handIndex = dc.handIndex + 1
              const isLast = handIndex >= dc.totalHands
              let ratingAfter = dc.ratingAfter
              const patch: Partial<GtoState> = {
                status: 'graded',
                fullHand: snap,
                review,
                reviewSource: 'live',
                reviewFeatures: new Array(review.decisions.length).fill(null),
                reviewFeaturesStatus: 'idle',
                activeDecisionIdx: 0,
              }
              if (isLast) {
                const summary = computeDailyScore(results)
                ratingAfter = applyDailyResultToRank(dc.ratingBefore, summary.score)
                saveDailyResult(dc.dateKey, { score: summary.score, correctCount: summary.correctCount, totalEvLossBb: summary.totalEvLossBb, handCount: dc.totalHands })
                saveDailyRank(ratingAfter)
                patch.dailyRank = ratingAfter
              }
              patch.dailyChallenge = { ...dc, handIndex, results, phase: 'reviewing', ratingAfter }
              set(patch)
              get().ensureFeatures(0)
              return
            }
            set({ fullHand: snap, status: snap.phase === 'userTurn' ? 'userTurn' : 'botThinking' })
          },
          onError: (err) => set({ status: 'error', errorMessage: err.message }),
        })
        set({ fullHandController: controller })
        controller.start()
        return
      }

      const spot = createSpot(scenario, flop, flopSolution, userSeat, seeds.seatRng)
      if (stale()) return
      set({ status: 'userTurn', spot, grading: null, chosenLabel: null, errorMessage: null })
    } catch (e) {
      set({ status: 'error', errorMessage: e instanceof Error ? e.message : String(e) })
    }
  },
  dismissDailyReview: () => {
    const challenge = get().dailyChallenge
    if (!challenge || challenge.phase !== 'reviewing') return
    if (challenge.handIndex >= challenge.totalHands) {
      set({ dailyChallenge: { ...challenge, phase: 'done' } })
    } else {
      void get().advanceDailyChallenge()
    }
  },

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
    // 通しモードのライブレビューから保存済みを開いた場合、以前のハンドのコントローラが
    // 残り得る。遅延したonUpdateがidleを上書きしないよう、一覧へ戻る時点で破棄する。
    get().fullHandController?.dispose()
    set({
      // ブックマークを開くとstatusは'graded'になる。ここでidleへ戻さないと、
      // PlayScreenがReviewScreenを選ぶ一方reviewはnullとなり空白画面になる。
      status: 'idle',
      review: null,
      reviewSource: 'live',
      reviewFeatures: [],
      reviewFeaturesStatus: 'idle',
      activeDecisionIdx: 0,
      activeTab: 'bookmarks',
      fullHand: null,
      fullHandController: null,
    })
  },

  customAnalyzer: null,
  startCustomAnalysis: async () => {
    set({ activeTab: 'review', review: null, reviewSource: 'live', reviewFeatures: [], reviewFeaturesStatus: 'idle', activeDecisionIdx: 0, customAnalyzer: initialCustomAnalyzer() })
    try {
      await get().loadAvailability()
    } catch (e) {
      set((state) => ({ customAnalyzer: state.customAnalyzer ? { ...state.customAnalyzer, phase: 'error', error: e instanceof Error ? e.message : String(e) } : state.customAnalyzer }))
    }
  },
  updateCustomAnalysis: (update) => {
    set((state) => {
      if (!state.customAnalyzer) return {}
      const changingScenario = update.scenario !== undefined && update.scenario !== state.customAnalyzer.scenario
      // P12 Phase C: 盤面(flopCards)はsubmit時まで収録判定しないため、盤面変更の
      // トリガーはflopではなくflopCardsにした(flopは解析実行時に一度だけ解決して
      // 追加設定される値になったため、flop単独の更新は後続を巻き戻さない)。
      const changingFlopCards = update.flopCards !== undefined
      return {
        customAnalyzer: {
          ...state.customAnalyzer,
          // シナリオ/盤面変更後に古いアクション列・後続カード・確定済みflopを残さない
          // (デフォルト値としてまず適用し、直後の...updateで「同じ呼び出しで明示的に
          // 指定された値」が優先されるようにする。例: PositionRingPickerのonComplete/
          // このファイルのテストがscenarioとflopCards/userComboを同時に1回のupdateで
          // 渡すケースで、指定した値がリセットで巻き戻されないようにするため)。
          ...(changingScenario || changingFlopCards
            ? {
                flopCards: changingScenario ? [null, null, null] : state.customAnalyzer.flopCards,
                flop: null,
                userCombo: changingScenario ? null : state.customAnalyzer.userCombo,
                turnCard: null,
                riverCard: null,
                streetActions: { flop: [], turn: [], river: [] },
              }
            : {}),
          ...update,
          phase: 'input',
          error: null,
        },
      }
    })
  },
  addCustomAction: (street, action) => {
    set((state) => {
      if (!state.customAnalyzer || state.customAnalyzer.phase !== 'input') return {}
      const actions = state.customAnalyzer.streetActions
      return { customAnalyzer: { ...state.customAnalyzer, streetActions: { ...actions, [street]: [...actions[street], action] }, error: null } }
    })
  },
  goBackCustomStep: () => {
    set((state) => {
      const a = state.customAnalyzer
      if (!a) return {}
      if (a.streetActions.river.length > 0) return { customAnalyzer: { ...a, streetActions: { ...a.streetActions, river: [] }, phase: 'input', error: null } }
      if (a.riverCard) return { customAnalyzer: { ...a, riverCard: null, phase: 'input', error: null } }
      if (a.streetActions.turn.length > 0) return { customAnalyzer: { ...a, streetActions: { ...a.streetActions, turn: [] }, phase: 'input', error: null } }
      if (a.turnCard) return { customAnalyzer: { ...a, turnCard: null, phase: 'input', error: null } }
      if (a.streetActions.flop.length > 0) return { customAnalyzer: { ...a, streetActions: { ...a.streetActions, flop: [] }, phase: 'input', error: null } }
      if (a.userCombo && (a.userCombo[0] || a.userCombo[1])) return { customAnalyzer: { ...a, userCombo: null, phase: 'input', error: null } }
      if (a.flopCards.some((c) => c !== null)) return { customAnalyzer: { ...a, flopCards: [null, null, null], flop: null, phase: 'input', error: null } }
      if (a.scenario) return { customAnalyzer: { ...a, scenario: null, userSeat: null, flopCards: [null, null, null], flop: null, phase: 'input', error: null } }
      return {}
    })
  },
  submitCustomHand: async () => {
    const analyzer = get().customAnalyzer
    if (!analyzer || !analyzer.scenario || !analyzer.flop || analyzer.userSeat === null || !analyzer.userCombo || !analyzer.userCombo[0] || !analyzer.userCombo[1]) return
    const input: CustomHandInput = {
      scenario: analyzer.scenario, flop: analyzer.flop, userSeat: analyzer.userSeat, userCombo: analyzer.userCombo as Combo,
      turnCard: analyzer.turnCard, riverCard: analyzer.riverCard, streetActions: analyzer.streetActions,
    }
    set({ customAnalyzer: { ...analyzer, phase: 'solving', error: null } })
    try {
      const review = await computeCustomHandReview(input, providerFactoryCreator())
      set({ status: 'graded', review, reviewSource: 'custom', reviewFeatures: new Array(review.decisions.length).fill(null), reviewFeaturesStatus: 'idle', activeDecisionIdx: 0, customAnalyzer: { ...analyzer, ...input, phase: 'input', error: null } })
      get().ensureFeatures(0)
    } catch (e) {
      set((state) => ({ customAnalyzer: state.customAnalyzer ? { ...state.customAnalyzer, phase: 'error', error: describeCustomHandError(e) } : state.customAnalyzer }))
    }
  },
  closeCustomAnalysis: () => {
    set((state) => ({ status: 'idle', review: null, reviewSource: 'live', reviewFeatures: [], reviewFeaturesStatus: 'idle', activeDecisionIdx: 0, customAnalyzer: state.customAnalyzer ? { ...state.customAnalyzer, phase: 'input', error: null } : initialCustomAnalyzer(), activeTab: 'review' }))
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
    const { settings, fullHandController, spot, sessionTally, dailyChallenge } = get()
    // P11 Phase C: デイリー通しモード中は、単発用のapplyUserAction経路ではなく
    // fullHandController(FullHandController)へ委譲する。採点・スコア集計・phase遷移は
    // advanceDailyChallenge内のonUpdateがsnap.phase==='over'到達時にまとめて行う。
    if (dailyChallenge?.phase === 'playing' && dailyChallenge.mode === 'full') {
      fullHandController?.chooseAction(label)
      return
    }
    // (デイリー非playing、または通常プレイの通しモード): 既存どおりfullHandControllerへ委譲。
    if (dailyChallenge?.phase !== 'playing' && settings.mode === 'full') {
      fullHandController?.chooseAction(label)
      return
    }
    if (!spot) return
    const grading = applyUserAction(spot, label)
    const review = buildReview(spot, grading, label)
    // P11 Phase D-3: ここに到達するのは通常の単発プレイ、またはデイリーチャレンジの
    // 単発プレイ(dailyChallenge.mode==='full'は上で既にreturn済み)のみで、
    // どちらも実プレイなのでGTOズレ集計へ積む(custom/bookmarkはこの関数を経由しない)。
    recordDivergenceDecisions([{ grading, chosenLabel: label }])
    const nextTally: SessionTally = {
      ...sessionTally,
      spots: sessionTally.spots + 1,
      correct: sessionTally.correct + (grading.verdict === 'correct' ? 1 : 0),
      marginal: sessionTally.marginal + (grading.verdict === 'marginal' ? 1 : 0),
      totalEvLossBb: sessionTally.totalEvLossBb + Math.max(0, grading.evLossBb),
    }
    if (dailyChallenge?.phase === 'playing') {
      // ここに来るのはdailyChallenge.mode==='single'のみ(fullは上のガードで既に処理済み)。
      // P11 Phase C: 最後の問題かどうかに関わらず、毎回reviewを構築してphase:'reviewing'へ
      // 遷移する(自動で次の問題へ進まない。dismissDailyReview()が唯一の先進アクション)。
      const results = [...dailyChallenge.results, { verdict: grading.verdict, evLossBb: grading.evLossBb }]
      const handIndex = dailyChallenge.handIndex + 1
      const isLast = handIndex >= dailyChallenge.totalHands
      let ratingAfter = dailyChallenge.ratingAfter
      const patch: Partial<GtoState> = {
        status: 'graded',
        grading,
        chosenLabel: label,
        sessionTally: nextTally,
        review,
        reviewSource: 'live',
        reviewFeatures: new Array(review.decisions.length).fill(null),
        reviewFeaturesStatus: 'idle',
        activeDecisionIdx: 0,
      }
      if (isLast) {
        const summary = computeDailyScore(results)
        ratingAfter = applyDailyResultToRank(dailyChallenge.ratingBefore, summary.score)
        saveDailyResult(dailyChallenge.dateKey, {
          score: summary.score,
          correctCount: summary.correctCount,
          totalEvLossBb: summary.totalEvLossBb,
          handCount: dailyChallenge.totalHands,
        })
        saveDailyRank(ratingAfter)
        patch.dailyRank = ratingAfter
      }
      // phaseは'reviewing'のまま('done'にするのはdismissDailyReview()が呼ばれた時点)。
      patch.dailyChallenge = { ...dailyChallenge, handIndex, results, phase: 'reviewing', ratingAfter }
      set(patch)
      get().ensureFeatures(0)
      return
    }
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
    // P11 Phase D-3: 通常の通しプレイ(実プレイ)なので、ハンド中の全決断をGTOズレ集計へ積む。
    recordDivergenceDecisions(review.decisions)
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
  }
})
