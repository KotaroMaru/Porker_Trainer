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
import type { NodeProviderFactory, StreetNodeProvider } from './nodeDataProvider'
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

interface PendingUserDecision {
  street: FullHandStreet
  nodeId: string
  boardAtDecision: Card[]
  potBbAtDecision: number
  effectiveStackRemainingBb: number
  actionsWithAmounts: { label: string; amountBb: number }[]
  chosenLabel: string
}

const NEAR_ZERO_BB = 1e-6

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
    this.deps.onUpdate({
      phase: this.phase,
      street: this.street,
      board: this.board,
      potBb: this.potBb,
      solveProgress: this.phase === 'botDeciding' ? (this.provider.progress()?.fraction ?? null) : null,
      actionsWithAmounts: this.phase === 'userTurn' && this.curNode.kind === 'decision' ? actionLabelsWithAmounts(this.curNode) : [],
      history: this.history,
      result: this.result,
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
    await this.provider.ready
    const nodeIdsToFetch = new Set<string>()
    for (const a of this.streetActionLog) nodeIdsToFetch.add(a.nodeId)
    for (const d of this.streetUserDecisions) {
      for (const a of d.actionsWithAmounts) nodeIdsToFetch.add(childNodeId(d.nodeId, a.label))
    }
    const fetched = await this.provider.getNodes([...nodeIdsToFetch])

    const oopCombos = this.provider.oopCombos
    const ipCombos = this.provider.ipCombos
    let oopW = this.streetInitialOopWeights
    let ipW = this.streetInitialIpWeights

    const snapshots = new Map<string, { heroWeights: number[]; villainWeights: number[] }>()
    const userDecisionNodeIds = new Set(this.streetUserDecisions.map((d) => d.nodeId))

    for (const action of this.streetActionLog) {
      if (userDecisionNodeIds.has(action.nodeId) && !snapshots.has(action.nodeId)) {
        const heroWeights = this.userSeat === 0 ? [...oopW] : [...ipW]
        const villainWeights = this.userSeat === 0 ? [...ipW] : [...oopW]
        snapshots.set(action.nodeId, { heroWeights, villainWeights })
      }
      const decoded = fetched.get(action.nodeId)
      if (!decoded) throw new Error(`harvestStreet: missing decodedNode for nodeId="${action.nodeId}"`)
      const handCount = decoded.player === 0 ? oopCombos.length : ipCombos.length
      const actionIdx = decoded.actionLabels.indexOf(action.label)
      if (actionIdx < 0) throw new Error(`harvestStreet: action "${action.label}" not found at nodeId="${action.nodeId}"`)
      const freqRow: number[] = []
      for (let h = 0; h < handCount; h++) freqRow.push(decoded.freqs[actionIdx * handCount + h])
      if (decoded.player === 0) oopW = updateRangeWeights(oopW, freqRow)
      else ipW = updateRangeWeights(ipW, freqRow)
    }

    for (const d of this.streetUserDecisions) {
      const decodedNode = fetched.get(d.nodeId)
      if (!decodedNode) throw new Error(`harvestStreet: missing decodedNode for user decision nodeId="${d.nodeId}"`)
      const snap = snapshots.get(d.nodeId)
      if (!snap) throw new Error(`harvestStreet: missing weight snapshot for user decision nodeId="${d.nodeId}"`)

      const heroCombos = this.userSeat === 0 ? oopCombos : ipCombos
      const villainCombos = this.userSeat === 0 ? ipCombos : oopCombos

      const responseNodes: ReviewDecision['responseNodes'] = []
      for (const label of decodedNode.actionLabels) {
        const childId = childNodeId(d.nodeId, label)
        const node = fetched.get(childId)
        if (node) responseNodes.push({ forLabel: label, nodeId: childId, node })
      }

      const comboIdx = lookupComboIndex(buildComboIndexMapFromCombos(heroCombos), this.userCombo)
      const grading: GradeResult = gradeDecision(decodedNode, comboIdx, d.chosenLabel)

      this.decisions.push({
        street: d.street,
        nodeId: d.nodeId,
        seat: this.userSeat,
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

    this.streetActionLog = []
    this.streetUserDecisions = []
    return { oopWeights: oopW, ipWeights: ipW }
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

    // 呼び出し元(advance())はterminal/chance両分岐とも、この関数に入る前に
    // remainingStackBb - streetContributed の残りが実質ゼロ(オールイン成立)なら
    // 直接ランアウト側へ分岐するため、ここに到達する時点で必ず正の実効スタックが残っている。
    this.provider = this.deps.providerFactory.forLiveStreet({
      street: nextStreet,
      board: newBoard,
      oopCombos: filteredOop.combos,
      oopReach: filteredOop.weights,
      ipCombos: filteredIp.combos,
      ipReach: filteredIp.weights,
      potBb: this.potBb,
      effectiveStackBb: this.remainingStackBb,
    })

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
    this.deps.providerFactory.dispose()
    this.emit()
  }

  private async finalizeShowdown(finalPotBb: number, finalBoard: Card[]): Promise<void> {
    // 最終ストリート(通常はリバー)の決断はここに来るまで収穫されていない
    // (transitionToNextStreetを経由しないため)。オールイン経路(runOutRemainingCardsAndFinalize
    // 経由)では既に空になったstreetActionLog/streetUserDecisionsに対する空振り呼び出しになるだけで安全。
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
    this.deps.providerFactory.dispose()
    this.emit()
  }

  getResult(): HandResult {
    if (!this.result) throw new Error('getResult: hand is not over yet')
    return this.result
  }

  getReview(): ReviewData {
    if (!this.result) throw new Error('getReview: hand is not over yet')
    const oopIsRaiser = isOopPosition(this.deps.scenario.raiser.position, this.deps.scenario.defender.position)
    const oopPosition = oopIsRaiser ? this.deps.scenario.raiser.position : this.deps.scenario.defender.position
    const ipPosition = oopIsRaiser ? this.deps.scenario.defender.position : this.deps.scenario.raiser.position
    const userPosition = this.userSeat === 0 ? oopPosition : ipPosition
    const botPosition = this.userSeat === 0 ? ipPosition : oopPosition

    return {
      scenario: this.deps.scenario,
      flop: this.deps.flop,
      board: this.result.finalBoard,
      userCombo: this.userCombo,
      userPosition,
      botPosition,
      history: this.history,
      decisions: this.decisions,
    }
  }

  dispose(): void {
    this.provider.dispose()
    this.deps.providerFactory.dispose()
  }
}
