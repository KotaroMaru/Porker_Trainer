import type { Position } from './types'

// ボタンからの時計回り席順 (offset=0がBTN)
// 6人: BTN SB BB UTG HJ CO
// 7人: BTN SB BB UTG UTG+1 HJ CO
// 8人: BTN SB BB UTG UTG+1 MP HJ CO
export function positionsByOffset(tableSize: number): Position[] {
  const early: Position[] =
    tableSize === 8 ? ['UTG', 'UTG+1', 'MP']
    : tableSize === 7 ? ['UTG', 'UTG+1']
    : ['UTG']
  return ['BTN', 'SB', 'BB', ...early, 'HJ', 'CO']
}

// プリフロップ行動順 (UTGが最初、BBが最後)
export function actionOrder(tableSize: number): Position[] {
  const early: Position[] =
    tableSize === 8 ? ['UTG', 'UTG+1', 'MP']
    : tableSize === 7 ? ['UTG', 'UTG+1']
    : ['UTG']
  return [...early, 'HJ', 'CO', 'BTN', 'SB', 'BB']
}

// 後ろの人数 = (tableSize-1) - 行動順index
export function playersBehind(position: Position, tableSize: number = 6): number {
  const order = actionOrder(tableSize)
  const idx = order.indexOf(position)
  if (idx === -1) return 0
  return (tableSize - 1) - idx
}
