// P6 Step B3: Worker内で保持する解(戦略+EV)から、要求されたノードだけを
// DecodedNode形状(Rust事前計算パイプラインと同じ形)に変換する。全ノードの
// 戦略をpostMessageで丸ごとシリアライズしていた旧実装(潜在的性能バグ、
// ターン部分ゲームで約11kノード)を廃止し、収穫パターン(D2)に置き換える
// ための土台。純関数のみで構成し、Node環境でテストできる(Worker本体は
// jsdomで動かせないため、実際のWorker配線はsolverWorker.tsで行う)。

import type { TreeNode, DecisionNode } from '../solver/cfr'
import { rootNodeId, childNodeId } from '../tree/nodeId'
import type { DecodedNode } from '../loader/binaryFormat'

/** 木を辿ってnodeId→DecisionNodeの索引を構築する(チャンス区間はcard:<cardKey>規約、既存serializeStrategiesと同じ)。 */
export function buildNodeIndex(root: TreeNode): Map<string, DecisionNode> {
  const index = new Map<string, DecisionNode>()
  function walk(node: TreeNode, nodeId: string): void {
    if (node.kind === 'terminal') return
    if (node.kind === 'decision') {
      index.set(nodeId, node)
      node.children.forEach((child, i) => walk(child, childNodeId(nodeId, node.actionLabels[i])))
      return
    }
    node.children.forEach((child, i) => walk(child, childNodeId(nodeId, `card:${node.cards[i]}`)))
  }
  walk(root, rootNodeId())
  return index
}

/**
 * 指定nodeIdの決断ノードを、DecodedNode形状(action-major Float32Array)に変換する。
 * 木に存在しないnodeId(terminal・チャンス区間で実在しないカード等)はnullを返す。
 * evsにそのノードのエントリが無い場合(nodeEvs.extractDecisionEvsの走査対象外=
 * 到達不能なノード)は全0のEVを返す。
 */
export function nodeDataAt(
  index: Map<string, DecisionNode>,
  getStrategy: (node: DecisionNode) => { actionLabels: string[]; frequencies: number[][] },
  evs: Map<DecisionNode, Float32Array>,
  nodeId: string,
): DecodedNode | null {
  const node = index.get(nodeId)
  if (!node) return null

  const strat = getStrategy(node)
  const handCount = strat.frequencies.length
  const actionCount = strat.actionLabels.length
  const freqs = new Float32Array(actionCount * handCount)
  for (let h = 0; h < handCount; h++) {
    for (let a = 0; a < actionCount; a++) {
      freqs[a * handCount + h] = strat.frequencies[h][a]
    }
  }
  const evsBb = evs.get(node) ?? new Float32Array(actionCount * handCount)

  return {
    player: node.player,
    actionLabels: strat.actionLabels,
    freqs,
    evsBb,
  }
}
