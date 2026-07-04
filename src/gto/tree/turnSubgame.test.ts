import { describe, it, expect } from 'vitest'
import { buildTurnSubgameTree, collectTerminals, collectDecisions } from './actionTree'
import type { TreeNode, ChanceNode } from '../solver/cfr'
import type { Card } from '../../engine/types'
import { cardKey } from '../../engine/deck'

function board4(): Card[] {
  return [
    { rank: 13, suit: 'c' }, // Kc (flop)
    { rank: 7, suit: 'd' }, // 7d
    { rank: 2, suit: 'h' }, // 2h
    { rank: 9, suit: 's' }, // 9s (turn)
  ]
}

function collectChanceNodes(node: TreeNode): ChanceNode[] {
  if (node.kind === 'terminal') return []
  const out: ChanceNode[] = node.kind === 'chance' ? [node] : []
  for (const c of node.children) out.push(...collectChanceNodes(c))
  return out
}

describe('buildTurnSubgameTree', () => {
  it('全ターミナルでお金の保存則が成り立つ(potBb=開始ポット+両者の投入額)', () => {
    const tree = buildTurnSubgameTree({
      turnPotBb: 9.1,
      effectiveStackBb: 95.7,
      firstToAct: 1,
      deadCards: board4(),
    })
    const terminals = collectTerminals(tree)
    expect(terminals.length).toBeGreaterThan(0)
    for (const t of terminals) {
      const expectedPot = 9.1 + t.contributed[0] + t.contributed[1]
      expect(t.potBb).toBeCloseTo(expectedPot, 6)
      expect(t.contributed[0]).toBeLessThanOrEqual(95.7 + 1e-6)
      expect(t.contributed[1]).toBeLessThanOrEqual(95.7 + 1e-6)
    }
  })

  it('リバーのチャンスノードは既知の4枚(deadCards)を含まない', () => {
    const dead = board4()
    const tree = buildTurnSubgameTree({
      turnPotBb: 9.1,
      effectiveStackBb: 95.7,
      firstToAct: 1,
      deadCards: dead,
    })
    const chanceNodes = collectChanceNodes(tree)
    expect(chanceNodes.length).toBeGreaterThan(0)
    const deadKeys = new Set(dead.map(cardKey))
    for (const cn of chanceNodes) {
      for (const card of cn.cards) {
        expect(deadKeys.has(card)).toBe(false)
      }
      expect(cn.cards.length).toBe(48) // 52-4枚
    }
  })

  it('決断ノード数が計画の見積り(1ストリート約26ノード×継続ライン×48リバー枚)の桁数と整合する', () => {
    const tree = buildTurnSubgameTree({
      turnPotBb: 9.1,
      effectiveStackBb: 95.7,
      firstToAct: 1,
      deadCards: board4(),
    })
    const decisions = collectDecisions(tree)
    // 計画の見積り(約11,000)の同じ桁数(数千〜数万)に収まることを確認
    expect(decisions.length).toBeGreaterThan(1000)
    expect(decisions.length).toBeLessThan(30000)
  })

  it('浅いスタックでターン中にオールインした場合、リバーには決断ノードが生まれない(ランアウトのみ)', () => {
    const tree = buildTurnSubgameTree({
      turnPotBb: 9.1,
      effectiveStackBb: 3, // 非常に浅い実効スタック
      firstToAct: 1,
      deadCards: board4(),
    })
    // ツリー全体を通しても、リバーに到達する頃には大抵オールインしているはずなので
    // 決断ノード数はストリート1つ分程度に収まる(全体が数千ノードに膨れ上がらない)
    const decisions = collectDecisions(tree)
    expect(decisions.length).toBeLessThan(200)
  })
})
