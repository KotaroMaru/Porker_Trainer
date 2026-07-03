import { describe, it, expect } from 'vitest'
import { buildStreetTree, collectTerminals, collectDecisions } from './actionTree'

describe('buildStreetTree', () => {
  it('全ターミナルでpotBbが「開始ポット+両者の追加投入額」と一致する(お金の保存則)', () => {
    const tree = buildStreetTree({ potBb: 9.1, effectiveStackBb: 95.7, firstToAct: 1 })
    const terminals = collectTerminals(tree)
    expect(terminals.length).toBeGreaterThan(0)
    for (const t of terminals) {
      const expectedPot = 9.1 + t.contributed[0] + t.contributed[1]
      expect(t.potBb).toBeCloseTo(expectedPot, 6)
    }
  })

  it('誰の追加投入額も実効スタックを超えない', () => {
    const tree = buildStreetTree({ potBb: 9.1, effectiveStackBb: 95.7, firstToAct: 1 })
    const terminals = collectTerminals(tree)
    for (const t of terminals) {
      expect(t.contributed[0]).toBeLessThanOrEqual(95.7 + 1e-6)
      expect(t.contributed[1]).toBeLessThanOrEqual(95.7 + 1e-6)
    }
  })

  it('両プレイヤーとも決断ノードに登場する(一方的な木になっていない)', () => {
    const tree = buildStreetTree({ potBb: 9.1, effectiveStackBb: 95.7, firstToAct: 1 })
    const decisions = collectDecisions(tree)
    const players = new Set(decisions.map((d) => d.player))
    expect(players.has(0)).toBe(true)
    expect(players.has(1)).toBe(true)
  })

  it('決断ノード数が想定レンジ内(数十ノード程度)に収まる', () => {
    const tree = buildStreetTree({ potBb: 9.1, effectiveStackBb: 95.7, firstToAct: 1 })
    const decisions = collectDecisions(tree)
    expect(decisions.length).toBeGreaterThan(5)
    expect(decisions.length).toBeLessThan(60)
  })

  it('firstToActが先に行動する(そのプレイヤーのdecisionがルート)', () => {
    const tree = buildStreetTree({ potBb: 9.1, effectiveStackBb: 95.7, firstToAct: 1 })
    expect(tree.kind).toBe('decision')
    if (tree.kind === 'decision') expect(tree.player).toBe(1)
  })

  it('浅い実効スタックではベットサイズがオールインに収束し、重複サイズが生まれない', () => {
    // ポットに対してスタックが浅い(pot=10, stack=3): 33%/75%ともほぼオールイン圏内
    const tree = buildStreetTree({ potBb: 10, effectiveStackBb: 3, firstToAct: 0 })
    if (tree.kind !== 'decision') throw new Error('expected decision root')
    const labels = tree.actionLabels
    expect(new Set(labels).size).toBe(labels.length) // ラベルの重複がない
  })

  it('オールインでコールした後は、さらなるレイズの選択肢がない(レイズはオールインまでで打ち止め)', () => {
    const tree = buildStreetTree({ potBb: 9.1, effectiveStackBb: 95.7, firstToAct: 1 })
    if (tree.kind !== 'decision') throw new Error('expected decision root')
    // オールインの分岐を辿り、その先の決断ノードがfold/callのみ(レイズなし)であることを確認
    const allinIdx = tree.actionLabels.indexOf('allin')
    expect(allinIdx).toBeGreaterThanOrEqual(0)
    const afterAllin = tree.children[allinIdx]
    expect(afterAllin.kind).toBe('decision')
    if (afterAllin.kind === 'decision') {
      expect(afterAllin.actionLabels).toEqual(['fold', 'call'])
    }
  })
})
