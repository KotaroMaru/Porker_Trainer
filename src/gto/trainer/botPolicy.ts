// P4 Step 1: ボット(GTO戦略サンプリング)。DecodedNodeの頻度(action-major)から、
// 指定コンボの手番アクションを重み付きで1つ選ぶ。

import type { DecodedNode } from '../loader/binaryFormat'

export interface SampledAction {
  label: string
  actionIndex: number
}

/** ノードの戦略頻度から、指定コンボ(comboIdx)のアクションを1つ重み付きサンプルする。 */
export function sampleAction(node: DecodedNode, comboIdx: number, rng: () => number): SampledAction {
  const handCount = node.freqs.length / node.actionLabels.length
  const freqs: number[] = node.actionLabels.map((_, a) => node.freqs[a * handCount + comboIdx])
  const total = freqs.reduce((a, b) => a + b, 0)
  if (total <= 0) {
    throw new Error(`sampleAction: all-zero strategy for comboIdx=${comboIdx} (hand likely has zero range weight at this node)`)
  }
  let r = rng() * total
  for (let a = 0; a < freqs.length; a++) {
    r -= freqs[a]
    if (r <= 0) return { label: node.actionLabels[a], actionIndex: a }
  }
  return { label: node.actionLabels[node.actionLabels.length - 1], actionIndex: node.actionLabels.length - 1 }
}
