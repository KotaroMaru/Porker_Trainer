// P4 Step 1: フロップ単発スポットのゲーム状態機械。engine/game.tsとは独立
// (HU専用・ソルバー抽象ツリーと厳密一致する合法アクションのみを扱う)。
//
// フロップ街のみを対象とする(単発モード=最初のユーザー決断で停止)。
// player0=OOP, player1=IPで統一する(FORMAT.md/Rust側のnodeId.player規約と揃える)。

import { buildStreetTree } from '../tree/actionTree'
import type { DecisionNode } from '../solver/cfr'
import { rootNodeId, childNodeId } from '../tree/nodeId'
import type { DecodedSolution, DecodedNode } from '../loader/binaryFormat'
import type { Scenario } from '../types'
import type { FlopDef } from '../types'
import type { Card } from '../../engine/types'
import type { Combo } from '../../analysis/range'
import { isOopPosition } from '../data/scenarios'
import { dealHands } from './dealer'
import { sampleAction } from './botPolicy'
import { buildComboIndexMapFromCombos, lookupComboIndex } from './comboIndex'
import { gradeDecision, type GradeResult } from './grading'
import { actionLabelsWithAmounts } from './actionMath'

/** userSeatと同じく0=OOP,1=IP。 */
export type Seat = 0 | 1

export interface BotActionLogEntry {
  nodeId: string
  label: string
}

export interface SpotState {
  scenario: Scenario
  flop: FlopDef
  solution: DecodedSolution
  userSeat: Seat
  userCombo: Combo
  botCombo: Combo
  /** ユーザーの決断ノード(TS木本体。actionLabelsWithAmounts等に渡す)。 */
  decisionNode: DecisionNode
  /** 同じ決断ノードのGTO戦略/EV(事前計算解)。 */
  decodedNode: DecodedNode
  nodeId: string
  /** ユーザーの手番に至るまでのボットのアクション(単発モードでは高々1件)。 */
  botActionsBefore: BotActionLogEntry[]
  /** アクション+bb換算額(ボタン表示用)。decodedNode.actionLabelsと同じ順序。 */
  actionsWithAmounts: { label: string; amountBb: number }[]
}

function boardFromFlop(flop: FlopDef): Card[] {
  return flop.cards.map((key) => {
    const rankStr = key.slice(0, -1)
    const suit = key.slice(-1) as Card['suit']
    const rank = (rankStr === 'A' ? 14 : rankStr === 'K' ? 13 : rankStr === 'Q' ? 12 : rankStr === 'J' ? 11 : rankStr === 'T' ? 10 : Number(rankStr)) as Card['rank']
    return { rank, suit }
  })
}

/**
 * シナリオ+フロップ+事前計算解から1スポットを組み立てる。ボットの手番は解の
 * 戦略からサンプルして自動進行し、ユーザーの最初の決断で停止する。
 * userSeatは0(OOP)か1(IP)。solutionはこのscenario+flopに対応するものであること。
 */
export function createSpot(scenario: Scenario, flop: FlopDef, solution: DecodedSolution, userSeat: Seat, rng: () => number): SpotState {
  const oopIsRaiser = isOopPosition(scenario.raiser.position, scenario.defender.position)
  const oopRangeId = oopIsRaiser ? scenario.raiser.rangeId : scenario.defender.rangeId
  const ipRangeId = oopIsRaiser ? scenario.defender.rangeId : scenario.raiser.rangeId

  const board = boardFromFlop(flop)
  const { oopCombo, ipCombo } = dealHands(oopRangeId, ipRangeId, board, rng)
  const userCombo = userSeat === 0 ? oopCombo : ipCombo
  const botCombo = userSeat === 0 ? ipCombo : oopCombo
  const botSeat: Seat = userSeat === 0 ? 1 : 0

  const oopComboIndex = buildComboIndexMapFromCombos(solution.oopCombos)
  const ipComboIndex = buildComboIndexMapFromCombos(solution.ipCombos)

  const tree = buildStreetTree({ potBb: scenario.potBb, effectiveStackBb: scenario.effectiveStackBb, firstToAct: 0 })

  let node = tree
  let nodeId = rootNodeId()
  const botActionsBefore: BotActionLogEntry[] = []

  // ボットの手番を自動進行し、ユーザーの手番(node.player === userSeat)で停止する。
  for (;;) {
    if (node.kind !== 'decision') {
      throw new Error(`createSpot: reached non-decision node before user's turn (nodeId=${nodeId}, kind=${node.kind})`)
    }
    // const束縛に固定して、以下のクロージャ(.some)内でもナローイングを保つ。
    const decisionNode: DecisionNode = node
    const decodedNode = solution.nodes.get(nodeId)
    if (!decodedNode) {
      throw new Error(`createSpot: no solution data for nodeId="${nodeId}" (scenario/tree mismatch?)`)
    }
    // TS木とRust解のノード形状は独立に構築されているため、暗黙に一致すると仮定せず
    // 都度検証する(P4中間レビューで指摘: 抽象が将来変わった際に静かに壊れるのを防ぐ)。
    if (decodedNode.player !== decisionNode.player) {
      throw new Error(
        `createSpot: player mismatch at nodeId="${nodeId}" (tree=${decisionNode.player}, solution=${decodedNode.player})`,
      )
    }
    if (
      decodedNode.actionLabels.length !== decisionNode.actionLabels.length ||
      decodedNode.actionLabels.some((label, i) => label !== decisionNode.actionLabels[i])
    ) {
      throw new Error(
        `createSpot: actionLabels mismatch at nodeId="${nodeId}" (tree=[${decisionNode.actionLabels}], solution=[${decodedNode.actionLabels}])`,
      )
    }

    if (decisionNode.player === userSeat) {
      return {
        scenario,
        flop,
        solution,
        userSeat,
        userCombo,
        botCombo,
        decisionNode,
        decodedNode,
        nodeId,
        botActionsBefore,
        actionsWithAmounts: actionLabelsWithAmounts(decisionNode),
      }
    }

    // ボットの手番: 解の戦略からサンプルして進める。子ノードはインデックスではなく
    // ラベルで引く(上のassertでラベル順序の一致は保証済みだが、参照経路を
    // インデックスの暗黙一致に依存させないため)。
    const botCombIdx = botSeat === 0 ? lookupComboIndex(oopComboIndex, botCombo) : lookupComboIndex(ipComboIndex, botCombo)
    const sampled = sampleAction(decodedNode, botCombIdx, rng)
    const childIndex = decisionNode.actionLabels.indexOf(sampled.label)
    if (childIndex < 0) {
      throw new Error(`createSpot: sampled label "${sampled.label}" not found in tree actionLabels at nodeId="${nodeId}"`)
    }
    botActionsBefore.push({ nodeId, label: sampled.label })
    node = decisionNode.children[childIndex]
    nodeId = childNodeId(nodeId, sampled.label)
  }
}

/** ユーザーのアクション選択を採点する。 */
export function applyUserAction(spot: SpotState, chosenLabel: string): GradeResult {
  const indexMap = buildComboIndexMapFromCombos(spot.userSeat === 0 ? spot.solution.oopCombos : spot.solution.ipCombos)
  const comboIdx = lookupComboIndex(indexMap, spot.userCombo)
  return gradeDecision(spot.decodedNode, comboIdx, chosenLabel)
}
