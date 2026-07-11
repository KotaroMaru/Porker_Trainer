import type { TreeNode, TerminalNode, DecisionNode, ChanceNode, PlayerIdx } from '../solver/cfr'
import type { Card } from '../../engine/types'
import { createDeck, cardKey } from '../../engine/deck'

/**
 * 1ストリート分のベッティングツリーを構築する。
 * サイズ抽象化(承認済みプラン、2026-07-04仕様更新): ベット33%/75%pot+オールイン、
 * レイズ55%pot+オールイン。レイズに直面した側は fold/call/allin(再レイズ)の3択
 * (サイズドの再レイズは提示しない。再レイズはオールインのみ)。オールインに直面した
 * 側はfold/callのみ(相手に残りスタックがないため構造的に連鎖が止まる)。
 *
 * ベット額 = 現在のポット × betSizesPct。
 * レイズ額(コール分を除いた追加分) = (相手の賭け額をコールした後のポット) × raiseSizePct
 *   raiseTotal(コール込みの合計拠出) = callTotal + raiseSizePct × (potBeforeBet + 2 × callAmount)
 * どちらも相手の最大可能拠出(自身の既存拠出+残りスタック)を超える場合はオールインに
 * 切り詰め、オールインとの差が小さすぎる場合(< allinCollapseThresholdBb)はオールイン
 * 1本に統合してノード数の重複を避ける。
 *
 * 重要な不変条件: state.contributed[p]は「このストリートでpがこれまでに投入した
 * 累計額」であり、buildFacingBetのamount引数は「actorがこの時点で持つ累計投入額
 * (今回のアクションで到達する額)」を表す。相手(other)がコール/レイズする際に
 * 実際に追加投入すべき額は amount − state.contributed[other] (deficit)であり、
 * amountそのものではない(2手目以降のレイズ合戦で両者の既存投入額が異なるため)。
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

  /**
   * 希望する「累計投入総額」を、そのプレイヤーが到達しうる最大累計投入額
   * (maxTotal = 既存投入額+残りスタック)で切り詰める。上限に近ければallin扱いにする。
   * 戻り値: [実際の累計投入総額, allinか]
   */
  function clampBet(desiredTotal: number, maxTotal: number): [number, boolean] {
    if (desiredTotal >= maxTotal - collapseThreshold) return [maxTotal, true]
    return [desiredTotal, false]
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

    return { kind: 'decision', player: actor, actionLabels, children, potBb: state.potBb, contributedBb: [...state.contributed] }
  }

  /**
   * actorがこのアクションで累計投入額をactorNewTotalへ引き上げた直後、
   * 相手(other)がfold/call/raise/allinを選ぶ状態。
   * actorNewTotalは(deltaではなく)actorの「このストリートでの累計投入総額」であること
   * (呼び出し側は常に総額を渡す。関数内部で state.contributed[actor] との差分から
   * 実際の追加投入額(delta)を導出する)。
   */
  function buildFacingBet(state: StreetState, actor: PlayerIdx, actorNewTotal: number, actorAllin: boolean, isReraise = false): TreeNode {
    const other: PlayerIdx = actor === 0 ? 1 : 0
    const actorDelta = actorNewTotal - state.contributed[actor]
    const newContributed: [number, number] = [...state.contributed]
    newContributed[actor] = actorNewTotal
    const newState: StreetState = {
      potBb: state.potBb + actorDelta,
      stacks: [state.stacks[0], state.stacks[1]] as [number, number],
      contributed: newContributed,
    }
    newState.stacks[actor] -= actorDelta

    const actionLabels: string[] = ['fold', 'call']
    const foldOutcome: TerminalNode['outcome'] = { kind: 'fold', foldedPlayer: other }
    const children: TreeNode[] = [terminal(newState, foldOutcome)]

    // otherがこの時点までに投入済みの額(actorの当該ベットとは独立)。コール/レイズの
    // 際に実際に追加投入すべき額は、actorNewTotal(actorの累計投入額)からこれを
    // 差し引いたdeficitであり、actorNewTotalそのものではない
    // (レイズ合戦では両者の既存投入額が異なる)。
    const otherContributed = state.contributed[other]
    const otherRemaining = newState.stacks[other]
    const otherMaxTotal = otherContributed + otherRemaining
    const deficit = actorNewTotal - otherContributed

    // call: otherはdeficit分を追加投入するが、残りスタックがdeficit未満なら
    // 「コールフォーレス」(ショートスタックのオールインコール)としてスタック分だけ投入する
    const callAmount = Math.min(deficit, otherRemaining)
    const callState: StreetState = {
      potBb: newState.potBb + callAmount,
      stacks: [newState.stacks[0], newState.stacks[1]] as [number, number],
      contributed: [newState.contributed[0], newState.contributed[1]] as [number, number],
    }
    callState.stacks[other] -= callAmount
    callState.contributed[other] += callAmount
    children.push(terminal(callState, { kind: 'showdown' }))

    // レイズ/再レイズの権利: actor自身がオールインしていない、かつotherが
    // コールを上回る額を投入できる場合のみ(そうでなければコールで手が尽きている)。
    if (!actorAllin && otherMaxTotal > actorNewTotal) {
      if (!isReraise) {
        // まだ誰も再レイズしていない: サイズドレイズ(1サイズ)+オールインの権利
        const potAfterCall = newState.potBb + deficit // 現在のpot + otherがコールした場合の追加分
        const desiredRaiseExtra = raiseSizePct * potAfterCall
        const desiredRaiseTotal = actorNewTotal + desiredRaiseExtra
        const [raiseTotal, raiseIsAllin] = clampBet(desiredRaiseTotal, otherMaxTotal)
        if (raiseTotal > actorNewTotal) {
          const label = raiseIsAllin ? 'allin' : 'raise55'
          actionLabels.push(label)
          children.push(buildFacingBet(newState, other, raiseTotal, raiseIsAllin, true))
          if (!raiseIsAllin && Math.round(otherMaxTotal * 100) !== Math.round(raiseTotal * 100)) {
            actionLabels.push('allin')
            children.push(buildFacingBet(newState, other, otherMaxTotal, true, true))
          }
        } else {
          actionLabels.push('allin')
          children.push(buildFacingBet(newState, other, otherMaxTotal, true, true))
        }
      } else {
        // 既に誰かがレイズ済み: 再レイズはオールインのみ許可(2026-07-04仕様更新)
        actionLabels.push('allin')
        children.push(buildFacingBet(newState, other, otherMaxTotal, true, true))
      }
    }

    return { kind: 'decision', player: other, actionLabels, children, potBb: newState.potBb, contributedBb: [...newState.contributed] }
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

  return { kind: 'chance', cards: cardLabels, children, contributed: turnTerminal.contributed }
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
