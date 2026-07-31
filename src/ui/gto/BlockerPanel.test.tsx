import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { BlockerPanel } from './BlockerPanel'
import type { Card } from '../../engine/types'
import type { Combo } from '../../analysis/range'
import type { SpotFeatures } from '../../gto/explain/features'

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit }
}

function blockers(overrides: Partial<SpotFeatures['blockers']> = {}): SpotFeatures['blockers'] {
  return {
    valueCombosReducedPct: 22,
    bluffCombosReducedPct: 0,
    continueCombosReducedPct: null,
    blockedExamples: [],
    valueBlockedHands: [],
    bluffBlockedHands: [],
    continueBlockedHands: null,
    ...overrides,
  }
}

describe('BlockerPanel', () => {
  const userCombo: Combo = [card(14, 'h'), card(13, 'h')] // AhKh

  it('valueCombosReducedPctと手札表記を表示する', () => {
    const { container } = render(
      <BlockerPanel blockers={blockers({ blockedExamples: ['AKo', 'AQs'], valueBlockedHands: [{ hand: 'AKo', comboCount: 3, weightPct: 60 }, { hand: 'AQs', comboCount: 1, weightPct: 40 }] })} userCombo={userCombo} />,
    )
    expect(container.textContent).toContain('A♥ K♥')
    expect(container.textContent).toContain('22%')
    expect(container.textContent).toContain('バリューハンドのブロック対象（全2クラス）')
    expect(container.textContent).toContain('AKo')
    expect(container.textContent).toContain('60.0%')
  })

  it('continueCombosReducedPctがnullの場合は継続レンジの行を表示しない', () => {
    const { container } = render(
      <BlockerPanel blockers={blockers()} userCombo={userCombo} />,
    )
    expect(container.textContent).not.toContain('継続レンジ')
  })

  it('continueCombosReducedPctがある場合はその行を表示する', () => {
    const { container } = render(
      <BlockerPanel blockers={blockers({ continueCombosReducedPct: 15, continueBlockedHands: [{ hand: 'KQs', comboCount: 2, weightPct: 100 }] })} userCombo={userCombo} />,
    )
    expect(container.textContent).toContain('継続レンジ')
    expect(container.textContent).toContain('15%')
  })

  it('ブロックハンドが空の場合は代替文言を表示する', () => {
    const { container } = render(
      <BlockerPanel blockers={blockers({ valueCombosReducedPct: 0 })} userCombo={userCombo} />,
    )
    expect(container.textContent).toContain('バリューハンドにブロックしているハンドはありません。')
  })

  it('全ブロックハンドをクラス別に表示する', () => {
    const hands = Array.from({ length: 12 }, (_, i) => ({ hand: `A${i + 2}o`, comboCount: 1, weightPct: 12 - i }))
    const { container } = render(<BlockerPanel blockers={blockers({ valueBlockedHands: hands })} userCombo={userCombo} />)

    expect(container.textContent).toContain('全12クラス')
    expect(container.textContent).toContain('A2o')
    expect(container.textContent).toContain('A13o')
  })
})
