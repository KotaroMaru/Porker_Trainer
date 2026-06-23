import type { GameState, Player, Action } from '../engine/types'
import { getLegalActions } from '../engine/game'
import { evaluate } from '../engine/evaluator'
import { PERSONALITIES, type Personality } from './personality'

const BIG_BLIND = 50

// Preflop hand tier (simplified): 1=premium, 2=strong, 3=playable, 4=marginal, 5=trash
function preflopTier(rank1: number, rank2: number, suited: boolean): number {
  const high = Math.max(rank1, rank2)
  const low = Math.min(rank1, rank2)
  const isPair = rank1 === rank2
  const gap = high - low

  if (isPair && high >= 10) return 1
  if (isPair && high >= 7) return 2
  if (isPair) return 3
  if (high === 14 && low >= 11) return suited ? 1 : 1
  if (high === 14 && low >= 9) return suited ? 1 : 2
  if (high >= 13 && gap <= 2 && suited) return 2
  if (high >= 12 && gap <= 1) return 2
  if (high >= 11 && gap <= 2 && suited) return 2
  if (high >= 10 && gap === 0 && suited) return 2
  if (gap <= 2 && suited && high >= 7) return 3
  if (high >= 12 && gap <= 3) return 3
  if (isPair) return 3
  return high >= 10 ? 4 : 5
}

function jitter(value: number, amount = 0.10): number {
  return value + (Math.random() * 2 - 1) * amount
}

// Returns the total amount to put in (not the additional amount)
export function getBotAction(state: GameState, bot: Player): Action {
  const legal = getLegalActions(state)
  if (legal.length === 0) {
    return { type: 'check', amount: 0, playerId: bot.id }
  }

  const personality = bot.type === 'user' ? null : PERSONALITIES[bot.type as Exclude<typeof bot.type, 'user'>]
  if (!personality) {
    return { type: 'check', amount: 0, playerId: bot.id }
  }

  const isPreflop = state.street === 'PREFLOP_BETTING'

  if (isPreflop) {
    return getPreflopAction(state, bot, personality)
  }
  return getPostflopAction(state, bot, personality)
}

function getPreflopAction(state: GameState, bot: Player, p: Personality): Action {
  const [c1, c2] = bot.holeCards
  const rank1 = c1.rank
  const rank2 = c2.rank
  const suited = c1.suit === c2.suit
  const tier = preflopTier(rank1, rank2, suited)

  const callAmount = state.currentBet - bot.bet
  const facingRaise = state.currentBet > BIG_BLIND

  const vpip = jitter(p.vpip)
  const pfr = jitter(p.pfr)

  // Tier-based thresholds
  const tierThreshold = [0, 1.0, 0.75, 0.55, 0.35, 0.10][tier]

  // Play decision
  const wantsToPlay = Math.random() < vpip && tier <= 3
  const wantsToRaise = Math.random() < pfr && tier <= 2

  if (facingRaise) {
    if (tier === 1 && Math.random() < 0.7) {
      // 3bet with premiums
      const raiseAction = legal(state, 'raise')
      if (raiseAction) {
        const raiseTotal = Math.min(state.currentBet * 3, bot.stack + bot.bet)
        return { type: 'raise', amount: raiseTotal, playerId: bot.id }
      }
    }
    const callProb = Math.min(1, tierThreshold * (1 - p.foldToBet))
    if (Math.random() < callProb && callAmount <= bot.stack) {
      return { type: 'call', amount: callAmount, playerId: bot.id }
    }
    return { type: 'fold', amount: 0, playerId: bot.id }
  }

  // No raise facing (limping or open)
  if (wantsToRaise && legal(state, 'raise')) {
    const raiseTotal = Math.min(BIG_BLIND * 3, bot.stack + bot.bet)
    return { type: 'raise', amount: raiseTotal, playerId: bot.id }
  }

  if (state.currentBet === 0 && legal(state, 'check')) {
    return { type: 'check', amount: 0, playerId: bot.id }
  }

  if (wantsToPlay && callAmount <= bot.stack) {
    return { type: 'call', amount: callAmount, playerId: bot.id }
  }

  if (legal(state, 'check')) {
    return { type: 'check', amount: 0, playerId: bot.id }
  }

  return { type: 'fold', amount: 0, playerId: bot.id }
}

function getPostflopAction(state: GameState, bot: Player, p: Personality): Action {
  // Simple equity estimate from current made hand
  const allCards = [...bot.holeCards, ...state.board]
  const result = allCards.length >= 5 ? evaluate(allCards) : null

  // Map hand category to rough equity estimate
  const categoryEquity: Record<string, number> = {
    ROYAL_FLUSH: 0.99, STRAIGHT_FLUSH: 0.98, FOUR_OF_A_KIND: 0.97,
    FULL_HOUSE: 0.93, FLUSH: 0.85, STRAIGHT: 0.80,
    THREE_OF_A_KIND: 0.68, TWO_PAIR: 0.60, ONE_PAIR: 0.45, HIGH_CARD: 0.25,
  }
  const baseEquity = result ? (categoryEquity[result.category] ?? 0.25) : 0.25
  const equity = jitter(baseEquity, 0.08)

  const facingBet = state.currentBet > 0
  const callAmount = state.currentBet - bot.bet
  const potTotal = state.pots.reduce((s, pt) => s + pt.amount, 0)
  const requiredEquity = callAmount > 0 ? callAmount / (potTotal + callAmount) : 0

  const aggression = jitter(p.aggression)
  const foldToBet = jitter(p.foldToBet)
  const callDown = jitter(p.callDownTendency)
  const bluff = jitter(p.bluffFreq)

  if (facingBet) {
    // Big-bet sanity guard: don't stack off with a mediocre hand against an
    // overbet (keeps bots from going broke constantly in continuous play)
    const betRatio = potTotal > 0 ? callAmount / potTotal : 1
    if (betRatio > 1.0 && equity < 0.75 && Math.random() > callDown * 0.4) {
      return { type: 'fold', amount: 0, playerId: bot.id }
    }
    // Never call off more than half the stack without a strong hand
    if (callAmount > bot.stack * 0.5 && equity < 0.80) {
      return { type: 'fold', amount: 0, playerId: bot.id }
    }

    if (equity >= requiredEquity) {
      if (equity > 0.70 && aggression > 0.5 && legal(state, 'raise')) {
        // cap raise size to keep pots reasonable
        const raiseTotal = Math.min(
          state.currentBet * 2 + Math.floor(potTotal * 0.5),
          bot.stack + bot.bet,
        )
        return { type: 'raise', amount: raiseTotal, playerId: bot.id }
      }
      // callDownTendency adjusts willingness to call with marginal equity
      if (equity >= requiredEquity * (1 - callDown * 0.5)) {
        if (callAmount <= bot.stack) {
          return { type: 'call', amount: callAmount, playerId: bot.id }
        }
        return { type: 'allin', amount: bot.stack, playerId: bot.id }
      }
    }

    // Fold or call based on personality
    if (Math.random() < foldToBet && equity < requiredEquity) {
      return { type: 'fold', amount: 0, playerId: bot.id }
    }
    // station / callDownTendency: call even below required equity
    if (Math.random() < callDown && callAmount <= bot.stack) {
      return { type: 'call', amount: callAmount, playerId: bot.id }
    }
    return { type: 'fold', amount: 0, playerId: bot.id }
  }

  // No bet facing
  if (equity > 0.55 && Math.random() < aggression && legal(state, 'bet')) {
    const betSize = Math.floor(potTotal * (0.5 + aggression * 0.3))
    const betTotal = Math.min(betSize, bot.stack)
    return { type: 'bet', amount: betTotal, playerId: bot.id }
  }

  // Bluff
  if (equity < 0.35 && Math.random() < bluff && legal(state, 'bet')) {
    const bluffSize = Math.floor(potTotal * 0.5)
    const betTotal = Math.min(bluffSize, bot.stack)
    return { type: 'bet', amount: betTotal, playerId: bot.id }
  }

  if (legal(state, 'check')) {
    return { type: 'check', amount: 0, playerId: bot.id }
  }

  return { type: 'fold', amount: 0, playerId: bot.id }
}

function legal(state: GameState, type: string) {
  return getLegalActions(state).find(a => a.type === type)
}
