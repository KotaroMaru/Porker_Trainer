import {
  DIVERGENCE_VERSION,
  FLOP_PATHS,
  OTHER_FLOP_PATH,
  STREETS,
  TEXTURE_KEYS,
  initialDivergenceStats,
  type DivergenceCell,
  type DivergenceStats,
  type DivergenceTally,
} from './divergence'
import type { ActionBucket } from './actionBucket'

const STORAGE_KEY = 'poker_trainer_gto_divergence'

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isValidBucketRecord(value: unknown): value is Record<ActionBucket, number> {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return isFiniteNumber(v.fold) && isFiniteNumber(v.passive) && isFiniteNumber(v.aggressive)
}

function isValidTally(value: unknown): value is DivergenceTally {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return isFiniteNumber(v.decisionCount) && isValidBucketRecord(v.userCount) && isValidBucketRecord(v.gtoFreqSum)
}

function isValidCell(value: unknown): value is DivergenceCell {
  if (!isValidTally(value)) return false
  const v = value as unknown as Record<string, unknown>
  return isFiniteNumber(v.foldEligibleCount) && isFiniteNumber(v.foldUserCount) && isFiniteNumber(v.foldGtoFreqSum)
}

function isValidStats(value: unknown): value is DivergenceStats {
  if (!isValidCell(value)) return false
  const v = value as unknown as Record<string, unknown>
  if (v.version !== DIVERGENCE_VERSION || !isFiniteNumber(v.legacyDecisionCount)) return false
  const recordsAreValid = (record: unknown, keys: readonly string[]): boolean => {
    if (!record || typeof record !== 'object') return false
    const cells = record as Record<string, unknown>
    return keys.every((key) => isValidCell(cells[key]))
  }
  if (!recordsAreValid(v.byStreet, STREETS)) return false
  if (!recordsAreValid(v.byPath, [...FLOP_PATHS, OTHER_FLOP_PATH])) return false
  if (!recordsAreValid(v.byTexture, TEXTURE_KEYS)) return false
  if (!v.focusTrajectory || typeof v.focusTrajectory !== 'object') return false
  const focus = v.focusTrajectory as Record<string, unknown>
  if (!(focus.scenarioId === null || typeof focus.scenarioId === 'string') || !isValidCell(focus.tally) || !Array.isArray(focus.points)) return false
  return focus.points.every((point) => {
    if (!point || typeof point !== 'object') return false
    const p = point as Record<string, unknown>
    return isFiniteNumber(p.decisionCount) && isFiniteNumber(p.foldEligibleCount) && typeof p.x === 'number' && Number.isFinite(p.x) && typeof p.y === 'number' && Number.isFinite(p.y)
  })
}

/** v1は全体3バケットを保持し、復元不能な条件付きfold集計だけ0から開始する。 */
export function migrateLegacyTally(legacy: DivergenceTally): DivergenceStats {
  return {
    ...initialDivergenceStats(),
    decisionCount: legacy.decisionCount,
    userCount: { ...legacy.userCount },
    gtoFreqSum: { ...legacy.gtoFreqSum },
    legacyDecisionCount: legacy.decisionCount,
  }
}

export function loadDivergenceTally(): DivergenceStats {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initialDivergenceStats()
    const parsed: unknown = JSON.parse(raw)
    if (isValidStats(parsed)) return parsed
    if (isValidTally(parsed)) return migrateLegacyTally(parsed)
    return initialDivergenceStats()
  } catch {
    return initialDivergenceStats()
  }
}

export function saveDivergenceTally(tally: DivergenceStats): void {
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
