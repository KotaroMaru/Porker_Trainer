/// <reference types="node" />
// P6 Step B8: PlayScreen.tsxの通しモード(FullHandPlayScreen)部分のテスト。
// 単発モード側(SingleSpotPlayScreen)は無変更のためテスト無し(既存の統合確認は
// store.test.ts/ReviewScreen.test.tsxで十分)。ここではuseGtoStore.setStateで各phaseの
// 状態を直接スタブし、UIの表示ロジック(botThinking進捗文言・handOver時の
// ResultSummaryScreen表示・graded時のReviewScreen合流)だけを検証する。
// 「レビューする」等の実クリックからのnextSpot誘発は実ネットワークを起こしうるため、
// ResultSummaryScreen.test.tsxと同様にfetchをスタブする。

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PlayScreen } from './PlayScreen'
import { useGtoStore, initialTally } from '../../gto/store'
import { getScenario } from '../../gto/data/scenarios'
import { FLOPS } from '../../gto/data/flops'
import type { Combo } from '../../analysis/range'
import type { Card } from '../../engine/types'
import type { FlopDef } from '../../gto/types'
import type { FullHandSnapshot } from '../../gto/trainer/fullHandFlow'

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

const scenario = getScenario('srp_btn_vs_bb')
const flopOrUndefined = FLOPS.find((f) => f.cards.join('') === 'AsQsJs')
if (!flopOrUndefined) throw new Error('flop fixture not found')
// TSの絞り込みはクロージャに伝播しないため、確定した型のconstへ束縛し直す。
const flop: FlopDef = flopOrUndefined

const board3: Card[] = [
  { rank: 14, suit: 's' },
  { rank: 12, suit: 's' },
  { rank: 11, suit: 's' },
]
const userCombo: Combo = [
  { rank: 13, suit: 'h' },
  { rank: 13, suit: 'd' },
]

function baseFullHand(overrides: Partial<FullHandSnapshot>): FullHandSnapshot {
  return {
    phase: 'userTurn',
    street: 'flop',
    board: board3,
    potBb: scenario.potBb,
    solveProgress: null,
    actionsWithAmounts: [{ label: 'check', amountBb: 0 }],
    history: [{ street: 'preflop', position: scenario.raiser.position, label: 'レイズ 2.5bb', isUserDecision: false }],
    result: null,
    latestActions: [],
    scenario,
    flop,
    userSeat: 0,
    userCombo,
    userPosition: 'BB',
    botPosition: 'BTN',
    ...overrides,
  }
}

function resetToFullMode(overrides: Partial<ReturnType<typeof useGtoStore.getState>>): void {
  useGtoStore.setState({
    status: 'userTurn',
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
    ...overrides,
  })
}

describe('PlayScreen (通しモード, P6 B8)', () => {
  it('botThinking中は進捗パーセンテージ付きの文言を表示し、アクションボタンは出さない', () => {
    resetToFullMode({ status: 'botThinking', fullHand: baseFullHand({ phase: 'botDeciding', solveProgress: 0.42 }) })
    render(<PlayScreen />)

    expect(screen.getByText(/相手が考え中/)).toBeInTheDocument()
    expect(screen.getByText(/解析 42%/)).toBeInTheDocument()
    expect(screen.queryByText('チェック')).not.toBeInTheDocument()
  })

  it('botThinking中でもsolveProgressがnullならパーセンテージ無しで表示する', () => {
    resetToFullMode({ status: 'botThinking', fullHand: baseFullHand({ phase: 'botDeciding', solveProgress: null }) })
    render(<PlayScreen />)

    expect(screen.getByText(/相手が考え中/)).toBeInTheDocument()
    expect(screen.queryByText(/解析/)).not.toBeInTheDocument()
  })

  it('userTurn中はアクションボタンが有効(ソルブ進捗に関わらず)', () => {
    resetToFullMode({
      status: 'userTurn',
      fullHand: baseFullHand({ phase: 'userTurn', actionsWithAmounts: [{ label: 'check', amountBb: 0 }, { label: 'bet33', amountBb: 1.8 }] }),
    })
    render(<PlayScreen />)

    expect(screen.getByText('チェック')).toBeInTheDocument()
    expect(screen.getByText('ベット 33%')).toBeInTheDocument()
  })

  it('P7-2: 場に両プレイヤーの最新アクション(位置・アクション名・金額)がチップ表示される', () => {
    resetToFullMode({
      status: 'userTurn',
      fullHand: baseFullHand({
        phase: 'userTurn',
        latestActions: [
          { position: 'BTN', label: 'bet75', amountBb: 4.1, isUser: false },
          { position: 'BB', label: 'call', amountBb: 4.1, isUser: true },
        ],
      }),
    })
    render(<PlayScreen />)

    expect(screen.getByText(/ベット 75%\s*4\.1bb/)).toBeInTheDocument()
    expect(screen.getByText(/コール\s*4\.1bb/)).toBeInTheDocument()
  })

  it('P7-2: latestActionsが空の場合はアクションチップを表示しない', () => {
    resetToFullMode({ status: 'userTurn', fullHand: baseFullHand({ phase: 'userTurn', latestActions: [] }) })
    render(<PlayScreen />)

    expect(screen.queryByTestId('action-chip')).not.toBeInTheDocument()
  })

  it('handOver時はResultSummaryScreenが表示され、フッターに通しモード集計が出る', () => {
    resetToFullMode({
      status: 'handOver',
      sessionTally: { ...initialTally(), hands: 2, decisions: 5, correct: 3, totalNetBb: 4.25 },
      fullHand: baseFullHand({
        phase: 'over',
        result: {
          endedBy: 'showdown',
          userNetBb: 3.0,
          finalPotBb: 11,
          finalBoard: board3,
          botCombo: [
            { rank: 9, suit: 'h' },
            { rank: 9, suit: 'd' },
          ],
          decisionSummaries: [],
        },
      }),
    })
    render(<PlayScreen />)

    expect(screen.getByText('+3.00bb')).toBeInTheDocument()
    expect(screen.getByText('レビューする')).toBeInTheDocument()
    expect(screen.getByText(/通しモード.*2ハンド.*決断5.*正解3.*収支 \+4\.3bb/)).toBeInTheDocument()
  })

  it('status===gradedのとき、通しモードでも単発モードと共通のReviewScreenへ合流する', async () => {
    // FullHandControllerを実際に走らせず、単発モードの実データ経路でreviewを1件構築し、
    // それをそのままstore.reviewへ差し込んでmode='full'/status='graded'の描画を検証する
    // (ReviewScreen.tsx自体はモードを意識しないため、この合成で妥当な検証になる)。
    resetToFullMode({ status: 'idle', settings: { mode: 'single', enabledScenarioIds: [] } })
    await useGtoStore.getState().startNewSpot()
    const spot = useGtoStore.getState().spot
    if (!spot) throw new Error('spot should be set')
    useGtoStore.getState().chooseAction(spot.decodedNode.actionLabels[0])
    const review = useGtoStore.getState().review
    if (!review) throw new Error('review should be set')

    useGtoStore.setState({
      settings: { mode: 'full', enabledScenarioIds: [] },
      status: 'graded',
      fullHand: baseFullHand({ phase: 'over', result: { endedBy: 'showdown', userNetBb: 1, finalPotBb: 11, finalBoard: board3, botCombo: null, decisionSummaries: [] } }),
    })
    render(<PlayScreen />)

    expect(screen.getByText('ボード')).toBeInTheDocument()
    expect(screen.getByText('あなたの手')).toBeInTheDocument()
    expect(screen.getByText(/通しモード/)).toBeInTheDocument()
  })
})
