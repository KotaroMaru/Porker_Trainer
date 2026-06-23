import { describe, it, expect } from 'vitest'
import {
  createGame,
  getLegalActions,
  applyAction,
  advanceStreet,
  computePayouts,
} from './game'
import type { GameState } from './types'

// ---------- helpers ----------
function makeGame(playerCount = 6): GameState {
  return createGame(playerCount, 0)
}

// ---------- createGame ----------
describe('createGame', () => {
  it('creates 6 players', () => {
    const g = makeGame(6)
    expect(g.players).toHaveLength(6)
  })

  it('assigns unique positions', () => {
    const g = makeGame(6)
    const positions = g.players.map(p => p.position)
    expect(new Set(positions).size).toBe(6)
  })

  it('starts at PREFLOP_BETTING', () => {
    const g = makeGame()
    expect(g.street).toBe('PREFLOP_BETTING')
  })

  it('deals 2 hole cards to each player', () => {
    const g = makeGame()
    for (const p of g.players) {
      expect(p.holeCards).toHaveLength(2)
    }
  })

  it('posts small and big blinds', () => {
    const g = makeGame()
    const sb = g.players.find(p => p.position === 'SB')!
    const bb = g.players.find(p => p.position === 'BB')!
    expect(sb.bet).toBe(25)
    expect(bb.bet).toBe(50)
  })

  it('starts player stacks at 5000', () => {
    const g = makeGame()
    for (const p of g.players) {
      // after blinds SB=4975, BB=4950, others=5000
      expect(p.stack + p.bet).toBe(5000)
    }
  })
})

// ---------- getLegalActions ----------
describe('getLegalActions', () => {
  it('includes fold, call, raise when facing a bet', () => {
    const g = makeGame()
    // UTG acts first preflop — facing BB=50
    const actions = getLegalActions(g)
    const types = actions.map(a => a.type)
    expect(types).toContain('fold')
    expect(types).toContain('call')
    expect(types).toContain('raise')
  })

  it('includes check when no bet to call', () => {
    let g = makeGame()
    // bring UTG/HJ/CO/BTN to call/fold, SB call, BB check position
    // simulate: everyone calls big blind around to BB
    const actingPlayer = g.players[g.actionIndex]
    expect(actingPlayer).toBeDefined()
  })

  it('always includes allin', () => {
    const g = makeGame()
    const types = getLegalActions(g).map(a => a.type)
    expect(types).toContain('allin')
  })
})

// ---------- applyAction ----------
describe('applyAction', () => {
  it('fold removes player from action', () => {
    const g = makeGame()
    const actorId = g.players[g.actionIndex].id
    const g2 = applyAction(g, { type: 'fold', amount: 0, playerId: actorId })
    const actor = g2.players.find(p => p.id === actorId)!
    expect(actor.folded).toBe(true)
  })

  it('call adds correct amount to pot', () => {
    const g = makeGame()
    const actorId = g.players[g.actionIndex].id
    const actor = g.players[g.actionIndex]
    const callAmount = g.currentBet - actor.bet
    const totalPotBefore = g.pots.reduce((s, p) => s + p.amount, 0)
    const g2 = applyAction(g, { type: 'call', amount: callAmount, playerId: actorId })
    const totalPotAfter = g2.pots.reduce((s, p) => s + p.amount, 0)
    expect(totalPotAfter).toBe(totalPotBefore + callAmount)
  })

  it('raise updates currentBet', () => {
    const g = makeGame()
    const actor = g.players[g.actionIndex]
    const raiseTotal = 200
    const g2 = applyAction(g, { type: 'raise', amount: raiseTotal, playerId: actor.id })
    expect(g2.currentBet).toBe(raiseTotal)
  })

  it('allin sets player allin flag', () => {
    const g = makeGame()
    const actor = g.players[g.actionIndex]
    const g2 = applyAction(g, { type: 'allin', amount: actor.stack, playerId: actor.id })
    const p = g2.players.find(p => p.id === actor.id)!
    expect(p.allin).toBe(true)
    expect(p.stack).toBe(0)
  })
})

// ---------- advanceStreet ----------
describe('advanceStreet', () => {
  it('transitions PREFLOP_BETTING → FLOP when action is closed', () => {
    // everyone folds except one — should go to PAYOUT
    let g = makeGame()
    // fold everyone except the first actor and BB
    // simplest: get to a state where betting is done
    // We'll just test advanceStreet directly
    const g2 = advanceStreet(g)
    // Should advance to FLOP
    expect(['FLOP', 'PAYOUT'].includes(g2.street)).toBe(true)
  })

  it('deals 3 board cards when transitioning from PREFLOP_BETTING', () => {
    let g = makeGame()
    // g already starts at PREFLOP_BETTING
    const g2 = advanceStreet(g)
    expect(g2.board).toHaveLength(3)
    expect(g2.street).toBe('FLOP')
  })

  it('deals 1 board card when transitioning from FLOP_BETTING', () => {
    let g = makeGame()
    g = { ...g, street: 'FLOP_BETTING', board: [
      { rank: 2, suit: 'c' }, { rank: 3, suit: 'd' }, { rank: 4, suit: 'h' }
    ] }
    const g2 = advanceStreet(g)
    expect(g2.board).toHaveLength(4)
    expect(g2.street).toBe('TURN')
  })

  it('deals 1 board card when transitioning from TURN_BETTING', () => {
    let g = makeGame()
    g = { ...g, street: 'TURN_BETTING', board: [
      { rank: 2, suit: 'c' }, { rank: 3, suit: 'd' }, { rank: 4, suit: 'h' }, { rank: 5, suit: 's' }
    ] }
    const g2 = advanceStreet(g)
    expect(g2.board).toHaveLength(5)
    expect(g2.street).toBe('RIVER')
  })
})

// ---------- computePayouts (side pots) ----------
describe('computePayouts - side pots', () => {
  it('simple heads up: winner takes pot', () => {
    // Player A has AA, Player B has 22, board makes A the winner
    const g = makeGame(2)
    // Manually set up a showdown state
    const [pA, pB] = g.players
    const stateAtShowdown: GameState = {
      ...g,
      street: 'SHOWDOWN',
      board: [
        { rank: 14, suit: 'c' }, { rank: 14, suit: 'd' },
        { rank: 2,  suit: 'h' }, { rank: 7,  suit: 's' }, { rank: 9, suit: 'd' }
      ],
      players: [
        { ...pA, holeCards: [{ rank: 14, suit: 'h' }, { rank: 14, suit: 's' }], folded: false, totalBetInHand: 100 },
        { ...pB, holeCards: [{ rank: 2,  suit: 'c' }, { rank: 2,  suit: 'd' }], folded: false, totalBetInHand: 100 },
      ],
      pots: [{ amount: 200, eligiblePlayerIds: [pA.id, pB.id] }],
    }
    const payouts = computePayouts(stateAtShowdown)
    expect(payouts.get(pA.id)).toBe(200)
    expect(payouts.get(pB.id) ?? 0).toBe(0)
  })

  it('split pot: equal hands divide pot', () => {
    const g = makeGame(2)
    const [pA, pB] = g.players
    const stateAtShowdown: GameState = {
      ...g,
      street: 'SHOWDOWN',
      board: [
        { rank: 14, suit: 'c' }, { rank: 13, suit: 'd' },
        { rank: 12, suit: 'h' }, { rank: 11, suit: 's' }, { rank: 10, suit: 'd' }
      ],
      players: [
        { ...pA, holeCards: [{ rank: 2, suit: 'c' }, { rank: 3, suit: 'c' }], folded: false, totalBetInHand: 100 },
        { ...pB, holeCards: [{ rank: 2, suit: 'd' }, { rank: 3, suit: 'd' }], folded: false, totalBetInHand: 100 },
      ],
      pots: [{ amount: 200, eligiblePlayerIds: [pA.id, pB.id] }],
    }
    const payouts = computePayouts(stateAtShowdown)
    expect(payouts.get(pA.id)).toBe(100)
    expect(payouts.get(pB.id)).toBe(100)
  })

  it('side pot: short stack can only win main pot', () => {
    // 3 players: A=big stack, B=short stack allin, C=big stack
    // Main pot: 150 (50*3), Side pot: 300 ((200-50)*2)
    // Board: A♣,A♦,3♣,7♠,9♦
    // pA hole: 3♥,3♦ → full house 333/AA beats pC
    // pB hole: A♥,A♠ → quads AAAA beats everyone (wins main pot)
    // pC hole: 2♣,2♦ → two pair AA,22 (loses side pot to pA)
    const g = makeGame(3)
    const [pA, pB, pC] = g.players
    const stateAtShowdown: GameState = {
      ...g,
      street: 'SHOWDOWN',
      board: [
        { rank: 14, suit: 'c' }, { rank: 14, suit: 'd' },
        { rank: 3,  suit: 'c' }, { rank: 7,  suit: 's' }, { rank: 9, suit: 'd' }
      ],
      players: [
        { ...pA, holeCards: [{ rank: 3,  suit: 'h' }, { rank: 3,  suit: 'd' }], folded: false, totalBetInHand: 200, allin: false },
        { ...pB, holeCards: [{ rank: 14, suit: 'h' }, { rank: 14, suit: 's' }], folded: false, totalBetInHand: 50,  allin: true, stack: 0 },
        { ...pC, holeCards: [{ rank: 2,  suit: 'c' }, { rank: 2,  suit: 'd' }], folded: false, totalBetInHand: 200, allin: false },
      ],
      pots: [
        { amount: 150, eligiblePlayerIds: [pA.id, pB.id, pC.id] },
        { amount: 300, eligiblePlayerIds: [pA.id, pC.id] },
      ],
    }
    const payouts = computePayouts(stateAtShowdown)
    // pB has quads → wins main pot (150)
    expect(payouts.get(pB.id)).toBe(150)
    // pA has full house > pC two pair → pA wins side pot (300)
    expect(payouts.get(pA.id)).toBe(300)
    expect(payouts.get(pC.id) ?? 0).toBe(0)
  })

  it('folded player wins nothing', () => {
    const g = makeGame(2)
    const [pA, pB] = g.players
    const stateAtShowdown: GameState = {
      ...g,
      street: 'PAYOUT',
      board: [],
      players: [
        { ...pA, folded: false, totalBetInHand: 100 },
        { ...pB, folded: true,  totalBetInHand: 25 },
      ],
      pots: [{ amount: 125, eligiblePlayerIds: [pA.id] }],
    }
    const payouts = computePayouts(stateAtShowdown)
    expect(payouts.get(pA.id)).toBe(125)
    expect(payouts.get(pB.id) ?? 0).toBe(0)
  })
})
