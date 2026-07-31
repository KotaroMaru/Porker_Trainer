// P13 Phase C-2: BetIntentPanelのテスト。ベット種別バッジ・ターゲット表示・非表示条件を検証する。

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { BetIntentPanel } from './BetIntentPanel'
import type { ReviewDecision } from '../../gto/trainer/reviewBuilder'
import type { SpotFeatures, ActionResponseSummary, BetActionTarget } from '../../gto/explain/features'
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
  betTarget: SpotFeatures['betTarget'],
  draws: Partial<SpotFeatures['draws']> = {},
): SpotFeatures {
  return {
    nodeContext: { kind: 'root' },
    boardTexture: { paired: false, suitPattern: 'rainbow', heightJa: 'ミドル', connected: false, summaryJa: 'レインボー・ドライ' },
    handClass,
    noPairShowdownValue: handClass === 'AIR' ? 'air' : null,
    weakPairSubtype: handClass === 'WEAK_PAIR' ? 'bluffCatcher' : null,
    draws: { hasFlushDraw: false, hasOESD: false, hasGutshot: false, flushDrawOuts: 0, straightDrawOuts: 0, ...draws },
    heroComboEquity: 0.5,
    eqPercentileInRange: 50,
    rangeAdvantage: { heroAvg: 0.5, villainAvg: 0.5, verdictJa: '互角' },
    nutsAdvantage: { heroTopPct: 10, villainTopPct: 10, verdictJa: '互角' },
    equityBuckets: [],
    responses,
    blockers: { valueCombosReducedPct: 0, continueCombosReducedPct: null, blockedExamples: [], valueBlockedHands: [], continueBlockedHands: null },
    betTarget,
    mdf: null,
    potOddsRequiredEq: null,
    sprBucket: { spr: 4, labelJa: '中SPR(3-6)' },
    sameClass: { classJa: '', comboCount: 0, actionMix: [] },
  }
}

const valueTarget: BetActionTarget = {
  forLabel: 'bet33',
  valueTargetHands: [{ hand: 'AKo', comboCount: 3, weightPct: 60 }],
  bluffTargetHands: [{ hand: 'QJo', comboCount: 2, weightPct: 40 }],
}

describe('BetIntentPanel', () => {
  it('チェック/コール/フォールドを選んだ場合(betTarget===null)はパネルを表示しない', () => {
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
    expect(container.textContent).toContain('からコールをもらいます')
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
    const target: SpotFeatures['betTarget'] = { chosen: null, best: valueTarget }
    const features = buildFeatures('AIR', [response('bet33', { heroEquityVsContinueRange: 0.1 })], target)
    const { container } = render(<BetIntentPanel decision={decision} features={features} />)
    expect(container.textContent).toContain('最善アクション')
    expect(container.textContent).toContain('ピュアブラフ')
  })

  it('ターゲットが空配列の場合はターゲット行を表示しない', () => {
    const decision = buildDecision('bet33', 'bet33')
    const emptyTarget: BetActionTarget = { forLabel: 'bet33', valueTargetHands: [], bluffTargetHands: [] }
    const features = buildFeatures('STRONG_MADE', [response('bet33', { heroEquityVsContinueRange: 0.72 })], { chosen: emptyTarget, best: emptyTarget })
    const { container } = render(<BetIntentPanel decision={decision} features={features} />)
    expect(container.textContent).not.toContain('からコールをもらいます')
    expect(container.textContent).not.toContain('を降ろします')
  })
})
