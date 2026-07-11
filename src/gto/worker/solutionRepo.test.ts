import { describe, it, expect } from 'vitest'
import { solveCfr } from '../solver/cfr'
import { extractDecisionEvs } from '../solver/nodeEvs'
import { buildTurnSubgameTree } from '../tree/actionTree'
import { buildNodeIndex, nodeDataAt } from './solutionRepo'
import type { CfrGame, DecisionNode } from '../solver/cfr'
import type { Card } from '../../engine/types'
import type { Combo } from '../../analysis/range'

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit }
}

function comboCards(combo: Combo): string[] {
  return combo.map((c) => `${c.rank}${c.suit}`)
}

// 極小のターン部分ゲーム(各サイド2コンボ)を低イテレーションで解き、
// buildNodeIndex/nodeDataAtの変換ロジックを検証する。実際のWorker配線
// (solverWorker.ts)はjsdomで動かせないため、ここではsolutionRepo.tsの
// 純関数部分だけをNode環境でテストする。
describe('solutionRepo', () => {
  // ボードKc Jc 2d + ターンTs、深いスタックにはしない(木を小さく保つ)。
  const board4: Card[] = [card(13, 'c'), card(11, 'c'), card(2, 'd'), card(10, 's')]
  const oopCombos: Combo[] = [
    [card(14, 'h'), card(14, 's')], // AhAs
    [card(9, 'd'), card(9, 'h')], // 9d9h
  ]
  const ipCombos: Combo[] = [
    [card(8, 'h'), card(7, 'h')], // 8h7h
    [card(6, 'd'), card(5, 'd')], // 6d5d
  ]

  function buildGame(): { game: CfrGame<Combo>; tree: ReturnType<typeof buildTurnSubgameTree> } {
    const tree = buildTurnSubgameTree({
      turnPotBb: 5.5,
      effectiveStackBb: 20, // 浅いスタックで木を小さく保つ
      firstToAct: 0,
      deadCards: board4,
    })
    const game: CfrGame<Combo> = {
      root: tree,
      players: [
        { hands: oopCombos, initialReach: [1, 1], cards: comboCards },
        { hands: ipCombos, initialReach: [1, 1], cards: comboCards },
      ],
      score: (combo, boardKeys) => {
        // テスト用の単純化されたスコア(実際のhandEval.scoreComboOnBoardは
        // このテストの主眼(索引構築・データ変換)には不要な複雑さを持ち込むため、
        // ランクの高い方が強いという単純な順序関数で代用する)。
        void boardKeys
        return Math.max(combo[0].rank, combo[1].rank)
      },
    }
    return { game, tree }
  }

  it('buildNodeIndexがルート決断ノードを含み、getStrategyで頻度が引ける', () => {
    const { game, tree } = buildGame()
    const solution = solveCfr(game, { maxIterations: 20, targetExploitability: 0.05, checkEveryIterations: 10 })
    const index = buildNodeIndex(tree)

    expect(index.has('')).toBe(true)
    const root = index.get('')!
    const strat = solution.getStrategy(root)
    expect(strat.frequencies.length).toBe(oopCombos.length) // root.player===0=OOP
  })

  it('nodeDataAtがDecodedNode形状(action-major freqs、行和=1)を返す', () => {
    const { game, tree } = buildGame()
    const solution = solveCfr(game, { maxIterations: 20, targetExploitability: 0.05, checkEveryIterations: 10 })
    const index = buildNodeIndex(tree)
    const getAvgStrategy = (node: DecisionNode) => solution.getStrategy(node).frequencies
    const evs = extractDecisionEvs(game, getAvgStrategy)

    const rootData = nodeDataAt(index, solution.getStrategy, evs, '')
    expect(rootData).not.toBeNull()
    expect(rootData!.player).toBe(0)
    const handCount = oopCombos.length
    for (let h = 0; h < handCount; h++) {
      let sum = 0
      for (let a = 0; a < rootData!.actionLabels.length; a++) sum += rootData!.freqs[a * handCount + h]
      expect(sum).toBeCloseTo(1, 5)
    }
    expect(rootData!.evsBb.length).toBe(rootData!.actionLabels.length * handCount)
  })

  it('nodeDataAtのEVレイアウトはextractDecisionEvsの出力と一致する', () => {
    const { game, tree } = buildGame()
    const solution = solveCfr(game, { maxIterations: 20, targetExploitability: 0.05, checkEveryIterations: 10 })
    const index = buildNodeIndex(tree)
    const getAvgStrategy = (node: DecisionNode) => solution.getStrategy(node).frequencies
    const evs = extractDecisionEvs(game, getAvgStrategy)

    const root = index.get('')!
    const rootData = nodeDataAt(index, solution.getStrategy, evs, '')!
    const directEvs = evs.get(root)!
    expect(Array.from(rootData.evsBb)).toEqual(Array.from(directEvs))
  })

  it('存在しないnodeId(terminal等)にはnullを返す', () => {
    const { game, tree } = buildGame()
    const solution = solveCfr(game, { maxIterations: 20, targetExploitability: 0.05, checkEveryIterations: 10 })
    const index = buildNodeIndex(tree)
    const evs = extractDecisionEvs(
      game,
      (node) => solution.getStrategy(node).frequencies,
    )

    // 'check-check'のような、terminalに到達する組み合わせはindexに存在しない
    const result = nodeDataAt(index, solution.getStrategy, evs, 'check-check-check-check-check-check-check-check-check-check')
    expect(result).toBeNull()
  })

  it('チャンス区間(ターン後のリバー分岐)のnodeIdはcard:<cardKey>規約で辿れる', () => {
    const { tree } = buildGame()
    const index = buildNodeIndex(tree)
    // buildNodeIndexはterminal直前で止まるため、少なくとも1つはcard:を含むキーが
    // 存在するはず(リバーの決断ノードへの経路には必ずチャンス区間を経由する)。
    const hasChanceSegment = [...index.keys()].some((k) => k.includes('card:'))
    expect(hasChanceSegment).toBe(true)
  })
})
