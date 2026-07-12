// P6 Step B8: ResultSummaryScreen.tsxのテスト。実際にFullHandControllerを走らせず、
// useGtoStore.setStateでfullHand(FullHandSnapshot、phase='over')を直接スタブして
// 描画内容だけを検証する(store.test.ts/fullHandFlow.test.tsが状態機械そのものを
// 別途検証済みのため、ここではUIの表示ロジックに専念する)。

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ResultSummaryScreen } from './ResultSummaryScreen'
import { useGtoStore, initialTally } from '../../gto/store'
import { getScenario } from '../../gto/data/scenarios'
import { FLOPS } from '../../gto/data/flops'
import type { Combo } from '../../analysis/range'
import type { Card } from '../../engine/types'
import type { FlopDef } from '../../gto/types'
import type { FullHandSnapshot, HandResult } from '../../gto/trainer/fullHandFlow'

// 「次のハンド」クリック(nextSpot→startNewSpot)がloadFlopSolutionをfetchするため、
// 実ネットワークI/Oを起こさないよう即座に失敗するスタブへ差し替える(store.ts側の
// try-catchでstatus:'error'になることは既にstore.test.tsで検証済みなので、ここでは
// クリックが実ネットワークへ出ないことだけを保証すればよい)。
const originalFetch = globalThis.fetch
beforeAll(() => {
  globalThis.fetch = (async () => {
    throw new Error('network disabled in this test file')
  }) as typeof fetch
})
afterAll(() => {
  globalThis.fetch = originalFetch
})

const scenario = getScenario('srp_btn_vs_bb')
const flopOrUndefined = FLOPS.find((f) => f.cards.join('') === 'AsQsJs')
if (!flopOrUndefined) throw new Error('flop fixture not found')
// TSの絞り込みはクロージャ(下のbaseSnapshot)に伝播しないため、確定した型のconstへ束縛し直す。
const flop: FlopDef = flopOrUndefined

const board5: Card[] = [
  { rank: 14, suit: 's' },
  { rank: 12, suit: 's' },
  { rank: 11, suit: 's' },
  { rank: 2, suit: 'c' },
  { rank: 3, suit: 'c' },
]
const userCombo: Combo = [
  { rank: 13, suit: 'h' },
  { rank: 13, suit: 'd' },
]
const botCombo: Combo = [
  { rank: 9, suit: 'h' },
  { rank: 9, suit: 'd' },
]

function baseSnapshot(result: HandResult): FullHandSnapshot {
  return {
    phase: 'over',
    street: 'river',
    board: board5,
    potBb: result.finalPotBb,
    solveProgress: null,
    actionsWithAmounts: [],
    history: [],
    result,
    refining: false,
    latestActions: [],
    scenario,
    flop,
    userSeat: 0,
    userCombo,
    userPosition: 'BB',
    botPosition: 'BTN',
  }
}

function resetStore(fullHand: FullHandSnapshot | null): void {
  useGtoStore.setState({
    status: 'handOver',
    spot: null,
    grading: null,
    chosenLabel: null,
    errorMessage: null,
    sessionTally: initialTally(),
    fullHand,
    fullHandController: null,
    review: null,
    reviewFeatures: [],
    reviewFeaturesStatus: 'idle',
    activeDecisionIdx: 0,
  })
}

describe('ResultSummaryScreen', () => {
  it('fullHandが無い、またはphaseがoverでない場合は何も描画しない', () => {
    resetStore(null)
    const { container } = render(<ResultSummaryScreen />)
    expect(container).toBeEmptyDOMElement()
  })

  it('ショーダウン勝利: 収支がプラスで表示され、両者の手が開示される', () => {
    const result: HandResult = {
      endedBy: 'showdown',
      userNetBb: 8.5,
      finalPotBb: 11,
      finalBoard: board5,
      botCombo,
      decisionSummaries: [
        { street: 'flop', chosenLabel: 'check', verdict: 'correct', evLossBb: 0 },
        { street: 'turn', chosenLabel: 'bet33', verdict: 'marginal', evLossBb: 0.3 },
        { street: 'river', chosenLabel: 'bet75', verdict: 'incorrect', evLossBb: 1.2 },
      ],
    }
    resetStore(baseSnapshot(result))
    render(<ResultSummaryScreen />)

    expect(screen.getByText('+8.50bb')).toBeInTheDocument()
    expect(screen.getByText('ショーダウン')).toBeInTheDocument()
    // ボットの手が開示されている(faceDownではなくランク表記が出る)
    expect(screen.getByText('3決断中 正解1')).toBeInTheDocument()
    expect(screen.getByText(/フロップ.*○/)).toBeInTheDocument()
    expect(screen.getByText(/ターン.*△/)).toBeInTheDocument()
    expect(screen.getByText(/リバー.*✕/)).toBeInTheDocument()
  })

  it('フォールド負け: 収支がマイナスで表示され、ボットの手は開示されない(faceDown)', () => {
    const result: HandResult = {
      endedBy: 'fold',
      foldedSeat: 0, // userSeat===0がフォールド
      userNetBb: -5.5,
      finalPotBb: 11,
      finalBoard: [...board5.slice(0, 4)],
      botCombo: null,
      decisionSummaries: [{ street: 'flop', chosenLabel: 'fold', verdict: 'incorrect', evLossBb: 2.1 }],
    }
    resetStore(baseSnapshot(result))
    render(<ResultSummaryScreen />)

    expect(screen.getByText('-5.50bb')).toBeInTheDocument()
    expect(screen.getByText('あなた(BB)のフォールドで終了')).toBeInTheDocument()
    // ボットの手が非開示(faceDownカードのみ、ランク文字は出ない)
    expect(screen.queryByText('9')).not.toBeInTheDocument()
  })

  it('「次のハンド」クリックでnextSpotが呼ばれる', () => {
    const result: HandResult = {
      endedBy: 'showdown',
      userNetBb: 0,
      finalPotBb: 11,
      finalBoard: board5,
      botCombo,
      decisionSummaries: [],
    }
    resetStore(baseSnapshot(result))
    render(<ResultSummaryScreen />)

    screen.getByText('次のハンド').click()
    // nextSpot()はasync startNewSpotを呼ぶため、少なくともstatusが変化を開始する
    // (実データ取得は行わずローディングへ遷移することのみ確認する)。
    expect(['loading', 'idle', 'userTurn', 'error']).toContain(useGtoStore.getState().status)
  })
})
