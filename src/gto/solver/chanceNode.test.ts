import { describe, it, expect } from 'vitest'
import { solveCfr } from './cfr'
import type { CfrGame, TreeNode, ChanceNode } from './cfr'

// ============================================================
// チャンスノード(次のカードを配る)のカード除去(ブロッキング)ロジックの検証。
// Kuhnポーカーは配札が1回きりで決断ノードのみのため、チャンスノードのコードパスを
// 一切通らない。ここでは決断ノードなし・チャンスノード→ショーダウンのみの
// 最小の木を使い、期待値を手計算で独立に導出して照合する。
//
// 設定: 5枚のカード {a,b,c,d,e}。
//   ヒーローの手: A(カード'a'を保有) / B(カード'b'を保有)。reach=[1,1]。
//   相手の手:     H1(カード'c'を保有) / H2(カード'd'を保有)。reach=[1,1]。
//   ヒーロー・相手のカードは互いに重複しない(手同士のブロッキングは発生しない)ため、
//   このテストは「チャンスノードでのカード除去」のみを単独で検証できる。
//   チャンスノードは{a,b,c,d,e}の5枚から1枚を配る(pot=2, 追加ベットなしでショーダウン)。
//   compare: A vs H1=勝ち, A vs H2=負け, B vs H1=引き分け, B vs H2=負け。
//
// 反実仮想値(v0_raw、CFRの内部値)を手計算で導出:
//   v0_raw(A): Aは自分のカード'a'が配られる分岐を除外し、残り4分岐{b,c,d,e}で平均。
//     分岐b(誰もブロックしない): reach1=[1,1] → 1*2(勝ち) + 1*0(負け) = 2
//     分岐c(H1をブロック):       reach1=[0,1] → 0        + 1*0        = 0
//     分岐d(H2をブロック):       reach1=[1,0] → 1*2       + 0          = 2
//     分岐e(誰もブロックしない): reach1=[1,1] → 1*2       + 1*0        = 2
//     平均 = (2+0+2+2)/4 = 1.5
//   v0_raw(B): Bは自分のカード'b'の分岐を除外し、残り{a,c,d,e}で平均。
//     分岐a: reach1=[1,1] → 1*1(引分=pot/2)+1*0 = 1
//     分岐c: reach1=[0,1] → 0                 +1*0 = 0
//     分岐d: reach1=[1,0] → 1*1                +0   = 1
//     分岐e: reach1=[1,1] → 1*1                +1*0 = 1
//     平均 = (1+0+1+1)/4 = 0.75
//
// 手同士のブロッキングがないため、A・Bどちらの相手レンジも常にeffectiveOppReach=2
// (H1+H2の初期reach合計)。よって正しく正規化したゲーム値:
//   gameValue0 = [1*(1.5/2) + 1*(0.75/2)] / 2 = [0.75+0.375]/2 = 0.5625
// ============================================================

type Hero = 'A' | 'B'
type Villain = 'H1' | 'H2'

const HERO_CARD: Record<Hero, string> = { A: 'a', B: 'b' }
const VILLAIN_CARD: Record<Villain, string> = { H1: 'c', H2: 'd' }
// compare()はcfr.ts内部でv1計算時に引数順が入れ替わって呼ばれる(相手の手, 自分の手)ため、
// 引数の順序に依存しない対称な比較関数である必要がある。全ハンドを1本の強さスケールに
// 割り当てることで実現する: H2(3) > A(2) > H1=B(1) が
// 「A vs H1=勝ち, A vs H2=負け, B vs H1=引分, B vs H2=負け」を満たす。
const STRENGTH: Record<Hero | Villain, number> = { H2: 3, A: 2, H1: 1, B: 1 }

function buildTree(): ChanceNode {
  const cards = ['a', 'b', 'c', 'd', 'e']
  return {
    kind: 'chance',
    cards,
    children: cards.map(() => ({
      kind: 'terminal',
      potBb: 2,
      contributed: [0, 0],
      outcome: { kind: 'showdown' },
    })),
  }
}

const ALL_CARDS: Record<Hero | Villain, string> = { ...HERO_CARD, ...VILLAIN_CARD }

function buildGame(): CfrGame<Hero | Villain> {
  const heroUniverse = { hands: ['A', 'B'] as Hero[], initialReach: [1, 1], cards: (h: Hero | Villain) => [ALL_CARDS[h]] }
  const villainUniverse = { hands: ['H1', 'H2'] as Villain[], initialReach: [1, 1], cards: (h: Hero | Villain) => [ALL_CARDS[h]] }
  return {
    root: buildTree() as TreeNode,
    players: [heroUniverse, villainUniverse],
    score: (h) => STRENGTH[h],
  }
}

describe('チャンスノードのカード除去(ブロッキング)ロジック', () => {
  it('決断ノードなし(チャンス→ショーダウンのみ)のゲーム値が手計算した期待値と一致する', () => {
    const game = buildGame()
    // 決断ノードが無いため反復は不要だが、solveCfrのAPIをそのまま使う(1回で確定する)
    const solution = solveCfr(game, { maxIterations: 1 })
    expect(solution.gameValue[0]).toBeCloseTo(0.5625, 6)
  })
})
