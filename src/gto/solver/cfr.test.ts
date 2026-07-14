import { describe, it, expect } from 'vitest'
import { solveCfr, createCfrSession } from './cfr'
import type { CfrGame, TreeNode, DecisionNode, TerminalNode, CfrSession } from './cfr'

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
    score: (h) => RANK[h],
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

// ============================================================
// P9-1: 再開可能CFRセッション(createCfrSession)の無損失等価ゲート。
// DCFRの割引係数は反復番号tのみに依存し、regretTable(セッション内部状態)は
// advance()呼び出しをまたいで連続するため、「nずつ複数回advance」は
// 「一括でn回分advance」とビット等価になるはずである。この等価性が
// 崩れていれば、P9-4のプレイ中背景リファイン(粗いソルブをそのまま継続する)は
// 数値的に不正になる。全ての後続作業(P9-2以降)はこのゲートの合格が前提。
// ============================================================
describe('P9-1: CfrSessionの再開可能性(無損失等価ゲート)', () => {
  function strategiesEqual<Hand>(a: DecisionNode, b: DecisionNode, sessionA: CfrSession<Hand>, sessionB: CfrSession<Hand>) {
    const stratA = sessionA.getStrategy(a)
    const stratB = sessionB.getStrategy(b)
    expect(stratA.actionLabels).toEqual(stratB.actionLabels)
    for (let h = 0; h < stratA.frequencies.length; h++) {
      for (let act = 0; act < stratA.frequencies[h].length; act++) {
        expect(stratA.frequencies[h][act]).toBeCloseTo(stratB.frequencies[h][act], 12)
      }
    }
  }

  it('チャンク分割実行(7反復ずつ)は一括実行(合計反復数)とビット等価(1e-12許容)になる', () => {
    const gameOneShot = buildKuhnGame()
    const sessionOneShot = createCfrSession(gameOneShot)
    sessionOneShot.advance(70)

    const gameChunked = buildKuhnGame()
    const sessionChunked = createCfrSession(gameChunked)
    for (let i = 0; i < 10; i++) sessionChunked.advance(7)

    expect(sessionChunked.iterationsRun).toBe(sessionOneShot.iterationsRun)
    strategiesEqual(gameOneShot.root as DecisionNode, gameChunked.root as DecisionNode, sessionOneShot, sessionChunked)

    const gvOneShot = sessionOneShot.gameValue()
    const gvChunked = sessionChunked.gameValue()
    expect(gvChunked[0]).toBeCloseTo(gvOneShot[0], 12)
    expect(gvChunked[1]).toBeCloseTo(gvOneShot[1], 12)

    expect(sessionChunked.measureExploitability()).toBeCloseTo(sessionOneShot.measureExploitability(), 12)
  })

  it('50まで進めてから250反復継続した解(ウォームスタート)は、一気に300反復した解と一致する', () => {
    const gameContinued = buildKuhnGame()
    const sessionContinued = createCfrSession(gameContinued)
    sessionContinued.advance(50) // プレイ中の粗いソルブに相当
    sessionContinued.advance(250) // ハンド終了後の背景リファインで継続、に相当

    const gameMonolithic = buildKuhnGame()
    const sessionMonolithic = createCfrSession(gameMonolithic)
    sessionMonolithic.advance(300)

    expect(sessionContinued.iterationsRun).toBe(300)
    expect(sessionMonolithic.iterationsRun).toBe(300)
    strategiesEqual(gameMonolithic.root as DecisionNode, gameContinued.root as DecisionNode, sessionMonolithic, sessionContinued)
  })

  it('solveCfr()自体もcreateCfrSessionを直接同じ反復数まで進めた結果とビット等価(ラッパー化による回帰がないことの確認)', () => {
    const gameViaWrapper = buildKuhnGame()
    const solution = solveCfr(gameViaWrapper, { maxIterations: 300, targetExploitability: 0, checkEveryIterations: 300 })

    const gameDirect = buildKuhnGame()
    const sessionDirect = createCfrSession(gameDirect)
    sessionDirect.advance(300)

    expect(solution.iterationsRun).toBe(300)
    const root = gameViaWrapper.root as DecisionNode
    const strat = solution.getStrategy(root)
    const stratDirect = sessionDirect.getStrategy(gameDirect.root as DecisionNode)
    for (let h = 0; h < strat.frequencies.length; h++) {
      for (let act = 0; act < strat.frequencies[h].length; act++) {
        expect(strat.frequencies[h][act]).toBeCloseTo(stratDirect.frequencies[h][act], 12)
      }
    }
    expect(solution.gameValue[0]).toBeCloseTo(sessionDirect.gameValue()[0], 12)
  })
})
