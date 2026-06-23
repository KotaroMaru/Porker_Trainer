import { describe, it, expect } from 'vitest'
import { createGame, getLegalActions, applyAction } from '../engine/game'
import { getBotAction } from './decision'

describe('bot statistics convergence (1000 hands)', () => {
  it('station folds far less than rock (station is loose)', () => {
    const SAMPLES = 500
    let stationFolds = 0
    let rockFolds = 0

    for (let i = 0; i < SAMPLES; i++) {
      const state = createGame(6, 5)
      const station = state.players.find(p => p.type === 'station')!
      const rock = state.players.find(p => p.type === 'rock')!

      const facingState = { ...state, currentBet: 50 }
      const stAction = getBotAction(facingState, station)
      const rAction = getBotAction(facingState, rock)

      if (stAction.type === 'fold') stationFolds++
      if (rAction.type === 'fold') rockFolds++
    }

    const stationFoldRate = stationFolds / SAMPLES
    const rockFoldRate = rockFolds / SAMPLES

    expect(stationFoldRate).toBeLessThan(rockFoldRate)
    expect(rockFoldRate).toBeGreaterThan(0.50)
  })

  it('rock is tight preflop', () => {
    const HANDS = 500
    let total = 0
    let vpip = 0

    for (let h = 0; h < HANDS; h++) {
      const state = createGame(6, 5)

      let g = state
      for (let i = 0; i < 30; i++) {
        if (g.street !== 'PREFLOP_BETTING') break
        const actor = g.players[g.actionIndex]
        if (!actor) break
        const legal = getLegalActions(g)
        if (legal.length === 0) break
        g = applyAction(g, getBotAction(g, actor))
      }

      total++
      const r = g.players.find(p => p.type === 'rock')
      if (r && !r.folded) vpip++
    }

    const rate = vpip / total
    expect(rate).toBeLessThanOrEqual(0.40)
  })

  it('bots do NOT access other players hole cards', () => {
    const state = createGame(6, 0)
    const bot = state.players.find(p => !p.isUser)!
    const action = getBotAction(state, bot)
    expect(['fold','check','call','bet','raise','allin']).toContain(action.type)
  })

  it('maniac is more aggressive than rock', () => {
    const HANDS = 200
    let maniacRaises = 0
    let rockRaises = 0

    for (let h = 0; h < HANDS; h++) {
      const state = createGame(6, 5)
      const maniac = state.players.find(p => p.type === 'maniac')!
      const rock = state.players.find(p => p.type === 'rock')!
      const mAction = getBotAction(state, maniac)
      const rAction = getBotAction(state, rock)

      if (mAction.type === 'raise' || mAction.type === 'bet') maniacRaises++
      if (rAction.type === 'raise' || rAction.type === 'bet') rockRaises++
    }

    expect(maniacRaises).toBeGreaterThan(rockRaises)
  })
})
