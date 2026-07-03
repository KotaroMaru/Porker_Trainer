import { describe, it, expect } from 'vitest'
import { solveCfr } from './cfr'
import type { CfrGame, TreeNode, DecisionNode, TerminalNode } from './cfr'

// ============================================================
// Kuhnポーカー: J/Q/K の3枚から1枚ずつ配られる最小のポーカー
// (Kuhn 1950)。解析解が既知(ゲーム値 = -1/18、両プレイヤーとも
// exploitability=0)のため、CFRコアの正しさを検証する定番のトイゲーム。
//
// 各プレイヤーは先にアンティ1を払う。P0が先手でcheck/bet(1)を選び、
// 以降 check-check(ショーダウン) / bet-fold / bet-call(ショーダウン) の
// いずれかで終わる。手そのものが「持ち札」かつ「カード」なので、
// cards(h)=[h] とするだけで「同じ札を2人が同時に持てない」という
// Kuhnの配札制約がブロッキング行列によって自動的に表現される。
// ============================================================

type KuhnCard = 'J' | 'Q' | 'K'
const RANK: Record<KuhnCard, number> = { J: 0, Q: 1, K: 2 }

function terminal(potBb: number, contributed: [number, number], outcome: TerminalNode['outcome']): TerminalNode {
  return { kind: 'terminal', potBb, contributed, outcome }
}

function buildKuhnTree(): TreeNode {
  // P0 check -> P1 check/bet
  const p1AfterCheck: DecisionNode = {
    kind: 'decision',
    player: 1,
    actionLabels: ['check', 'bet'],
    children: [
      terminal(2, [1, 1], { kind: 'showdown' }),
      {
        kind: 'decision',
        player: 0,
        actionLabels: ['fold', 'call'],
        children: [
          terminal(3, [1, 2], { kind: 'fold', foldedPlayer: 0 }),
          terminal(4, [2, 2], { kind: 'showdown' }),
        ],
      },
    ],
  }

  // P0 bet -> P1 fold/call
  const p1AfterBet: DecisionNode = {
    kind: 'decision',
    player: 1,
    actionLabels: ['fold', 'call'],
    children: [
      terminal(3, [2, 1], { kind: 'fold', foldedPlayer: 1 }),
      terminal(4, [2, 2], { kind: 'showdown' }),
    ],
  }

  const root: DecisionNode = {
    kind: 'decision',
    player: 0,
    actionLabels: ['check', 'bet'],
    children: [p1AfterCheck, p1AfterBet],
  }
  return root
}

function buildKuhnGame(): CfrGame<KuhnCard> {
  const hands: KuhnCard[] = ['J', 'Q', 'K']
  const universe = { hands, initialReach: [1, 1, 1], cards: (h: KuhnCard) => [h] }
  return {
    root: buildKuhnTree(),
    players: [universe, universe],
    compare: (h0, h1) => RANK[h0] - RANK[h1],
  }
}

describe('Discounted CFR: Kuhnポーカーでの収束検証', () => {
  it('exploitabilityが1e-3未満に収束する', () => {
    const game = buildKuhnGame()
    const solution = solveCfr(game, { maxIterations: 3000, targetExploitability: 0.0005, checkEveryIterations: 50 })
    expect(solution.exploitability).toBeLessThan(1e-3)
  })

  it('ゲーム値がP0にとって-1/18に近づく(既知の解析解)', () => {
    const game = buildKuhnGame()
    const solution = solveCfr(game, { maxIterations: 3000, targetExploitability: 0.0005, checkEveryIterations: 50 })
    expect(solution.gameValue[0]).toBeGreaterThan(-1 / 18 - 0.02)
    expect(solution.gameValue[0]).toBeLessThan(-1 / 18 + 0.02)
  })

  it('P0のK/Jのbet頻度は既知の均衡族の不変関係 bet(K)≈3×bet(J) を満たす', () => {
    // Kuhnポーカーの均衡は一意ではなく、ブラフ頻度α∈[0,1/3]の1パラメータ族が存在する
    // (bet(J)=α, bet(K)=3α, bet(Q)=0という関係だけが全ての均衡で共通)。
    // そのためK/Jの個別頻度を固定値で断定するテストは誤りで、この比の関係のみを検証する。
    const game = buildKuhnGame()
    const solution = solveCfr(game, { maxIterations: 3000, targetExploitability: 0.0005, checkEveryIterations: 50 })
    const root = game.root as DecisionNode
    const strat = solution.getStrategy(root)
    const kIdx = game.players[0].hands.indexOf('K')
    const jIdx = game.players[0].hands.indexOf('J')
    const betK = strat.frequencies[kIdx][1]
    const betJ = strat.frequencies[jIdx][1]
    expect(betK).toBeGreaterThan(0)
    expect(betJ).toBeGreaterThan(0)
    expect(betK / betJ).toBeGreaterThan(2.7)
    expect(betK / betJ).toBeLessThan(3.3)
  })

  it('P0のQ(中間)のbet頻度は0に近い(既知の均衡族で共通の性質)', () => {
    const game = buildKuhnGame()
    const solution = solveCfr(game, { maxIterations: 3000, targetExploitability: 0.0005, checkEveryIterations: 50 })
    const root = game.root as DecisionNode
    const strat = solution.getStrategy(root)
    const qIdx = game.players[0].hands.indexOf('Q')
    expect(strat.frequencies[qIdx][1]).toBeLessThan(0.05)
  })
})
