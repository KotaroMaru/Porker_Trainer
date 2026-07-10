// P5 Step B4: templates.tsのテスト。合成featuresで{root,facingBet}×{correct,marginal,
// incorrect}×7ハンドクラス=42ケースを網羅し、「壊れていないこと」(NaN/undefined/null
// が文字列に混入しない・各verdictで必須情報が含まれる)を保証する。
// 文面の質そのものはユーザーフィードバックで反復改善する対象(v1はここまで)。

import { describe, it, expect } from 'vitest'
import { buildExplanation } from './templates'
import { HAND_CLASS_JA, type SpotFeatures, type ActionResponseSummary, type NodeContext } from './features'
import type { HandStrength } from '../../advisor/postflop'
import type { ReviewDecision } from '../trainer/reviewBuilder'
import type { GradeResult, GradeVerdict } from '../trainer/grading'
import type { DecodedNode } from '../loader/binaryFormat'

const ALL_HAND_CLASSES: HandStrength[] = ['MONSTER', 'STRONG_MADE', 'MIDDLE', 'WEAK_PAIR', 'STRONG_DRAW', 'WEAK_DRAW', 'AIR']
const NODE_KINDS: Array<'root' | 'facingBet'> = ['root', 'facingBet']
const VERDICTS: GradeVerdict[] = ['correct', 'marginal', 'incorrect']

function bestLabelFor(kind: 'root' | 'facingBet'): string {
  return kind === 'root' ? 'bet33' : 'call'
}

function chosenLabelFor(kind: 'root' | 'facingBet', verdict: GradeVerdict): string {
  const best = bestLabelFor(kind)
  if (verdict === 'correct') return best
  return kind === 'root' ? 'check' : 'fold'
}

function buildSyntheticDecision(kind: 'root' | 'facingBet', verdict: GradeVerdict): ReviewDecision {
  const bestLabel = bestLabelFor(kind)
  const chosenLabel = chosenLabelFor(kind, verdict)
  const evLossBb = verdict === 'correct' ? 0 : verdict === 'marginal' ? 0.3 : 1.5
  const bestEvBb = 2.0
  const chosenEvBb = bestEvBb - evLossBb

  const baseBreakdown =
    kind === 'root'
      ? [
          { label: 'check', freq: 0.3, evBb: 1.5 },
          { label: 'bet33', freq: 0.5, evBb: bestEvBb },
          { label: 'bet75', freq: 0.15, evBb: 1.8 },
          { label: 'allin', freq: 0.05, evBb: 1.0 },
        ]
      : [
          { label: 'fold', freq: 0.2, evBb: 0 },
          { label: 'call', freq: 0.6, evBb: bestEvBb },
          { label: 'raise55', freq: 0.15, evBb: 1.7 },
          { label: 'allin', freq: 0.05, evBb: 1.2 },
        ]

  const actionBreakdown = baseBreakdown.map((a) => (a.label === bestLabel ? { ...a, evBb: bestEvBb } : a.label === chosenLabel ? { ...a, evBb: chosenEvBb } : a))

  const grading: GradeResult = { verdict, evLossBb, bestLabel, bestEvBb, chosenEvBb, actionBreakdown }
  const actionsWithAmounts = actionBreakdown.map((a) => ({ label: a.label, amountBb: a.label === 'check' || a.label === 'fold' ? 0 : 3 }))
  const decodedNode: DecodedNode = { player: 0, actionLabels: actionBreakdown.map((a) => a.label), freqs: new Float32Array(0), evsBb: new Float32Array(0) }

  return {
    street: 'flop',
    nodeId: '',
    seat: 0,
    chosenLabel,
    grading,
    potBbAtDecision: 10,
    effectiveStackRemainingBb: 90,
    actionsWithAmounts,
    decodedNode,
    heroCombos: [],
    heroWeights: [],
    villainCombos: [],
    villainWeights: [],
    responseNodes: [],
  }
}

function buildSyntheticFeatures(kind: 'root' | 'facingBet', handClass: HandStrength): SpotFeatures {
  const nodeContext: NodeContext = kind === 'root' ? { kind: 'root' } : { kind: 'facingBet', betAmountBb: 5, potBeforeCallBb: 10 }
  const bestLabel = bestLabelFor(kind)
  const responses: ActionResponseSummary[] =
    kind === 'root'
      ? [
          { forLabel: 'check', terminal: false, breakdown: [{ label: 'check', freq: 0.6 }, { label: 'bet33', freq: 0.4 }], foldFreq: 0, heroEquityVsContinueRange: 0.5 },
          { forLabel: 'bet33', terminal: false, breakdown: [{ label: 'fold', freq: 0.3 }, { label: 'call', freq: 0.6 }, { label: 'raise55', freq: 0.1 }], foldFreq: 0.3, heroEquityVsContinueRange: 0.45 },
          { forLabel: 'bet75', terminal: false, breakdown: [{ label: 'fold', freq: 0.4 }, { label: 'call', freq: 0.6 }], foldFreq: 0.4, heroEquityVsContinueRange: null },
          { forLabel: 'allin', terminal: false, breakdown: [{ label: 'fold', freq: 0.5 }, { label: 'call', freq: 0.5 }], foldFreq: 0.5, heroEquityVsContinueRange: null },
        ]
      : [
          { forLabel: 'fold', terminal: true, breakdown: [], foldFreq: 0, heroEquityVsContinueRange: null },
          { forLabel: 'call', terminal: true, breakdown: [], foldFreq: 0, heroEquityVsContinueRange: null },
          { forLabel: 'raise55', terminal: false, breakdown: [{ label: 'fold', freq: 0.4 }, { label: 'call', freq: 0.5 }, { label: 'allin', freq: 0.1 }], foldFreq: 0.4, heroEquityVsContinueRange: 0.4 },
          { forLabel: 'allin', terminal: false, breakdown: [{ label: 'fold', freq: 0.6 }, { label: 'call', freq: 0.4 }], foldFreq: 0.6, heroEquityVsContinueRange: null },
        ]

  return {
    nodeContext,
    handClass,
    draws: { hasFlushDraw: false, hasOESD: false, hasGutshot: false, flushDrawOuts: 0, straightDrawOuts: 0 },
    heroComboEquity: 0.55,
    eqPercentileInRange: 62,
    rangeAdvantage: { heroAvg: 0.5, villainAvg: 0.48, verdictJa: '互角' },
    nutsAdvantage: { heroTopPct: 12, villainTopPct: 10, verdictJa: '互角' },
    equityBuckets: Array.from({ length: 10 }, (_, i) => ({ lo: i * 10, hi: (i + 1) * 10, heroPct: 10, villainPct: 10 })),
    responses,
    blockers: { valueCombosReducedPct: 8, continueCombosReducedPct: kind === 'facingBet' ? 5 : null, blockedExamples: ['AKs'] },
    mdf: kind === 'facingBet' ? 0.6 : null,
    potOddsRequiredEq: kind === 'facingBet' ? 0.33 : null,
    sprBucket: { spr: 4, labelJa: '中SPR(3-6)' },
    sameClass: { classJa: HAND_CLASS_JA[handClass], comboCount: 10, actionMix: [{ label: bestLabel, freq: 0.7 }, { label: 'check', freq: 0.3 }] },
  }
}

describe('buildExplanation: 網羅マトリクステスト(root/facingBet × correct/marginal/incorrect × 7クラス = 42ケース)', () => {
  for (const kind of NODE_KINDS) {
    for (const verdict of VERDICTS) {
      for (const handClass of ALL_HAND_CLASSES) {
        it(`${kind} / ${verdict} / ${handClass}: headline・sameClassLineが非空でNaN/undefined/nullを含まない`, () => {
          const decision = buildSyntheticDecision(kind, verdict)
          const features = buildSyntheticFeatures(kind, handClass)
          const explanation = buildExplanation(decision, features)

          expect(explanation.headline.length).toBeGreaterThan(0)
          expect(explanation.sameClassLine.length).toBeGreaterThan(0)
          expect(explanation.paragraphs.length).toBeGreaterThanOrEqual(2)

          const fullText = [explanation.headline, ...explanation.paragraphs, explanation.sameClassLine].join('\n')
          expect(fullText).not.toContain('NaN')
          expect(fullText).not.toContain('undefined')
          expect(fullText).not.toContain('null')

          expect(explanation.sameClassLine).toMatch(/%/)

          if (verdict === 'incorrect') {
            const bestLabelJa = kind === 'root' ? 'ベット33%' : 'コール'
            expect(fullText).toContain(bestLabelJa)
            expect(fullText).toContain(decision.grading.evLossBb.toFixed(2))
          }
        })
      }
    }
  }
})

describe('buildExplanation: アクションカテゴリ別の理由段落分岐', () => {
  it('bestLabelがcheck(root)の場合でも例外なく生成できる', () => {
    const decision = buildSyntheticDecision('root', 'correct')
    decision.grading.bestLabel = 'check'
    decision.chosenLabel = 'check'
    const features = buildSyntheticFeatures('root', 'MIDDLE')
    const explanation = buildExplanation(decision, features)
    expect(explanation.paragraphs.join('')).not.toContain('NaN')
  })

  it('bestLabelがfold(facingBet)の場合でも例外なく生成できる', () => {
    const decision = buildSyntheticDecision('facingBet', 'correct')
    decision.grading.bestLabel = 'fold'
    decision.chosenLabel = 'fold'
    const features = buildSyntheticFeatures('facingBet', 'AIR')
    const explanation = buildExplanation(decision, features)
    expect(explanation.paragraphs.join('')).not.toContain('NaN')
    expect(explanation.paragraphs.join('')).toContain('必要勝率')
  })

  it('correct時は比較段落(不正解時の追加段落)が生成されない', () => {
    const decision = buildSyntheticDecision('root', 'correct')
    const features = buildSyntheticFeatures('root', 'MONSTER')
    const explanation = buildExplanation(decision, features)
    expect(explanation.paragraphs.length).toBe(2)
  })

  it('marginal/incorrect時は比較段落が追加される', () => {
    for (const verdict of ['marginal', 'incorrect'] as const) {
      const decision = buildSyntheticDecision('root', verdict)
      const features = buildSyntheticFeatures('root', 'MIDDLE')
      const explanation = buildExplanation(decision, features)
      expect(explanation.paragraphs.length).toBe(3)
    }
  })
})
