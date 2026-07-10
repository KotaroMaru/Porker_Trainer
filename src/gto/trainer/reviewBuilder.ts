// P5 Step B1: SpotState+GradeResultから、レビュー画面が必要とする「決断のリスト」形式の
// データを構築する。P5では常にdecisions.length===1(フロップ単発の1決断)だが、P6の通し
// モード(複数決断)にそのまま拡張できるよう、最初からリスト形式で設計する。
//
// 中核の責務は「そのノードに到達した時点での両者のレンジ重み(解のコンボ順序に整列済み)」を
// 再構築すること。expandWeightedRange(プリフロップレンジの展開)の出力順序は解の
// コンボ表(oopCombos/ipCombos)と一致しないため、initialWeightsInSolutionOrderが
// その変換を一箇所に集約する。以後の全モジュール(features.ts等)は「解コンボ順序の
// 配列」だけを受け渡し、文字列キーのMapを境界から排除する。

import type { Card } from '../../engine/types'
import type { Combo } from '../../analysis/range'
import { rankName } from '../../engine/deck'
import type { Scenario, FlopDef } from '../types'
import type { DecodedNode } from '../loader/binaryFormat'
import type { SpotState, Seat } from './gameFlow'
import { boardFromFlop } from './gameFlow'
import type { GradeResult } from './grading'
import { updateRangeWeights } from './rangeTracker'
import { expandWeightedRange } from './weightedRange'
import { buildComboIndexMapFromCombos, comboRustKey } from './comboIndex'
import { buildPreflopScript } from './preflopScript'
import { isOopPosition } from '../data/scenarios'
import { rootNodeId, childNodeId, parseNodeId } from '../tree/nodeId'

export interface HistoryEntry {
  street: 'preflop' | 'flop' // P6: 'turn'|'river'を追加
  position: string
  /** 表示用ラベル。preflopは"レイズ 2.5bb"のように既にJapanese整形済み、flopは
   *  "bet33"等の生アクションラベル(UI側でACTION_LABEL_JAを通して翻訳する)。 */
  label: string
  isUserDecision: boolean
  /** isUserDecision===trueのときのみ: decisions[]への添字。 */
  decisionIndex?: number
}

export interface ReviewDecision {
  street: 'flop'
  nodeId: string
  /** 0=OOP, 1=IP。この決断の手番だったプレイヤー(=ユーザー)。 */
  seat: Seat
  chosenLabel: string
  grading: GradeResult
  /** decisionNode.potBb(この決断時点でのポット、bb)。 */
  potBbAtDecision: number
  /** SPR計算用: このストリート開始時の実効スタック - この決断時点までにseat側が投入した額。 */
  effectiveStackRemainingBb: number
  actionsWithAmounts: { label: string; amountBb: number }[]
  decodedNode: DecodedNode
  /** 解コンボ順序・正規化済み(合計1)。 */
  heroCombos: Combo[]
  heroWeights: number[]
  villainCombos: Combo[]
  villainWeights: number[]
  /** ユーザーの各選択肢について、相手がその後どう応答するかのノード。
   *  fold/コール締め等でノードが存在しない(terminal)選択肢は含まれない。 */
  responseNodes: { forLabel: string; nodeId: string; node: DecodedNode }[]
}

export interface ReviewData {
  scenario: Scenario
  flop: FlopDef
  board: Card[]
  userCombo: Combo
  userPosition: string
  botPosition: string
  /** プリフロップ台本+フロップのボット行動+ユーザー決断、を時系列で並べたもの。 */
  history: HistoryEntry[]
  /** P5は常にlength===1。P6の通しモードで複数決断に拡張される。 */
  decisions: ReviewDecision[]
}

/** [Ah,Kh]→'AKs', [Qs,Qd]→'QQ', [Ac,Kd]→'AKo'。RangeSetGrid.cellHandと同じ表記規約。 */
export function handStrFromCombo(combo: Combo): string {
  const [a, b] = combo
  const hi = a.rank >= b.rank ? a : b
  const lo = a.rank >= b.rank ? b : a
  if (hi.rank === lo.rank) return `${rankName(hi.rank)}${rankName(lo.rank)}`
  const suited = hi.suit === lo.suit
  return `${rankName(hi.rank)}${rankName(lo.rank)}${suited ? 's' : 'o'}`
}

/**
 * レンジID(preflopRanges.json)を、指定ボードで展開した上で解のコンボ表(solutionCombos)の
 * 並び順に再配置した重み配列にする(合計1に正規化済み)。解にあるがレンジ展開に無い
 * コンボの重みは0のまま。
 */
export function initialWeightsInSolutionOrder(rangeId: string, board: Card[], solutionCombos: readonly Combo[]): number[] {
  const { combos, weights } = expandWeightedRange(rangeId, board)
  const indexMap = buildComboIndexMapFromCombos(solutionCombos)
  const out = new Array(solutionCombos.length).fill(0)
  for (let i = 0; i < combos.length; i++) {
    const idx = indexMap.get(comboRustKey(combos[i]))
    if (idx === undefined) continue // 解のコンボ表に無い(理論上は起こらないが安全側)
    out[idx] = weights[i]
  }
  const total = out.reduce((sum: number, w: number) => sum + w, 0)
  if (total <= 0) {
    throw new Error(`initialWeightsInSolutionOrder: rangeId="${rangeId}" produced zero total weight against solution combo table`)
  }
  return out.map((w: number) => w / total)
}

/**
 * ルートから targetNodeId までのアクション履歴を辿り、各アクションで「行動した側」の
 * レンジ重みを updateRangeWeights で逐次更新する。戻り値は targetNodeId 到達時点
 * (=その決断の直前)でのOOP/IP両者のレンジ重み(解コンボ順序・正規化済み)。
 */
export function weightsAtNode(spot: SpotState, targetNodeId: string): { oopWeights: number[]; ipWeights: number[] } {
  const { scenario, solution } = spot
  const oopIsRaiser = isOopPosition(scenario.raiser.position, scenario.defender.position)
  const oopRangeId = oopIsRaiser ? scenario.raiser.rangeId : scenario.defender.rangeId
  const ipRangeId = oopIsRaiser ? scenario.defender.rangeId : scenario.raiser.rangeId
  const board: Card[] = solution.flop

  let oopWeights = initialWeightsInSolutionOrder(oopRangeId, board, solution.oopCombos)
  let ipWeights = initialWeightsInSolutionOrder(ipRangeId, board, solution.ipCombos)

  let prefix = rootNodeId()
  for (const label of parseNodeId(targetNodeId)) {
    const node = solution.nodes.get(prefix)
    if (!node) throw new Error(`weightsAtNode: no solution node at prefix "${prefix}"`)
    const handCount = node.player === 0 ? solution.oopCombos.length : solution.ipCombos.length
    const actionIdx = node.actionLabels.indexOf(label)
    if (actionIdx < 0) throw new Error(`weightsAtNode: action "${label}" not found at node "${prefix}" (expected one of ${node.actionLabels.join(',')})`)
    const freqsForAction: number[] = []
    for (let h = 0; h < handCount; h++) freqsForAction.push(node.freqs[actionIdx * handCount + h])

    if (node.player === 0) oopWeights = updateRangeWeights(oopWeights, freqsForAction)
    else ipWeights = updateRangeWeights(ipWeights, freqsForAction)

    prefix = childNodeId(prefix, label)
  }

  return { oopWeights, ipWeights }
}

/** SpotState+採点結果から、ReviewScreenが必要とするReviewDataを構築する。 */
export function buildReview(spot: SpotState, grading: GradeResult, chosenLabel: string): ReviewData {
  const { scenario, flop, solution, userSeat, userCombo, decodedNode, decisionNode, nodeId, botActionsBefore, actionsWithAmounts } = spot

  const oopIsRaiser = isOopPosition(scenario.raiser.position, scenario.defender.position)
  const oopPosition = oopIsRaiser ? scenario.raiser.position : scenario.defender.position
  const ipPosition = oopIsRaiser ? scenario.defender.position : scenario.raiser.position
  const userPosition = userSeat === 0 ? oopPosition : ipPosition
  const botPosition = userSeat === 0 ? ipPosition : oopPosition

  const board = boardFromFlop(flop)

  const history: HistoryEntry[] = buildPreflopScript(scenario).map((line) => ({
    street: 'preflop' as const,
    position: line.position,
    label: `${line.action} ${line.amountBb}bb`,
    isUserDecision: false,
  }))
  for (const entry of botActionsBefore) {
    history.push({ street: 'flop', position: botPosition, label: entry.label, isUserDecision: false })
  }
  history.push({ street: 'flop', position: userPosition, label: chosenLabel, isUserDecision: true, decisionIndex: 0 })

  const { oopWeights, ipWeights } = weightsAtNode(spot, nodeId)
  const heroCombos = userSeat === 0 ? solution.oopCombos : solution.ipCombos
  const heroWeights = userSeat === 0 ? oopWeights : ipWeights
  const villainCombos = userSeat === 0 ? solution.ipCombos : solution.oopCombos
  const villainWeights = userSeat === 0 ? ipWeights : oopWeights

  const responseNodes: ReviewDecision['responseNodes'] = []
  for (const label of decodedNode.actionLabels) {
    const childId = childNodeId(nodeId, label)
    const node = solution.nodes.get(childId)
    if (node) responseNodes.push({ forLabel: label, nodeId: childId, node })
  }

  const potBbAtDecision = decisionNode.potBb ?? scenario.potBb
  const contributedBb = decisionNode.contributedBb ?? [0, 0]
  const effectiveStackRemainingBb = scenario.effectiveStackBb - contributedBb[userSeat]

  const decision: ReviewDecision = {
    street: 'flop',
    nodeId,
    seat: userSeat,
    chosenLabel,
    grading,
    potBbAtDecision,
    effectiveStackRemainingBb,
    actionsWithAmounts,
    decodedNode,
    heroCombos,
    heroWeights,
    villainCombos,
    villainWeights,
    responseNodes,
  }

  return {
    scenario,
    flop,
    board,
    userCombo,
    userPosition,
    botPosition,
    history,
    decisions: [decision],
  }
}
