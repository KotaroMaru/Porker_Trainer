import { describe, expect, it, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { AnalyzerScreen } from './AnalyzerScreen'
import { initialTally, useGtoStore } from '../../gto/store'
import { SCENARIOS } from '../../gto/data/scenarios'
import { FLOPS } from '../../gto/data/flops'
import { createDeck, cardKey } from '../../engine/deck'
import { boardFromFlop } from '../../gto/trainer/gameFlow'

describe('AnalyzerScreen', () => {
  beforeEach(() => {
    useGtoStore.setState({ activeTab: 'review', review: null, reviewSource: 'live', availability: new Map(), customAnalyzer: null, sessionTally: initialTally() })
  })

  it('シナリオ選択後にフロップ選択と無効な解析ボタンを表示する', async () => {
    render(<AnalyzerScreen />)
    await screen.findByText('カスタムハンド解析')
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[0], { target: { value: 'srp_btn_vs_bb' } })
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '解析する' })).toBeDisabled()
  })

  it('入力が進むごとに常設の盤面が埋まっていく(フロップ選択→手札選択の順でプレースホルダが実カードに置き換わる)', async () => {
    render(<AnalyzerScreen />)
    await screen.findByText('カスタムハンド解析')

    // 初期状態: ボードは0枚、手札は破線プレースホルダが2枚。
    expect(document.querySelectorAll('[style*="dashed"]').length).toBe(2)
    expect(document.querySelectorAll('[style*="2px solid var(--gold)"]').length).toBe(0)

    const scenario = SCENARIOS[0]
    const flop = FLOPS[0]

    act(() => {
      useGtoStore.getState().updateCustomAnalysis({ scenario })
    })
    act(() => {
      useGtoStore.getState().updateCustomAnalysis({ flop })
    })

    // フロップ選択直後: ボードが3枚出現するが、手札はまだプレースホルダのまま。
    expect(document.querySelectorAll('[style*="2px solid var(--gold)"]').length).toBe(3)
    expect(document.querySelectorAll('[style*="dashed"]').length).toBe(2)

    act(() => {
      useGtoStore.getState().updateCustomAnalysis({ userSeat: 0 })
    })

    // フロップに使われていないカードを2枚選び、統合されたCardPickerで手札を選択する。
    const flopKeys = new Set(boardFromFlop(flop).map(cardKey))
    const [handA, handB] = createDeck().filter((c) => !flopKeys.has(cardKey(c)))
    const picker = screen.getByLabelText('あなたの手札')
    fireEvent.click(within(picker).getByRole('button', { name: labelFor(handA) }))
    fireEvent.click(within(picker).getByRole('button', { name: labelFor(handB) }))

    // 2枚とも選択済みになれば、手札のプレースホルダは消える。
    expect(document.querySelectorAll('[style*="dashed"]').length).toBe(0)
    expect(document.querySelectorAll('[style*="2px solid var(--gold)"]').length).toBe(3)

    // 選択済みカードを再クリックすると解除され、プレースホルダに戻る。
    fireEvent.click(within(picker).getByRole('button', { name: labelFor(handA) }))
    expect(document.querySelectorAll('[style*="dashed"]').length).toBe(1)
  })
})

function labelFor(card: { rank: number; suit: string }): string {
  const rankStr = ({ 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T' } as Record<number, string>)[card.rank] ?? String(card.rank)
  const suitStr = ({ c: '♣', d: '♦', h: '♥', s: '♠' } as Record<string, string>)[card.suit] ?? card.suit
  return `${rankStr}${suitStr}`
}
