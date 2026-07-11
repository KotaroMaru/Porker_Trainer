/// <reference types="node" />
// P5 Step B9: ReviewScreen.tsxの統合テスト。useGtoStoreを実データ(fetchスタブ経由の
// 実.bin)でgradedまで進め、承認済みUI仕様の8要素がDOMに存在することを確認する。
// process.cwd()基準のパス解決を使う(store.test.tsと同じパターン)。

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import { ReviewScreen } from './ReviewScreen'
import { useGtoStore } from '../../gto/store'
import { __resetSolutionCacheForTests } from '../../gto/loader/solutionLoader'
import type { Card } from '../../engine/types'

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

async function advanceToGraded(): Promise<void> {
  useGtoStore.setState({
    status: 'idle',
    spot: null,
    grading: null,
    chosenLabel: null,
    errorMessage: null,
    sessionTally: { spots: 0, correct: 0, marginal: 0, totalEvLossBb: 0 },
    review: null,
    reviewFeatures: [],
    reviewFeaturesStatus: 'idle',
    activeDecisionIdx: 0,
  })
  await useGtoStore.getState().startNewSpot()
  const spot = useGtoStore.getState().spot
  if (!spot) throw new Error('spot should be set after startNewSpot')
  useGtoStore.getState().chooseAction(spot.decodedNode.actionLabels[0])

  await waitFor(
    () => {
      expect(useGtoStore.getState().reviewFeaturesStatus).toBe('ready')
    },
    { timeout: 5000, interval: 20 },
  )
}

describe('ReviewScreen', () => {
  it('採点完了後、承認済みUI仕様の8要素が全てDOMに存在する', async () => {
    await advanceToGraded()
    render(<ReviewScreen />)

    // ① 履歴ストリップ=ナビゲータ(自分の決断ボタンが少なくとも1つ)
    const state = useGtoStore.getState()
    const chosenJa = { check: 'チェック', fold: 'フォールド', call: 'コール', bet33: 'ベット 33%', bet75: 'ベット 75%', raise55: 'レイズ 55%', allin: 'オールイン' }[
      state.chosenLabel!
    ]
    expect(screen.getAllByText(new RegExp(chosenJa!)).length).toBeGreaterThan(0)

    // ② 判定バッジ
    expect(screen.getByText(/正解|不正解|境界上/)).toBeInTheDocument()

    // ③ ボード+ハンド1行
    expect(screen.getByText('ボード')).toBeInTheDocument()
    expect(screen.getByText('あなたの手')).toBeInTheDocument()

    // ④ 戦略ミックス+EV表
    expect(screen.getByText('頻度')).toBeInTheDocument()
    expect(screen.getByText('EV')).toBeInTheDocument()

    // ⑤ 「なぜ」解説カード(computing→readyを待っているのでheadlineが出ているはず)
    // headline文言(buildHeadline)は「が最善」または「境界上の手」を必ず含み、
    // かつナビゲータ/ステッパーの短いラベルには出現しないため一意に識別できる。
    await waitFor(() => {
      expect(screen.getByText(/が最善|境界上の手/)).toBeInTheDocument()
    })

    // ⑥ レンジグリッド(169セル)
    await waitFor(() => {
      expect(document.querySelectorAll('[data-hand]').length).toBe(169)
    })

    // ⑦ 折りたたみ3パネル
    expect(screen.getByText('相手の応答レンジ分析')).toBeInTheDocument()
    expect(screen.getByText('エクイティ分布')).toBeInTheDocument()
    expect(screen.getByText('ブロッカー分析')).toBeInTheDocument()

    // ⑧ 保存(disabled)+次のハンド
    expect(screen.getByText('ハンドを保存')).toBeDisabled()
    expect(screen.getByText('次のハンド')).toBeInTheDocument()
  })

  it('決断が1件のみの場合、ステッパーの前/次ボタンは両方disabledになる', async () => {
    await advanceToGraded()
    render(<ReviewScreen />)

    expect(screen.getByText('◀ 前')).toBeDisabled()
    expect(screen.getByText('次 ▶')).toBeDisabled()
  })

  it('「AIに質問用コピー」でbuildSpotMarkdownの出力がclipboardに書き込まれる', async () => {
    await advanceToGraded()
    const writeText = vi.fn((_text: string) => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<ReviewScreen />)
    // headline文言(buildHeadline)は「が最善」または「境界上の手」を必ず含み、
    // かつナビゲータ/ステッパーの短いラベルには出現しないため一意に識別できる。
    await waitFor(() => {
      expect(screen.getByText(/が最善|境界上の手/)).toBeInTheDocument()
    })

    screen.getByText('AIに質問用コピー').click()

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1)
    })
    const copiedText = writeText.mock.calls[0][0]
    expect(copiedText).toContain('# GTOポストフロップスポット')
    expect(copiedText).toContain('## GTO戦略(このノード)')

    await waitFor(() => {
      expect(screen.getByText('コピー済み')).toBeInTheDocument()
    })
  })

  it('「次のハンド」クリックでnextSpotが呼ばれ、新しいスポットへ遷移する', async () => {
    await advanceToGraded()
    __resetSolutionCacheForTests()
    render(<ReviewScreen />)
    const firstReview = useGtoStore.getState().review

    screen.getByText('次のハンド').click()

    await waitFor(() => {
      expect(useGtoStore.getState().status).toBe('userTurn')
    })
    expect(useGtoStore.getState().review).not.toBe(firstReview)
    expect(useGtoStore.getState().review).toBeNull()
  })

  it('複数決断のレビュー(P6通しモード相当)では、ナビゲータチップに街ラベルが表示され、決断時点のボードが最終ボードと異なる決断でのみ追加行が表示される', async () => {
    // FullHandController統合(B7)前でも、reviewBuilder.ts側の型(街ごとのReviewDecision)を
    // 直接使ってReviewScreen単体の複数決断描画を検証できる(合成2決断のReviewData)。
    await advanceToGraded()
    const baseReview = useGtoStore.getState().review!
    const extraCard: Card = { rank: 2, suit: 'c' }
    const finalBoard: Card[] = [...baseReview.board, extraCard]
    const flopDecision = { ...baseReview.decisions[0], street: 'flop' as const, boardAtDecision: baseReview.board }
    const turnDecision = { ...baseReview.decisions[0], street: 'turn' as const, boardAtDecision: finalBoard, nodeId: 'synthetic-turn-decision' }
    const syntheticReview = { ...baseReview, board: finalBoard, decisions: [flopDecision, turnDecision] }
    useGtoStore.setState({ review: syntheticReview, reviewFeatures: [null, null], reviewFeaturesStatus: 'idle', activeDecisionIdx: 0 })

    render(<ReviewScreen />)

    // ナビゲータチップに街ラベル(フロップ/ターン)が表示される
    expect(screen.getByText(/^フロップ /)).toBeInTheDocument()
    expect(screen.getByText(/^ターン /)).toBeInTheDocument()

    // activeDecisionIdx=0(flop決断): boardAtDecision(3枚)がreview.board(4枚)と異なるため追加行が出る
    expect(screen.getByText(/フロップ決断時点のボード/)).toBeInTheDocument()

    // ターン決断へ切り替えるとboardAtDecision===review.boardなので追加行は消える
    screen.getByText('次 ▶').click()
    await waitFor(() => {
      expect(useGtoStore.getState().activeDecisionIdx).toBe(1)
    })
    expect(screen.queryByText(/決断時点のボード/)).not.toBeInTheDocument()
  })
})
