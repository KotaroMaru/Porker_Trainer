import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CardPicker } from './CardPicker'

describe('CardPicker', () => {
  it('既出カードは無効化し、利用可能なカードだけを選択できる', () => {
    const selected: string[] = []
    render(
      <CardPicker
        ariaLabel="テストカード"
        selected={[]}
        unavailable={[{ rank: 14, suit: 's' }]}
        maxSelect={1}
        onSelect={(card) => selected.push(`${card.rank}${card.suit}`)}
      />,
    )
    expect(screen.getByRole('button', { name: 'A♠' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '2♣' }))
    expect(selected).toEqual(['2c'])
  })

  it('複数選択(最大2枚)に対応し、選択済みカードはaria-pressedになる', () => {
    render(
      <CardPicker
        ariaLabel="手札"
        selected={[
          { rank: 14, suit: 's' },
          { rank: 13, suit: 'h' },
        ]}
        unavailable={[]}
        maxSelect={2}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'A♠' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'K♥' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '2♣' })).toHaveAttribute('aria-pressed', 'false')
  })
})
