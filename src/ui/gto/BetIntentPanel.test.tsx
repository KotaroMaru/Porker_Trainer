// P13 Phase C-2: BetIntentPanelのテスト。ベット種別バッジ・ターゲット表示・非表示条件を検証する。

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { BetIntentPanel } from './BetIntentPanel'
import type { ReviewDecision } from '../../gto/trainer/reviewBuilder'
import type { SpotFeatures, ActionResponseSummary, ActionTargets } from '../../gto/explain/features'
import type { GradeResult } from '../../gto/trainer/grading'
import type { DecodedNode } from '../../gto/loader/binaryFormat'
import type { HandStrength } from '../../advisor/postflop'

function buildDecision(chosenLabel: string, bestLabel: string): ReviewDecision {
  const grading: GradeResult = {
    verdict: chosenLabel === bestLabel ? 'correct' : 'incorrect',
    evLossBb: chosenLabel === bestLabel ? 0 : 1,
    bestLabel,
    bestEvBb: 2,
    chosenEvBb: chosenLabel === bestLabel ? 2 : 1,
    actionBreakdown: [],
  }
  const decodedNode: DecodedNode = { player: 0, actionLabels: [chosenLabel, bestLabel], freqs: new Float32Array(0), evsBb: new Float32Array(0) }
  return {
    street: 'flop',
    nodeId: '',
    seat: 0,
    boardAtDecision: [],
    chosenLabel,
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

function buildFeatures(
  handClass: HandStrength,
  responses: ActionResponseSummary[],
  targets: SpotFeatures['targets'],
  draws: Partial<SpotFeatures['draws']> = {},
): SpotFeatures {
  return {
    nodeContext: { kind: 'root' },
    boardTexture: { paired: false, suitPattern: 'rainbow', heightJa: 'ミドル', connected: false, summaryJa: 'レインボー・ドライ' },
    handClass,
    sdvLevel: handClass === 'AIR' ? 'none' : 'solid',
    weakPairSubtype: handClass === 'WEAK_PAIR' ? 'bluffCatcher' : null,
    draws: { hasFlushDraw: false, hasOESD: false, hasGutshot: false, flushDrawOuts: 0, straightDrawOuts: 0, ...draws },
    backdoors: { flush: { has: false, isNut: false }, straight: { has: false, isWheel: false } },
    heroComboEquity: 0.5,
    currentShowdown: { heroEquity: 0.5, heroAheadPct: 50 },
    eqPercentileInRange: 50,
    rangeAdvantage: { heroAvg: 0.5, villainAvg: 0.5, verdictJa: '互角' },
    nutsAdvantage: { heroTopPct: 10, villainTopPct: 10, verdictJa: '互角' },
    equityBuckets: [],
    responses,
    blockers: { valueCombosReducedPct: 0, bluffCombosReducedPct: 0, continueCombosReducedPct: null, blockedExamples: [], valueBlockedHands: [], bluffBlockedHands: [], continueBlockedHands: null },
    targets,
    mdf: null,
    potOddsRequiredEq: null,
    sprBucket: { spr: 4, labelJa: '中SPR(3-6)' },
    sameClass: { classJa: '', comboCount: 0, actionMix: [] },
    comboVsClass: { comboAggFreq: 0, classAggFreq: 0, deltaPp: 0 },
    streetStructure: { flopCheckedThrough: null, bettorIsIp: null, villainCheckedToHero: null },
  }
}

const valueTarget: ActionTargets = {
  forLabel: 'bet33',
  continueWeakHands: [{ hand: 'AKo', comboCount: 3, weightPct: 60 }],
  foldedHands: [{ hand: 'QJo', comboCount: 2, weightPct: 40 }],
}

describe('BetIntentPanel', () => {
  it('チェック/コール/フォールドを選んだ場合(targets===null)はパネルを表示しない', () => {
    const decision = buildDecision('check', 'check')
    const features = buildFeatures('MIDDLE', [], null)
    const { container } = render(<BetIntentPanel decision={decision} features={features} />)
    expect(container.firstChild).toBeNull()
  })

  it('バリュー(厚め)のバッジと理由・ターゲットを表示する', () => {
    const decision = buildDecision('bet33', 'bet33')
    const features = buildFeatures('STRONG_MADE', [response('bet33', { heroEquityVsContinueRange: 0.72 })], { chosen: valueTarget, best: valueTarget })
    const { container } = render(<BetIntentPanel decision={decision} features={features} />)
    expect(container.textContent).toContain('バリューベット(厚め)')
    expect(container.textContent).toContain('AKo')
    expect(container.textContent).toContain('コールして残るが現時点で劣るハンド')
  })

  it('セミブラフのバッジを表示する', () => {
    const decision = buildDecision('bet33', 'bet33')
    const features = buildFeatures(
      'AIR',
      [response('bet33', { heroEquityVsContinueRange: 0.2 })],
      { chosen: valueTarget, best: valueTarget },
      { hasFlushDraw: true },
    )
    const { container } = render(<BetIntentPanel decision={decision} features={features} />)
    expect(container.textContent).toContain('セミブラフ')
  })

  it('ピュアブラフのバッジとブラフターゲットを表示する', () => {
    const decision = buildDecision('bet33', 'bet33')
    const features = buildFeatures('AIR', [response('bet33', { heroEquityVsContinueRange: 0.1 })], { chosen: valueTarget, best: valueTarget })
    const { container } = render(<BetIntentPanel decision={decision} features={features} />)
    expect(container.textContent).toContain('ピュアブラフ')
    expect(container.textContent).toContain('QJo')
    expect(container.textContent).toContain('を降ろします')
  })

  it('プロテクションのバッジを表示する', () => {
    const decision = buildDecision('bet33', 'bet33')
    const features = buildFeatures('MIDDLE', [response('bet33', { heroEquityVsContinueRange: 0.4, foldFreq: 0.2 })], { chosen: valueTarget, best: valueTarget })
    const { container } = render(<BetIntentPanel decision={decision} features={features} />)
    expect(container.textContent).toContain('プロテクション')
  })

  it('選んだアクションと最善アクションが異なるベットの場合、両方を表示する', () => {
    const decision = buildDecision('check', 'bet33')
    const target: SpotFeatures['targets'] = { chosen: null, best: valueTarget }
    const features = buildFeatures('AIR', [response('bet33', { heroEquityVsContinueRange: 0.1 })], target)
    const { container } = render(<BetIntentPanel decision={decision} features={features} />)
    expect(container.textContent).toContain('最善アクション')
    expect(container.textContent).toContain('ピュアブラフ')
  })

  it('ターゲットが空配列の場合はターゲット行を表示しない', () => {
    const decision = buildDecision('bet33', 'bet33')
    const emptyTarget: ActionTargets = { forLabel: 'bet33', continueWeakHands: [], foldedHands: [] }
    const features = buildFeatures('STRONG_MADE', [response('bet33', { heroEquityVsContinueRange: 0.72 })], { chosen: emptyTarget, best: emptyTarget })
    const { container } = render(<BetIntentPanel decision={decision} features={features} />)
    expect(container.textContent).not.toContain('からコールをもらいます')
    expect(container.textContent).not.toContain('を降ろします')
  })
})
