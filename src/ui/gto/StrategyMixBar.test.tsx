import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StrategyMixBar } from './StrategyMixBar'
import type { ActionBreakdownEntry } from '../../gto/trainer/grading'

describe('StrategyMixBar', () => {
  const breakdown: ActionBreakdownEntry[] = [
    { label: 'check', freq: 0.3, evBb: 1.0 },
    { label: 'bet33', freq: 0.7, evBb: 2.0 },
  ]

  it('各アクションの帯の幅がfreqに一致する', () => {
    render(<StrategyMixBar breakdown={breakdown} bestLabel="bet33" chosenLabel="check" />)
    const checkBar = screen.getByTitle('チェック 30%')
    const betBar = screen.getByTitle('ベット 33% 70%')
    expect(checkBar.style.width).toBe('30%')
    expect(betBar.style.width).toBe('70%')
  })

  it('bestLabelには★マークが凡例に付く', () => {
    const { container } = render(<StrategyMixBar breakdown={breakdown} bestLabel="bet33" chosenLabel="check" />)
    expect(container.textContent).toContain('★ ベット 33% 70%')
  })

  it('chosenLabelの帯セグメントに赤(var(--red))のoutlineが付く', () => {
    render(<StrategyMixBar breakdown={breakdown} bestLabel="bet33" chosenLabel="check" />)
    const checkBar = screen.getByTitle('チェック 30%')
    const betBar = screen.getByTitle('ベット 33% 70%')
    expect(checkBar.style.outline).toContain('var(--red)')
    expect(betBar.style.outline).toBe('none')
  })

  it('頻度がほぼ0のアクションは帯セグメントとして描画されない', () => {
    const withZero: ActionBreakdownEntry[] = [...breakdown, { label: 'allin', freq: 0, evBb: -5 }]
    render(<StrategyMixBar breakdown={withZero} bestLabel="bet33" chosenLabel="check" />)
    expect(screen.queryByTitle(/オールイン/)).not.toBeInTheDocument()
  })

  it('凡例には頻度0のアクションも含めて全アクションが表示される', () => {
    const withZero: ActionBreakdownEntry[] = [...breakdown, { label: 'allin', freq: 0, evBb: -5 }]
    const { container } = render(<StrategyMixBar breakdown={withZero} bestLabel="bet33" chosenLabel="check" />)
    expect(container.textContent).toContain('オールイン 0%')
  })
})
