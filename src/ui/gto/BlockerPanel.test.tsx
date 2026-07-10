import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { BlockerPanel } from './BlockerPanel'
import type { Card } from '../../engine/types'
import type { Combo } from '../../analysis/range'

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit }
}

describe('BlockerPanel', () => {
  const userCombo: Combo = [card(14, 'h'), card(13, 'h')] // AhKh

  it('valueCombosReducedPctと手札表記を表示する', () => {
    const { container } = render(
      <BlockerPanel blockers={{ valueCombosReducedPct: 22, continueCombosReducedPct: null, blockedExamples: ['AKo', 'AQs'] }} userCombo={userCombo} />,
    )
    expect(container.textContent).toContain('A♥ K♥')
    expect(container.textContent).toContain('22%')
    expect(container.textContent).toContain('代表例: AKo, AQs')
  })

  it('continueCombosReducedPctがnullの場合は継続レンジの行を表示しない', () => {
    const { container } = render(
      <BlockerPanel blockers={{ valueCombosReducedPct: 22, continueCombosReducedPct: null, blockedExamples: [] }} userCombo={userCombo} />,
    )
    expect(container.textContent).not.toContain('継続レンジ')
  })

  it('continueCombosReducedPctがある場合はその行を表示する', () => {
    const { container } = render(
      <BlockerPanel blockers={{ valueCombosReducedPct: 22, continueCombosReducedPct: 15, blockedExamples: [] }} userCombo={userCombo} />,
    )
    expect(container.textContent).toContain('継続レンジ')
    expect(container.textContent).toContain('15%')
  })

  it('blockedExamplesが空の場合は代替文言を表示する', () => {
    const { container } = render(
      <BlockerPanel blockers={{ valueCombosReducedPct: 0, continueCombosReducedPct: null, blockedExamples: [] }} userCombo={userCombo} />,
    )
    expect(container.textContent).toContain('ブロックしている代表的なコンボはありません。')
  })
})
