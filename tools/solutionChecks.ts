// 事前計算解(.bin)の整合性検証に使う純粋関数群。
// verify-solutions.test.ts は実データ(public/gto/solutions/)が無い環境では
// 丸ごとスキップされるため、ロジック自体は solutionChecks.test.ts の
// 合成フィクスチャで常時検証する(データの有無に依存しない担保)。

import type { DecodedSolution } from '../src/gto/loader/binaryFormat'

const utf8 = new TextEncoder()

/**
 * FORMAT.mdセクション4のレイアウトから、デコード結果が示す「あるべきバイト数」を
 * 積み上げる。実バイト数との厳密一致は、切り詰め・書きかけ・余分な末尾バイトを
 * 直接検出する。ファイルサイズの絶対下限という代理指標と違い、レンジ幅
 * (3betポットはSRPの1/5程度のコンボ数)に依存しない。
 */
export function expectedBytes(sol: DecodedSolution): number {
  // 4.1 ヘッダ
  let n = 4 + 1 + (1 + utf8.encode(sol.scenarioId).length) + 3 + 4 + 4
  // 4.2 コンボ表(OOP→IP)
  n += 2 + 2 * sol.oopCombos.length
  n += 2 + 2 * sol.ipCombos.length
  // 4.3 ノード表
  n += 2
  for (const [nodeId, node] of sol.nodes) {
    n += (1 + utf8.encode(nodeId).length) + 1 + 1
    for (const label of node.actionLabels) n += 1 + utf8.encode(label).length
    n += 4
  }
  // 4.4 データ本体(freq: u8、ev: i16)
  for (const node of sol.nodes.values()) {
    const handCount = node.player === 0 ? sol.oopCombos.length : sol.ipCombos.length
    n += node.actionLabels.length * handCount * (1 + 2)
  }
  return n
}

/**
 * nodeIdの祖先を辿り、`opponent`側がこのノードへ到達する確率をコンボごとに返す
 * (opponentが手番の祖先ノードで、実際に選ばれたアクションの頻度の積)。
 * ルートノード("")では全コンボ1.0。
 */
export function opponentReach(sol: DecodedSolution, nodeId: string, opponent: 0 | 1): Float64Array {
  const combos = opponent === 0 ? sol.oopCombos : sol.ipCombos
  const reach = new Float64Array(combos.length).fill(1)
  const labels = nodeId === '' ? [] : nodeId.split('-')
  for (let d = 0; d < labels.length; d++) {
    const ancestor = sol.nodes.get(labels.slice(0, d).join('-'))
    if (!ancestor || ancestor.player !== opponent) continue
    const ai = ancestor.actionLabels.indexOf(labels[d])
    if (ai < 0) continue
    for (let h = 0; h < combos.length; h++) reach[h] *= ancestor.freqs[ai * combos.length + h]
  }
  return reach
}

const cardKey = (c: { rank: number; suit: string }) => `${c.rank}${c.suit}`

/**
 * 手番側(`player`)の手`handIdx`から見た、相手のこのノードへの実効到達確率の総和。
 * カードが重複する相手コンボは物理的にありえないので除外する。
 *
 * 0を返す場合、そのノードはその手では到達不能=そこでのEVは未定義(0/0)であり、
 * FORMAT.md 4.5規約4のとおり無意味なプレースホルダとして扱ってよい。
 */
export function effectiveOpponentReach(
  sol: DecodedSolution,
  nodeId: string,
  player: 0 | 1,
  handIdx: number,
): number {
  const opponent: 0 | 1 = player === 0 ? 1 : 0
  const mine = player === 0 ? sol.oopCombos[handIdx] : sol.ipCombos[handIdx]
  const mineKeys = new Set([cardKey(mine[0]), cardKey(mine[1])])
  const oppCombos = opponent === 0 ? sol.oopCombos : sol.ipCombos
  const reach = opponentReach(sol, nodeId, opponent)
  let sum = 0
  for (let j = 0; j < oppCombos.length; j++) {
    if (reach[j] === 0) continue
    const [a, b] = oppCombos[j]
    if (mineKeys.has(cardKey(a)) || mineKeys.has(cardKey(b))) continue
    sum += reach[j]
  }
  return sum
}
