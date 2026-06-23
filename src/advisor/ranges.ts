import type { Position } from '../engine/types'

// 13x13 grid: rows = rank (A down to 2), cols same
// 's' = suited, 'o' = offsuit, 'p' = pair
// Value: 'open' | '3bet' | 'call' | 'fold' for open raising range
// Encoded as Set of hand strings like 'AKs', 'AKo', 'AA'

type HandCategory = 'open' | 'fold'

const RANKS = ['A','K','Q','J','T','9','8','7','6','5','4','3','2']

function hand(r1: string, r2: string, suited: boolean): string {
  const i1 = RANKS.indexOf(r1)
  const i2 = RANKS.indexOf(r2)
  if (i1 === i2) return `${r1}${r2}` // pair
  if (i1 < i2) return suited ? `${r1}${r2}s` : `${r1}${r2}o`
  return suited ? `${r2}${r1}s` : `${r2}${r1}o`
}

// Position open-raising ranges (TAG / ABC poker baseline)
// Source: standard 6-max TAG ranges
export const OPEN_RANGES: Record<Position, Set<string>> = {
  // 7-8人用の新ポジション: 近いポジションのレンジを流用
  'UTG+1': new Set([
    'AA','KK','QQ','JJ','TT','99','88',
    'AKs','AQs','AJs','ATs','KQs','KJs','QJs',
    'AKo','AQo',
  ]),
  MP: new Set([
    'AA','KK','QQ','JJ','TT','99','88','77',
    'AKs','AQs','AJs','ATs','A9s','KQs','KJs','KTs','QJs','QTs','JTs',
    'AKo','AQo','AJo',
  ]),
  UTG: new Set([
    'AA','KK','QQ','JJ','TT','99','88',
    'AKs','AQs','AJs','ATs','KQs','KJs','QJs',
    'AKo','AQo',
  ]),
  HJ: new Set([
    'AA','KK','QQ','JJ','TT','99','88','77',
    'AKs','AQs','AJs','ATs','A9s','KQs','KJs','KTs','QJs','QTs','JTs',
    'AKo','AQo','AJo',
  ]),
  CO: new Set([
    'AA','KK','QQ','JJ','TT','99','88','77','66',
    'AKs','AQs','AJs','ATs','A9s','A8s','A5s','A4s',
    'KQs','KJs','KTs','K9s','QJs','QTs','Q9s','JTs','J9s','T9s',
    'AKo','AQo','AJo','ATo','KQo','KJo',
  ]),
  BTN: new Set([
    'AA','KK','QQ','JJ','TT','99','88','77','66','55','44',
    'AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s',
    'KQs','KJs','KTs','K9s','K8s','QJs','QTs','Q9s','Q8s','JTs','J9s','J8s','T9s','T8s','98s','87s','76s','65s',
    'AKo','AQo','AJo','ATo','A9o','KQo','KJo','KTo','QJo','QTo','JTo',
  ]),
  SB: new Set([
    'AA','KK','QQ','JJ','TT','99','88','77','66','55',
    'AKs','AQs','AJs','ATs','A9s','A8s','A5s','A4s','A3s',
    'KQs','KJs','KTs','K9s','QJs','QTs','JTs','J9s','T9s','98s','87s',
    'AKo','AQo','AJo','ATo','KQo','KJo','QJo',
  ]),
  // BB: リンプ(コールのみ)で回ってきたとき、レイズして孤立(アイソレート)させる範囲。
  // これ以外の手はフォールドではなく「チェック」して無料でフロップを見る。
  BB: new Set([
    'AA','KK','QQ','JJ','TT','99','88',
    'AKs','AQs','AJs','ATs','KQs','KJs','QJs','JTs',
    'AKo','AQo','AJo','KQo',
  ]),
}

// vs open raise: 3bet range for each position
export const THREEBET_RANGES: Record<Position, Set<string>> = {
  'UTG+1': new Set(['AA','KK','QQ','JJ','AKs','AKo']),
  MP:  new Set(['AA','KK','QQ','JJ','AKs','AKo','AQs']),
  UTG: new Set(['AA','KK','QQ','JJ','AKs','AKo']),
  HJ:  new Set(['AA','KK','QQ','JJ','AKs','AKo','AQs']),
  CO:  new Set(['AA','KK','QQ','JJ','TT','AKs','AKo','AQs','AQo']),
  BTN: new Set(['AA','KK','QQ','JJ','TT','AKs','AKo','AQs','AQo','AJs','KQs']),
  SB:  new Set(['AA','KK','QQ','JJ','TT','AKs','AKo','AQs','AQo']),
  BB:  new Set(['AA','KK','QQ','JJ','TT','AKs','AKo','AQs','AQo','AJs']),
}

// BB call range vs single raise
export const BB_CALL_RANGE = new Set([
  'AA','KK','QQ','JJ','TT','99','88','77','66','55','44','33','22',
  'AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s',
  'KQs','KJs','KTs','K9s','QJs','QTs','Q9s','JTs','J9s','T9s','98s','87s','76s',
  'AKo','AQo','AJo','ATo','A9o','KQo','KJo','QJo',
])

export function handString(rank1: number, rank2: number, suited: boolean): string {
  const RANK_NAMES: Record<number, string> = {
    14:'A',13:'K',12:'Q',11:'J',10:'T',9:'9',8:'8',7:'7',6:'6',5:'5',4:'4',3:'3',2:'2'
  }
  const r1 = RANK_NAMES[rank1]
  const r2 = RANK_NAMES[rank2]
  return hand(r1, r2, suited)
}

export function isInOpenRange(pos: Position, rank1: number, rank2: number, suited: boolean): boolean {
  const h = handString(rank1, rank2, suited)
  return OPEN_RANGES[pos]?.has(h) ?? false
}

export function isIn3betRange(pos: Position, rank1: number, rank2: number, suited: boolean): boolean {
  const h = handString(rank1, rank2, suited)
  return THREEBET_RANGES[pos]?.has(h) ?? false
}

export function isInBBCallRange(rank1: number, rank2: number, suited: boolean): boolean {
  const h = handString(rank1, rank2, suited)
  return BB_CALL_RANGE.has(h)
}

export type PreflopAction = 'open' | '3bet' | 'call' | 'check' | 'fold'

export function getPreflopAdvice(
  pos: Position,
  rank1: number,
  rank2: number,
  suited: boolean,
  facingRaise: boolean,
): PreflopAction {
  if (!facingRaise) {
    if (isInOpenRange(pos, rank1, rank2, suited)) return 'open'
    // BBは誰もレイズしていなければコール額0でチェックできる。
    // 弱い手でもフォールドせず「無料でフロップを見る」のが最善。
    return pos === 'BB' ? 'check' : 'fold'
  }
  if (isIn3betRange(pos, rank1, rank2, suited)) return '3bet'
  if (pos === 'BB' && isInBBCallRange(rank1, rank2, suited)) return 'call'
  return 'fold'
}

// Export grid for study screen
export function getOpenRangeGrid(pos: Position): HandCategory[][] {
  const grid: HandCategory[][] = []
  for (let i = 0; i < 13; i++) {
    grid[i] = []
    for (let j = 0; j < 13; j++) {
      const r1 = RANKS[i]
      const r2 = RANKS[j]
      let h: string
      if (i === j) h = `${r1}${r2}`
      else if (i < j) h = `${r1}${r2}s`
      else h = `${r2}${r1}o`
      grid[i][j] = OPEN_RANGES[pos]?.has(h) ? 'open' : 'fold'
    }
  }
  return grid
}

export type VsRaiseCategory = '3bet' | 'call' | 'fold'

// Grid for "facing a raise" decisions: 3bet / call (BB only) / fold
export function getVsRaiseRangeGrid(pos: Position): VsRaiseCategory[][] {
  const grid: VsRaiseCategory[][] = []
  for (let i = 0; i < 13; i++) {
    grid[i] = []
    for (let j = 0; j < 13; j++) {
      const r1 = RANKS[i]
      const r2 = RANKS[j]
      let h: string
      if (i === j) h = `${r1}${r2}`
      else if (i < j) h = `${r1}${r2}s`
      else h = `${r2}${r1}o`
      if (THREEBET_RANGES[pos]?.has(h)) grid[i][j] = '3bet'
      else if (pos === 'BB' && BB_CALL_RANGE.has(h)) grid[i][j] = 'call'
      else grid[i][j] = 'fold'
    }
  }
  return grid
}
