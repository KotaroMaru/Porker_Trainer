import { DAILY_RATING_INITIAL } from './dailyChallenge'

const RESULTS_KEY = 'poker_trainer_gto_daily_results'
const RANK_KEY = 'poker_trainer_gto_daily_rank'
const RESULT_CAP = 90

export interface DailyStoredResult {
  score: number
  correctCount: number
  totalEvLossBb: number
  handCount: number
}

export function loadDailyResults(): Record<string, DailyStoredResult> {
  try {
    const raw = localStorage.getItem(RESULTS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, DailyStoredResult> : {}
  } catch {
    return {}
  }
}

export function saveDailyResult(dateKey: string, result: DailyStoredResult): void {
  try {
    const entries = Object.entries({ ...loadDailyResults(), [dateKey]: result }).sort(([a], [b]) => b.localeCompare(a)).slice(0, RESULT_CAP)
    localStorage.setItem(RESULTS_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // localStorage非対応・quota超過時も練習フローは止めない。
  }
}

export function loadDailyRank(): number {
  try {
    const raw = localStorage.getItem(RANK_KEY)
    if (raw === null) return DAILY_RATING_INITIAL
    const value = Number(raw)
    return Number.isFinite(value) && value >= 0 ? value : DAILY_RATING_INITIAL
  } catch {
    return DAILY_RATING_INITIAL
  }
}

export function saveDailyRank(rating: number): void {
  try {
    localStorage.setItem(RANK_KEY, String(rating))
  } catch {
    // localStorage非対応でもそのセッション中の状態はstoreが保持する。
  }
}
