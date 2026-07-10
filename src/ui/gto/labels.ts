// P5 Step B7(当初B9で計画していたが、B7のStrategyMixBar/RangeHeatGridが先に
// 必要とするため前倒しで作成): GTO練習UI共通のラベル/表示定数。
// PlayScreen.tsxのローカル定義をここに集約し、ReviewScreen.tsx(B9)と共有する。

import type { GradeVerdict } from '../../gto/trainer/grading'

export const ACTION_LABEL_JA: Record<string, string> = {
  check: 'チェック',
  fold: 'フォールド',
  call: 'コール',
  bet33: 'ベット 33%',
  bet75: 'ベット 75%',
  raise55: 'レイズ 55%',
  allin: 'オールイン',
}

export function actionLabelJa(label: string): string {
  return ACTION_LABEL_JA[label] ?? label
}

export const VERDICT_LABEL: Record<GradeVerdict, string> = {
  correct: '○ 正解',
  marginal: '△ 惜しい(境界上の手)',
  incorrect: '✕ 不正解',
}

export const VERDICT_COLOR: Record<GradeVerdict, string> = {
  correct: 'var(--green-light)',
  marginal: 'var(--gold)',
  incorrect: 'var(--red)',
}

const RANK_LABELS: Record<number, string> = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T' }

export function rankLabel(rank: number): string {
  return RANK_LABELS[rank] ?? String(rank)
}

export function suitSymbol(suit: string): string {
  return { c: '♣', d: '♦', h: '♥', s: '♠' }[suit] ?? suit
}
