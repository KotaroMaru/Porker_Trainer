import { describe, it, expect } from 'vitest'
import { solveCfr, createCfrSession } from './cfr'
import type { CfrGame, TreeNode, DecisionNode, TerminalNode } from './cfr'

// ============================================================
// リバートイスポット: ポラライズドベッター vs ブラフキャッチャー。
// GTOのベットサイジング理論における最も基本的な教科書スポットで、解析解が既知。
//
// 設定: ポットpot=1、ベットサイズbet=0.5(s=bet/pot=0.5)。
//   ベッター(player0)のレンジ: バリュー(value, 常にショーダウンで勝つ) V コンボ
//                              ブラフ(bluff, 常にショーダウンで負ける)   B コンボ (V=B=2)
//   コーラー(player1)のレンジ: ブラフキャッチャー(bluffcatcher, valueには負けbluffには勝つ) C コンボ
//   カードは重複しない抽象的な手として扱う(ブロッカー効果なしの教科書設定)。
//
// 既知の解析解(標準的なGTOのベットサイジング理論、V=Bのとき):
//   バリューは常にベット(頻度100%): ベットは弱いレンジに対して常に強い側の支配戦略
//   ブラフのベット頻度 β = s/(1+s) = 0.5/1.5 = 1/3
//     (コーラーが「コール/フォールドどちらでも無差別」になるようベッターが調整する頻度)
//   コーラーのコール頻度(MDF) = 1/(1+s) = 1/1.5 = 2/3
//     (ベッターの「ブラフしてもチェックしても無差別」になるようコーラーが調整する頻度)
// ============================================================

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
    children: [
      terminal(POT + BET, [BET, 0], { kind: 'fold', foldedPlayer: 1 }),
      terminal(POT + 2 * BET, [BET, BET], { kind: 'showdown' }),
    ],
  }
  return {
    kind: 'decision',
    player: 0,
    actionLabels: ['check', 'bet'],
    children: [
      terminal(POT, [0, 0], { kind: 'showdown' }),
      afterBet,
    ],
  }
}

function buildGame(): CfrGame<Bettor | Caller> {
  const bettorUniverse = {
    hands: ['value', 'bluff'] as Bettor[],
    initialReach: [2, 2], // V=B=2コンボ
    cards: () => [] as string[], // ブロッカーなしの教科書設定
  }
  const callerUniverse = {
    hands: ['bluffcatcher'] as Caller[],
    initialReach: [2],
    cards: () => [] as string[],
  }
  // compare()はcfr.ts内部でv1計算時に引数順が入れ替わって(相手の手,自分の手)呼ばれるため、
  // 引数順序に依存しない対称な比較関数にする必要がある。value > bluffcatcher > bluff の
  // 1本の強さスケールに割り当てる(値そのものに意味はなく、大小関係のみが使われる)。
  const STRENGTH: Record<Bettor | Caller, number> = { value: 2, bluffcatcher: 1, bluff: 0 }
  return {
    root: buildTree(),
    players: [bettorUniverse, callerUniverse],
    score: (h) => STRENGTH[h],
  }
}

describe('リバートイスポット: ポラライズドベッター vs ブラフキャッチャー', () => {
  it('バリューは常にベットする(支配戦略)', () => {
    const game = buildGame()
    const solution = solveCfr(game, { maxIterations: 2000, targetExploitability: 0.0005, checkEveryIterations: 50 })
    const root = game.root as DecisionNode
    const strat = solution.getStrategy(root)
    const valueIdx = game.players[0].hands.indexOf('value')
    expect(strat.frequencies[valueIdx][1]).toBeGreaterThan(0.97) // bet
  })

  it('ブラフのベット頻度が理論値 s/(1+s)=1/3 に一致する', () => {
    const game = buildGame()
    const solution = solveCfr(game, { maxIterations: 2000, targetExploitability: 0.0005, checkEveryIterations: 50 })
    const root = game.root as DecisionNode
    const strat = solution.getStrategy(root)
    const bluffIdx = game.players[0].hands.indexOf('bluff')
    const s = BET / POT
    const expected = s / (1 + s)
    expect(strat.frequencies[bluffIdx][1]).toBeGreaterThan(expected - 0.03)
    expect(strat.frequencies[bluffIdx][1]).toBeLessThan(expected + 0.03)
  })

  it('コーラーのコール頻度(MDF)が理論値 1/(1+s)=2/3 に一致する', () => {
    const game = buildGame()
    const solution = solveCfr(game, { maxIterations: 2000, targetExploitability: 0.0005, checkEveryIterations: 50 })
    const tree = game.root as DecisionNode
    const afterBet = tree.children[1] as DecisionNode
    const strat = solution.getStrategy(afterBet)
    const s = BET / POT
    const expectedCallFreq = 1 / (1 + s)
    expect(strat.frequencies[0][1]).toBeGreaterThan(expectedCallFreq - 0.03) // call
    expect(strat.frequencies[0][1]).toBeLessThan(expectedCallFreq + 0.03)
  })

  it('exploitabilityが1e-3未満に収束する', () => {
    const game = buildGame()
    const solution = solveCfr(game, { maxIterations: 2000, targetExploitability: 0.0005, checkEveryIterations: 50 })
    expect(solution.exploitability).toBeLessThan(1e-3)
  })

  // P9-1: Kuhnポーカーだけでなく実際のポストフロップ部分ゲーム構造(ベット/コール/フォールドの
  // 木)でも、再開可能セッションのウォームスタート等価性(cfr.test.tsの主ゲート)が
  // 成立することを別ゲームで確認する。
  it('P9-1: 60反復まで進めてから140反復継続した解(ウォームスタート)は、一気に200反復した解と一致する', () => {
    const gameContinued = buildGame()
    const sessionContinued = createCfrSession(gameContinued)
    sessionContinued.advance(60)
    sessionContinued.advance(140)

    const gameMonolithic = buildGame()
    const sessionMonolithic = createCfrSession(gameMonolithic)
    sessionMonolithic.advance(200)

    const rootContinued = gameContinued.root as DecisionNode
    const rootMonolithic = gameMonolithic.root as DecisionNode
    const stratContinued = sessionContinued.getStrategy(rootContinued)
    const stratMonolithic = sessionMonolithic.getStrategy(rootMonolithic)
    for (let h = 0; h < stratContinued.frequencies.length; h++) {
      for (let a = 0; a < stratContinued.frequencies[h].length; a++) {
        expect(stratContinued.frequencies[h][a]).toBeCloseTo(stratMonolithic.frequencies[h][a], 12)
      }
    }
    expect(sessionContinued.gameValue()[0]).toBeCloseTo(sessionMonolithic.gameValue()[0], 12)
  })
})
