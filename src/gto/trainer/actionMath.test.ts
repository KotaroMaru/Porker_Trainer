import { describe, it, expect } from 'vitest'
import { actionInvestmentsBb, actionLabelsWithAmounts } from './actionMath'
import { buildStreetTree, collectDecisions } from '../tree/actionTree'
import type { DecisionNode } from '../solver/cfr'

describe('actionInvestmentsBb', () => {
  const tree = buildStreetTree({ potBb: 9.1, effectiveStackBb: 95.7, firstToAct: 1 })
  const decisions = collectDecisions(tree)

  it('check/foldの投入額は常に0', () => {
    for (const node of decisions) {
      const amounts = actionLabelsWithAmounts(node)
      for (const { label, amountBb } of amounts) {
        if (label === 'check' || label === 'fold') {
          expect(amountBb).toBe(0)
        }
      }
    }
  })

  it('各アクションの追加投入額は非負で、実効スタック(95.7bb)を超えない', () => {
    for (const node of decisions) {
      const amounts = actionInvestmentsBb(node)
      for (const amt of amounts) {
        expect(amt).toBeGreaterThanOrEqual(-1e-9)
        expect(amt).toBeLessThanOrEqual(95.7 + 1e-6)
      }
    }
  })

  it('ルートのbet33/bet75の投入額はポットの33%/75%に近い', () => {
    const root = tree as DecisionNode
    const withAmounts = actionLabelsWithAmounts(root)
    const bet33 = withAmounts.find((a) => a.label === 'bet33')
    const bet75 = withAmounts.find((a) => a.label === 'bet75')
    expect(bet33).toBeDefined()
    expect(bet75).toBeDefined()
    expect(bet33!.amountBb).toBeCloseTo(9.1 * 0.33, 1)
    expect(bet75!.amountBb).toBeCloseTo(9.1 * 0.75, 1)
  })

  it('実際にそのアクションを辿った先の子ノードのcontributed(Bb)と整合する(お金の保存則)', () => {
    const root = tree as DecisionNode
    const amounts = actionInvestmentsBb(root)
    for (let i = 0; i < root.actionLabels.length; i++) {
      const child = root.children[i]
      const actorContributedBefore = root.contributedBb![root.player]
      const expectedAfter = actorContributedBefore + amounts[i]
      if (child.kind === 'terminal') {
        expect(child.contributed[root.player]).toBeCloseTo(expectedAfter, 6)
      } else if (child.kind === 'decision') {
        expect(child.contributedBb![root.player]).toBeCloseTo(expectedAfter, 6)
      }
    }
  })
})
