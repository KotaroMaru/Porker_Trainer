import { describe, expect, it, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { AnalyzerScreen } from './AnalyzerScreen'
import { initialTally, useGtoStore } from '../../gto/store'
import { SCENARIOS } from '../../gto/data/scenarios'
import { FLOPS } from '../../gto/data/flops'
import { createDeck, cardKey } from '../../engine/deck'
import { boardFromFlop } from '../../gto/trainer/gameFlow'
import type { Card } from '../../engine/types'

// P12 Phase C: ステップ式ウィザードへの刷新に伴い、旧UI(素の<select>×2)を前提にしていた
// テストを新フロー(リング図でのマッチアップ選択→フロップ3枚自由選択→…)へ全面書き換え。

describe('AnalyzerScreen', () => {
  beforeEach(() => {
    useGtoStore.setState({ activeTab: 'review', review: null, reviewSource: 'live', availability: new Map(), customAnalyzer: null, sessionTally: initialTally() })
  })

  it('初期状態はマッチアップ選択ステップで、リング図から自分→相手の席を選ぶとフロップ選択ステップへ自動遷移する', async () => {
    render(<AnalyzerScreen />)
    await screen.findByText('カスタムハンド解析')
    expect(screen.getByText('マッチアップを選んでください')).toBeInTheDocument()

    // 自分の席(UTG)→相手の席(BB): srp_utg_vs_bbのみ該当するため即座に確定する。
    fireEvent.click(screen.getByRole('button', { name: 'UTG' }))
    fireEvent.click(screen.getByRole('button', { name: 'BB' }))

    expect(useGtoStore.getState().customAnalyzer?.scenario?.id).toBe('srp_utg_vs_bb')
    expect(useGtoStore.getState().customAnalyzer?.userSeat).not.toBeNull()
    expect(screen.getByText('フロップを3枚選んでください')).toBeInTheDocument()
  })

  it('自分/相手の両方が関与する候補が複数あるペア(CO/BTN)では、SRP/3betの選択ステップを経てから確定する', async () => {
    render(<AnalyzerScreen />)
    await screen.findByText('カスタムハンド解析')

    fireEvent.click(screen.getByRole('button', { name: 'CO' }))
    fireEvent.click(screen.getByRole('button', { name: 'BTN' }))

    // まだ確定しない(SRPコールドコール/3betの2択が出る)。
    expect(useGtoStore.getState().customAnalyzer?.scenario).toBeNull()
    const srpBtn = screen.getByRole('button', { name: /SRP\(コールドコール\)/ })
    fireEvent.click(srpBtn)

    expect(useGtoStore.getState().customAnalyzer?.scenario?.id).toBe('srp_co_vs_btn_cc')
  })

  it('入力が進むごとに常設の盤面が埋まっていく(フロップ選択→手札選択の順でプレースホルダが実カードに置き換わる)', async () => {
    render(<AnalyzerScreen />)
    await screen.findByText('カスタムハンド解析')

    // 初期状態: ボードは0枚、手札は破線プレースホルダが2枚。
    expect(document.querySelectorAll('[style*="dashed"]').length).toBe(2)
    expect(document.querySelectorAll('[style*="2px solid var(--gold)"]').length).toBe(0)

    const scenario = SCENARIOS[0]
    const flop = FLOPS[0]
    const flopCards = boardFromFlop(flop) as [Card, Card, Card]

    act(() => {
      useGtoStore.getState().updateCustomAnalysis({ scenario, userSeat: 0 })
    })
    expect(screen.getByText('フロップを3枚選んでください')).toBeInTheDocument()

    act(() => {
      useGtoStore.getState().updateCustomAnalysis({ flopCards })
    })

    // フロップ選択直後: ボードが3枚出現するが、手札はまだプレースホルダのまま。
    expect(document.querySelectorAll('[style*="2px solid var(--gold)"]').length).toBe(3)
    expect(document.querySelectorAll('[style*="dashed"]').length).toBe(2)
    expect(screen.getByText('あなたの手札を2枚選んでください')).toBeInTheDocument()

    // フロップに使われていないカードを2枚選び、統合されたCardPickerで手札を選択する。
    const flopKeys = new Set(flopCards.map(cardKey))
    const [handA, handB] = createDeck().filter((c) => !flopKeys.has(cardKey(c)))
    const picker = screen.getByLabelText('あなたの手札')
    fireEvent.click(within(picker).getByRole('button', { name: labelFor(handA) }))
    fireEvent.click(within(picker).getByRole('button', { name: labelFor(handB) }))

    // 2枚とも選択済みになれば、手札のプレースホルダは消え、次のステップ(フロップのアクション)へ進む。
    expect(document.querySelectorAll('[style*="dashed"]').length).toBe(0)
    expect(document.querySelectorAll('[style*="2px solid var(--gold)"]').length).toBe(3)
    expect(screen.getByText('フロップのアクションを再現してください')).toBeInTheDocument()

    // 「戻る」で手札選択ステップへ戻ると、選択済みの手札はクリアされプレースホルダに戻る
    // (ウィザードは完了したステップの入力欄を自動的に隠すため、表示中のまま個別のカードを
    // 再クリックして解除する、という旧UIの操作性はもう無い。「戻る」で明示的に前ステップへ
    // 戻ってから選び直す設計)。
    fireEvent.click(screen.getByRole('button', { name: '← 戻る' }))
    expect(screen.getByText('あなたの手札を2枚選んでください')).toBeInTheDocument()
    expect(document.querySelectorAll('[style*="dashed"]').length).toBe(2)
  })

  it('「戻る」でフロップ選択ステップからマッチアップ選択ステップへ戻れる', async () => {
    render(<AnalyzerScreen />)
    await screen.findByText('カスタムハンド解析')

    act(() => {
      useGtoStore.getState().updateCustomAnalysis({ scenario: SCENARIOS[0], userSeat: 0 })
    })
    expect(screen.getByText('フロップを3枚選んでください')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '← 戻る' }))

    expect(useGtoStore.getState().customAnalyzer?.scenario).toBeNull()
    expect(screen.getByText('マッチアップを選んでください')).toBeInTheDocument()
  })

  it('収録済みフロップと厳密一致する場合のみ「解析する」ボタンが有効になる', async () => {
    render(<AnalyzerScreen />)
    await screen.findByText('カスタムハンド解析')

    const scenario = SCENARIOS[0]
    const storedFlop = FLOPS[0]
    const storedFlopCards = boardFromFlop(storedFlop) as [Card, Card, Card]
    const usedKeys = new Set(storedFlopCards.map(cardKey))
    const rest = createDeck().filter((c) => !usedKeys.has(cardKey(c)))

    // フロップ・ターン・リバーとも両者チェックのみでショーダウンまで進める
    // (buildStreetTree/buildTurnSubgameTreeは常にfirstToAct:0のため、この行動列は
    // 盤面・シナリオに依らず常に妥当。customHandReview.test.tsと同じ手法)。
    act(() => {
      useGtoStore.getState().updateCustomAnalysis({ scenario, userSeat: 0, flopCards: storedFlopCards, userCombo: [rest[0], rest[1]] })
    })
    act(() => {
      useGtoStore.getState().addCustomAction('flop', { seat: 0, label: 'check' })
      useGtoStore.getState().addCustomAction('flop', { seat: 1, label: 'check' })
    })
    act(() => {
      useGtoStore.getState().updateCustomAnalysis({ turnCard: rest[2] })
    })
    act(() => {
      useGtoStore.getState().addCustomAction('turn', { seat: 0, label: 'check' })
      useGtoStore.getState().addCustomAction('turn', { seat: 1, label: 'check' })
    })
    act(() => {
      useGtoStore.getState().updateCustomAnalysis({ riverCard: rest[3] })
    })
    act(() => {
      useGtoStore.getState().addCustomAction('river', { seat: 0, label: 'check' })
      useGtoStore.getState().addCustomAction('river', { seat: 1, label: 'check' })
    })

    expect(screen.getByText('解析の準備ができました')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '解析する' })).not.toBeDisabled()
  })
})

function labelFor(card: { rank: number; suit: string }): string {
  const rankStr = ({ 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T' } as Record<number, string>)[card.rank] ?? String(card.rank)
  const suitStr = ({ c: '♣', d: '♦', h: '♥', s: '♠' } as Record<string, string>)[card.suit] ?? card.suit
  return `${rankStr}${suitStr}`
}
