import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DivergencePlot } from './DivergencePlot'

describe('DivergencePlot', () => {
  it('ready=falseでは点もSVGも描かない', () => {
    render(<DivergencePlot point={{ decisionCount: 29, foldEligibleCount: 29, x: 0.2, y: -0.1 }} ready={false} />)
    expect(screen.getByTestId('divergence-insufficient')).toHaveTextContent('サンプル不足')
    expect(screen.queryByTestId('divergence-plot')).not.toBeInTheDocument()
    expect(screen.queryByTestId('divergence-point')).not.toBeInTheDocument()
  })

  it('ready=trueで点を描き、条件を満たす軌跡点だけを折れ線に含める', () => {
    render(
      <DivergencePlot
        point={{ decisionCount: 60, foldEligibleCount: 35, x: 0.1, y: 0.2 }}
        ready
        trajectory={[
          { decisionCount: 25, foldEligibleCount: 20, x: -0.1, y: -0.1 },
          { decisionCount: 50, foldEligibleCount: 30, x: 0.05, y: 0.1 },
        ]}
      />,
    )
    expect(screen.getByTestId('divergence-point')).toBeInTheDocument()
    expect(screen.getByTestId('divergence-trajectory')).toBeInTheDocument()
    expect(screen.getByTestId('divergence-plot')).toHaveAccessibleName(/攻めのずれ10%/)
  })
})
