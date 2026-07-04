import type { TreeNode, TerminalNode, DecisionNode, ChanceNode, PlayerIdx } from '../solver/cfr'
import type { Card } from '../../engine/types'
import { createDeck, cardKey } from '../../engine/deck'

/**
 * 1ストリート分のベッティングツリーを構築する。
 * サイズ抽象化(承認済みプラン): ベット33%/75%pot+オールイン、レイズ55%pot+オールイン
 * (レイズ後の再レイズはオールインのみ、フォールド/コールで打ち切り)。
 *
 * ベット額 = 現在のポット × betSizesPct。
 * レイズ額(コール分を除いた追加分) = (相手の賭け額をコールした後のポット) × raiseSizePct
 *   raiseTotal(コール込みの合計拠出) = callAmount + raiseSizePct × (potBeforeBet + 2 × callAmount)
 * どちらも実効スタックを超える場合はオールインに切り詰め、オールインとの差が小さすぎる
 * 場合(< allinCollapseThresholdBb)はオールイン1本に統合してノード数の重複を避ける。
 */
export interface ActionTreeOptions {
  potBb: number
  /** 両プレイヤーの残りスタック(このストリート開始時点、対称=同額と仮定) */
  effectiveStackBb: number
  /** 先に行動するプレイヤー(OOP)。0=player0が先手、1=player1が先手。 */
  firstToAct: PlayerIdx
  betSizesPct?: number[]
  raiseSizePct?: number
  /** オールイン額との差がこの値未満(bb)ならオールインへ統合する */
  allinCollapseThresholdBb?: number
}

const DEFAULT_BET_SIZES = [0.33, 0.75]
const DEFAULT_RAISE_SIZE = 0.55
const DEFAULT_COLLAPSE_THRESHOLD = 0.5

interface StreetState {
  potBb: number
  /** 各プレイヤーの残りスタック(bb) */
  stacks: [number, number]
  /** このストリートで各プレイヤーがこれまでに追加投入した額(bb、ポットに含まれる) */
  contributed: [number, number]
}

function terminal(state: StreetState, outcome: TerminalNode['outcome']): TerminalNode {
  return {
    kind: 'terminal',
    potBb: state.potBb,
    contributed: [...state.contributed],
    outcome,
  }
}

export function buildStreetTree(opts: ActionTreeOptions): TreeNode {
  const betSizesPct = opts.betSizesPct ?? DEFAULT_BET_SIZES
  const raiseSizePct = opts.raiseSizePct ?? DEFAULT_RAISE_SIZE
  const collapseThreshold = opts.allinCollapseThresholdBb ?? DEFAULT_COLLAPSE_THRESHOLD

  const initialState: StreetState = {
    potBb: opts.potBb,
    stacks: [opts.effectiveStackBb, opts.effectiveStackBb],
    contributed: [0, 0],
  }

  /** betAmountを実効スタックで切り詰め、上限に近ければallin扱いにする。戻り値: [実際のベット額, allinか] */
  function clampBet(desired: number, remainingStack: number): [number, boolean] {
    if (desired >= remainingStack - collapseThreshold) return [remainingStack, true]
    return [desired, false]
  }

  /** まだ誰もこのストリートでベットしていない状態でのアクション(check or bet系)。 */
  function buildOpenDecision(state: StreetState, actor: PlayerIdx, isFirstAction: boolean): TreeNode {
    const remaining = state.stacks[actor]
    if (remaining <= 0) {
      // オールイン済みで行動不能 -> ショーダウンへ
      return terminal(state, { kind: 'showdown' })
    }

    const actionLabels: string[] = ['check']
    const children: TreeNode[] = []

    if (isFirstAction) {
      children.push(buildOpenDecision(state, actor === 0 ? 1 : 0, false))
    } else {
      children.push(terminal(state, { kind: 'showdown' }))
    }

    const sizeSet = new Set<number>()
    for (const pct of betSizesPct) {
      const desired = state.potBb * pct
      const [amount, isAllin] = clampBet(desired, remaining)
      const rounded = Math.round(amount * 100) / 100
      if (sizeSet.has(rounded)) continue
      sizeSet.add(rounded)
      const label = isAllin ? 'allin' : `bet${Math.round(pct * 100)}`
      actionLabels.push(label)
      children.push(buildFacingBet(state, actor, amount, isAllin))
      if (isAllin) break // オールインに達したらそれ以上大きいサイズは不要
    }
    // 上記でオールインに到達しなかった場合、明示的にオールインの枝を追加
    if (!actionLabels.includes('allin')) {
      const [amount] = clampBet(remaining, remaining)
      const rounded = Math.round(amount * 100) / 100
      if (!sizeSet.has(rounded) && amount > 0) {
        actionLabels.push('allin')
        children.push(buildFacingBet(state, actor, amount, true))
      }
    }

    return { kind: 'decision', player: actor, actionLabels, children }
  }

  /** actorがamountをbet/raiseした直後、相手(other)がfold/call/raise/allinを選ぶ状態。 */
  function buildFacingBet(state: StreetState, actor: PlayerIdx, amount: number, actorAllin: boolean, isReraise = false): TreeNode {
    const other: PlayerIdx = actor === 0 ? 1 : 0
    const newContributed: [number, number] = [...state.contributed]
    newContributed[actor] += amount
    const newState: StreetState = {
      potBb: state.potBb + amount,
      stacks: [state.stacks[0], state.stacks[1]] as [number, number],
      contributed: newContributed,
    }
    newState.stacks[actor] -= amount

    const actionLabels: string[] = ['fold', 'call']
    const foldOutcome: TerminalNode['outcome'] = { kind: 'fold', foldedPlayer: other }
    const children: TreeNode[] = [terminal(newState, foldOutcome)]

    // call: otherはamount分を投入するが、自身のスタックがamount未満なら
    // 「コールフォーレス」(ショートスタックのオールインコール)としてスタック分だけ投入する
    const callAmount = Math.min(amount, newState.stacks[other])
    const callState: StreetState = {
      potBb: newState.potBb + callAmount,
      stacks: [newState.stacks[0], newState.stacks[1]] as [number, number],
      contributed: [newState.contributed[0], newState.contributed[1]] as [number, number],
    }
    callState.stacks[other] -= callAmount
    callState.contributed[other] += callAmount
    children.push(terminal(callState, { kind: 'showdown' }))

    const otherRemaining = newState.stacks[other]
    if (!actorAllin && !isReraise && otherRemaining > 0) {
      // レイズ(1サイズのみ)+オールインの権利
      const potAfterCall = newState.potBb + amount // 現在のpot(相手のbetを含む) + 自分がコールした分
      const desiredRaiseExtra = raiseSizePct * potAfterCall
      const desiredRaiseTotal = amount + desiredRaiseExtra
      const [raiseTotal, raiseIsAllin] = clampBet(desiredRaiseTotal, otherRemaining)
      if (raiseTotal > amount) {
        const label = raiseIsAllin ? 'allin' : 'raise55'
        actionLabels.push(label)
        children.push(buildFacingBet(newState, other, raiseTotal, raiseIsAllin, true))
        if (!raiseIsAllin) {
          const [allinAmount] = clampBet(otherRemaining, otherRemaining)
          if (Math.round(allinAmount * 100) !== Math.round(raiseTotal * 100)) {
            actionLabels.push('allin')
            children.push(buildFacingBet(newState, other, allinAmount, true, true))
          }
        }
      } else if (otherRemaining > 0) {
        actionLabels.push('allin')
        children.push(buildFacingBet(newState, other, otherRemaining, true, true))
      }
    }

    return { kind: 'decision', player: other, actionLabels, children }
  }

  return buildOpenDecision(initialState, opts.firstToAct, true)
}

/** 木を平坦化して全ターミナルノードを集める(テスト・検証用)。 */
export function collectTerminals(node: TreeNode): TerminalNode[] {
  if (node.kind === 'terminal') return [node]
  const out: TerminalNode[] = []
  const children = node.kind === 'decision' ? node.children : node.children
  for (const c of children) out.push(...collectTerminals(c))
  return out
}

/** 木を平坦化して全決断ノードを集める(テスト・検証用)。 */
export function collectDecisions(node: TreeNode): DecisionNode[] {
  if (node.kind === 'terminal') return []
  const out: DecisionNode[] = node.kind === 'decision' ? [node] : []
  for (const c of node.children) out.push(...collectDecisions(c))
  return out
}

// ============================================================
// ターン部分ゲーム: ターン街のベッティングツリーを構築し、ベッティングが
// (フォールドなく)完了した各地点を「リバーカードを1枚配るチャンスノード」+
// 「新しいリバー街のベッティングツリー」に展開する。
// ターン街の終端(fold以外)はまだ本当のショーダウンではなく「リバーへ進む」を
// 意味するため、buildStreetTreeがそのまま返す'showdown'ターミナルを差し替える。
// ============================================================

export interface TurnSubgameOptions {
  turnPotBb: number
  effectiveStackBb: number
  firstToAct: PlayerIdx
  /** ターン+リバー街開始時点で既に場に出ている4枚(フロップ3+ターン1)。リバーの
   *  チャンス分岐から除外する(カード除去)。 */
  deadCards: Card[]
  betSizesPct?: number[]
  raiseSizePct?: number
}

/**
 * 木を再帰的に複製しつつ、全ターミナルのcontributedにoffsetを加算し、
 * boardを付与する(街をまたぐ累積・スコア計算用ボードのスタンプ)。
 */
function finalizeRiverTerminals(node: TreeNode, offset: [number, number], board: string[]): TreeNode {
  if (node.kind === 'terminal') {
    return {
      ...node,
      contributed: [node.contributed[0] + offset[0], node.contributed[1] + offset[1]],
      board,
    }
  }
  return { ...node, children: node.children.map((c) => finalizeRiverTerminals(c, offset, board)) }
}

function buildRiverChanceNode(turnTerminal: TerminalNode, opts: TurnSubgameOptions): ChanceNode {
  const remaining0 = opts.effectiveStackBb - turnTerminal.contributed[0]
  const remaining1 = opts.effectiveStackBb - turnTerminal.contributed[1]
  const bothCanAct = remaining0 > 1e-9 && remaining1 > 1e-9

  const usedKeys = new Set(opts.deadCards.map(cardKey))
  const remainingDeck = createDeck().filter((c) => !usedKeys.has(cardKey(c)))
  const cardLabels = remainingDeck.map(cardKey)
  const deadCardKeys = opts.deadCards.map(cardKey)

  const children: TreeNode[] = remainingDeck.map((riverCard) => {
    const fullBoard = [...deadCardKeys, cardKey(riverCard)]
    if (!bothCanAct) {
      // 既にどちらかがオールイン: これ以上の意思決定はなくポットはターン終了時点で確定
      const t: TerminalNode = {
        kind: 'terminal',
        potBb: turnTerminal.potBb,
        contributed: turnTerminal.contributed,
        outcome: { kind: 'showdown' },
        board: fullBoard,
      }
      return t
    }
    const riverTree = buildStreetTree({
      potBb: turnTerminal.potBb,
      effectiveStackBb: Math.min(remaining0, remaining1),
      firstToAct: opts.firstToAct,
      betSizesPct: opts.betSizesPct,
      raiseSizePct: opts.raiseSizePct,
    })
    return finalizeRiverTerminals(riverTree, turnTerminal.contributed, fullBoard)
  })

  return { kind: 'chance', cards: cardLabels, children }
}

function expandTurnShowdownsToRiver(node: TreeNode, opts: TurnSubgameOptions): TreeNode {
  if (node.kind === 'terminal') {
    if (node.outcome.kind === 'fold') return node // ハンド終了、リバー不要
    return buildRiverChanceNode(node, opts) // ショーダウン→まだリバーが残っている
  }
  return { ...node, children: node.children.map((c) => expandTurnShowdownsToRiver(c, opts)) } as TreeNode
}

/** ターン街のベッティング+リバーのチャンスノード+リバー街のベッティングを結合した部分ゲーム木を構築する。 */
export function buildTurnSubgameTree(opts: TurnSubgameOptions): TreeNode {
  const turnTree = buildStreetTree({
    potBb: opts.turnPotBb,
    effectiveStackBb: opts.effectiveStackBb,
    firstToAct: opts.firstToAct,
    betSizesPct: opts.betSizesPct,
    raiseSizePct: opts.raiseSizePct,
  })
  return expandTurnShowdownsToRiver(turnTree, opts)
}
