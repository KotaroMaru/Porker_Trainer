import { describe, it, expect } from 'vitest'
import { solveCfr } from './cfr'
import { extractDecisionEvs } from './nodeEvs'
import type { CfrGame, TreeNode, DecisionNode, TerminalNode } from './cfr'

// リバートイスポット(riverToySpot.test.tsと同じ設定: ポラライズドベッターvs
// ブラフキャッチャー、ポット1・ベット0.5)を使い、extractDecisionEvsの正規化式
// (evBb[a,h] = childValues[a][acting][h] / effOppReach(h))を検証する。
// このトイはカードのブロッキングが一切ないため(cards()=[]常時)、
// 「非ブロック相手reach和」は常に相手側の総reachと一致し、手計算で正解値を
// 独立に導出できる。

type Bettor = 'value' | 'bluff'
type Caller = 'bluffcatcher'

const POT = 1
const BET = 0.5

function terminal(potBb: number, contributed: [number, number], outcome: TerminalNode['outcome']): TerminalNode {
  return { kind: 'terminal', potBb, contributed, outcome }
}

function buildTree(): TreeNode {
  const afterBet: DecisionNode = {
    kind: 'decision',
    player: 1,
    actionLabels: ['fold', 'call'],
    children: [terminal(POT + BET, [BET, 0], { kind: 'fold', foldedPlayer: 1 }), terminal(POT + 2 * BET, [BET, BET], { kind: 'showdown' })],
  }
  return {
    kind: 'decision',
    player: 0,
    actionLabels: ['check', 'bet'],
    children: [terminal(POT, [0, 0], { kind: 'showdown' }), afterBet],
  }
}

function buildGame(): CfrGame<Bettor | Caller> {
  const bettorUniverse = { hands: ['value', 'bluff'] as Bettor[], initialReach: [2, 2], cards: () => [] as string[] }
  const callerUniverse = { hands: ['bluffcatcher'] as Caller[], initialReach: [2], cards: () => [] as string[] }
  const STRENGTH: Record<Bettor | Caller, number> = { value: 2, bluffcatcher: 1, bluff: 0 }
  return {
    root: buildTree(),
    players: [bettorUniverse, callerUniverse],
    score: (h) => STRENGTH[h],
  }
}

describe('extractDecisionEvs (リバートイスポットによる手計算検証)', () => {
  it('root check-actionのEVは戦略に依存せず手計算できる(value=1.0bb, bluff=0.0bb)', () => {
    const game = buildGame()
    const solution = solveCfr(game, { maxIterations: 2000, targetExploitability: 0.0005, checkEveryIterations: 50 })
    const root = game.root as DecisionNode
    const evs = extractDecisionEvs(game, (node) => solution.getStrategy(node).frequencies)
    const rootEvs = evs.get(root)
    if (!rootEvs) throw new Error('root not found in extracted EVs')

    const valueIdx = game.players[0].hands.indexOf('value')
    const bluffIdx = game.players[0].hands.indexOf('bluff')
    const checkActionIdx = root.actionLabels.indexOf('check')
    const handCount = game.players[0].hands.length

    // check→即showdown(pot=1,contributed=[0,0])。valueは常にbluffcatcherに勝つので
    // net=pot-c0=1、bluffは常に負けるのでnet=-c0=0。ブロッキングなしなので
    // effOppReachは常にcallerの全reach(=2)。
    expect(rootEvs[checkActionIdx * handCount + valueIdx]).toBeCloseTo(1.0, 6)
    expect(rootEvs[checkActionIdx * handCount + bluffIdx]).toBeCloseTo(0.0, 6)
  })

  it('afterBetのfold-actionのEVは戦略に依存せず手計算できる(bluffcatcher=0.0bb)', () => {
    const game = buildGame()
    const solution = solveCfr(game, { maxIterations: 2000, targetExploitability: 0.0005, checkEveryIterations: 50 })
    const root = game.root as DecisionNode
    const afterBet = root.children[root.actionLabels.indexOf('bet')] as DecisionNode
    const evs = extractDecisionEvs(game, (node) => solution.getStrategy(node).frequencies)
    const afterBetEvs = evs.get(afterBet)
    if (!afterBetEvs) throw new Error('afterBet not found in extracted EVs')

    const foldActionIdx = afterBet.actionLabels.indexOf('fold')
    const handCount = game.players[1].hands.length // caller側(bluffcatcherのみ)

    // fold terminal: potBb=1.5, contributed=[0.5,0], foldedPlayer=1(caller)。
    // caller視点net1 = -c1 = 0(foldedPlayer===0ではないので-c1)。
    expect(afterBetEvs[foldActionIdx * handCount + 0]).toBeCloseTo(0.0, 6)
  })

  it('root健全性: 手番側のreach加重Σ_a freq・evBb はsolution.gameValueと一致する', () => {
    const game = buildGame()
    const solution = solveCfr(game, { maxIterations: 3000, targetExploitability: 0.0002, checkEveryIterations: 50 })
    const root = game.root as DecisionNode
    const evs = extractDecisionEvs(game, (node) => solution.getStrategy(node).frequencies)
    const rootEvs = evs.get(root)
    if (!rootEvs) throw new Error('root not found in extracted EVs')

    const strat = solution.getStrategy(root)
    const reach = game.players[0].initialReach
    const handCount = game.players[0].hands.length
    let weightedSum = 0
    let reachSum = 0
    for (let h = 0; h < handCount; h++) {
      let evForHand = 0
      for (let a = 0; a < root.actionLabels.length; a++) {
        evForHand += strat.frequencies[h][a] * rootEvs[a * handCount + h]
      }
      weightedSum += reach[h] * evForHand
      reachSum += reach[h]
    }
    const reconstructed = weightedSum / reachSum

    expect(reconstructed).toBeCloseTo(solution.gameValue[0], 2)
  })
})
