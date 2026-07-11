// P6 Step B2: solveCfrの解(平均戦略)から、決断ノードごとに「手番側の手ごと・
// アクションごとの条件付き期待値(bb)」を抽出する。
//
// solveCfrはNodeStrategy(頻度)のみを返し、per-hand EVは計算しない。採点
// (grading.gradeDecision)はRust事前計算パイプラインのDecodedNode.evsBb
// (action-major Float32Array、条件付きper-hand bb)を前提に書かれているため、
// TS自前ソルバー(ターン/リバーのライブソルブ、P6)でも同じ形状のEVを供給する
// 必要がある。
//
// exploitability.tsのselfPlayValue内部のdecisionValueは、各アクションを
// 取った場合の反実仮想値ベクトル(childValues)を計算した上でstrategy加重平均
// (v0/v1)だけを返して破棄している。本モジュールはselfPlayValueと全く同じ
// walk構造を複製し、decisionValueの内部で計算されるchildValues[a][acting][h]
// (アクションaを取った場合の手hの反実仮想値、reach加重・ブロッキング除外込みの
// 生の合計)を、conditionalGameValueと同じ正規化(手ごとに非ブロック相手reach和
// で除算)でMapへ記録する。

import type { CfrGame, DecisionNode, TreeNode, TerminalNode, PlayerIdx, EvalCache } from './cfr'
import { blockedByCard, handsBlock, createEvalCache } from './cfr'
import { computeShowdownValue, computeFoldValue } from './terminalEval'
import type { StrategyProvider } from './exploitability'

/**
 * ゲームを平均戦略でself-play walkし、各決断ノードについて手番側の手ごと・
 * アクションごとの条件付き期待値(bb)をaction-majorのFloat32Arrayで返す。
 * 正規化式: evBb[a*handCount+h] = childValues[a][acting][h] / effOppReach(h)
 * (effOppReach(h) = hとブロックしない相手コンボのreach和。Rust .binのevsBb
 * 規約=条件付きper-hand bbと一致させる)。
 */
export function extractDecisionEvs<Hand>(game: CfrGame<Hand>, getAvgStrategy: StrategyProvider, evalCache?: EvalCache): Map<DecisionNode, Float32Array> {
  const [uni0, uni1] = game.players
  const n0 = uni0.hands.length
  const n1 = uni1.hands.length
  const cards0 = uni0.hands.map(uni0.cards)
  const cards1 = uni1.hands.map(uni1.cards)
  const blocked01: boolean[][] = cards0.map((c0) => cards1.map((c1) => handsBlock(c0, c1)))
  const blocked10: boolean[][] = Array.from({ length: n1 }, (_, h1) => Array.from({ length: n0 }, (_, h0) => blocked01[h0][h1]))
  const cache = evalCache ?? createEvalCache(game)
  const [blockCtx0, blockCtx1] = cache.blockCtx
  const getScoreContexts = cache.getScoreContexts

  const result = new Map<DecisionNode, Float32Array>()

  function terminalValue(node: TerminalNode, reach0: Float64Array, reach1: Float64Array): [Float64Array, Float64Array] {
    const [c0, c1] = node.contributed
    if (node.outcome.kind === 'fold') {
      const { foldedPlayer } = node.outcome
      const net0 = foldedPlayer === 1 ? node.potBb - c0 : -c0
      const net1 = foldedPlayer === 0 ? node.potBb - c1 : -c1
      return [computeFoldValue(blockCtx0, reach1, net0), computeFoldValue(blockCtx1, reach0, net1)]
    }
    const [scoreCtx0, scoreCtx1] = getScoreContexts(node)
    return [computeShowdownValue(scoreCtx0, blockCtx0, reach1, node.potBb, c0), computeShowdownValue(scoreCtx1, blockCtx1, reach0, node.potBb, c1)]
  }

  function chanceValue(node: Extract<TreeNode, { kind: 'chance' }>, reach0: Float64Array, reach1: Float64Array): [Float64Array, Float64Array] {
    const v0 = new Float64Array(n0)
    const v1 = new Float64Array(n1)
    const cnt0 = new Float64Array(n0)
    const cnt1 = new Float64Array(n1)
    for (let bi = 0; bi < node.cards.length; bi++) {
      const card = node.cards[bi]
      const child = node.children[bi]
      const childReach0 = new Float64Array(n0)
      const childReach1 = new Float64Array(n1)
      for (let h0 = 0; h0 < n0; h0++) childReach0[h0] = blockedByCard(cards0[h0], card) ? 0 : reach0[h0]
      for (let h1 = 0; h1 < n1; h1++) childReach1[h1] = blockedByCard(cards1[h1], card) ? 0 : reach1[h1]
      const [cv0, cv1] = walk(child, childReach0, childReach1)
      for (let h0 = 0; h0 < n0; h0++) {
        if (!blockedByCard(cards0[h0], card)) {
          v0[h0] += cv0[h0]
          cnt0[h0] += 1
        }
      }
      for (let h1 = 0; h1 < n1; h1++) {
        if (!blockedByCard(cards1[h1], card)) {
          v1[h1] += cv1[h1]
          cnt1[h1] += 1
        }
      }
    }
    for (let h0 = 0; h0 < n0; h0++) if (cnt0[h0] > 0) v0[h0] /= cnt0[h0]
    for (let h1 = 0; h1 < n1; h1++) if (cnt1[h1] > 0) v1[h1] /= cnt1[h1]
    return [v0, v1]
  }

  function decisionValue(node: DecisionNode, reach0: Float64Array, reach1: Float64Array): [Float64Array, Float64Array] {
    const acting: PlayerIdx = node.player
    const actionCount = node.actionLabels.length
    const strategy = getAvgStrategy(node)
    const childValues: [Float64Array, Float64Array][] = []
    for (let a = 0; a < actionCount; a++) {
      if (acting === 0) {
        const newReach0 = new Float64Array(n0)
        for (let h = 0; h < n0; h++) newReach0[h] = reach0[h] * strategy[h][a]
        childValues.push(walk(node.children[a], newReach0, reach1))
      } else {
        const newReach1 = new Float64Array(n1)
        for (let h = 0; h < n1; h++) newReach1[h] = reach1[h] * strategy[h][a]
        childValues.push(walk(node.children[a], reach0, newReach1))
      }
    }

    // EV記録: actingの手ごとの非ブロック相手reach和(effOppReach)でchildValuesを正規化する。
    const actingHandCount = acting === 0 ? n0 : n1
    const otherReach = acting === 0 ? reach1 : reach0
    const blockedActingOther = acting === 0 ? blocked01 : blocked10
    const evs = new Float32Array(actionCount * actingHandCount)
    for (let h = 0; h < actingHandCount; h++) {
      let effOppReach = 0
      const blockedRow = blockedActingOther[h]
      for (let ho = 0; ho < otherReach.length; ho++) {
        if (!blockedRow[ho]) effOppReach += otherReach[ho]
      }
      for (let a = 0; a < actionCount; a++) {
        const raw = childValues[a][acting][h]
        evs[a * actingHandCount + h] = effOppReach > 0 ? raw / effOppReach : 0
      }
    }
    result.set(node, evs)

    const v0 = new Float64Array(n0)
    const v1 = new Float64Array(n1)
    if (acting === 0) {
      for (let h = 0; h < n0; h++) {
        let val = 0
        for (let a = 0; a < actionCount; a++) val += strategy[h][a] * childValues[a][0][h]
        v0[h] = val
      }
      for (let h1 = 0; h1 < n1; h1++) {
        let val = 0
        for (let a = 0; a < actionCount; a++) val += childValues[a][1][h1]
        v1[h1] = val
      }
    } else {
      for (let h = 0; h < n1; h++) {
        let val = 0
        for (let a = 0; a < actionCount; a++) val += strategy[h][a] * childValues[a][1][h]
        v1[h] = val
      }
      for (let h0 = 0; h0 < n0; h0++) {
        let val = 0
        for (let a = 0; a < actionCount; a++) val += childValues[a][0][h0]
        v0[h0] = val
      }
    }
    return [v0, v1]
  }

  function walk(node: TreeNode, reach0: Float64Array, reach1: Float64Array): [Float64Array, Float64Array] {
    if (node.kind === 'terminal') return terminalValue(node, reach0, reach1)
    if (node.kind === 'chance') return chanceValue(node, reach0, reach1)
    return decisionValue(node, reach0, reach1)
  }

  const reach0 = new Float64Array(uni0.initialReach)
  const reach1 = new Float64Array(uni1.initialReach)
  walk(game.root, reach0, reach1)

  return result
}
