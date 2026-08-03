import type { ActionBreakdownEntry } from '../trainer/grading'
import { bucketOf, type ActionBucket } from './actionBucket'

const BUCKETS: readonly ActionBucket[] = ['fold', 'passive', 'aggressive']

/** 30件未満の比率は標本誤差を実力差と誤読しやすいため、点・数値を表示しない。 */
export const MIN_DIVERGENCE_SAMPLE = 30
export const NEAR_GTO_THRESHOLD = 0.05
export const TRAJECTORY_INTERVAL = 25
export const MAX_TRAJECTORY_POINTS = 40
export const DIVERGENCE_VERSION = 2 as const

export const STREETS = ['flop', 'turn', 'river'] as const
export type DivergenceStreet = (typeof STREETS)[number]

/** turnPaths.test.tsが正典とする、ターンへ到達する9つのフロップ経路。 */
export const FLOP_PATHS = [
  'check-check',
  'check-bet33-call',
  'check-bet33-raise55-call',
  'check-bet75-call',
  'check-bet75-raise55-call',
  'bet33-call',
  'bet33-raise55-call',
  'bet75-call',
  'bet75-raise55-call',
] as const
export const OTHER_FLOP_PATH = 'other' as const
export type FlopPathKey = (typeof FLOP_PATHS)[number] | typeof OTHER_FLOP_PATH

export const TEXTURE_KEYS = [
  'monotone-unpaired',
  'monotone-paired',
  'twoTone-unpaired',
  'twoTone-paired',
  'rainbow-unpaired',
  'rainbow-paired',
] as const
export type TextureKey = (typeof TEXTURE_KEYS)[number]

export interface TextureFlags {
  paired: boolean
  monotone: boolean
  twoTone: boolean
}

export function textureKeyOf(texture: TextureFlags): TextureKey {
  const suitClass = texture.monotone ? 'monotone' : texture.twoTone ? 'twoTone' : 'rainbow'
  return `${suitClass}-${texture.paired ? 'paired' : 'unpaired'}` as TextureKey
}

/** v1の保存形式。v2でも先頭3フィールドを維持し、旧テスト/APIとの互換性を保つ。 */
export interface DivergenceTally {
  decisionCount: number
  userCount: Record<ActionBucket, number>
  gtoFreqSum: Record<ActionBucket, number>
}

export interface ConditionalFoldTally {
  foldEligibleCount: number
  foldUserCount: number
  foldGtoFreqSum: number
}

export interface DivergenceCell extends DivergenceTally, ConditionalFoldTally {}

export interface DivergencePoint {
  decisionCount: number
  foldEligibleCount: number
  x: number
  y: number
}

export interface FocusTrajectory {
  scenarioId: string | null
  tally: DivergenceCell
  points: DivergencePoint[]
}

export interface DivergenceStats extends DivergenceCell {
  version: typeof DIVERGENCE_VERSION
  /** v1から継承した件数。Xには使えるが、条件付きYには使えない。 */
  legacyDecisionCount: number
  byStreet: Record<DivergenceStreet, DivergenceCell>
  byPath: Record<FlopPathKey, DivergenceCell>
  byTexture: Record<TextureKey, DivergenceCell>
  focusTrajectory: FocusTrajectory
}

export interface DivergenceContext {
  street: DivergenceStreet
  flopPath: string
  texture: TextureFlags
  focusScenarioId: string | null
}

export function initialDivergenceTally(): DivergenceCell {
  return {
    decisionCount: 0,
    userCount: { fold: 0, passive: 0, aggressive: 0 },
    gtoFreqSum: { fold: 0, passive: 0, aggressive: 0 },
    foldEligibleCount: 0,
    foldUserCount: 0,
    foldGtoFreqSum: 0,
  }
}

function cellsFor<T extends readonly string[]>(keys: T): Record<T[number], DivergenceCell> {
  return Object.fromEntries(keys.map((key) => [key, initialDivergenceTally()])) as Record<T[number], DivergenceCell>
}

export function initialDivergenceStats(): DivergenceStats {
  return {
    version: DIVERGENCE_VERSION,
    ...initialDivergenceTally(),
    legacyDecisionCount: 0,
    byStreet: cellsFor(STREETS),
    byPath: cellsFor([...FLOP_PATHS, OTHER_FLOP_PATH] as const),
    byTexture: cellsFor(TEXTURE_KEYS),
    focusTrajectory: { scenarioId: null, tally: initialDivergenceTally(), points: [] },
  }
}

/** 1決断を取り込む。fold軸はbreakdownにfoldが存在する決断だけを別集計する。 */
export function accumulateDivergence(
  tally: DivergenceCell,
  breakdown: readonly ActionBreakdownEntry[],
  chosenLabel: string,
): DivergenceCell {
  const userCount = { ...tally.userCount }
  const gtoFreqSum = { ...tally.gtoFreqSum }
  const chosenBucket = bucketOf(chosenLabel)
  userCount[chosenBucket] += 1
  const freqTotal = breakdown.reduce((sum, entry) => sum + entry.freq, 0)
  if (!(freqTotal > 0)) throw new Error('accumulateDivergence: actionBreakdown frequency total must be positive')
  // .binのFloat32量子化で合計が1から微小にずれる場合も、3バケット恒等式を保つため
  // 決断単位で再正規化する。分類後の合計ではなく入力全体を分母にするので情報は落ちない。
  for (const entry of breakdown) gtoFreqSum[bucketOf(entry.label)] += entry.freq / freqTotal

  const foldEntry = breakdown.find((entry) => bucketOf(entry.label) === 'fold')
  return {
    decisionCount: tally.decisionCount + 1,
    userCount,
    gtoFreqSum,
    foldEligibleCount: tally.foldEligibleCount + (foldEntry ? 1 : 0),
    foldUserCount: tally.foldUserCount + (foldEntry && chosenBucket === 'fold' ? 1 : 0),
    foldGtoFreqSum: tally.foldGtoFreqSum + (foldEntry ? foldEntry.freq / freqTotal : 0),
  }
}

function pathKeyOf(path: string): FlopPathKey {
  return (FLOP_PATHS as readonly string[]).includes(path) ? (path as FlopPathKey) : OTHER_FLOP_PATH
}

function graphPoint(cell: DivergenceCell): DivergencePoint {
  const aggressiveDiff = cell.decisionCount === 0 ? 0 : (cell.userCount.aggressive - cell.gtoFreqSum.aggressive) / cell.decisionCount
  const foldDiff = cell.foldEligibleCount === 0 ? 0 : (cell.foldUserCount - cell.foldGtoFreqSum) / cell.foldEligibleCount
  return { decisionCount: cell.decisionCount, foldEligibleCount: cell.foldEligibleCount, x: aggressiveDiff, y: -foldDiff }
}

/**
 * Xは全決断を分母にする。通常の意思決定ではbet/raiseの少なくとも一方を選べるためで、
 * 例外的に攻めを選べないノードも「攻めなかった決断」として母集団に含める。
 * Yだけは尺度を揃えるためfold可能ノードに条件付ける。従って基礎3バケット恒等式の
 * fold差分と、グラフYの条件付きfold差分は意図的に別の統計量である。
 */
export function accumulateDivergenceStats(
  stats: DivergenceStats,
  breakdown: readonly ActionBreakdownEntry[],
  chosenLabel: string,
  context: DivergenceContext,
): DivergenceStats {
  const overall = accumulateDivergence(stats, breakdown, chosenLabel)
  const streetCell = accumulateDivergence(stats.byStreet[context.street], breakdown, chosenLabel)
  const pathKey = pathKeyOf(context.flopPath)
  const pathCell = accumulateDivergence(stats.byPath[pathKey], breakdown, chosenLabel)
  const textureKey = textureKeyOf(context.texture)
  const textureCell = accumulateDivergence(stats.byTexture[textureKey], breakdown, chosenLabel)

  let focusTrajectory = stats.focusTrajectory
  if (context.focusScenarioId) {
    const sameFocus = focusTrajectory.scenarioId === context.focusScenarioId
    const focusTally = accumulateDivergence(sameFocus ? focusTrajectory.tally : initialDivergenceTally(), breakdown, chosenLabel)
    let points = sameFocus ? focusTrajectory.points : []
    if (focusTally.decisionCount % TRAJECTORY_INTERVAL === 0) {
      points = [...points, graphPoint(focusTally)].slice(-MAX_TRAJECTORY_POINTS)
    }
    focusTrajectory = { scenarioId: context.focusScenarioId, tally: focusTally, points }
  }

  return {
    ...stats,
    ...overall,
    byStreet: { ...stats.byStreet, [context.street]: streetCell },
    byPath: { ...stats.byPath, [pathKey]: pathCell },
    byTexture: { ...stats.byTexture, [textureKey]: textureCell },
    focusTrajectory,
  }
}

export interface DivergenceBucketSummary {
  bucket: ActionBucket
  userRate: number
  gtoRate: number
  diff: number
}

export interface DivergenceSummary {
  count: number
  foldEligibleCount: number
  buckets: DivergenceBucketSummary[]
  point: DivergencePoint
  pointReady: boolean
}

export function summarizeDivergence(tally: DivergenceCell): DivergenceSummary {
  const count = tally.decisionCount
  const buckets = BUCKETS.map((bucket) => {
    const userRate = count === 0 ? 0 : tally.userCount[bucket] / count
    const gtoRate = count === 0 ? 0 : tally.gtoFreqSum[bucket] / count
    return { bucket, userRate, gtoRate, diff: userRate - gtoRate }
  })
  return {
    count,
    foldEligibleCount: tally.foldEligibleCount,
    buckets,
    point: graphPoint(tally),
    pointReady: count >= MIN_DIVERGENCE_SAMPLE && tally.foldEligibleCount >= MIN_DIVERGENCE_SAMPLE,
  }
}

export type DivergenceQuadrant =
  | 'GTOに近い'
  | 'オーバープレイ'
  | 'コーリングステーション'
  | 'タイトパッシブ'
  | '両極端(ベットオアフォールド)'

export function classifyDivergence(x: number, y: number): DivergenceQuadrant {
  if (Math.abs(x) < NEAR_GTO_THRESHOLD && Math.abs(y) < NEAR_GTO_THRESHOLD) return 'GTOに近い'
  if (x >= 0 && y >= 0) return 'オーバープレイ'
  if (x < 0 && y >= 0) return 'コーリングステーション'
  if (x < 0 && y < 0) return 'タイトパッシブ'
  return '両極端(ベットオアフォールド)'
}
