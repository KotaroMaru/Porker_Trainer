export type Suit = 'c' | 'd' | 'h' | 's'
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14

export interface Card {
  rank: Rank
  suit: Suit
}

export type Position = 'UTG' | 'UTG+1' | 'MP' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB'

export type Street = 'DEAL' | 'PREFLOP_BETTING' | 'FLOP' | 'FLOP_BETTING' | 'TURN' | 'TURN_BETTING' | 'RIVER' | 'RIVER_BETTING' | 'SHOWDOWN' | 'PAYOUT'

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin'

export interface Action {
  type: ActionType
  amount: number
  playerId: string
  street?: Street
}

export type PlayerType = 'user' | 'station' | 'rock' | 'maniac' | 'reg' | 'fishy'

export interface Player {
  id: string
  name: string
  type: PlayerType
  stack: number
  holeCards: Card[]
  position: Position
  seatIndex: number
  bet: number
  totalBetInHand: number
  folded: boolean
  allin: boolean
  isUser: boolean
  hasActed: boolean
  lastAction?: { type: ActionType; amount: number } | null
}

export interface Pot {
  amount: number
  eligiblePlayerIds: string[]
}

export interface GameState {
  street: Street
  players: Player[]
  board: Card[]
  pots: Pot[]
  currentBet: number
  minRaise: number
  actionIndex: number
  buttonIndex: number
  handNumber: number
  deck: Card[]
  actionHistory: Action[]
  handOver: boolean
}

export type HandCategory =
  | 'HIGH_CARD'
  | 'ONE_PAIR'
  | 'TWO_PAIR'
  | 'THREE_OF_A_KIND'
  | 'STRAIGHT'
  | 'FLUSH'
  | 'FULL_HOUSE'
  | 'FOUR_OF_A_KIND'
  | 'STRAIGHT_FLUSH'
  | 'ROYAL_FLUSH'

export interface HandResult {
  category: HandCategory
  score: number
  cards: Card[]
}
