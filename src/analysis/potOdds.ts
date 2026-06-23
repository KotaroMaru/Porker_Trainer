export function requiredEquity(callAmount: number, potBeforeCall: number): number {
  if (callAmount <= 0) return 0
  return callAmount / (potBeforeCall + callAmount)
}

export function potOddsRatio(callAmount: number, potBeforeCall: number): string {
  if (callAmount <= 0) return '∞'
  const ratio = potBeforeCall / callAmount
  return `${ratio.toFixed(1)}:1`
}
