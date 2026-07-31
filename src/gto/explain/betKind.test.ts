// P13 Phase C-1: betKind.tsのテスト。既存feature値だけからkind/valueThickness/reasonJaが
// 一意に決まることを、代表的な分岐ごとに検証する。

import { describe, it, expect } from 'vitest'
import { classifyBetKind } from './betKind'
import type { SpotFeatures, ActionResponseSummary } from './features'
import type { HandStrength } from '../../advisor/postflop'

function response(overrides: Partial<ActionResponseSummary> = {}): ActionResponseSummary {
  return { forLabel: 'bet33', terminal: false, breakdown: [], foldFreq: 0.3, heroEquityVsContinueRange: null, ...overrides }
}

function buildFeatures(handClass: HandStrength, responses: ActionResponseSummary[], draws: Partial<SpotFeatures['draws']> = {}): SpotFeatures {
  return {
    nodeContext: { kind: 'root' },
    boardTexture: { paired: false, suitPattern: 'rainbow', heightJa: 'ミドル', connected: false, summaryJa: 'レインボー・ドライ' },
    handClass,
    noPairShowdownValue: handClass === 'AIR' ? 'air' : null,
    weakPairSubtype: handClass === 'WEAK_PAIR' ? 'bluffCatcher' : null,
    draws: { hasFlushDraw: false, hasOESD: false, hasGutshot: false, flushDrawOuts: 0, straightDrawOuts: 0, ...draws },
    heroComboEquity: 0.5,
    currentShowdown: { heroEquity: 0.5, heroAheadPct: 50 },
    eqPercentileInRange: 50,
    rangeAdvantage: { heroAvg: 0.5, villainAvg: 0.5, verdictJa: '互角' },
    nutsAdvantage: { heroTopPct: 10, villainTopPct: 10, verdictJa: '互角' },
    equityBuckets: [],
    responses,
    blockers: { valueCombosReducedPct: 0, bluffCombosReducedPct: 0, continueCombosReducedPct: null, blockedExamples: [], valueBlockedHands: [], bluffBlockedHands: [], continueBlockedHands: null },
    betTarget: null,
    mdf: null,
    potOddsRequiredEq: null,
    sprBucket: { spr: 4, labelJa: '中SPR(3-6)' },
    sameClass: { classJa: '', comboCount: 0, actionMix: [] },
    streetStructure: { flopCheckedThrough: null, bettorIsIp: null },
  }
}

describe('classifyBetKind', () => {
  it('check/call/foldではnullを返す', () => {
    const features = buildFeatures('MONSTER', [])
    expect(classifyBetKind('check', features)).toBeNull()
    expect(classifyBetKind('call', features)).toBeNull()
    expect(classifyBetKind('fold', features)).toBeNull()
  })

  it('heroEquityVsContinueRangeが0.5以上ならvalue(0.6以上でthick、未満でthin)', () => {
    const thin = buildFeatures('MIDDLE', [response({ heroEquityVsContinueRange: 0.55 })])
    const thick = buildFeatures('STRONG_MADE', [response({ heroEquityVsContinueRange: 0.72 })])

    expect(classifyBetKind('bet33', thin)).toEqual({ kind: 'value', valueThickness: 'thin', reasonJa: expect.any(String) })
    expect(classifyBetKind('bet33', thick)).toEqual({ kind: 'value', valueThickness: 'thick', reasonJa: expect.any(String) })
  })

  it('SDV低クラス(AIR/STRONG_DRAW/WEAK_DRAW)でドローがあればsemiBluff', () => {
    const features = buildFeatures('AIR', [response({ heroEquityVsContinueRange: 0.2 })], { hasFlushDraw: true })
    const result = classifyBetKind('bet33', features)
    expect(result?.kind).toBe('semiBluff')
    expect(result?.valueThickness).toBeNull()
  })

  it('SDV低クラスでドローが無ければpureBluff', () => {
    const features = buildFeatures('AIR', [response({ heroEquityVsContinueRange: 0.15 })])
    const result = classifyBetKind('bet33', features)
    expect(result?.kind).toBe('pureBluff')
  })

  it('MIDDLE/WEAK_PAIRでフォールド率が高くなければprotection', () => {
    const features = buildFeatures('MIDDLE', [response({ heroEquityVsContinueRange: 0.4, foldFreq: 0.3 })])
    const result = classifyBetKind('bet33', features)
    expect(result?.kind).toBe('protection')
    expect(result?.reasonJa).toContain('30%')
  })

  it('MIDDLE/WEAK_PAIRでフォールド率が高い場合はprotectionにならずvalueへフォールバックする', () => {
    const features = buildFeatures('WEAK_PAIR', [response({ heroEquityVsContinueRange: 0.4, foldFreq: 0.7 })])
    const result = classifyBetKind('bet33', features)
    expect(result?.kind).toBe('value')
  })

  it('応答ノードが無い(heroEquityVsContinueRangeがnull)場合でもクラッシュせず何らかの分類を返す', () => {
    const features = buildFeatures('MONSTER', [])
    const result = classifyBetKind('bet33', features)
    expect(result).not.toBeNull()
    expect(result?.kind).toBe('value')
  })
})
