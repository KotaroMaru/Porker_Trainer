// NF1: 「カスタムハンド解析モード」のソルバー配線バックエンド。
//
// fullHandFlow.ts(FullHandController)は「木を辿りながらボットの手番はソルバーで解いて
// sampleAction、ユーザーの手番はUI操作を待つ」というインタラクティブな進行で1ハンドを
// 進める。こちらは逆に、他アプリ/対面プレイで見た「既に完結した1ハンドの全アクション
// 履歴」を入力として受け取り、それを木に沿って「再生」しながら同じ収穫(harvest)・
// 採点ロジック(computeStreetHarvest、fullHandFlow.tsからexport済み)へ流し込む
// バッチ処理版。UI(入力フォーム)は別タスクなので、ここでは純粋にロジックのみを扱う。
//
// フロップは事前計算済みの95局面のみ(呼び出し側=UI側がFlopDefの選択を候補一覧に
// 制限する)。ターン・リバーは任意のカードをその場でライブソルブする(制約なし)。
// ライブソルブの精度は、プレイ中のインタラクティブなbot応答用の粗いソルブ
// (TURN_PLAY_SOLVE)ではなく、非インタラクティブなこのバッチ処理では最初から
// リファイン相当の精密設定(PRECISE_LIVE_SOLVE、RIVER_PLAY_SOLVEと同値)を使う
// (プレイ中のUX最適化が不要なため、待ち時間を気にせず高精度に倒せる)。

import type { Card } from '../../engine/types'
import type { Combo } from '../../analysis/range'
import type { Scenario, FlopDef } from '../types'
import type { TreeNode, PlayerIdx } from '../solver/cfr'
import { buildStreetTree, buildTurnSubgameTree } from '../tree/actionTree'
import { rootNodeId, childNodeId } from '../tree/nodeId'
import { cardKey } from '../../engine/deck'
import { isOopPosition } from '../data/scenarios'
import { loadFlopSolution } from '../loader/solutionLoader'
import { createPrecomputedProvider } from './precomputedProvider'
import { buildPreflopScript } from './preflopScript'
import { actionInvestmentsBb, actionLabelsWithAmounts } from './actionMath'
import { initialWeightsInSolutionOrder, type HistoryEntry, type ReviewData, type ReviewDecision } from './reviewBuilder'
import type { NodeProviderFactory, StreetNodeProvider, StreetSolveInput } from './nodeDataProvider'
import { boardFromFlop, type Seat } from './gameFlow'
import { type FullHandStreet, computeStreetHarvest, filterAndRenormalize } from './fullHandFlow'

/** ユーザーが指定した1アクション。seatは0=OOP,1=IP(FullHandController/actionTree.tsと同じ規約)。 */
export interface CustomStreetAction {
  seat: Seat
  /** 木のactionLabels(buildStreetTree/buildTurnSubgameTreeが生成するラベル)と一致すること。 */
  label: string
}

export interface CustomHandInput {
  scenario: Scenario
  /** scenario向けのavailableFlopIdsに含まれる前提(呼び出し側=UI側の責務)。 */
  flop: FlopDef
  /** フロップで終わった(フォールドした)ハンドはnull。 */
  turnCard: Card | null
  /** ターンで終わった(フォールドした)ハンドはnull。 */
  riverCard: Card | null
  userSeat: Seat
  userCombo: Combo
  streetActions: {
    flop: CustomStreetAction[]
    turn: CustomStreetAction[]
    river: CustomStreetAction[]
  }
}

/**
 * fullHandFlow.tsのRecordedAction/PendingUserDecisionと同形の型(意図的に再定義)。
 * fullHandFlow.tsの変更をexport追加2箇所のみに限定するため、型自体はexportせず
 * ここで構造的に同一の型を定義し、computeStreetHarvestへ構造的部分型として渡す。
 */
interface RecordedAction {
  nodeId: string
  label: string
  actingPlayer: PlayerIdx
}

interface PendingUserDecision {
  street: FullHandStreet
  nodeId: string
  boardAtDecision: Card[]
  potBbAtDecision: number
  effectiveStackRemainingBb: number
  actionsWithAmounts: { label: string; amountBb: number }[]
  chosenLabel: string
}

/**
 * このバッチ処理は待ち時間を気にする必要がないため、プレイ中のTURN_PLAY_SOLVE
 * (粗い・高速)ではなく、fullHandFlow.tsのRIVER_PLAY_SOLVE(実質厳密解狙い)と
 * 同値の精密設定をターン・リバー両方に使う。
 */
const PRECISE_LIVE_SOLVE = { maxIterations: 300, targetExploitability: 0.005, checkEveryIterations: 50 }

interface StreetWalkResult {
  endNode: TreeNode
  actionLog: RecordedAction[]
  userDecisions: PendingUserDecision[]
  history: HistoryEntry[]
  /** このストリートで各プレイヤーが投入した累計額(bb)。次ストリートへの遷移計算に使う。 */
  streetContributed: [number, number]
}

/**
 * 指定ストリートの木のルートから、入力アクション列を順番に適用する。各アクションについて
 * 「現在の決断ノードのactingPlayerとaction.seatが一致するか」「action.labelが現ノードの
 * 選択肢に存在するか」を検証し、不一致・不正な場合は明確なエラーメッセージでthrowする。
 * 木がterminal/chanceに到達した後に余分なアクションが続く場合(フォールド後に続く
 * アクション等)も、次ループの「現ノードがdecisionでない」チェックで検出しthrowする。
 */
function applyStreetActions(params: {
  street: FullHandStreet
  rootNode: TreeNode
  actions: CustomStreetAction[]
  userSeat: Seat
  positionOf: (seat: Seat) => string
  board: Card[]
  /** このストリート開始時点の実効残りスタック(bb、両者同額)。SPR計算用。 */
  remainingStackBb: number
  /** このストリート開始時点のポット(bb)。decisionNode.potBbが省略された場合のフォールバック用。 */
  potBb: number
  /** これまでに(過去のストリートで)収穫済みの決断数。history.decisionIndexの算出に使う。 */
  harvestedDecisionCount: number
}): StreetWalkResult {
  const { street, actions, userSeat, positionOf, board, remainingStackBb, potBb, harvestedDecisionCount } = params
  let curNode: TreeNode = params.rootNode
  let curNodeId = rootNodeId()
  const actionLog: RecordedAction[] = []
  const userDecisions: PendingUserDecision[] = []
  const history: HistoryEntry[] = []
  const streetContributed: [number, number] = [0, 0]

  for (const action of actions) {
    if (curNode.kind !== 'decision') {
      throw new Error(
        `computeCustomHandReview: street "${street}" has an extra action after the hand already ended on this street ` +
          `(reached a "${curNode.kind}" node before consuming all provided actions). Offending action: seat=${action.seat}, label="${action.label}".`,
      )
    }
    const decisionNode = curNode
    if (decisionNode.player !== action.seat) {
      throw new Error(
        `computeCustomHandReview: acting-player mismatch on street "${street}" at nodeId="${curNodeId || '(root)'}": ` +
          `the tree expects actingPlayer=${decisionNode.player}, but the input action has seat=${action.seat} (label="${action.label}").`,
      )
    }
    const actionIdx = decisionNode.actionLabels.indexOf(action.label)
    if (actionIdx < 0) {
      throw new Error(
        `computeCustomHandReview: unknown action label "${action.label}" on street "${street}" at nodeId="${curNodeId || '(root)'}". ` +
          `Available labels: ${decisionNode.actionLabels.join(', ')}.`,
      )
    }

    if (action.seat === userSeat) {
      userDecisions.push({
        street,
        nodeId: curNodeId,
        boardAtDecision: board,
        potBbAtDecision: decisionNode.potBb ?? potBb,
        effectiveStackRemainingBb: remainingStackBb - streetContributed[action.seat],
        actionsWithAmounts: actionLabelsWithAmounts(decisionNode),
        chosenLabel: action.label,
      })
    }

    const investments = actionInvestmentsBb(decisionNode)
    streetContributed[action.seat] = decisionNode.contributedBb![action.seat] + investments[actionIdx]

    actionLog.push({ nodeId: curNodeId, label: action.label, actingPlayer: action.seat })
    history.push({
      street,
      position: positionOf(action.seat),
      label: action.label,
      isUserDecision: action.seat === userSeat,
      decisionIndex: action.seat === userSeat ? harvestedDecisionCount + userDecisions.length - 1 : undefined,
    })

    curNode = decisionNode.children[actionIdx]
    curNodeId = childNodeId(curNodeId, action.label)
  }

  return { endNode: curNode, actionLog, userDecisions, history, streetContributed }
}

/**
 * 他アプリ/対面プレイで見た「既に完結した1ハンド」の全アクション履歴を再生し、
 * GTO練習のレビュー画面と同じReviewDataを計算する。フロップは事前計算解、
 * ターン・リバーはproviderFactory経由でライブソルブする。
 *
 * 入力アクション列が不正(存在しないラベル、手番違反、フォールド後に続くアクション、
 * ストリートが未完のまま木がdecisionノードに留まっている等)な場合は明確なエラー
 * メッセージでthrowする。
 */
export async function computeCustomHandReview(input: CustomHandInput, providerFactory: NodeProviderFactory): Promise<ReviewData> {
  const { scenario, flop, userSeat, userCombo } = input
  const botSeat: Seat = userSeat === 0 ? 1 : 0

  const flopId = flop.cards.join('')
  const flopSolution = await loadFlopSolution(scenario.id, flopId)
  const board3 = boardFromFlop(flop)

  const oopIsRaiser = isOopPosition(scenario.raiser.position, scenario.defender.position)
  const oopRangeId = oopIsRaiser ? scenario.raiser.rangeId : scenario.defender.rangeId
  const ipRangeId = oopIsRaiser ? scenario.defender.rangeId : scenario.raiser.rangeId
  const oopPosition = oopIsRaiser ? scenario.raiser.position : scenario.defender.position
  const ipPosition = oopIsRaiser ? scenario.defender.position : scenario.raiser.position
  const positionOf = (seat: Seat): string => (seat === 0 ? oopPosition : ipPosition)

  const history: HistoryEntry[] = buildPreflopScript(scenario).map((line) => ({
    street: 'preflop' as const,
    position: line.position,
    label: `${line.action} ${line.amountBb}bb`,
    isUserDecision: false,
  }))

  let oopWeights = initialWeightsInSolutionOrder(oopRangeId, board3, flopSolution.oopCombos)
  let ipWeights = initialWeightsInSolutionOrder(ipRangeId, board3, flopSolution.ipCombos)
  let provider: StreetNodeProvider = createPrecomputedProvider(flopSolution, board3)

  const allDecisions: ReviewDecision[] = []
  let board: Card[] = board3
  let potBb = scenario.potBb
  let remainingStackBb = scenario.effectiveStackBb

  const finish = (): ReviewData => ({
    scenario,
    flop,
    board,
    userCombo,
    userPosition: positionOf(userSeat),
    botPosition: positionOf(botSeat),
    history,
    decisions: allDecisions,
  })

  try {
    // ---- フロップ ----
    const flopTree = buildStreetTree({ potBb, effectiveStackBb: remainingStackBb, firstToAct: 0 })
    const flopWalk = applyStreetActions({
      street: 'flop',
      rootNode: flopTree,
      actions: input.streetActions.flop,
      userSeat,
      positionOf,
      board,
      remainingStackBb,
      potBb,
      harvestedDecisionCount: allDecisions.length,
    })
    history.push(...flopWalk.history)
    if (flopWalk.endNode.kind === 'decision') {
      throw new Error(
        `computeCustomHandReview: street "flop" is incomplete — the provided actions do not reach the end of the betting round ` +
          `(still awaiting seat=${flopWalk.endNode.player}, options: ${flopWalk.endNode.actionLabels.join(', ')}).`,
      )
    }
    if (flopWalk.endNode.kind === 'chance') {
      throw new Error('computeCustomHandReview: internal invariant violated — buildStreetTree(flop) produced a chance node.')
    }

    const flopHarvest = await computeStreetHarvest({
      provider,
      actionLog: flopWalk.actionLog,
      userDecisions: flopWalk.userDecisions,
      initialOopWeights: oopWeights,
      initialIpWeights: ipWeights,
      userSeat,
      userCombo,
    })
    allDecisions.push(...flopHarvest.decisions)
    oopWeights = flopHarvest.oopWeights
    ipWeights = flopHarvest.ipWeights

    if (flopWalk.endNode.outcome.kind === 'fold') {
      if (input.streetActions.turn.length > 0 || input.streetActions.river.length > 0) {
        throw new Error('computeCustomHandReview: the hand ended by fold on the flop, but turn/river streetActions are non-empty.')
      }
      provider.dispose()
      return finish()
    }

    // フロップのベッティング完了(フォールドなし) -> ターンへ遷移する。
    if (input.turnCard === null) {
      throw new Error('computeCustomHandReview: flop betting completed without a fold, but input.turnCard is null (a turn card must be dealt).')
    }
    potBb += flopWalk.streetContributed[0] + flopWalk.streetContributed[1]
    remainingStackBb -= Math.max(flopWalk.streetContributed[0], flopWalk.streetContributed[1])

    const turnCardKey = cardKey(input.turnCard)
    const filteredOopForTurn = filterAndRenormalize(provider.oopCombos, oopWeights, turnCardKey)
    const filteredIpForTurn = filterAndRenormalize(provider.ipCombos, ipWeights, turnCardKey)
    provider.dispose()
    board = [...board, input.turnCard]
    oopWeights = filteredOopForTurn.weights
    ipWeights = filteredIpForTurn.weights

    const turnSolveInput: StreetSolveInput = {
      street: 'turn',
      board,
      oopCombos: filteredOopForTurn.combos,
      oopReach: filteredOopForTurn.weights,
      ipCombos: filteredIpForTurn.combos,
      ipReach: filteredIpForTurn.weights,
      potBb,
      effectiveStackBb: remainingStackBb,
      ...PRECISE_LIVE_SOLVE,
    }
    provider = providerFactory.forLiveStreet(turnSolveInput)

    // ---- ターン ----
    const turnTree = buildTurnSubgameTree({ turnPotBb: potBb, effectiveStackBb: remainingStackBb, firstToAct: 0, deadCards: board })
    const turnWalk = applyStreetActions({
      street: 'turn',
      rootNode: turnTree,
      actions: input.streetActions.turn,
      userSeat,
      positionOf,
      board,
      remainingStackBb,
      potBb,
      harvestedDecisionCount: allDecisions.length,
    })
    history.push(...turnWalk.history)
    if (turnWalk.endNode.kind === 'decision') {
      throw new Error(
        `computeCustomHandReview: street "turn" is incomplete — the provided actions do not reach the end of the betting round ` +
          `(still awaiting seat=${turnWalk.endNode.player}, options: ${turnWalk.endNode.actionLabels.join(', ')}).`,
      )
    }

    const turnHarvest = await computeStreetHarvest({
      provider,
      actionLog: turnWalk.actionLog,
      userDecisions: turnWalk.userDecisions,
      initialOopWeights: oopWeights,
      initialIpWeights: ipWeights,
      userSeat,
      userCombo,
    })
    allDecisions.push(...turnHarvest.decisions)
    oopWeights = turnHarvest.oopWeights
    ipWeights = turnHarvest.ipWeights

    if (turnWalk.endNode.kind === 'terminal') {
      // buildTurnSubgameTreeは非フォールドのterminalを全てchanceノードへ変換済みのため、
      // ここに来る場合は必ずfold。
      if (turnWalk.endNode.outcome.kind !== 'fold') {
        throw new Error('computeCustomHandReview: internal invariant violated — unexpected terminal(showdown) at the turn subgame tree top level.')
      }
      if (input.streetActions.river.length > 0) {
        throw new Error('computeCustomHandReview: the hand ended by fold on the turn, but river streetActions are non-empty.')
      }
      provider.dispose()
      return finish()
    }

    // turnWalk.endNode.kind === 'chance': ターンのベッティング完了(フォールドなし) -> リバーへ遷移する。
    // D1と同じく、埋め込みのリバー分岐(chanceノードのchildren)は使わず、確定したリバーカードで
    // 単独再構築・単独再ソルブする。
    if (input.riverCard === null) {
      throw new Error('computeCustomHandReview: turn betting completed without a fold, but input.riverCard is null (a river card must be dealt).')
    }
    potBb += turnWalk.streetContributed[0] + turnWalk.streetContributed[1]
    remainingStackBb -= Math.max(turnWalk.streetContributed[0], turnWalk.streetContributed[1])

    const riverCardKey = cardKey(input.riverCard)
    const filteredOopForRiver = filterAndRenormalize(provider.oopCombos, oopWeights, riverCardKey)
    const filteredIpForRiver = filterAndRenormalize(provider.ipCombos, ipWeights, riverCardKey)
    provider.dispose()
    board = [...board, input.riverCard]
    oopWeights = filteredOopForRiver.weights
    ipWeights = filteredIpForRiver.weights

    const riverSolveInput: StreetSolveInput = {
      street: 'river',
      board,
      oopCombos: filteredOopForRiver.combos,
      oopReach: filteredOopForRiver.weights,
      ipCombos: filteredIpForRiver.combos,
      ipReach: filteredIpForRiver.weights,
      potBb,
      effectiveStackBb: remainingStackBb,
      ...PRECISE_LIVE_SOLVE,
    }
    provider = providerFactory.forLiveStreet(riverSolveInput)

    // ---- リバー ----
    const riverTree = buildStreetTree({ potBb, effectiveStackBb: remainingStackBb, firstToAct: 0 })
    const riverWalk = applyStreetActions({
      street: 'river',
      rootNode: riverTree,
      actions: input.streetActions.river,
      userSeat,
      positionOf,
      board,
      remainingStackBb,
      potBb,
      harvestedDecisionCount: allDecisions.length,
    })
    history.push(...riverWalk.history)
    if (riverWalk.endNode.kind === 'decision') {
      throw new Error(
        `computeCustomHandReview: street "river" is incomplete — the provided actions do not reach the end of the betting round ` +
          `(still awaiting seat=${riverWalk.endNode.player}, options: ${riverWalk.endNode.actionLabels.join(', ')}).`,
      )
    }
    if (riverWalk.endNode.kind === 'chance') {
      throw new Error('computeCustomHandReview: internal invariant violated — buildStreetTree(river) produced a chance node.')
    }

    const riverHarvest = await computeStreetHarvest({
      provider,
      actionLog: riverWalk.actionLog,
      userDecisions: riverWalk.userDecisions,
      initialOopWeights: oopWeights,
      initialIpWeights: ipWeights,
      userSeat,
      userCombo,
    })
    allDecisions.push(...riverHarvest.decisions)

    // riverWalk.endNode(fold または showdown)いずれでもハンドはここで終了する。
    // ReviewDataは勝敗/純損益を持たない(HandResultとは別物)ため、fold/showdownの
    // 区別自体はここでは不要。
    provider.dispose()
    return finish()
  } finally {
    providerFactory.dispose()
  }
}
