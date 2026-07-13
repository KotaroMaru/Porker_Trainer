// P6 Step B5: 通しモード(フロップ→ターン→リバー、即時採点なし→終了後レビュー)の
// マルチストリート状態機械。gameFlow.ts(単発モード、フロップ単発)は無変更のまま
// 維持し、これは独立した新規コントローラとして追加する。
//
// 設計(マスタープランD1〜D5):
// - 各ストリートはローカルに構築した木(buildStreetTree、ターンのみ
//   buildTurnSubgameTree)を辿る。ターンはリバー継続込みの部分ゲームとして
//   ソルブする(EVの精度向上のため)が、リバーの実際のカードが確定した時点で
//   その埋め込みブランチ(chanceノード配下)は使わず、更新済みレンジ+確定
//   ボードで別途単独再ソルブする(<0.5秒・実質厳密解を狙う設計、D1)
// - ノードデータ(戦略+EV)はStreetNodeProvider(nodeDataProvider.ts)経由で
//   取得する。ボットの決断にはproviderの解が必須(D1不変条件)だが、ユーザーの
//   決断は木構造だけで即座に可能(採点は通しモードでは終了後にまとめて行う
//   ため、決断の瞬間に解が揃っている必要はない)
// - レンジの引き継ぎ(D4)は「そのストリートの全アクションを後から再生して
//   updateRangeWeightsを逐次適用する」方式。ストリート終端(ベッティング完了=
//   showdown終端 or リバーへのchanceノード)で初めてprovider.readyを待ち、
//   このストリートで visited した決断ノードをまとめて収穫(harvest)する
// - 採点(D5)はハンド終了時にまとめて行う。プレイ中の即時採点はしない
// - 各ストリートの投入額はツリーノードの型(terminal/chance)によって持っている
//   フィールドが異なる(ChanceNodeはcontributedを持たない)ため、ツリーの
//   フィールドを読み取るのではなく、行動のたびにactionInvestmentsBbで
//   差分を計算しコントローラ自身がstreetContributedとして追跡する

import type { Card } from '../../engine/types'
import type { Combo } from '../../analysis/range'
import type { Scenario, FlopDef } from '../types'
import type { DecodedSolution } from '../loader/binaryFormat'
import type { TreeNode, DecisionNode, PlayerIdx } from '../solver/cfr'
import { buildStreetTree, buildTurnSubgameTree } from '../tree/actionTree'
import { rootNodeId, childNodeId } from '../tree/nodeId'
import { createDeck, cardKey } from '../../engine/deck'
import { evaluate } from '../../engine/evaluator'
import { isOopPosition, preflopContribPerPlayerBb } from '../data/scenarios'
import { dealHands } from './dealer'
import { sampleAction } from './botPolicy'
import { buildComboIndexMapFromCombos, lookupComboIndex } from './comboIndex'
import { updateRangeWeights } from './rangeTracker'
import { gradeDecision, type GradeResult, type GradeVerdict } from './grading'
import { actionInvestmentsBb, actionLabelsWithAmounts } from './actionMath'
import { buildPreflopScript } from './preflopScript'
import { boardFromFlop, type Seat } from './gameFlow'
import { initialWeightsInSolutionOrder, type HistoryEntry, type ReviewData, type ReviewDecision } from './reviewBuilder'
import type { NodeProviderFactory, StreetNodeProvider, StreetSolveInput } from './nodeDataProvider'
import { createPrecomputedProvider } from './precomputedProvider'

export type FullHandStreet = 'flop' | 'turn' | 'river'
export type HandPhase = 'userTurn' | 'botDeciding' | 'grading' | 'over'

export interface DecisionSummary {
  street: FullHandStreet
  chosenLabel: string
  verdict: GradeVerdict
  evLossBb: number
}

export interface HandResult {
  endedBy: 'fold' | 'showdown'
  foldedSeat?: Seat
  /** ハンド全体(プリフロップ投資込み)の純損益、ユーザー視点。 */
  userNetBb: number
  finalPotBb: number
  finalBoard: Card[]
  /** ショーダウン到達時のみ開示。フォールドで終わった場合はnull。 */
  botCombo: Combo | null
  decisionSummaries: DecisionSummary[]
}

export interface FullHandSnapshot {
  phase: HandPhase
  street: FullHandStreet
  board: Card[]
  potBb: number
  /** botDeciding中のライブソルブ進捗(0..1)。それ以外はnull。 */
  solveProgress: number | null
  /** userTurn中のみ意味を持つ。 */
  actionsWithAmounts: { label: string; amountBb: number }[]
  history: HistoryEntry[]
  result: HandResult | null
  /**
   * P7-6b: ハンド終了後、ターンをバックグラウンド精密再ソルブ中かどうか。result確定後
   * (phase==='over')のみtrueになりうる。完了するとfalseに戻り、resultのdecisionSummaries
   * (とgetReview()が返す該当決断)が精密値に差し替わっている。
   */
  refining: boolean
  /**
   * 現在のストリートで各プレイヤーが直近に取ったアクション(0〜2件、行動した順ではなく
   * 常にOOP→IP順)。P7-2: プレイ中の場(フェルト)表示専用(「BB ベット4.1bb」等)。
   * HistoryEntry/ブックマークcodecには含めない非永続の表示専用データ。
   */
  latestActions: { position: string; label: string; amountBb: number; isUser: boolean }[]

  // 以下はハンド全体で不変(構築時に確定)。毎emitで同じ値を含めることで、
  // UI層(PlayScreen等)がFullHandSnapshotだけを見ればプレイ画面を組み立てられるようにする
  // (gameFlow.tsのSpotStateがscenario/flop/userComboを直接持つのと同じ設計方針)。
  scenario: Scenario
  flop: FlopDef
  userSeat: Seat
  userCombo: Combo
  userPosition: string
  botPosition: string
}

export interface FullHandControllerDeps {
  scenario: Scenario
  flop: FlopDef
  flopSolution: DecodedSolution
  userSeat: Seat
  rng: () => number
  providerFactory: NodeProviderFactory
  onUpdate: (snap: FullHandSnapshot) => void
  /** advance()中の想定外エラー(通常は発生しない)を通知する。 */
  onError?: (err: Error) => void
}

interface RecordedAction {
  nodeId: string
  label: string
  actingPlayer: PlayerIdx
}

interface LatestAction {
  label: string
  amountBb: number
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
 * P7-6b: ターン(プレイ用の粗いソルブで通過した街)をハンド終了後に精密再ソルブ・
 * 再収穫するための素材。transitionToNextStreet/finalizeFold/finalizeShowdownが
 * ターンの収穫(harvestStreet)を行う直前に退避する(harvestStreetはstreetActionLog等を
 * クリアしてしまうため)。decisionStartIdxはリファイン後の決断をthis.decisionsの
 * どこに差し戻すかを示す。
 */
interface StreetRefineMaterial {
  solveInput: StreetSolveInput
  actionLog: RecordedAction[]
  userDecisions: PendingUserDecision[]
  initialOopWeights: number[]
  initialIpWeights: number[]
  decisionStartIdx: number
}

const NEAR_ZERO_BB = 1e-6

/**
 * P7-6a/P8-2: プレイ中にボットが行動するために必要な最低限の粗さでターンをソルブする
 * (UX優先度①「計算待ちを最小に」)。実測(checkEveryIterations=25のベンチ)で
 * iter25=典型~3.8秒(4.0%)、iter50=~7.4秒(2.0%)、iter75=~11秒(1.2%)。
 * P8-2でcfr.tsに両者リーチ全ゼロの無損失プルーニングを追加したが、この規模の
 * ターン部分ゲームでは効果が薄く(~2〜5%改善)、実用的な待ち時間短縮には不十分と
 * 判明した。そのためmaxIterationsを75→50に引き下げ、絶対的な最悪ケースを
 * ~11秒→~7.4秒へ短縮する(典型ケースはcheckEveryIterations=25の時点で既に
 * targetExploitability付近まで収束していることが多く、実質的な影響は小さい)。
 * 採点の精度はハンド終了後のバックグラウンド精密リファイン(REFINE_SOLVE、P7-6b)で
 * 別途補う(UX優先度②)。ボット行動の品質はここでは最下位優先度③として明示的に妥協する。
 */
const TURN_PLAY_SOLVE = { maxIterations: 50, targetExploitability: 0.04, checkEveryIterations: 25 }
/** リバーは木が小さくソルブが高速なため、プレイ時から精密な収束のままでよい。 */
const RIVER_PLAY_SOLVE = { maxIterations: 300, targetExploitability: 0.005, checkEveryIterations: 50 }
/**
 * P7-6b: ハンド終了後、Workerが暇になった時点でターンをバックグラウンド精密再ソルブする
 * ときの設定(UX優先度②「答え合わせをできるだけ正確に」)。従来の即時ソルブ版と同じ
 * 収束目標(0.5%)にすることで、最終的な採点精度は変えない。
 */
const REFINE_SOLVE = { maxIterations: 300, targetExploitability: 0.005, checkEveryIterations: 50 }

/** weight>0のコンボからdeadCardと衝突するものを除いて再正規化する(ターン/リバーへの遷移時に使う)。 */
function filterAndRenormalize(combos: readonly Combo[], weights: readonly number[], deadCardKey: string): { combos: Combo[]; weights: number[] } {
  const outCombos: Combo[] = []
  const outWeights: number[] = []
  for (let i = 0; i < combos.length; i++) {
    if (weights[i] <= 0) continue
    if (cardKey(combos[i][0]) === deadCardKey || cardKey(combos[i][1]) === deadCardKey) continue
    outCombos.push(combos[i])
    outWeights.push(weights[i])
  }
  const total = outWeights.reduce((a, b) => a + b, 0)
  if (total <= 0) throw new Error(`filterAndRenormalize: all combos excluded by dead card ${deadCardKey}`)
  return { combos: outCombos, weights: outWeights.map((w) => w / total) }
}

function dealCardExcluding(usedCards: readonly Card[], rng: () => number): Card {
  const usedKeys = new Set(usedCards.map(cardKey))
  const remaining = createDeck().filter((c) => !usedKeys.has(cardKey(c)))
  if (remaining.length === 0) throw new Error('dealCardExcluding: deck exhausted')
  const idx = Math.min(Math.floor(rng() * remaining.length), remaining.length - 1)
  return remaining[idx]
}

/**
 * ある街で記録された行動列とユーザー決断を、指定のprovider(解の出所)を使って
 * レンジ重み更新+ReviewDecision組み立てまで行う純粋寄りの処理。FullHandControllerの
 * harvestStreet(プレイ中、instance stateを直接読み書き)と、P7-6bのリファイン
 * (ハンド終了後、別providerで同じ処理を再実行)の両方から共用する(プランの
 * 「収穫ロジックの共通化」)。
 */
async function computeStreetHarvest(params: {
  provider: StreetNodeProvider
  actionLog: RecordedAction[]
  userDecisions: PendingUserDecision[]
  initialOopWeights: number[]
  initialIpWeights: number[]
  userSeat: Seat
  userCombo: Combo
}): Promise<{ decisions: ReviewDecision[]; oopWeights: number[]; ipWeights: number[] }> {
  const { provider, actionLog, userDecisions, userSeat, userCombo } = params
  await provider.ready
  const nodeIdsToFetch = new Set<string>()
  for (const a of actionLog) nodeIdsToFetch.add(a.nodeId)
  for (const d of userDecisions) {
    for (const a of d.actionsWithAmounts) nodeIdsToFetch.add(childNodeId(d.nodeId, a.label))
  }
  const fetched = await provider.getNodes([...nodeIdsToFetch])

  const oopCombos = provider.oopCombos
  const ipCombos = provider.ipCombos
  let oopW = params.initialOopWeights
  let ipW = params.initialIpWeights

  const snapshots = new Map<string, { heroWeights: number[]; villainWeights: number[] }>()
  const userDecisionNodeIds = new Set(userDecisions.map((d) => d.nodeId))

  for (const action of actionLog) {
    if (userDecisionNodeIds.has(action.nodeId) && !snapshots.has(action.nodeId)) {
      const heroWeights = userSeat === 0 ? [...oopW] : [...ipW]
      const villainWeights = userSeat === 0 ? [...ipW] : [...oopW]
      snapshots.set(action.nodeId, { heroWeights, villainWeights })
    }
    const decoded = fetched.get(action.nodeId)
    if (!decoded) throw new Error(`computeStreetHarvest: missing decodedNode for nodeId="${action.nodeId}"`)
    const handCount = decoded.player === 0 ? oopCombos.length : ipCombos.length
    const actionIdx = decoded.actionLabels.indexOf(action.label)
    if (actionIdx < 0) throw new Error(`computeStreetHarvest: action "${action.label}" not found at nodeId="${action.nodeId}"`)
    const freqRow: number[] = []
    for (let h = 0; h < handCount; h++) freqRow.push(decoded.freqs[actionIdx * handCount + h])
    if (decoded.player === 0) oopW = updateRangeWeights(oopW, freqRow)
    else ipW = updateRangeWeights(ipW, freqRow)
  }

  const decisions: ReviewDecision[] = []
  for (const d of userDecisions) {
    const decodedNode = fetched.get(d.nodeId)
    if (!decodedNode) throw new Error(`computeStreetHarvest: missing decodedNode for user decision nodeId="${d.nodeId}"`)
    const snap = snapshots.get(d.nodeId)
    if (!snap) throw new Error(`computeStreetHarvest: missing weight snapshot for user decision nodeId="${d.nodeId}"`)

    const heroCombos = userSeat === 0 ? oopCombos : ipCombos
    const villainCombos = userSeat === 0 ? ipCombos : oopCombos

    const responseNodes: ReviewDecision['responseNodes'] = []
    for (const label of decodedNode.actionLabels) {
      const childId = childNodeId(d.nodeId, label)
      const node = fetched.get(childId)
      if (node) responseNodes.push({ forLabel: label, nodeId: childId, node })
    }

    const comboIdx = lookupComboIndex(buildComboIndexMapFromCombos(heroCombos), userCombo)
    const grading: GradeResult = gradeDecision(decodedNode, comboIdx, d.chosenLabel)

    decisions.push({
      street: d.street,
      nodeId: d.nodeId,
      seat: userSeat,
      boardAtDecision: d.boardAtDecision,
      chosenLabel: d.chosenLabel,
      grading,
      potBbAtDecision: d.potBbAtDecision,
      effectiveStackRemainingBb: d.effectiveStackRemainingBb,
      actionsWithAmounts: d.actionsWithAmounts,
      decodedNode,
      heroCombos: heroCombos as Combo[],
      heroWeights: snap.heroWeights,
      villainCombos: villainCombos as Combo[],
      villainWeights: snap.villainWeights,
      responseNodes,
    })
  }

  return { decisions, oopWeights: oopW, ipWeights: ipW }
}

/**
 * 通しモード(フロップ→ターン→リバー)のマルチストリート状態機械。
 * 1インスタンス=1ハンド。ハンド終了(phase='over')まで使い切りで、次のハンドは
 * 新しいインスタンスを作る(store.ts側の責務)。
 */
export class FullHandController {
  private readonly deps: FullHandControllerDeps
  private phase: HandPhase = 'userTurn'
  private street: FullHandStreet = 'flop'
  private board: Card[]
  private potBb: number
  private remainingStackBb: number
  private provider: StreetNodeProvider

  private curNode: TreeNode
  private curNodeId: string

  private readonly userCombo: Combo
  private readonly botCombo: Combo
  private readonly userSeat: Seat
  private readonly botSeat: Seat

  private history: HistoryEntry[] = []
  private decisions: ReviewDecision[] = []
  private result: HandResult | null = null

  // このストリートで記録した行動列とユーザー決断(harvest時にまとめて処理する)
  private streetActionLog: RecordedAction[] = []
  private streetUserDecisions: PendingUserDecision[] = []
  private streetInitialOopWeights: number[] = []
  private streetInitialIpWeights: number[] = []
  /** 現在のストリートで各プレイヤーがこれまでに投入した額(bb)。行動のたびに更新する。 */
  private streetContributed: [number, number] = [0, 0]
  /** 完了済みストリートまでの投入額累計(プリフロップ除く、ポストフロップ分のみ)。 */
  private priorStreetsContributed: [number, number] = [0, 0]
  /** 現在のストリートで各プレイヤーが直近に取ったアクション(P7-2、場の表示専用)。街が変わるとクリアする。 */
  private latestActionBySeat: [LatestAction | null, LatestAction | null] = [null, null]

  // P7-6b: ハンド終了後のバックグラウンド精密リファイン関連の状態
  /** ターンのforLiveStreetに渡した実際のStreetSolveInput(リファイン時に同じ入力へREFINE_SOLVEを重ねて再ソルブする)。 */
  private pendingTurnSolveInput: StreetSolveInput | null = null
  /** ターンの街が終わった時点で退避したリファイン素材。無ければリファイン不要(ターンに到達しなかった等)。 */
  private refineMaterial: StreetRefineMaterial | null = null
  /** リファイン中かどうか(FullHandSnapshot.refiningとしてUIへ公開)。 */
  private refining = false
  /** リファイン用に一時的に開いているprovider(dispose()からのキャンセル対象)。 */
  private activeRefineProvider: StreetNodeProvider | null = null
  /** dispose()済みなら以後のemit/onErrorを抑止する(二重dispose・破棄後のstore更新を防ぐ)。 */
  private disposed = false

  constructor(deps: FullHandControllerDeps) {
    this.deps = deps
    this.userSeat = deps.userSeat
    this.botSeat = deps.userSeat === 0 ? 1 : 0

    const board3 = boardFromFlop(deps.flop)
    this.board = board3
    this.potBb = deps.scenario.potBb
    this.remainingStackBb = deps.scenario.effectiveStackBb

    const oopIsRaiser = isOopPosition(deps.scenario.raiser.position, deps.scenario.defender.position)
    const oopRangeId = oopIsRaiser ? deps.scenario.raiser.rangeId : deps.scenario.defender.rangeId
    const ipRangeId = oopIsRaiser ? deps.scenario.defender.rangeId : deps.scenario.raiser.rangeId
    const { oopCombo, ipCombo } = dealHands(oopRangeId, ipRangeId, board3, deps.rng)
    this.userCombo = deps.userSeat === 0 ? oopCombo : ipCombo
    this.botCombo = deps.userSeat === 0 ? ipCombo : oopCombo

    this.provider = createPrecomputedProvider(deps.flopSolution, board3)
    this.streetInitialOopWeights = initialWeightsInSolutionOrder(oopRangeId, board3, deps.flopSolution.oopCombos)
    this.streetInitialIpWeights = initialWeightsInSolutionOrder(ipRangeId, board3, deps.flopSolution.ipCombos)

    this.history = buildPreflopScript(deps.scenario).map((line) => ({
      street: 'preflop' as const,
      position: line.position,
      label: `${line.action} ${line.amountBb}bb`,
      isUserDecision: false,
    }))

    const tree = buildStreetTree({ potBb: this.potBb, effectiveStackBb: this.remainingStackBb, firstToAct: 0 })
    this.curNode = tree
    this.curNodeId = rootNodeId()
  }

  private positionOf(seat: Seat): string {
    const oopIsRaiser = isOopPosition(this.deps.scenario.raiser.position, this.deps.scenario.defender.position)
    const oopPosition = oopIsRaiser ? this.deps.scenario.raiser.position : this.deps.scenario.defender.position
    const ipPosition = oopIsRaiser ? this.deps.scenario.defender.position : this.deps.scenario.raiser.position
    return seat === 0 ? oopPosition : ipPosition
  }

  private emit(): void {
    if (this.disposed) return // P7-6b: 破棄後のリファイン継続処理からのemitを抑止する
    const latestActions: FullHandSnapshot['latestActions'] = []
    for (const seat of [0, 1] as const) {
      const a = this.latestActionBySeat[seat]
      if (a) latestActions.push({ position: this.positionOf(seat), label: a.label, amountBb: a.amountBb, isUser: seat === this.userSeat })
    }

    this.deps.onUpdate({
      phase: this.phase,
      street: this.street,
      board: this.board,
      potBb: this.potBb,
      solveProgress: this.phase === 'botDeciding' ? (this.provider.progress()?.fraction ?? null) : null,
      actionsWithAmounts: this.phase === 'userTurn' && this.curNode.kind === 'decision' ? actionLabelsWithAmounts(this.curNode) : [],
      history: this.history,
      result: this.result,
      refining: this.refining,
      latestActions,
      scenario: this.deps.scenario,
      flop: this.deps.flop,
      userSeat: this.userSeat,
      userCombo: this.userCombo,
      userPosition: this.positionOf(this.userSeat),
      botPosition: this.positionOf(this.botSeat),
    })
  }

  /**
   * 初期状態を通知する(store.ts側でコントローラ生成直後に呼ぶ想定)。
   * phaseフィールドの初期値'userTurn'は暫定のプレースホルダに過ぎない(先手がボットの
   * 場合は誤り)ため、ここで直接emitせずadvance()に委ねる。advance()のdecisionノード
   * 分岐が手番に応じて正しくphaseを設定してからemitする。
   */
  start(): void {
    void this.advance()
  }

  chooseAction(label: string): void {
    if (this.phase !== 'userTurn') return
    if (this.curNode.kind !== 'decision') return
    this.applyAction(this.curNode, label, this.userSeat, true)
    void this.advance()
  }

  /** decisionNodeでactingPlayerがlabelを選んだ場合の共通処理(投入額更新・履歴記録・木の前進)。 */
  private applyAction(decisionNode: DecisionNode, label: string, actingPlayer: PlayerIdx, isUser: boolean): void {
    const actionIdx = decisionNode.actionLabels.indexOf(label)
    if (actionIdx < 0) throw new Error(`applyAction: unknown label "${label}" (expected one of ${decisionNode.actionLabels.join(',')})`)

    if (isUser) {
      this.streetUserDecisions.push({
        street: this.street,
        nodeId: this.curNodeId,
        boardAtDecision: this.board,
        potBbAtDecision: decisionNode.potBb ?? this.potBb,
        effectiveStackRemainingBb: this.remainingStackBb - this.streetContributed[actingPlayer],
        actionsWithAmounts: actionLabelsWithAmounts(decisionNode),
        chosenLabel: label,
      })
    }

    const investments = actionInvestmentsBb(decisionNode)
    this.streetContributed[actingPlayer] = decisionNode.contributedBb![actingPlayer] + investments[actionIdx]
    this.latestActionBySeat[actingPlayer] = { label, amountBb: investments[actionIdx] }

    this.streetActionLog.push({ nodeId: this.curNodeId, label, actingPlayer })
    this.history.push({
      street: this.street,
      position: this.positionOf(actingPlayer as Seat),
      label,
      isUserDecision: isUser,
      decisionIndex: isUser ? this.decisions.length + this.streetUserDecisions.length - 1 : undefined,
    })

    this.curNode = decisionNode.children[actionIdx]
    this.curNodeId = childNodeId(this.curNodeId, label)
  }

  private async advance(): Promise<void> {
    try {
      for (;;) {
        if (this.curNode.kind === 'chance') {
          // ターン+リバー部分ゲームの埋め込みリバー分岐には入らない(D1)。
          // ターンのベッティング完了とみなし、収穫→独自にリバーカードを配って単独再ソルブする。
          if (this.remainingStackBb - Math.max(this.streetContributed[0], this.streetContributed[1]) < NEAR_ZERO_BB) {
            // 既にオールイン(ターン中に両者オールイン成立): これ以上の決断は無い。
            // ライブソルブは意思決定の無い自明な木を無駄に解くだけなので、直接ランアウトする。
            // 収穫(harvestStreet)はfinalizeShowdown内で行う(以下同様)。
            this.commitStreetContribution()
            await this.runOutRemainingCardsAndFinalize(this.potBb)
            return
          }
          await this.transitionToNextStreet()
          continue
        }

        if (this.curNode.kind === 'terminal') {
          const term = this.curNode
          if (term.outcome.kind === 'fold') {
            await this.finalizeFold(term.outcome.foldedPlayer as Seat, term.potBb)
            return
          }
          // showdown終端 = このストリートのベッティング完了
          if (this.street === 'river') {
            await this.finalizeShowdown(term.potBb, this.board)
            return
          }
          if (this.remainingStackBb - Math.max(this.streetContributed[0], this.streetContributed[1]) < NEAR_ZERO_BB) {
            // どちらかがオールイン: これ以上の決断は無い。残りカードをソルブせずランアウトする。
            // 収穫(harvestStreet)はfinalizeShowdown内で行う。
            this.commitStreetContribution()
            await this.runOutRemainingCardsAndFinalize(term.potBb)
            return
          }
          await this.transitionToNextStreet()
          continue
        }

        // decision node
        if (this.curNode.player === this.userSeat) {
          this.phase = 'userTurn'
          this.emit()
          return
        }

        this.phase = 'botDeciding'
        this.emit()
        await this.provider.ready
        const nodeId = this.curNodeId
        const decisionNode = this.curNode
        const fetched = await this.provider.getNodes([nodeId])
        const decodedNode = fetched.get(nodeId)
        if (!decodedNode) throw new Error(`advance: no solution data for nodeId="${nodeId}" (street=${this.street})`)
        if (decodedNode.player !== decisionNode.player) {
          throw new Error(`advance: player mismatch at nodeId="${nodeId}" (tree=${decisionNode.player}, solution=${decodedNode.player})`)
        }
        if (decodedNode.actionLabels.length !== decisionNode.actionLabels.length || decodedNode.actionLabels.some((l, i) => l !== decisionNode.actionLabels[i])) {
          throw new Error(`advance: actionLabels mismatch at nodeId="${nodeId}"`)
        }

        const botCombIdx =
          this.botSeat === 0
            ? lookupComboIndex(buildComboIndexMapFromCombos(this.provider.oopCombos), this.botCombo)
            : lookupComboIndex(buildComboIndexMapFromCombos(this.provider.ipCombos), this.botCombo)
        const sampled = sampleAction(decodedNode, botCombIdx, this.deps.rng)

        this.applyAction(decisionNode, sampled.label, this.botSeat, false)
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.deps.onError?.(error)
    }
  }

  /** このストリートで記録した全行動を再生してレンジ重みを更新し、ユーザー決断をReviewDecisionへ変換する。戻り値はこのストリート終了時点の最終重み。 */
  private async harvestStreet(): Promise<{ oopWeights: number[]; ipWeights: number[] }> {
    const { decisions, oopWeights, ipWeights } = await computeStreetHarvest({
      provider: this.provider,
      actionLog: this.streetActionLog,
      userDecisions: this.streetUserDecisions,
      initialOopWeights: this.streetInitialOopWeights,
      initialIpWeights: this.streetInitialIpWeights,
      userSeat: this.userSeat,
      userCombo: this.userCombo,
    })
    this.decisions.push(...decisions)
    this.streetActionLog = []
    this.streetUserDecisions = []
    return { oopWeights, ipWeights }
  }

  /**
   * P7-6b: このストリートがターンで、かつプレイ用の粗いソルブ入力(pendingTurnSolveInput)が
   * 記録済みなら、harvestStreetで消費される前にリファイン素材を退避する。ターン以外
   * (フロップ=事前計算、リバー=プレイ時から精密)では何もしない。transitionToNextStreet/
   * finalizeFold/finalizeShowdownがharvestStreetを呼ぶ直前に必ず呼ぶこと。
   */
  private captureTurnRefineMaterialIfNeeded(): void {
    if (this.street !== 'turn' || !this.pendingTurnSolveInput) return
    this.refineMaterial = {
      solveInput: this.pendingTurnSolveInput,
      actionLog: [...this.streetActionLog],
      userDecisions: [...this.streetUserDecisions],
      initialOopWeights: [...this.streetInitialOopWeights],
      initialIpWeights: [...this.streetInitialIpWeights],
      decisionStartIdx: this.decisions.length,
    }
  }

  /**
   * ハンド終了時に呼ぶ。ターンのリファイン素材が無ければ即座にfactoryを解放する
   * (従来通り)。あればrefining=trueでemitしてからバックグラウンドでターンを
   * REFINE_SOLVEで再ソルブ・再収穫し、this.decisions/this.resultを差し替えて
   * refining=falseでemitする。失敗してもハンド結果自体は壊さない(粗い採点のまま)。
   */
  private async finishOrRefine(): Promise<void> {
    const material = this.refineMaterial
    this.refineMaterial = null
    if (!material) {
      if (!this.disposed) this.deps.providerFactory.dispose()
      return
    }

    this.refining = true
    this.emit()

    try {
      const refineProvider = this.deps.providerFactory.forLiveStreet({ ...material.solveInput, ...REFINE_SOLVE })
      this.activeRefineProvider = refineProvider
      const { decisions } = await computeStreetHarvest({
        provider: refineProvider,
        actionLog: material.actionLog,
        userDecisions: material.userDecisions,
        initialOopWeights: material.initialOopWeights,
        initialIpWeights: material.initialIpWeights,
        userSeat: this.userSeat,
        userCombo: this.userCombo,
      })
      if (this.disposed) return
      for (let i = 0; i < decisions.length; i++) {
        this.decisions[material.decisionStartIdx + i] = decisions[i]
      }
      if (this.result) {
        this.result = {
          ...this.result,
          decisionSummaries: this.decisions.map((d) => ({ street: d.street, chosenLabel: d.chosenLabel, verdict: d.grading.verdict, evLossBb: d.grading.evLossBb })),
        }
      }
    } catch (err) {
      if (!this.disposed) {
        const error = err instanceof Error ? err : new Error(String(err))
        this.deps.onError?.(error)
      }
    } finally {
      this.activeRefineProvider?.dispose()
      this.activeRefineProvider = null
      if (!this.disposed) {
        this.refining = false
        this.emit()
        this.deps.providerFactory.dispose()
      }
    }
  }

  /** streetContributedをpriorStreetsContributedへ繰り込み、remainingStackBb/potBbを更新する。 */
  private commitStreetContribution(): void {
    const amount = Math.max(this.streetContributed[0], this.streetContributed[1])
    this.priorStreetsContributed[0] += this.streetContributed[0]
    this.priorStreetsContributed[1] += this.streetContributed[1]
    this.remainingStackBb -= amount
    this.potBb += this.streetContributed[0] + this.streetContributed[1]
    this.streetContributed = [0, 0]
  }

  private async transitionToNextStreet(): Promise<void> {
    this.captureTurnRefineMaterialIfNeeded()
    const { oopWeights, ipWeights } = await this.harvestStreet()
    this.commitStreetContribution()
    const nextStreet: FullHandStreet = this.street === 'flop' ? 'turn' : 'river'

    const newCard = dealCardExcluding([...this.board, this.userCombo[0], this.userCombo[1], this.botCombo[0], this.botCombo[1]], this.deps.rng)
    const newBoard = [...this.board, newCard]
    const cardK = cardKey(newCard)
    const filteredOop = filterAndRenormalize(this.provider.oopCombos, oopWeights, cardK)
    const filteredIp = filterAndRenormalize(this.provider.ipCombos, ipWeights, cardK)

    this.provider.dispose()
    this.street = nextStreet
    this.board = newBoard
    this.streetInitialOopWeights = filteredOop.weights
    this.streetInitialIpWeights = filteredIp.weights
    this.latestActionBySeat = [null, null] // 新しい街ではチップが場に出る感覚をリセットする

    // 呼び出し元(advance())はterminal/chance両分岐とも、この関数に入る前に
    // remainingStackBb - streetContributed の残りが実質ゼロ(オールイン成立)なら
    // 直接ランアウト側へ分岐するため、ここに到達する時点で必ず正の実効スタックが残っている。
    const playSolve = nextStreet === 'turn' ? TURN_PLAY_SOLVE : RIVER_PLAY_SOLVE
    const solveInput: StreetSolveInput = {
      street: nextStreet,
      board: newBoard,
      oopCombos: filteredOop.combos,
      oopReach: filteredOop.weights,
      ipCombos: filteredIp.combos,
      ipReach: filteredIp.weights,
      potBb: this.potBb,
      effectiveStackBb: this.remainingStackBb,
      ...playSolve,
    }
    // P7-6b: ターンだけがこの入力をハンド終了後の精密リファインで再利用する
    // (フロップは事前計算、リバーはプレイ時から精密なので不要)。
    this.pendingTurnSolveInput = nextStreet === 'turn' ? solveInput : null
    this.provider = this.deps.providerFactory.forLiveStreet(solveInput)

    const tree =
      nextStreet === 'turn'
        ? buildTurnSubgameTree({ turnPotBb: this.potBb, effectiveStackBb: this.remainingStackBb, firstToAct: 0, deadCards: newBoard })
        : buildStreetTree({ potBb: this.potBb, effectiveStackBb: this.remainingStackBb, firstToAct: 0 })
    this.curNode = tree
    this.curNodeId = rootNodeId()
  }

  private async runOutRemainingCardsAndFinalize(finalPotBb: number): Promise<void> {
    let board = this.board
    while (board.length < 5) {
      const card = dealCardExcluding([...board, this.userCombo[0], this.userCombo[1], this.botCombo[0], this.botCombo[1]], this.deps.rng)
      board = [...board, card]
    }
    this.board = board
    await this.finalizeShowdown(finalPotBb, board)
  }

  private totalContributed(seat: Seat): number {
    return this.priorStreetsContributed[seat] + this.streetContributed[seat]
  }

  private async finalizeFold(foldedPlayer: Seat, finalPotBb: number): Promise<void> {
    this.captureTurnRefineMaterialIfNeeded()
    await this.harvestStreet()
    this.phase = 'grading'
    this.emit()

    const preflopContrib = preflopContribPerPlayerBb(this.deps.scenario)
    const userTotalContributed = preflopContrib + this.totalContributed(this.userSeat)
    const userNetBb = foldedPlayer === this.userSeat ? -userTotalContributed : finalPotBb - userTotalContributed

    this.result = {
      endedBy: 'fold',
      foldedSeat: foldedPlayer,
      userNetBb: Math.round(userNetBb * 100) / 100,
      finalPotBb,
      finalBoard: this.board,
      botCombo: null,
      decisionSummaries: this.decisions.map((d) => ({ street: d.street, chosenLabel: d.chosenLabel, verdict: d.grading.verdict, evLossBb: d.grading.evLossBb })),
    }
    this.phase = 'over'
    this.emit()
    void this.finishOrRefine()
  }

  private async finalizeShowdown(finalPotBb: number, finalBoard: Card[]): Promise<void> {
    // 最終ストリート(通常はリバー)の決断はここに来るまで収穫されていない
    // (transitionToNextStreetを経由しないため)。オールイン経路(runOutRemainingCardsAndFinalize
    // 経由)では既に空になったstreetActionLog/streetUserDecisionsに対する空振り呼び出しになるだけで安全。
    this.captureTurnRefineMaterialIfNeeded()
    await this.harvestStreet()
    this.phase = 'grading'
    this.emit()

    const userScore = evaluate([...this.userCombo, ...finalBoard]).score
    const botScore = evaluate([...this.botCombo, ...finalBoard]).score
    const preflopContrib = preflopContribPerPlayerBb(this.deps.scenario)
    const userTotalContributed = preflopContrib + this.totalContributed(this.userSeat)

    let userNetBb: number
    if (userScore > botScore) userNetBb = finalPotBb - userTotalContributed
    else if (userScore < botScore) userNetBb = -userTotalContributed
    else userNetBb = finalPotBb / 2 - userTotalContributed

    this.result = {
      endedBy: 'showdown',
      userNetBb: Math.round(userNetBb * 100) / 100,
      finalPotBb,
      finalBoard,
      botCombo: this.botCombo,
      decisionSummaries: this.decisions.map((d) => ({ street: d.street, chosenLabel: d.chosenLabel, verdict: d.grading.verdict, evLossBb: d.grading.evLossBb })),
    }
    this.phase = 'over'
    this.emit()
    void this.finishOrRefine()
  }

  getResult(): HandResult {
    if (!this.result) throw new Error('getResult: hand is not over yet')
    return this.result
  }

  getReview(): ReviewData {
    if (!this.result) throw new Error('getReview: hand is not over yet')
    return {
      scenario: this.deps.scenario,
      flop: this.deps.flop,
      board: this.result.finalBoard,
      userCombo: this.userCombo,
      userPosition: this.positionOf(this.userSeat),
      botPosition: this.positionOf(this.botSeat),
      history: this.history,
      // P7-6b: 呼び出し時点の配列をコピーして返す。this.decisionsはリファイン完了時に
      // 要素を差し替える(同一配列を破壊的に更新する)ため、コピーせず参照をそのまま返すと
      // 過去に取得済みのReviewData.decisionsまで後から書き換わってしまい、store.ts側の
      // 「旧reviewと新reviewで同じ決断オブジェクトかどうか」比較(featuresの選択的無効化)が
      // 機能しなくなる。
      decisions: [...this.decisions],
    }
  }

  dispose(): void {
    this.disposed = true
    this.provider.dispose()
    // P7-6b: リファイン中の破棄。finishOrRefine側のfinallyが二重にdisposeしないよう、
    // ここで参照をnull化してから呼ぶ(disposeが必ず1回だけ呼ばれるようにする)。
    const refineProvider = this.activeRefineProvider
    this.activeRefineProvider = null
    refineProvider?.dispose()
    this.deps.providerFactory.dispose()
  }
}
