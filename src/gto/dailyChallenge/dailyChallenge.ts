import { createSeededRng } from './seededRng'
import type { GradeVerdict } from '../trainer/grading'

export const DAILY_HAND_COUNT = 10
export const DAILY_SCORE_BASELINE = 50
export const DAILY_RATING_INITIAL = 1000

export interface DailySpotSeeds {
  scenarioRng: () => number
  flopRng: () => number
  seatRng: () => number
}

export interface DailyAnswer {
  verdict: GradeVerdict
  evLossBb: number
}

export interface DailyScore {
  correctCount: number
  totalEvLossBb: number
  score: number
}

export function dailyDateKey(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function pickDailySpotSeeds(dateKey: string, count: number = DAILY_HAND_COUNT): DailySpotSeeds[] {
  return Array.from({ length: count }, (_, index) => ({
    scenarioRng: createSeededRng(`${dateKey}-scenario-${index}`),
    flopRng: createSeededRng(`${dateKey}-flop-${index}`),
    seatRng: createSeededRng(`${dateKey}-seat-${index}`),
  }))
}

/** 正解を70%、EVロスの少なさを30%として0〜100点へ正規化する。marginalは半正解。 */
export function computeDailyScore(results: DailyAnswer[]): DailyScore {
  const correctCount = results.filter((result) => result.verdict === 'correct').length
  const correctPoints = results.reduce((sum, result) => sum + (result.verdict === 'correct' ? 1 : result.verdict === 'marginal' ? 0.5 : 0), 0)
  const totalEvLossBb = results.reduce((sum, result) => sum + Math.max(0, result.evLossBb), 0)
  const accuracyScore = results.length === 0 ? 0 : (correctPoints / results.length) * 70
  const evScore = results.length === 0 ? 0 : Math.max(0, 1 - totalEvLossBb / (results.length * 2)) * 30
  return { correctCount, totalEvLossBb, score: Math.round(Math.min(100, Math.max(0, accuracyScore + evScore))) }
}

/** 基準50点との差を5分の1で反映し、1日あたりの変動は±10に制限する。 */
export function applyDailyResultToRank(currentRating: number, score: number): number {
  const delta = Math.max(-10, Math.min(10, Math.round((score - DAILY_SCORE_BASELINE) / 5)))
  return Math.max(0, currentRating + delta)
}
