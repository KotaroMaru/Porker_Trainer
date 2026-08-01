import { describe, expect, it } from 'vitest'
import type { ReviewDecision } from '../trainer/reviewBuilder'
import type { SpotFeatures } from './features'
import { selectClaims } from './evidence'
import { interpretSpot } from './interpretation'
import { renderClaim } from './templates'

function decision(bestLabel: string, seat: 0 | 1 = 0): ReviewDecision {
  const labels = bestLabel === 'check' || bestLabel.startsWith('bet') ? ['check', 'bet33'] : ['fold', 'call', 'raise55']
  const actionBreakdown = labels.map((label) => ({ label, freq: label === bestLabel ? 0.7 : 0.15, evBb: label === bestLabel ? 2 : 1 }))
  return {
    street: 'flop', nodeId: '', seat, boardAtDecision: [], chosenLabel: bestLabel,
    grading: { verdict: 'correct', evLossBb: 0, bestLabel, bestEvBb: 2, chosenEvBb: 2, actionBreakdown },
    potBbAtDecision: 10, effectiveStackRemainingBb: 90, actionsWithAmounts: [],
    decodedNode: { player: seat, actionLabels: labels, freqs: new Float32Array(0), evsBb: new Float32Array(0) },
    heroCombos: [], heroWeights: [], villainCombos: [], villainWeights: [], responseNodes: [],
  }
}

function features(overrides: Partial<SpotFeatures> = {}): SpotFeatures {
  return {
    nodeContext: { kind: 'root' },
    boardTexture: { paired: false, suitPattern: 'rainbow', heightJa: 'ハイ', connected: false, summaryJa: '' },
    handClass: 'AIR', sdvLevel: 'none', weakPairSubtype: null,
    draws: { hasFlushDraw: false, hasOESD: false, hasGutshot: false, flushDrawOuts: 0, straightDrawOuts: 0 },
    backdoors: { flush: { has: false, isNut: false }, straight: { has: false, isWheel: false } },
    heroComboEquity: 0.3, currentShowdown: { heroEquity: 0.2, heroAheadPct: 20 }, eqPercentileInRange: 20,
    rangeAdvantage: { heroAvg: 0.5, villainAvg: 0.5, verdictJa: '互角' },
    nutsAdvantage: { heroTopPct: 10, villainTopPct: 10, verdictJa: '互角' }, equityBuckets: [],
    responses: [{ forLabel: 'bet33', terminal: false, breakdown: [], foldFreq: 0.4, heroEquityVsContinueRange: 0.3 }],
    blockers: { valueCombosReducedPct: 0, bluffCombosReducedPct: 0, continueCombosReducedPct: null, blockedExamples: [], valueBlockedHands: [], bluffBlockedHands: [], continueBlockedHands: null },
    targets: null, mdf: null, potOddsRequiredEq: null, sprBucket: { spr: 10, labelJa: '' },
    sameClass: { classJa: 'ノーペア', comboCount: 10, actionMix: [{ label: 'check', freq: 0.6 }, { label: 'bet33', freq: 0.4 }] },
    comboVsClass: { comboAggFreq: 0.8, classAggFreq: 0.4, deltaPp: 40 },
    streetStructure: { flopCheckedThrough: null, bettorIsIp: null, villainCheckedToHero: false },
    ...overrides,
  }
}

function claims(bestLabel: string, featureOverrides: Partial<SpotFeatures> = {}, seat: 0 | 1 = 0) {
  const d = decision(bestLabel, seat)
  const f = features(featureOverrides)
  return selectClaims(d, f, interpretSpot(d, f))
}

describe('selectClaims: bet/checkの網羅と極性', () => {
  it('betはprofile・classBaselineを必ず持ち、2件未満にならない', () => {
    const result = claims('bet33')
    expect(result.map((claim) => claim.id)).toEqual(expect.arrayContaining(['betProfile', 'classBaseline']))
    expect(result.length).toBeGreaterThanOrEqual(2)
  })

  it('bet専用blocker極性は強い側を多く減らせばsupports、弱い側ならopposes', () => {
    expect(claims('bet33', { blockers: { valueCombosReducedPct: 12, bluffCombosReducedPct: 2, continueCombosReducedPct: null, blockedExamples: ['AKo'], valueBlockedHands: [], bluffBlockedHands: [], continueBlockedHands: null } }).find((claim) => claim.id === 'betBlockerNet')?.polarity).toBe('supports')
    expect(claims('bet33', { blockers: { valueCombosReducedPct: 2, bluffCombosReducedPct: 12, continueCombosReducedPct: null, blockedExamples: [], valueBlockedHands: [], bluffBlockedHands: [], continueBlockedHands: null } }).find((claim) => claim.id === 'betBlockerNet')?.polarity).toBe('opposes')
  })

  it('IPのcheckではcheckTrapを作らず、実行不能なチェックレイズ文も描画しない', () => {
    const result = claims('check', { handClass: 'MONSTER', sdvLevel: 'solid', currentShowdown: { heroEquity: 0.9, heroAheadPct: 90 } }, 1)
    expect(result.find((claim) => claim.id === 'checkTrap')).toBeUndefined()
    expect(result.map(renderClaim).join('\n')).not.toMatch(/チェックレイズ|相手のベットを誘い/)
    expect(result.length).toBeGreaterThanOrEqual(2)
  })
})

describe('selectClaims: call/fold', () => {
  it('MDFとポットオッズを構造化数値として保持する', () => {
    const result = claims('call', {
      nodeContext: { kind: 'facingBet', betAmountBb: 5, potBeforeCallBb: 10 },
      mdf: 0.6, potOddsRequiredEq: 0.25, eqPercentileInRange: 50,
      heroComboEquity: 0.4, currentShowdown: { heroEquity: 0.3, heroAheadPct: 30 }, sdvLevel: 'thin',
    })
    expect(result.find((claim) => claim.id === 'mdfVsPercentile')?.data).toMatchObject({ mdfPct: 60, topPct: 50 })
    expect(result.find((claim) => claim.id === 'potOdds')?.data).toMatchObject({ requiredPct: 25, currentPct: 30, finalPct: 40 })
  })

  it('根拠が不足する場合は不足Claimを明示し、合計2件を保証する', () => {
    const result = claims('fold', { mdf: null, potOddsRequiredEq: null, sdvLevel: 'none' })
    expect(result.map((claim) => claim.id)).toEqual(['frequencyReference', 'insufficientEvidence'])
  })
})

describe('Claim描画', () => {
  it('Claim dataの主要数値を描画文へ埋め込み、NaN/undefinedを出さない', () => {
    const result = claims('bet33', { blockers: { valueCombosReducedPct: 12, bluffCombosReducedPct: 2, continueCombosReducedPct: null, blockedExamples: ['AKo'], valueBlockedHands: [], bluffBlockedHands: [], continueBlockedHands: null } })
    const blocker = result.find((claim) => claim.id === 'betBlockerNet')
    expect(blocker).toBeDefined()
    const text = renderClaim(blocker!)
    expect(text).toContain('12%')
    expect(text).toContain('2%')
    expect(text).toContain('10pp')
    expect(text).not.toMatch(/NaN|undefined|null/)
  })
})
