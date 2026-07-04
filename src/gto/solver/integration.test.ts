import { describe, it, expect } from 'vitest'
import { solveCfr } from './cfr'
import type { CfrGame, DecisionNode } from './cfr'
import { scoreComboOnBoard } from './handEval'
import { buildStreetTree, collectDecisions } from '../tree/actionTree'
import { expandHandStr } from '../../analysis/range'
import type { Card } from '../../engine/types'
import type { Combo } from '../../analysis/range'

function comboCards(combo: Combo): string[] {
  return combo.map((c) => `${c.rank}${c.suit}`)
}

// ============================================================
// 統合テスト: actionTree(ベッティングツリー構築) + handEval(ハンド評価) +
// cfr(DCFRソルバー) を実際の小さなポーカーサブゲームで結合して動作確認する。
// 個別ユニットテストでは検証できない「実際のレンジ・ボード・ツリーの組み合わせ」
// でエンドツーエンドに動くことを確認するのが目的(収束の理論値検証はKuhn/river
// トイスポットで既に行っているため、ここでは疎通と健全性のみを見る)。
// ============================================================

describe('統合テスト: 実際のポーカーサブゲームをactionTree+handEval+cfrで解く', () => {
  it('小さなレンジ・固定ボードでexploitabilityが収束し、戦略が正しい形状(0..1の頻度)になる', () => {
    const board: Card[] = [
      { rank: 13, suit: 'c' }, // Kc
      { rank: 7, suit: 'd' }, // 7d
      { rank: 2, suit: 'h' }, // 2h
    ]

    // 小さなレンジ(それぞれ数ハンド)をコンボに展開し、ボードと重複するものを除外
    const heroRangeHands = ['AA', 'KQs', '72s']
    const villainRangeHands = ['QQ', 'JTs', '86s']
    const deadCards = board

    function expandExcludingDead(hands: string[]): Combo[] {
      const combos: Combo[] = []
      for (const h of hands) {
        for (const combo of expandHandStr(h)) {
          const usesDeadCard = combo.some((c) =>
            deadCards.some((d) => d.rank === c.rank && d.suit === c.suit),
          )
          if (!usesDeadCard) combos.push(combo)
        }
      }
      return combos
    }

    const heroCombos = expandExcludingDead(heroRangeHands)
    const villainCombos = expandExcludingDead(villainRangeHands)
    expect(heroCombos.length).toBeGreaterThan(0)
    expect(villainCombos.length).toBeGreaterThan(0)

    const tree = buildStreetTree({ potBb: 6, effectiveStackBb: 20, firstToAct: 1 })
    const decisions = collectDecisions(tree)
    expect(decisions.length).toBeGreaterThan(0)

    const boardKeys = board.map((c) => `${c.rank}${c.suit}`)
    const game: CfrGame<Combo> = {
      root: tree,
      players: [
        { hands: heroCombos, initialReach: heroCombos.map(() => 1), cards: comboCards },
        { hands: villainCombos, initialReach: villainCombos.map(() => 1), cards: comboCards },
      ],
      score: (combo) => scoreComboOnBoard(combo, boardKeys),
    }

    const solution = solveCfr(game, { maxIterations: 300, targetExploitability: 0.01, checkEveryIterations: 50 })

    // 収束の絶対値までは主張しないが、有限で非負・妥当な範囲であることを確認
    expect(Number.isFinite(solution.exploitability)).toBe(true)
    expect(solution.exploitability).toBeGreaterThanOrEqual(0)
    expect(solution.exploitability).toBeLessThan(1) // pot比1.0(=100%)未満、爆発していない

    // 全ての決断ノードで、平均戦略の各手の頻度が0..1・合計1になっている
    for (const node of decisions) {
      const strat = solution.getStrategy(node)
      for (const row of strat.frequencies) {
        const sum = row.reduce((a, b) => a + b, 0)
        expect(sum).toBeCloseTo(1, 3)
        for (const freq of row) {
          expect(freq).toBeGreaterThanOrEqual(-1e-9)
          expect(freq).toBeLessThanOrEqual(1 + 1e-9)
        }
      }
    }

    // AA(ヒーローの最強ハンド)はvsQQ以下のレンジに対して積極的にベットに寄るはず
    const rootNode = tree as DecisionNode
    const aaCombo = heroCombos.find((c) => c[0].rank === 14 && c[1].rank === 14)
    expect(aaCombo).toBeDefined()
    if (aaCombo) {
      const aaIdx = heroCombos.indexOf(aaCombo)
      const rootStrat = solution.getStrategy(rootNode)
      const checkFreq = rootStrat.frequencies[aaIdx][0] // action 0 = 'check'(firstToAct=1がroot player)
      expect(checkFreq).toBeLessThan(1) // 常にチェックだけということはない(ある程度ベットに出る)
    }
  })
})
