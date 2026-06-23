import type { PlayerType } from '../engine/types'

export interface Personality {
  type: PlayerType
  vpip: number
  pfr: number
  aggression: number
  foldToBet: number
  bluffFreq: number
  callDownTendency: number
}

export const PERSONALITIES: Record<Exclude<PlayerType, 'user'>, Personality> = {
  station: {
    type: 'station',
    vpip: 0.65,
    pfr: 0.12,
    aggression: 0.25,
    foldToBet: 0.15,
    bluffFreq: 0.05,
    callDownTendency: 0.80,
  },
  rock: {
    type: 'rock',
    vpip: 0.12,
    pfr: 0.09,
    aggression: 0.20,
    foldToBet: 0.75,
    bluffFreq: 0.03,
    callDownTendency: 0.20,
  },
  maniac: {
    type: 'maniac',
    vpip: 0.70,
    pfr: 0.50,
    aggression: 0.85,
    foldToBet: 0.30,
    bluffFreq: 0.50,
    callDownTendency: 0.40,
  },
  reg: {
    type: 'reg',
    vpip: 0.24,
    pfr: 0.18,
    aggression: 0.55,
    foldToBet: 0.55,
    bluffFreq: 0.18,
    callDownTendency: 0.35,
  },
  fishy: {
    type: 'fishy',
    vpip: 0.55,
    pfr: 0.08,
    aggression: 0.25,
    foldToBet: 0.40,
    bluffFreq: 0.10,
    callDownTendency: 0.55,
  },
}

export const ADVANCED_PERSONALITIES: Record<Exclude<PlayerType, 'user'>, Personality> = {
  station: PERSONALITIES.reg,
  rock: PERSONALITIES.reg,
  maniac: PERSONALITIES.reg,
  reg: PERSONALITIES.reg,
  fishy: PERSONALITIES.reg,
}
