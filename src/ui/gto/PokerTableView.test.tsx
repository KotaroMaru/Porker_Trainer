// P11 Phase A: PlayScreen.tsxから切り出したPokerTableViewの新規テスト。
// 既存のPlayScreen.test.tsxが挙動不変を担保するため、ここではPokerTableView固有の
// 表示ロジック(villain省略時の相手行非表示・チップの有無・heroComboのnullプレースホルダ)
// のみを検証する。

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PokerTableView } from './PokerTableView'
import type { Card } from '../../engine/types'

const board: Card[] = [
  { rank: 14, suit: 's' },
  { rank: 12, suit: 's' },
  { rank: 11, suit: 's' },
]
const heroCombo: [Card, Card] = [
  { rank: 13, suit: 'h' },
  { rank: 13, suit: 'd' },
]

describe('PokerTableView', () => {
  it('ポット・ポジション名・ボード枚数を表示する', () => {
    render(<PokerTableView board={board} heroCombo={heroCombo} heroPosition="BB" potBb={6} />)

    expect(screen.getByText('ポット 6.0bb')).toBeInTheDocument()
    expect(screen.getByText('BB(あなた)')).toBeInTheDocument()
  })

  it('villainを省略すると相手行(裏向きカード)を描画しない', () => {
    const { container } = render(<PokerTableView board={board} heroCombo={heroCombo} heroPosition="BB" potBb={6} />)
    // 相手2枚+自分2枚がheroCombo(表向き)なので、faceDownのカード枠が無いことを
    // 相手ポジション名が表示されないことで間接的に確認する。
    expect(container.querySelector('[data-testid="action-chip"]')).not.toBeInTheDocument()
    expect(screen.queryByText('BTN')).not.toBeInTheDocument()
  })

  it('villainを渡すと相手ポジション名を表示する', () => {
    render(<PokerTableView board={board} heroCombo={heroCombo} heroPosition="BB" potBb={6} villain={{ position: 'BTN' }} />)
    expect(screen.getByText('BTN')).toBeInTheDocument()
  })

  it('villain.latestActionTextがあればアクションチップを表示する', () => {
    render(
      <PokerTableView
        board={board}
        heroCombo={heroCombo}
        heroPosition="BB"
        potBb={6}
        villain={{ position: 'BTN', latestActionText: 'ベット 4.1bb' }}
      />,
    )
    expect(screen.getByTestId('action-chip')).toHaveTextContent('ベット 4.1bb')
  })

  it('heroLatestActionTextがあればアクションチップを表示する', () => {
    render(<PokerTableView board={board} heroCombo={heroCombo} heroPosition="BB" potBb={6} heroLatestActionText="コール 4.1bb" />)
    expect(screen.getByTestId('action-chip')).toHaveTextContent('コール 4.1bb')
  })

  it('heroComboにnullを含めてもクラッシュせず、プレースホルダを描画する', () => {
    const { container } = render(<PokerTableView board={board} heroCombo={[null, null]} heroPosition="BB" potBb={6} />)
    expect(screen.getByText('BB(あなた)')).toBeInTheDocument()
    // プレースホルダはCardViewのランク/スート文字を持たない空枠(破線border)であることを確認。
    const dashedSlots = Array.from(container.querySelectorAll('div')).filter((el) => (el as HTMLElement).style.border?.includes('dashed'))
    expect(dashedSlots.length).toBe(2)
  })

  it('heroComboの片方だけnullでもクラッシュしない', () => {
    render(<PokerTableView board={board} heroCombo={[heroCombo[0], null]} heroPosition="BB" potBb={6} />)
    expect(screen.getByText('BB(あなた)')).toBeInTheDocument()
  })
})
