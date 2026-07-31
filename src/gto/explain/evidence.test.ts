// P13 Phase D-1: evidence.tsのテスト。各証拠が「成立する場合だけ」選ばれ、成立しない
// 場合は出ないことを検証する(旧buildReasonParagraphの「当てはまらない理由を書く」
// バグの再発防止が主目的)。

import { describe, it, expect } from 'vitest'
import { selectEvidence } from './evidence'
import type { SpotFeatures, ActionResponseSummary } from './features'
import type { ReviewDecision } from '../trainer/reviewBuilder'
import type { GradeResult } from '../trainer/grading'
import type { DecodedNode } from '../loader/binaryFormat'
import type { HandStrength } from '../../advisor/postflop'

function buildDecision(overrides: Partial<{ bestLabel: string; actionLabels: string[]; actionBreakdown: { label: string; freq: number; evBb: number }[] }> = {}): ReviewDecision {
  const bestLabel = overrides.bestLabel ?? 'call'
  const actionLabels = overrides.actionLabels ?? ['fold', 'call', 'raise55']
  const actionBreakdown = overrides.actionBreakdown ?? actionLabels.map((label) => ({ label, freq: label === bestLabel ? 0.7 : 0.15, evBb: label === bestLabel ? 2 : 1 }))
  const grading: GradeResult = { verdict: 'correct', evLossBb: 0, bestLabel, bestEvBb: 2, chosenEvBb: 2, actionBreakdown }
  const decodedNode: DecodedNode = { player: 0, actionLabels, freqs: new Float32Array(0), evsBb: new Float32Array(0) }
  return {
    street: 'flop',
    nodeId: '',
    seat: 0,
    boardAtDecision: [],
    chosenLabel: bestLabel,
    grading,
    potBbAtDecision: 10,
    effectiveStackRemainingBb: 90,
    actionsWithAmounts: [],
    decodedNode,
    heroCombos: [],
    heroWeights: [],
    villainCombos: [],
    villainWeights: [],
    responseNodes: [],
  }
}

function response(forLabel: string, overrides: Partial<ActionResponseSummary> = {}): ActionResponseSummary {
  return { forLabel, terminal: false, breakdown: [], foldFreq: 0.3, heroEquityVsContinueRange: null, ...overrides }
}

function buildFeatures(overrides: Partial<SpotFeatures> = {}): SpotFeatures {
  const handClass: HandStrength = overrides.handClass ?? 'WEAK_PAIR'
  return {
    nodeContext: { kind: 'facingBet', betAmountBb: 5, potBeforeCallBb: 10 },
    boardTexture: { paired: false, suitPattern: 'rainbow', heightJa: 'ミドル', connected: false, summaryJa: 'レインボー・ドライ' },
    handClass,
    noPairShowdownValue: handClass === 'AIR' ? 'air' : null,
    weakPairSubtype: handClass === 'WEAK_PAIR' ? 'bluffCatcher' : null,
    draws: { hasFlushDraw: false, hasOESD: false, hasGutshot: false, flushDrawOuts: 0, straightDrawOuts: 0 },
    heroComboEquity: 0.35,
    currentShowdown: { heroEquity: 0.35, heroAheadPct: 30 },
    eqPercentileInRange: 50,
    rangeAdvantage: { heroAvg: 0.5, villainAvg: 0.5, verdictJa: '互角' },
    nutsAdvantage: { heroTopPct: 10, villainTopPct: 10, verdictJa: '互角' },
    equityBuckets: [],
    responses: [response('raise55')],
    blockers: { valueCombosReducedPct: 0, bluffCombosReducedPct: 0, continueCombosReducedPct: null, blockedExamples: [], valueBlockedHands: [], bluffBlockedHands: [], continueBlockedHands: null },
    betTarget: null,
    mdf: 0.75,
    potOddsRequiredEq: 0.2,
    sprBucket: { spr: 4, labelJa: '中SPR(3-6)' },
    sameClass: { classJa: '', comboCount: 0, actionMix: [] },
    streetStructure: { flopCheckedThrough: null, bettorIsIp: null },
    ...overrides,
  }
}

describe('selectEvidence: bet', () => {
  it('bestLabelがベットの場合、classifyBetKindのreasonJaをsupports証拠として返す', () => {
    const decision = buildDecision({ bestLabel: 'bet33', actionLabels: ['check', 'bet33'] })
    const features = buildFeatures({
      nodeContext: { kind: 'root' },
      handClass: 'STRONG_MADE',
      responses: [response('bet33', { heroEquityVsContinueRange: 0.7 })],
    })
    const result = selectEvidence(decision, features)
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('betKind')
    expect(result[0].polarity).toBe('supports')
  })
})

describe('selectEvidence: check', () => {
  it('MONSTER/STRONG_MADEはポットコントロール(スロープレイ)のみ', () => {
    const decision = buildDecision({ bestLabel: 'check', actionLabels: ['check', 'bet33'] })
    const features = buildFeatures({ nodeContext: { kind: 'root' }, handClass: 'MONSTER' })
    const result = selectEvidence(decision, features)
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('checkPotControlStrong')
  })

  it('P13回帰: ドロー無しのAIR(ハイカード)はcheckDrawではなくcheckPotControlMiddleになる(「エクイティを活かす」文言が出ない)', () => {
    const decision = buildDecision({ bestLabel: 'check', actionLabels: ['check', 'bet33'] })
    const features = buildFeatures({ nodeContext: { kind: 'root' }, handClass: 'AIR', noPairShowdownValue: 'highCard' })
    const result = selectEvidence(decision, features)
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('checkPotControlMiddle')
    expect(result[0].textJa).not.toContain('次のストリートでエクイティを活かす')
  })

  it('ドローがあればcheckDrawを返す', () => {
    const decision = buildDecision({ bestLabel: 'check', actionLabels: ['check', 'bet33'] })
    const features = buildFeatures({ nodeContext: { kind: 'root' }, handClass: 'STRONG_DRAW', draws: { hasFlushDraw: true, hasOESD: false, hasGutshot: false, flushDrawOuts: 9, straightDrawOuts: 0 } })
    const result = selectEvidence(decision, features)
    expect(result[0].id).toBe('checkDraw')
  })
})

describe('selectEvidence: MDF vs レンジ内順位', () => {
  it('call推奨・続行範囲内(上位%<=MDF%)ならsupports', () => {
    const decision = buildDecision({ bestLabel: 'call' })
    const features = buildFeatures({ mdf: 0.75, eqPercentileInRange: 49 }) // 上位51% <= MDF75%
    const result = selectEvidence(decision, features)
    const mdfEvidence = result.find((e) => e.id === 'mdfVsPercentile')
    expect(mdfEvidence?.polarity).toBe('supports')
    expect(mdfEvidence?.textJa).toContain('75%')
  })

  it('fold推奨・続行範囲外(上位%>MDF%)ならsupports', () => {
    const decision = buildDecision({ bestLabel: 'fold' })
    const features = buildFeatures({ mdf: 0.5, eqPercentileInRange: 10, potOddsRequiredEq: null }) // 上位90% > MDF50%
    const result = selectEvidence(decision, features)
    const mdfEvidence = result.find((e) => e.id === 'mdfVsPercentile')
    expect(mdfEvidence?.polarity).toBe('supports')
  })

  it('mdfがnull(ベットに直面していない)なら証拠を出さない', () => {
    const decision = buildDecision({ bestLabel: 'call' })
    const features = buildFeatures({ mdf: null, potOddsRequiredEq: null })
    const result = selectEvidence(decision, features)
    expect(result.find((e) => e.id === 'mdfVsPercentile')).toBeUndefined()
  })
})

describe('selectEvidence: ポットオッズ(改善なし勝率での判定)', () => {
  it('改善なし勝率が必要勝率以上ならそのまま適用できる、とsupports', () => {
    const decision = buildDecision({ bestLabel: 'call' })
    const features = buildFeatures({ potOddsRequiredEq: 0.2, currentShowdown: { heroEquity: 0.25, heroAheadPct: 20 }, heroComboEquity: 0.4 })
    const result = selectEvidence(decision, features)
    const ev = result.find((e) => e.id === 'potOdds')
    expect(ev?.polarity).toBe('supports')
    expect(ev?.textJa).toContain('単独で上回る')
  })

  it('改善なしでは届かないが最終エクイティは届く場合、単純なポットオッズ適用は断定せず中立の注意喚起にする(ユーザー報告Q♦J♣ケース相当)', () => {
    const decision = buildDecision({ bestLabel: 'fold' })
    const features = buildFeatures({ potOddsRequiredEq: 0.2, currentShowdown: { heroEquity: 0.05, heroAheadPct: 5 }, heroComboEquity: 0.27 })
    const result = selectEvidence(decision, features)
    const ev = result.find((e) => e.id === 'potOdds')
    expect(ev?.polarity).toBe('neutral')
    expect(ev?.textJa).toContain('そのまま当てはめられません')
  })

  it('最終エクイティでも必要勝率に届かない場合、fold推奨をsupportsする', () => {
    const decision = buildDecision({ bestLabel: 'fold' })
    const features = buildFeatures({ potOddsRequiredEq: 0.5, currentShowdown: { heroEquity: 0.1, heroAheadPct: 10 }, heroComboEquity: 0.2 })
    const result = selectEvidence(decision, features)
    const ev = result.find((e) => e.id === 'potOdds')
    expect(ev?.polarity).toBe('supports')
  })
})

describe('selectEvidence: ブロッカー(両側)', () => {
  it('差が閾値未満なら証拠を出さない', () => {
    const decision = buildDecision({ bestLabel: 'call' })
    const features = buildFeatures({ blockers: { valueCombosReducedPct: 10, bluffCombosReducedPct: 9, continueCombosReducedPct: null, blockedExamples: [], valueBlockedHands: [], bluffBlockedHands: [], continueBlockedHands: null } })
    const result = selectEvidence(decision, features)
    expect(result.find((e) => e.id === 'blockerNet')).toBeUndefined()
  })

  it('バリューを多くブロックしていればcall推奨をsupportsする', () => {
    const decision = buildDecision({ bestLabel: 'call' })
    const features = buildFeatures({ blockers: { valueCombosReducedPct: 20, bluffCombosReducedPct: 5, continueCombosReducedPct: null, blockedExamples: [], valueBlockedHands: [], bluffBlockedHands: [], continueBlockedHands: null } })
    const result = selectEvidence(decision, features)
    expect(result.find((e) => e.id === 'blockerNet')?.polarity).toBe('supports')
  })

  it('handClass===AIRかつSDV無し(air)なら証拠を出さない', () => {
    const decision = buildDecision({ bestLabel: 'call' })
    const features = buildFeatures({
      handClass: 'AIR',
      noPairShowdownValue: 'air',
      blockers: { valueCombosReducedPct: 20, bluffCombosReducedPct: 5, continueCombosReducedPct: null, blockedExamples: [], valueBlockedHands: [], bluffBlockedHands: [], continueBlockedHands: null },
    })
    const result = selectEvidence(decision, features)
    expect(result.find((e) => e.id === 'blockerNet')).toBeUndefined()
  })
})

describe('selectEvidence: 直前ストリートの構造', () => {
  it('flopCheckedThrough&&bettorIsIpで、nutsAdvantageと矛盾しなければ証拠を出す', () => {
    const decision = buildDecision({ bestLabel: 'call' })
    const features = buildFeatures({
      streetStructure: { flopCheckedThrough: true, bettorIsIp: true },
      nutsAdvantage: { heroTopPct: 10, villainTopPct: 10, verdictJa: '互角' },
    })
    const result = selectEvidence(decision, features)
    expect(result.find((e) => e.id === 'streetStructure')?.textJa).toContain('上限は抑えられています')
  })

  it('flopCheckedThrough&&bettorIsIpでも、相手のナッツ比率が明確に高ければ矛盾するため証拠を出さない', () => {
    const decision = buildDecision({ bestLabel: 'call' })
    const features = buildFeatures({
      streetStructure: { flopCheckedThrough: true, bettorIsIp: true },
      nutsAdvantage: { heroTopPct: 5, villainTopPct: 20, verdictJa: 'ナッツ劣位' },
    })
    const result = selectEvidence(decision, features)
    expect(result.find((e) => e.id === 'streetStructure')).toBeUndefined()
  })

  it('flopCheckedThroughがnull(flop決断)なら証拠を出さない', () => {
    const decision = buildDecision({ bestLabel: 'call' })
    const features = buildFeatures({ streetStructure: { flopCheckedThrough: null, bettorIsIp: true } })
    const result = selectEvidence(decision, features)
    expect(result.find((e) => e.id === 'streetStructure')).toBeUndefined()
  })
})

describe('selectEvidence: レイズ却下理由', () => {
  it('レイズ応答の継続レンジエクイティが算出できれば手の性質で却下理由を述べる', () => {
    const decision = buildDecision({ bestLabel: 'call', actionLabels: ['fold', 'call', 'raise55'] })
    const features = buildFeatures({ responses: [response('raise55', { heroEquityVsContinueRange: 0.3 })] })
    const result = selectEvidence(decision, features)
    const ev = result.find((e) => e.id === 'raiseRejection')
    expect(ev?.textJa).toContain('30%')
    expect(ev?.textJa).toContain('負けている強い手には降りてもらえない')
  })

  it('継続レンジエクイティが算出できなければEV差の提示に留める', () => {
    const decision = buildDecision({ bestLabel: 'call', actionLabels: ['fold', 'call', 'raise55'] })
    const features = buildFeatures({ responses: [] })
    const result = selectEvidence(decision, features)
    const ev = result.find((e) => e.id === 'raiseRejection')
    expect(ev?.textJa).toContain('EV')
    expect(ev?.textJa).not.toContain('負けている強い手')
  })

  it('レイズの方がEVが高い場合は却下理由を出さない(結論と矛盾するため)', () => {
    const decision = buildDecision({
      bestLabel: 'call',
      actionLabels: ['fold', 'call', 'raise55'],
      actionBreakdown: [
        { label: 'fold', freq: 0.1, evBb: 0 },
        { label: 'call', freq: 0.6, evBb: 2 },
        { label: 'raise55', freq: 0.3, evBb: 2.5 },
      ],
    })
    const features = buildFeatures({ responses: [response('raise55', { heroEquityVsContinueRange: 0.5 })] })
    const result = selectEvidence(decision, features)
    expect(result.find((e) => e.id === 'raiseRejection')).toBeUndefined()
  })
})
