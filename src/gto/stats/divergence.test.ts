import { describe, expect, it } from 'vitest'
import type { ActionBreakdownEntry } from '../trainer/grading'
import {
  FLOP_PATHS,
  MIN_DIVERGENCE_SAMPLE,
  NEAR_GTO_THRESHOLD,
  STREETS,
  TEXTURE_KEYS,
  accumulateDivergence,
  accumulateDivergenceStats,
  classifyDivergence,
  initialDivergenceStats,
  initialDivergenceTally,
  summarizeDivergence,
} from './divergence'
import { RECORDED_TURN_BUNDLES } from '../loader/turnBundleSource'

const EPSILON_DIGITS = 9

function breakdown(entries: Record<string, number>): ActionBreakdownEntry[] {
  expect(Object.values(entries).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, EPSILON_DIGITS)
  return Object.entries(entries).map(([label, freq]) => ({ label, freq, evBb: 0 }))
}

describe('基礎3バケットと2軸', () => {
  it('diff合計=0かつdiff(passive)=-X+Y_base（許容誤差1e-9）', () => {
    let tally = initialDivergenceTally()
    tally = accumulateDivergence(tally, breakdown({ fold: 0.2, call: 0.5, raise55: 0.3 }), 'fold')
    tally = accumulateDivergence(tally, breakdown({ check: 0.7, bet33: 0.3 }), 'bet33')
    tally = accumulateDivergence(tally, breakdown({ fold: 0.6, call: 0.3, allin: 0.1 }), 'call')
    const buckets = summarizeDivergence(tally).buckets
    const diff = Object.fromEntries(buckets.map((bucket) => [bucket.bucket, bucket.diff]))
    const x = diff.aggressive
    const yBase = -diff.fold

    expect(diff.fold + diff.passive + diff.aggressive).toBeCloseTo(0, EPSILON_DIGITS)
    expect(diff.passive).toBeCloseTo(-x + yBase, EPSILON_DIGITS)
  })

  it('Float32相当の微小な頻度ずれも決断単位で正規化し、恒等式を保つ', () => {
    const tally = accumulateDivergence(
      initialDivergenceTally(),
      [
        { label: 'fold', freq: 0.2001, evBb: 0 },
        { label: 'call', freq: 0.4998, evBb: 0 },
        { label: 'raise55', freq: 0.3002, evBb: 0 },
      ],
      'call',
    )
    const summary = summarizeDivergence(tally)
    expect(tally.gtoFreqSum.fold + tally.gtoFreqSum.passive + tally.gtoFreqSum.aggressive).toBeCloseTo(1, EPSILON_DIGITS)
    expect(summary.buckets.reduce((sum, bucket) => sum + bucket.diff, 0)).toBeCloseTo(0, EPSILON_DIGITS)
  })

  it('fold不可ノードを混ぜてもYはfold可能ノードだけを分母にする', () => {
    let tally = initialDivergenceTally()
    tally = accumulateDivergence(tally, breakdown({ fold: 0.25, call: 0.75 }), 'fold')
    tally = accumulateDivergence(tally, breakdown({ check: 0.1, bet75: 0.9 }), 'check')
    const summary = summarizeDivergence(tally)

    expect(summary.count).toBe(2)
    expect(summary.foldEligibleCount).toBe(1)
    expect(summary.point.y).toBeCloseTo(-(1 - 0.25), EPSILON_DIGITS)
  })

  it('30決断とfold可能30件の両方が揃うまでpointReadyにならない', () => {
    const noFold = breakdown({ check: 0.5, bet33: 0.5 })
    const canFold = breakdown({ fold: 0.5, call: 0.5 })
    let tally = initialDivergenceTally()
    for (let i = 0; i < MIN_DIVERGENCE_SAMPLE; i++) tally = accumulateDivergence(tally, noFold, 'check')
    expect(summarizeDivergence(tally).pointReady).toBe(false)
    for (let i = 0; i < MIN_DIVERGENCE_SAMPLE; i++) tally = accumulateDivergence(tally, canFold, 'call')
    expect(summarizeDivergence(tally).pointReady).toBe(true)
  })
})

describe('象限判定', () => {
  it('原点と閾値未満はGTOに近い', () => {
    expect(classifyDivergence(0, 0)).toBe('GTOに近い')
    expect(classifyDivergence(NEAR_GTO_THRESHOLD - 0.001, -(NEAR_GTO_THRESHOLD - 0.001))).toBe('GTOに近い')
  })

  it('閾値ちょうどは近似に含めず、4象限を正しく分類する', () => {
    expect(classifyDivergence(NEAR_GTO_THRESHOLD, NEAR_GTO_THRESHOLD)).toBe('オーバープレイ')
    expect(classifyDivergence(-NEAR_GTO_THRESHOLD, NEAR_GTO_THRESHOLD)).toBe('コーリングステーション')
    expect(classifyDivergence(-NEAR_GTO_THRESHOLD, -NEAR_GTO_THRESHOLD)).toBe('タイトパッシブ')
    expect(classifyDivergence(NEAR_GTO_THRESHOLD, -NEAR_GTO_THRESHOLD)).toBe('両極端(ベットオアフォールド)')
  })
})

describe('次元別集計', () => {
  it('9経路はturnPathsのアプリ側正典と一致する', () => {
    expect([...FLOP_PATHS].sort()).toEqual([...RECORDED_TURN_BUNDLES.srp_btn_vs_bb].sort())
  })

  it('street/path/textureの各次元でセル合計が全体と一致し、未知経路も取りこぼさない', () => {
    let stats = initialDivergenceStats()
    const bd = breakdown({ fold: 0.2, call: 0.3, raise55: 0.5 })
    const fixtures = [
      { street: 'flop' as const, flopPath: FLOP_PATHS[0], texture: { monotone: true, twoTone: false, paired: false } },
      { street: 'turn' as const, flopPath: FLOP_PATHS[1], texture: { monotone: false, twoTone: true, paired: true } },
      { street: 'river' as const, flopPath: 'check-bet33-fold', texture: { monotone: false, twoTone: false, paired: false } },
    ]
    for (const context of fixtures) stats = accumulateDivergenceStats(stats, bd, 'call', { ...context, focusScenarioId: null })

    const sum = (cells: DivergenceTallyLike[]) => cells.reduce((total, cell) => total + cell.decisionCount, 0)
    expect(sum(STREETS.map((key) => stats.byStreet[key]))).toBe(stats.decisionCount)
    expect(sum([...FLOP_PATHS, 'other' as const].map((key) => stats.byPath[key]))).toBe(stats.decisionCount)
    expect(sum(TEXTURE_KEYS.map((key) => stats.byTexture[key]))).toBe(stats.decisionCount)
  })
})

interface DivergenceTallyLike { decisionCount: number }
