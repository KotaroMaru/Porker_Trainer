/// <reference types="node" />
// P11 Phase C: DailyChallengeScreen.tsxのテスト。単発/通し両モードでのプレイ中表示・
// 1問/1ハンドごとのレビュー画面(phase:'reviewing')遷移・完了画面を検証する。
// PlayScreen.test.tsxと同じ方針: 実データ経路(startNewSpot/chooseAction)でreview/spotを
// 構築し、通しモードのプレイ中表示はFullHandSnapshotを直接スタブする(FullHandControllerを
// 実際に走らせるとWeb Workerに依存しjsdomで動かないため)。

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DailyChallengeScreen } from './DailyChallengeScreen'
import { useGtoStore, initialTally, type DailyChallengeState } from '../../gto/store'
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
    // manifest.jsonも配信する。FLOPSには解が未生成のフロップも含まれる(対応数を段階的に

    // 増やしているため)ので、本番同様availabilityで生成済みだけに絞れないと、

    // 未生成フロップを引いてスポットが作れない。

    const manifestMatch = url.match(/\/gto\/solutions\/([^/]+)\/manifest\.json$/)

    if (manifestMatch) {

      const dir = join(process.cwd(), 'public/gto/solutions', manifestMatch[1])

      return new Response(await readFile(join(dir, 'manifest.json')), { status: 200 })

    }

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
// TSの絞り込みはクロージャに伝播しないため、確定した型のconstへ束縛し直す(PlayScreen.test.tsxと同じ理由)。
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
    turnSolutionSource: null,
    board: board3,
    potBb: scenario.potBb,
    solveProgress: null,
    solvePhase: null,
    actionsWithAmounts: [{ label: 'check', amountBb: 0 }],
    history: [{ street: 'preflop', position: scenario.raiser.position, label: 'レイズ 2.5bb', isUserDecision: false }],
    result: null,
    refining: false,
    refineProgress: null,
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

function baseDailyChallenge(overrides: Partial<DailyChallengeState>): DailyChallengeState {
  return {
    dateKey: '2026-07-18',
    handIndex: 0,
    totalHands: 10,
    results: [],
    phase: 'playing',
    ratingBefore: 1000,
    ratingAfter: null,
    mode: 'single',
    ...overrides,
  }
}

function resetStore(overrides: Partial<ReturnType<typeof useGtoStore.getState>>): void {
  useGtoStore.setState({
    status: 'idle',
    spot: null,
    grading: null,
    chosenLabel: null,
    errorMessage: null,
    sessionTally: initialTally(),
    settings: { mode: 'single', enabledScenarioIds: [], focusScenarioId: null },
    fullHand: null,
    fullHandController: null,
    review: null,
    reviewFeatures: [],
    reviewFeaturesStatus: 'idle',
    activeDecisionIdx: 0,
    dailyChallenge: null,
    dailyRank: 1000,
    ...overrides,
  })
}

describe('DailyChallengeScreen (P11 Phase C)', () => {
  it('未開始画面はモード選択・現在のランク・開始ボタンを表示する', () => {
    resetStore({ dailyRank: 1234 })
    render(<DailyChallengeScreen />)

    expect(screen.getByText('単発モード')).toBeInTheDocument()
    expect(screen.getByText('通しモード')).toBeInTheDocument()
    expect(screen.getByText('1234')).toBeInTheDocument()
    expect(screen.getByText('今日のチャレンジを開始')).toBeInTheDocument()

    // モード切替クリックはクラッシュせず、選択状態が変わる(startDailyChallengeは呼ばない)。
    fireEvent.click(screen.getByText('通しモード'))
    expect(useGtoStore.getState().dailyChallenge).toBeNull()
  })

  it('単発モードでプレイ中は進捗表示とPokerTableView+アクションボタンを表示する', async () => {
    resetStore({ status: 'idle' })
    await useGtoStore.getState().startNewSpot()
    const spot = useGtoStore.getState().spot
    if (!spot) throw new Error('spot should be set')
    useGtoStore.setState({ dailyChallenge: baseDailyChallenge({ handIndex: 2, mode: 'single' }) })

    render(<DailyChallengeScreen />)

    expect(screen.getByText('3/10問目 ・ 単発モード')).toBeInTheDocument()
    expect(screen.getByText(`ポット ${spot.scenario.potBb.toFixed(1)}bb`)).toBeInTheDocument()
    // P13 Phase A: プリフロップの行動が単発モードでも表示されること
    // (以前はDailyChallengeScreenに履歴ストリップ自体が無く欠けていた)。
    expect(screen.getByText('プリフロップ')).toBeInTheDocument()
  })

  it('通しモードでプレイ中はPokerTableView+進捗を表示し、userTurn中はアクションボタンが出る', () => {
    resetStore({
      status: 'userTurn',
      settings: { mode: 'full', enabledScenarioIds: [], focusScenarioId: null },
      fullHand: baseFullHand({ phase: 'userTurn', actionsWithAmounts: [{ label: 'check', amountBb: 0 }, { label: 'bet33', amountBb: 1.8 }] }),
      dailyChallenge: baseDailyChallenge({ handIndex: 0, mode: 'full' }),
    })
    render(<DailyChallengeScreen />)

    expect(screen.getByText('1/10問目 ・ 通しモード')).toBeInTheDocument()
    expect(screen.getByText('チェック')).toBeInTheDocument()
    expect(screen.getByText('ベット 33%')).toBeInTheDocument()
    // P13 Phase A: プリフロップの行動が通しモードでも表示されること。
    expect(screen.getByText('プリフロップ')).toBeInTheDocument()
    expect(screen.getByText(`${scenario.raiser.position}: レイズ 2.5bb`)).toBeInTheDocument()
  })

  it('通しモードでbotThinking中はアクションボタンを出さず考え中表示にする', () => {
    resetStore({
      status: 'botThinking',
      settings: { mode: 'full', enabledScenarioIds: [], focusScenarioId: null },
      fullHand: baseFullHand({ phase: 'botDeciding', solveProgress: 0.42 }),
      dailyChallenge: baseDailyChallenge({ handIndex: 4, mode: 'full' }),
    })
    render(<DailyChallengeScreen />)

    expect(screen.getByText('5/10問目 ・ 通しモード')).toBeInTheDocument()
    expect(screen.getByText(/相手が考え中/)).toBeInTheDocument()
    expect(screen.getByText(/解析 42%/)).toBeInTheDocument()
    expect(screen.queryByText('チェック')).not.toBeInTheDocument()
  })

  it('通しモードで解析100%後の残処理中は「まとめています…」を表示する', () => {
    resetStore({
      status: 'botThinking',
      settings: { mode: 'full', enabledScenarioIds: [], focusScenarioId: null },
      fullHand: baseFullHand({ phase: 'botDeciding', solveProgress: 1, solvePhase: 'finalizing' }),
      dailyChallenge: baseDailyChallenge({ handIndex: 4, mode: 'full' }),
    })
    render(<DailyChallengeScreen />)

    expect(screen.getByText('まとめています…')).toBeInTheDocument()
    expect(screen.queryByText(/解析 100%/)).not.toBeInTheDocument()
  })

  it('reviewing中(最終問未満)はReviewScreen+「次のハンドへ」ボタンを表示し、クリックでdismissDailyReviewが呼ばれる', async () => {
    resetStore({ status: 'idle', settings: { mode: 'single', enabledScenarioIds: [], focusScenarioId: null } })
    await useGtoStore.getState().startNewSpot()
    const spot = useGtoStore.getState().spot
    if (!spot) throw new Error('spot should be set')
    useGtoStore.getState().chooseAction(spot.decodedNode.actionLabels[0])
    const review = useGtoStore.getState().review
    if (!review) throw new Error('review should be set')

    useGtoStore.setState({ dailyChallenge: baseDailyChallenge({ handIndex: 3, mode: 'single', phase: 'reviewing' }) })
    render(<DailyChallengeScreen />)

    expect(screen.getByText('3/10問目 完了')).toBeInTheDocument()
    expect(screen.getByText('次のハンドへ')).toBeInTheDocument()
    expect(screen.queryByText('結果を見る')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('次のハンドへ'))
    // dismissDailyReview()はhandIndex(3)<totalHands(10)なのでadvanceDailyChallenge()を
    // キックする(非同期)。即座にはstatus:'loading'へ遷移していることだけを確認する
    // (実データ読み込みの完了までは待たない、UI配線の検証が目的のため)。
    expect(useGtoStore.getState().status).toBe('loading')
  })

  it('reviewing中(最終問)は「結果を見る」ボタンを表示し、クリックでphase:doneになる', async () => {
    resetStore({ status: 'idle', settings: { mode: 'single', enabledScenarioIds: [], focusScenarioId: null } })
    await useGtoStore.getState().startNewSpot()
    const spot = useGtoStore.getState().spot
    if (!spot) throw new Error('spot should be set')
    useGtoStore.getState().chooseAction(spot.decodedNode.actionLabels[0])
    const review = useGtoStore.getState().review
    if (!review) throw new Error('review should be set')

    useGtoStore.setState({ dailyChallenge: baseDailyChallenge({ handIndex: 10, totalHands: 10, mode: 'single', phase: 'reviewing', ratingAfter: 1005 }) })
    render(<DailyChallengeScreen />)

    expect(screen.getByText('10/10問目 完了')).toBeInTheDocument()
    const button = screen.getByText('結果を見る')
    expect(screen.queryByText('次のハンドへ')).not.toBeInTheDocument()

    fireEvent.click(button)
    expect(useGtoStore.getState().dailyChallenge?.phase).toBe('done')
  })

  it('done画面はスコア・正解数・EVロス・ランクを表示する', () => {
    resetStore({
      dailyRank: 1010,
      dailyChallenge: baseDailyChallenge({
        handIndex: 10,
        totalHands: 10,
        phase: 'done',
        ratingBefore: 1000,
        ratingAfter: 1010,
        results: [
          { verdict: 'correct', evLossBb: 0 },
          { verdict: 'incorrect', evLossBb: 2 },
        ],
      }),
    })
    render(<DailyChallengeScreen />)

    expect(screen.getByText('本日のチャレンジ完了')).toBeInTheDocument()
    expect(screen.getByText(/正解 1\/10/)).toBeInTheDocument()
    expect(screen.getByText(/EVロス合計 2\.00bb/)).toBeInTheDocument()
    expect(screen.getByText(/ランク 1010/)).toBeInTheDocument()
  })
})
