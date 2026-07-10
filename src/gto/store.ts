// P4 Step C: GTOトレーナー用の独立zustandストア。既存useAppStore(キャッシュゲーム
// 密結合)とは分離する(マスタープラン「状態管理・UI骨子」参照)。
//
// P4スコープ: フロップ単発モードのみ(シナリオはsrp_btn_vs_bb固定)。
// TODO(P6): 全17マッチアップの解データが揃ったらpickWeightedScenario()に切り替える。

import { create } from 'zustand'
import { getScenario } from './data/scenarios'
import { pickWeightedFlop } from './data/flops'
import { loadFlopSolution } from './loader/solutionLoader'
import { createSpot, applyUserAction, type SpotState, type Seat } from './trainer/gameFlow'
import type { GradeResult } from './trainer/grading'
import type { FlopDef } from './types'

const SCENARIO_ID = 'srp_btn_vs_bb' // TODO(P6): 重み抽選に切り替える

export type GtoStatus = 'idle' | 'loading' | 'userTurn' | 'graded' | 'error'

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

  startNewSpot: async () => {
    set({ status: 'loading', grading: null, chosenLabel: null, errorMessage: null })
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
    set({ status: 'graded', grading, chosenLabel: label, sessionTally: nextTally })
  },

  nextSpot: async () => {
    await get().startNewSpot()
  },
}))
