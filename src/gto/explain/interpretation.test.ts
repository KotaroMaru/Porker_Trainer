import { describe, expect, it } from 'vitest'
import type { SpotFeatures } from './features'
import { DEVIATION_OUTLIER_THRESHOLD_PP, interpretBetProfile, interpretSpot } from './interpretation'
import type { ReviewDecision } from '../trainer/reviewBuilder'

function features(overrides: Partial<SpotFeatures> = {}): SpotFeatures {
  return {
    nodeContext: { kind: 'root' },
    boardTexture: { paired: true, suitPattern: 'rainbow', heightJa: 'ハイ', connected: false, summaryJa: '' },
    handClass: 'AIR',
    sdvLevel: 'none',
    weakPairSubtype: null,
    draws: { hasFlushDraw: false, hasOESD: false, hasGutshot: false, flushDrawOuts: 0, straightDrawOuts: 0 },
    backdoors: { flush: { has: false, isNut: false }, straight: { has: false, isWheel: false } },
    heroComboEquity: 0.4,
    currentShowdown: { heroEquity: 0.4, heroAheadPct: 35 },
    eqPercentileInRange: 50,
    rangeAdvantage: { heroAvg: 0.54, villainAvg: 0.46, verdictJa: 'レンジ優位' },
    nutsAdvantage: { heroTopPct: 23, villainTopPct: 8, verdictJa: 'ナッツ優位' },
    equityBuckets: [],
    responses: [{ forLabel: 'bet33', terminal: false, breakdown: [], foldFreq: 0.33, heroEquityVsContinueRange: 0.3 }],
    blockers: { valueCombosReducedPct: 0, bluffCombosReducedPct: 0, continueCombosReducedPct: null, blockedExamples: [], valueBlockedHands: [], bluffBlockedHands: [], continueBlockedHands: null },
    targets: null,
    mdf: null,
    potOddsRequiredEq: null,
    sprBucket: { spr: 10, labelJa: '' },
    sameClass: { classJa: 'ノーペア', comboCount: 10, actionMix: [{ label: 'check', freq: 0.57 }, { label: 'bet33', freq: 0.43 }] },
    comboVsClass: { comboAggFreq: 0.816, classAggFreq: 0.43, deltaPp: 38.6 },
    streetStructure: { flopCheckedThrough: null, bettorIsIp: null, villainCheckedToHero: true },
    ...overrides,
  }
}

const decision = { grading: { bestLabel: 'bet33' } } as ReviewDecision

describe('interpretBetProfile', () => {
  it('非ベットはnull、継続レンジEQ 50%以上を最優先でvalueにする', () => {
    expect(interpretBetProfile('check', features())).toBeNull()
    expect(interpretBetProfile('bet33', features({ sdvLevel: 'none', responses: [{ forLabel: 'bet33', terminal: false, breakdown: [], foldFreq: 0.2, heroEquityVsContinueRange: 0.6 }] }))).toMatchObject({ kind: 'value', valueThickness: 'thick', targetsToShow: 'continueWeak' })
  })

  it.each([
    ['solid', 'bluffCatcher'],
    ['thin', 'drawPaired'],
  ] as const)('SDV=%s・weakPairSubtype=%sはfold率に関係なくprotection', (sdvLevel, weakPairSubtype) => {
    const result = interpretBetProfile('bet33', features({ handClass: 'WEAK_PAIR', sdvLevel, weakPairSubtype, responses: [{ forLabel: 'bet33', terminal: false, breakdown: [], foldFreq: 0.9, heroEquityVsContinueRange: 0.4 }] }))
    expect(result).toMatchObject({ kind: 'protection', targetsToShow: 'folded' })
  })

  it('SDVなしで通常ドローまたはバックドアがあればsemiBluff、それも無ければpureBluff', () => {
    expect(interpretBetProfile('bet33', features({ draws: { hasFlushDraw: false, hasOESD: false, hasGutshot: true, flushDrawOuts: 0, straightDrawOuts: 4 } }))?.kind).toBe('semiBluff')
    expect(interpretBetProfile('bet33', features({ backdoors: { flush: { has: true, isNut: true }, straight: { has: false, isWheel: false } } }))?.kind).toBe('semiBluff')
    expect(interpretBetProfile('bet33', features())?.kind).toBe('pureBluff')
  })
})

describe('interpretSpot', () => {
  it('20ppを外れ値境界とし、検出できたdriverだけを並べる', () => {
    expect(DEVIATION_OUTLIER_THRESHOLD_PP).toBe(20)
    const result = interpretSpot(decision, features({
      sdvLevel: 'solid',
      backdoors: { flush: { has: true, isNut: true }, straight: { has: false, isWheel: false } },
      blockers: { valueCombosReducedPct: 6, bluffCombosReducedPct: 0, continueCombosReducedPct: null, blockedExamples: [], valueBlockedHands: [], bluffBlockedHands: [], continueBlockedHands: null },
    }))
    expect(result.deviation).toEqual({ level: 'outlier', deltaPp: 38.6, drivers: ['blocker', 'backdoor', 'thinSdv'] })
    expect(result.handDescriptor.backdoorsJa).toEqual(['ナッツ・バックドアフラッシュ'])
    expect(result.betProfile?.kind).toBe('protection')
  })

  it('A3の誤ったホイール主張を生成しない', () => {
    const result = interpretSpot(decision, features({ sdvLevel: 'solid', backdoors: { flush: { has: true, isNut: true }, straight: { has: false, isWheel: false } } }))
    expect(result.handDescriptor.backdoorsJa.join('')).not.toContain('ホイール')
  })
})
