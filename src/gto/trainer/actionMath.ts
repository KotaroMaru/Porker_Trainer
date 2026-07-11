// P4 Step 1: 決断ノードの各アクションについて、bb換算の追加投入額を求める。
// actionTree.tsのDecisionNode/TerminalNodeが持つpotBb/contributed(Bb)を直接使うだけで
// (33/75/55%サイジングのロジックを再実装しない)、常にツリー本体と整合する値を返す。

import type { DecisionNode, PlayerIdx, TreeNode } from '../solver/cfr'

/** ノードkindを問わず、指定プレイヤーの「この時点までの投入累計額(bb)」を取り出す。 */
function contributedAt(node: TreeNode, player: PlayerIdx): number | undefined {
  if (node.kind === 'terminal') return node.contributed[player]
  if (node.kind === 'decision') return node.contributedBb?.[player]
  // ChanceNode: buildTurnSubgameTreeのリバー展開でのみ出現。前のストリートの
  // ベッティング完了時点の投入額をcontributedとして刻印済み(actionTree.ts参照)。
  return node.contributed?.[player]
}

/**
 * 決断ノードの各アクションについて、そのアクションを選んだ場合の追加投入額(bb)を返す。
 * actionLabelsと同じ順序・同じ長さの配列。check/foldは常に0。
 * potBb/contributedBbが無いノード(トイゲーム由来)を渡した場合はエラー。
 */
export function actionInvestmentsBb(node: DecisionNode): number[] {
  if (node.potBb === undefined || node.contributedBb === undefined) {
    throw new Error('actionInvestmentsBb requires a DecisionNode built by actionTree.ts (potBb/contributedBb missing)')
  }
  const before = node.contributedBb[node.player]
  return node.children.map((child) => {
    const after = contributedAt(child, node.player)
    if (after === undefined) {
      throw new Error(`cannot determine contributed amount for child of kind ${child.kind}`)
    }
    return after - before
  })
}

/** 表示用に、アクションラベルと追加投入額(bb)をまとめたペアの配列を返す。 */
export function actionLabelsWithAmounts(node: DecisionNode): { label: string; amountBb: number }[] {
  const amounts = actionInvestmentsBb(node)
  return node.actionLabels.map((label, i) => ({ label, amountBb: amounts[i] }))
}
