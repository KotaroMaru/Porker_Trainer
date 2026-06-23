import { createDeck, shuffle, deal } from './deck'
import { evaluate } from './evaluator'
import type { GameState, Player, Action, ActionType, Position, Pot } from './types'
import { positionsByOffset } from './positions'
const SMALL_BLIND = 25
const BIG_BLIND = 50
const STARTING_STACK = 5000

const BOT_NAMES = ['Station さん', 'Rock さん', 'Maniac さん', 'Reg さん', 'Fishy さん']
const BOT_TYPES: Player['type'][] = ['station', 'rock', 'maniac', 'reg', 'fishy']

export interface GameOptions {
  buttonIndex?: number
  stacks?: number[]       // carry-over stacks (auto-rebuy applied)
  handNumber?: number
}

// Auto-rebuy threshold: below 10BB the player tops back up to the full buy-in
const REBUY_THRESHOLD = BIG_BLIND * 10

export function createGame(playerCount: number = 6, userSeatIndex: number = 0, opts: GameOptions = {}): GameState {
  const count = Math.min(Math.max(playerCount, 2), 8)
  const buttonIndex = (opts.buttonIndex ?? 0) % count

  const players: Player[] = []
  let botCount = 0
  for (let i = 0; i < count; i++) {
    const isUser = i === userSeatIndex
    const botIdx = botCount
    // position rotates with the button: players[buttonIndex] is always BTN
    const position = positionsByOffset(count)[(i - buttonIndex + count) % count]
    const carried = opts.stacks?.[i]
    const stack = carried === undefined || carried < REBUY_THRESHOLD ? STARTING_STACK : carried
    players.push({
      id: `p${i}`,
      name: isUser ? 'あなた' : BOT_NAMES[botIdx % BOT_NAMES.length],
      type: isUser ? 'user' : BOT_TYPES[botIdx % BOT_TYPES.length],
      stack,
      holeCards: [],
      position,
      seatIndex: i,
      bet: 0,
      totalBetInHand: 0,
      folded: false,
      allin: false,
      isUser,
      hasActed: false,
      lastAction: null,
    })
    if (!isUser) botCount++
  }

  const deck = shuffle(createDeck())
  let remaining = deck

  // deal 2 hole cards to each player
  const updatedPlayers = players.map(p => {
    const { cards, remaining: r } = deal(remaining, 2)
    remaining = r
    return { ...p, holeCards: cards }
  })

  // post blinds
  const withBlinds = updatedPlayers.map(p => {
    if (p.position === 'SB') {
      const amount = Math.min(SMALL_BLIND, p.stack)
      return { ...p, stack: p.stack - amount, bet: amount, totalBetInHand: amount }
    }
    if (p.position === 'BB') {
      const amount = Math.min(BIG_BLIND, p.stack)
      return { ...p, stack: p.stack - amount, bet: amount, totalBetInHand: amount }
    }
    return p
  })

  // collect blinds into pot
  const potAmount = withBlinds.reduce((sum, p) => sum + p.bet, 0)

  const bbIndex = withBlinds.findIndex(p => p.position === 'BB')
  const firstToAct = (bbIndex + 1) % count

  return {
    street: 'PREFLOP_BETTING',
    players: withBlinds,
    board: [],
    pots: [{ amount: potAmount, eligiblePlayerIds: withBlinds.map(p => p.id) }],
    currentBet: BIG_BLIND,
    minRaise: BIG_BLIND * 2,
    actionIndex: firstToAct,
    buttonIndex,
    handNumber: opts.handNumber ?? 1,
    deck: remaining,
    actionHistory: [],
    handOver: false,
  }
}

/** 連続プレイ用: ボタンを時計回りに回し、スタックを引き継いで次のハンドを開始 */
export function nextHand(state: GameState, userSeatIndex: number = 0): GameState {
  const count = state.players.length
  return createGame(count, userSeatIndex, {
    buttonIndex: (state.buttonIndex + 1) % count,
    stacks: state.players.map(p => p.stack),
    handNumber: state.handNumber + 1,
  })
}

export interface LegalAction {
  type: ActionType
  minAmount: number
  maxAmount: number
}

export function getLegalActions(state: GameState): LegalAction[] {
  const actor = state.players[state.actionIndex]
  if (!actor || actor.folded || actor.allin) return []

  const actions: LegalAction[] = []
  const callAmount = Math.max(0, state.currentBet - actor.bet)

  actions.push({ type: 'fold', minAmount: 0, maxAmount: 0 })

  if (callAmount === 0) {
    actions.push({ type: 'check', minAmount: 0, maxAmount: 0 })
  } else {
    const actualCall = Math.min(callAmount, actor.stack)
    actions.push({ type: 'call', minAmount: actualCall, maxAmount: actualCall })
  }

  // can raise/bet only if stack > call amount
  if (actor.stack > callAmount) {
    if (state.currentBet === 0) {
      const minBet = Math.min(BIG_BLIND, actor.stack)
      actions.push({ type: 'bet', minAmount: minBet, maxAmount: actor.stack })
    } else {
      const minRaiseTotal = Math.min(state.minRaise, actor.stack + actor.bet)
      actions.push({ type: 'raise', minAmount: minRaiseTotal, maxAmount: actor.stack + actor.bet })
    }
  }

  actions.push({ type: 'allin', minAmount: actor.stack, maxAmount: actor.stack })

  return actions
}

export function applyAction(state: GameState, action: Action): GameState {
  const players = state.players.map(p => ({ ...p }))
  const actor = players.find(p => p.id === action.playerId)!
  const pots = state.pots.map(pot => ({ ...pot, eligiblePlayerIds: [...pot.eligiblePlayerIds] }))

  let newCurrentBet = state.currentBet
  let newMinRaise = state.minRaise

  switch (action.type) {
    case 'fold':
      actor.folded = true
      pots.forEach(pot => {
        pot.eligiblePlayerIds = pot.eligiblePlayerIds.filter(id => id !== actor.id)
      })
      break

    case 'check':
      break

    case 'call': {
      const callAmount = Math.min(action.amount, actor.stack)
      actor.stack -= callAmount
      actor.bet += callAmount
      actor.totalBetInHand += callAmount
      addToPot(pots, callAmount, [actor.id])
      if (actor.stack === 0) actor.allin = true
      break
    }

    case 'bet':
    case 'raise': {
      // amount is the total bet from this player this street
      const additionalAmount = action.amount - actor.bet
      const paid = Math.min(additionalAmount, actor.stack)
      actor.stack -= paid
      actor.totalBetInHand += paid
      actor.bet += paid
      addToPot(pots, paid, [actor.id])
      const raise = actor.bet - newCurrentBet
      newMinRaise = actor.bet + raise
      newCurrentBet = actor.bet
      if (actor.stack === 0) actor.allin = true
      break
    }

    case 'allin': {
      const paid = actor.stack
      actor.totalBetInHand += paid
      actor.bet += paid
      actor.stack = 0
      actor.allin = true
      addToPot(pots, paid, [actor.id])
      if (actor.bet > newCurrentBet) {
        const raise = actor.bet - newCurrentBet
        newMinRaise = actor.bet + raise
        newCurrentBet = actor.bet
      }
      break
    }
  }

  // Mark that actor has made a decision this street
  actor.hasActed = true
  actor.lastAction = { type: action.type, amount: action.amount }

  const nextIndex = nextActionIndex(players, state.actionIndex, newCurrentBet)

  const newHistory = [...state.actionHistory, { ...action, street: state.street }]

  return {
    ...state,
    players,
    pots,
    currentBet: newCurrentBet,
    minRaise: newMinRaise,
    actionIndex: nextIndex,
    actionHistory: newHistory,
  }
}

function addToPot(pots: Pot[], amount: number, _playerIds: string[]): void {
  // add to last pot (simplified — side pots handled at showdown via totalBetInHand)
  if (pots.length === 0) {
    pots.push({ amount, eligiblePlayerIds: [] })
    return
  }
  pots[pots.length - 1].amount += amount
}

function nextActionIndex(players: Player[], currentIndex: number, currentBet: number): number {
  const count = players.length
  // Priority 1: players who still owe chips (must call or re-raise)
  for (let i = 1; i < count; i++) {
    const idx = (currentIndex + i) % count
    const p = players[idx]
    if (!p.folded && !p.allin && p.bet < currentBet) return idx
  }
  // Priority 2: players who haven't acted yet this street (e.g. BB option)
  for (let i = 1; i < count; i++) {
    const idx = (currentIndex + i) % count
    const p = players[idx]
    if (!p.folded && !p.allin && !p.hasActed) return idx
  }
  return -1
}

export function isBettingClosed(state: GameState): boolean {
  const active = state.players.filter(p => !p.folded && !p.allin)
  if (active.length <= 1) return true
  const allMatched = active.every(p => p.bet === state.currentBet)
  const allActed = active.every(p => p.hasActed)
  return allMatched && allActed
}

export function advanceStreet(state: GameState): GameState {
  const transitions: Record<string, string> = {
    PREFLOP_BETTING: 'FLOP',
    FLOP_BETTING: 'TURN',
    TURN_BETTING: 'RIVER',
    RIVER_BETTING: 'SHOWDOWN',
    FLOP: 'FLOP_BETTING',
    TURN: 'TURN_BETTING',
    RIVER: 'RIVER_BETTING',
    SHOWDOWN: 'PAYOUT',
  }

  // If only one non-folded player remains, skip directly to showdown
  const nonFolded = state.players.filter(p => !p.folded)
  if (nonFolded.length <= 1 && state.street !== 'SHOWDOWN' && state.street !== 'PAYOUT') {
    return {
      ...state,
      street: 'SHOWDOWN',
      players: state.players.map(p => ({ ...p, bet: 0, hasActed: false, lastAction: null })),
    }
  }

  const nextStreet = transitions[state.street]
  if (!nextStreet) return state

  // reset bets, hasActed, and lastAction for new betting round
  const resetPlayers = state.players.map(p => ({ ...p, bet: 0, hasActed: false, lastAction: null }))

  let newBoard = [...state.board]
  let newDeck = [...state.deck]

  if (state.street === 'PREFLOP_BETTING') {
    const { cards, remaining } = deal(newDeck, 3)
    newBoard = [...newBoard, ...cards]
    newDeck = remaining
  } else if (state.street === 'FLOP_BETTING') {
    const { cards, remaining } = deal(newDeck, 1)
    newBoard = [...newBoard, ...cards]
    newDeck = remaining
  } else if (state.street === 'TURN_BETTING') {
    const { cards, remaining } = deal(newDeck, 1)
    newBoard = [...newBoard, ...cards]
    newDeck = remaining
  }

  // First to act postflop: first non-folded non-allin after BTN
  const buttonIdx = state.buttonIndex
  let firstActor = -1
  const count = resetPlayers.length
  for (let i = 1; i <= count; i++) {
    const idx = (buttonIdx + i) % count
    const p = resetPlayers[idx]
    if (!p.folded && !p.allin) {
      firstActor = idx
      break
    }
  }

  return {
    ...state,
    street: nextStreet as GameState['street'],
    board: newBoard,
    deck: newDeck,
    players: resetPlayers,
    currentBet: 0,
    minRaise: BIG_BLIND,
    actionIndex: firstActor,
  }
}

export function computePayouts(state: GameState): Map<string, number> {
  const payouts = new Map<string, number>()

  for (const pot of state.pots) {
    const eligible = pot.eligiblePlayerIds
      .map(id => state.players.find(p => p.id === id)!)
      .filter(p => p && !p.folded)

    if (eligible.length === 0) continue
    if (eligible.length === 1) {
      const winner = eligible[0]
      payouts.set(winner.id, (payouts.get(winner.id) ?? 0) + pot.amount)
      continue
    }

    // Evaluate all eligible players
    const scores = eligible.map(p => ({
      id: p.id,
      score: evaluate([...p.holeCards, ...state.board]).score,
    }))

    const maxScore = Math.max(...scores.map(s => s.score))
    const winners = scores.filter(s => s.score === maxScore)

    const share = Math.floor(pot.amount / winners.length)
    const remainder = pot.amount % winners.length

    for (let i = 0; i < winners.length; i++) {
      const extra = i === 0 ? remainder : 0
      payouts.set(winners[i].id, (payouts.get(winners[i].id) ?? 0) + share + extra)
    }
  }

  return payouts
}
