// P4 Step C: GTOトレーナー用の独立zustandストア。既存useAppStore(キャッシュゲーム
// 密結合)とは分離する(マスタープラン「状態管理・UI骨子」参照)。
//
// P4スコープ: フロップ単発モードのみ(シナリオはsrp_btn_vs_bb固定)。
// TODO(P6): 全17マッチアップの解データが揃ったらpickWeightedScenario()に切り替える。
//
// P5 Step B6: レビュー画面(ReviewScreen)向けにreview/reviewFeaturesを追加。
// buildReview(同期・軽量)はchooseAction内で即座に実行するが、computeSpotFeatures
// (レンジ対レンジのエクイティ計算を含み実測約600ms)はsetTimeout(0)で1フレーム
// 遅延させ、判定バッジ(status:'graded')が先に描画されるようにする(体感ブロック回避、
// ユーザー確定済みUX仕様: 「なぜ」カードは特徴量計算完了後に表示)。

import { create } from 'zustand'
import { getScenario } from './data/scenarios'
import { pickWeightedFlop } from './data/flops'
import { loadFlopSolution } from './loader/solutionLoader'
import { createSpot, applyUserAction, type SpotState, type Seat } from './trainer/gameFlow'
import { buildReview, type ReviewData } from './trainer/reviewBuilder'
import { computeSpotFeatures, type SpotFeatures } from './explain/features'
import type { GradeResult } from './trainer/grading'
import type { FlopDef } from './types'

const SCENARIO_ID = 'srp_btn_vs_bb' // TODO(P6): 重み抽選に切り替える

export type GtoStatus = 'idle' | 'loading' | 'userTurn' | 'graded' | 'error'
export type ReviewFeaturesStatus = 'idle' | 'computing' | 'ready' | 'error'

export interface SessionTally {
  spots: number
  correct: number
  marginal: number
  totalEvLossBb: number
}

function initialTally(): SessionTally {
  return { spots: 0, correct: 0, marginal: 0, totalEvLossBb: 0 }
}

export interface GtoState {
  status: GtoStatus
  spot: SpotState | null
  grading: GradeResult | null
  /** ユーザーが選択したアクションラベル(採点後の表示用)。 */
  chosenLabel: string | null
  errorMessage: string | null
  sessionTally: SessionTally

  /** レビュー画面用データ。chooseAction直後に同期構築される。 */
  review: ReviewData | null
  /** review.decisionsと同じ長さ。未計算の間はnull。P5は常にlength===1。 */
  reviewFeatures: (SpotFeatures | null)[]
  reviewFeaturesStatus: ReviewFeaturesStatus
  /** レビューのステッパー現在位置。P5は常に0(決断が1つのみ)。 */
  activeDecisionIdx: number
  setActiveDecisionIdx: (i: number) => void

  startNewSpot: () => Promise<void>
  chooseAction: (label: string) => void
  nextSpot: () => Promise<void>
}

export const useGtoStore = create<GtoState>((set, get) => ({
  status: 'idle',
  spot: null,
  grading: null,
  chosenLabel: null,
  errorMessage: null,
  sessionTally: initialTally(),

  review: null,
  reviewFeatures: [],
  reviewFeaturesStatus: 'idle',
  activeDecisionIdx: 0,
  setActiveDecisionIdx: (i: number) => set({ activeDecisionIdx: i }),

  startNewSpot: async () => {
    set({
      status: 'loading',
      grading: null,
      chosenLabel: null,
      errorMessage: null,
      review: null,
      reviewFeatures: [],
      reviewFeaturesStatus: 'idle',
      activeDecisionIdx: 0,
    })
    try {
      const scenario = getScenario(SCENARIO_ID)
      const flop: FlopDef = pickWeightedFlop()
      const flopId = flop.cards.join('')
      const solution = await loadFlopSolution(SCENARIO_ID, flopId)
      const userSeat: Seat = Math.random() < 0.5 ? 0 : 1
      const spot = createSpot(scenario, flop, solution, userSeat, Math.random)
      set({ status: 'userTurn', spot, grading: null, chosenLabel: null, errorMessage: null })
    } catch (e) {
      set({ status: 'error', errorMessage: e instanceof Error ? e.message : String(e) })
    }
  },

  chooseAction: (label: string) => {
    const { spot, sessionTally } = get()
    if (!spot) return
    const grading = applyUserAction(spot, label)
    const nextTally: SessionTally = {
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
      reviewFeaturesStatus: 'computing',
      activeDecisionIdx: 0,
    })

    // P5は常にdecisions.length===1なので全件計算しても問題ないが、P6の通し
    // モード(複数決断)では現在表示中の決断だけを計算する方式に見直す必要がある。
    setTimeout(() => {
      // 別スポットへ遷移済みなら結果を書き込まない(古い計算結果の混入防止)。
      if (get().review !== review) return
      try {
        const features = review.decisions.map((_, i) => computeSpotFeatures(review, i))
        set({ reviewFeatures: features, reviewFeaturesStatus: 'ready' })
      } catch {
        set({ reviewFeaturesStatus: 'error' })
      }
    }, 0)
  },

  nextSpot: async () => {
    await get().startNewSpot()
  },
}))
