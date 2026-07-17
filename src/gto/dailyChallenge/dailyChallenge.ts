import { createSeededRng } from './seededRng'
import type { GradeVerdict } from '../trainer/grading'
import type { ReviewDecision } from '../trainer/reviewBuilder'

export const DAILY_HAND_COUNT = 10
export const DAILY_SCORE_BASELINE = 50
export const DAILY_RATING_INITIAL = 1000

export interface DailySpotSeeds {
  scenarioRng: () => number
  flopRng: () => number
  seatRng: () => number
  /** P11 Phase C: 通しモード用にFullHandControllerへ渡す専用rng。コンボ配布・ボット行動
   *  サンプリング・ターン/リバーカード決定など、ハンド全体を通じて連続的に呼ばれ続ける
   *  ため、単発の1回きりの抽選で使うscenarioRng/flopRng/seatRngとは責務を分離する。 */
  handRng: () => number
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
    handRng: createSeededRng(`${dateKey}-hand-${index}`),
  }))
}

const VERDICT_SEVERITY: Record<GradeVerdict, number> = { correct: 0, marginal: 1, incorrect: 2 }

/**
 * P11 Phase C: 通しモードの1ハンド(複数決断)を、単発モードと同じ「1回答」形式
 * (DailyAnswer)へ集約する。verdictは決断群の中で最も悪い判定(incorrect > marginal >
 * correctの順で最悪を選ぶ)、evLossBbは各決断のMath.max(0, evLossBb)の合計(単発モードの
 * evLossBb集計・chooseAction/nextTallyと同じ「負値=EV超過分は切り捨て」規約)。
 *
 * decisions.length===0のフォールバック: フロップの先手がボット側(ユーザーがIP)で、
 * ユーザーの手番が一度も来ないうちにボットがフォールドした場合、ReviewData.decisionsは
 * 空になり得る(FullHandControllerはユーザー決断のみをReviewDecisionとして収穫するため)。
 * この場合ユーザーは一切判断していないためペナルティを課さず、correct/evLossBb:0として扱う。
 */
export function aggregateDailyAnswer(decisions: readonly ReviewDecision[]): DailyAnswer {
  if (decisions.length === 0) return { verdict: 'correct', evLossBb: 0 }
  let worstVerdict: GradeVerdict = 'correct'
  let evLossBb = 0
  for (const d of decisions) {
    if (VERDICT_SEVERITY[d.grading.verdict] > VERDICT_SEVERITY[worstVerdict]) worstVerdict = d.grading.verdict
    evLossBb += Math.max(0, d.grading.evLossBb)
  }
  return { verdict: worstVerdict, evLossBb }
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
