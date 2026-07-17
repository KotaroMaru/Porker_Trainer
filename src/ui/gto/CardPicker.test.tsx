import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CardPicker } from './CardPicker'

describe('CardPicker', () => {
  it('既出カードは無効化し、利用可能なカードだけを選択できる', () => {
    const selected: string[] = []
    render(<CardPicker ariaLabel="テストカード" selected={null} unavailable={[{ rank: 14, suit: 's' }]} onSelect={(card) => selected.push(`${card.rank}${card.suit}`)} />)
    expect(screen.getByRole('button', { name: 'A♠' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '2♣' }))
    expect(selected).toEqual(['2c'])
  })
})
