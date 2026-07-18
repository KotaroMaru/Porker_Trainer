// P11 Phase D-2: DivergenceTallyの永続化(localStorage)。
// settings.ts/dailyChallenge/storage.tsと同じtry-catchパターン(quota超過・
// localStorage非対応環境では既定値へフォールバック・書き込み失敗は無視して練習
// フローを止めない)。キー: poker_trainer_gto_divergence

import { initialDivergenceTally, type DivergenceTally } from './divergence'
import type { ActionBucket } from './actionBucket'

const STORAGE_KEY = 'poker_trainer_gto_divergence'

function isValidBucketRecord(value: unknown): value is Record<ActionBucket, number> {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.fold === 'number' && typeof v.passive === 'number' && typeof v.aggressive === 'number'
}

function isValidTally(value: unknown): value is DivergenceTally {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.decisionCount === 'number' && isValidBucketRecord(v.userCount) && isValidBucketRecord(v.gtoFreqSum)
}

/** 未保存・破損データ・localStorage非対応環境ではinitialDivergenceTally()を返す。 */
export function loadDivergenceTally(): DivergenceTally {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initialDivergenceTally()
    const parsed: unknown = JSON.parse(raw)
    if (!isValidTally(parsed)) return initialDivergenceTally()
    return parsed
  } catch {
    return initialDivergenceTally()
  }
}

/** 保存に失敗しても(quota超過・非対応環境)無視し、練習フローを止めない。 */
export function saveDivergenceTally(tally: DivergenceTally): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tally))
  } catch {
    // localStorage not available / quota exceeded
  }
}

export function resetDivergenceTally(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // best effort
  }
}
