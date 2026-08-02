// P14 L2: 解釈から、表示文を持たない構造化Claim列を選ぶ。
// 文中に出す数値・語はdataへ保持し、templates/exportが同じClaimを描画する。

import type { ReviewDecision } from '../trainer/reviewBuilder'
import type { SpotFeatures } from './features'
import type { SpotInterpretation } from './interpretation'

export const CLASS_BASELINE_MIN_DELTA_PP = 5
const BLOCKER_NET_MIN_PP = 5

export type ClaimPolarity = 'supports' | 'opposes' | 'neutral'
export type ClaimId =
  | 'betProfile'
  | 'classBaseline'
  | 'deviation'
  | 'betBlockerNet'
  | 'foldedHands'
  | 'checkShowdown'
  | 'checkDraw'
  | 'checkTrap'
  | 'mdfVsPercentile'
  | 'potOdds'
  | 'defenseBlockerNet'
  | 'streetStructure'
  | 'raiseRejection'
  | 'frequencyReference'
  | 'insufficientEvidence'

export interface Claim {
  id: ClaimId
  polarity: ClaimPolarity
  priority: number
  data: Record<string, number | string | boolean>
}

type ActionCategory = 'bet' | 'check' | 'call' | 'fold'

function actionCategoryOf(label: string): ActionCategory {
  if (label === 'check') return 'check'
  if (label === 'call') return 'call'
  if (label === 'fold') return 'fold'
  return 'bet'
}

function pushDeviationClaim(claims: Claim[], interpretation: SpotInterpretation): void {
  if (interpretation.deviation.level !== 'outlier') return
  claims.push({
    id: 'deviation',
    polarity: 'supports',
    priority: 105,
    data: { deltaPp: interpretation.deviation.deltaPp, drivers: interpretation.deviation.drivers.join(',') },
  })
}

function pushBetClaims(claims: Claim[], features: SpotFeatures, interpretation: SpotInterpretation): void {
  const profile = interpretation.betProfile
  if (!profile) return
  const profileData: Claim['data'] = { kind: profile.kind }
  if (profile.continueEquity !== null) profileData.continueEquityPct = profile.continueEquity * 100
  if (profile.foldFreq !== null) profileData.foldFreqPct = profile.foldFreq * 100
  claims.push({
    id: 'betProfile',
    polarity: 'supports',
    priority: 110,
    data: profileData,
  })

  if (Math.abs(features.comboVsClass.deltaPp) >= CLASS_BASELINE_MIN_DELTA_PP) {
    claims.push({
      id: 'classBaseline',
      polarity: 'neutral',
      priority: 70,
      data: {
        comboAggPct: features.comboVsClass.comboAggFreq * 100,
        classAggPct: features.comboVsClass.classAggFreq * 100,
        deltaPp: features.comboVsClass.deltaPp,
        rangeContext: interpretation.classBaseline.rangeContextJa ?? '',
      },
    })
  }

  // bet専用の極性: 強い相手を多くブロックするほどbet寄り、foldする弱い側を多く
  // ブロックするほどbetの利益を損なう。call/fold用とは符号を共有しない。
  const valuePct = features.blockers.valueCombosReducedPct
  const weakPct = features.blockers.bluffCombosReducedPct
  const netPp = valuePct - weakPct
  if (Math.abs(netPp) >= BLOCKER_NET_MIN_PP) {
    claims.push({
      id: 'betBlockerNet',
      polarity: netPp > 0 ? 'supports' : 'opposes',
      priority: 90,
      data: { valuePct, weakPct, netPp, examples: features.blockers.blockedExamples.join(', ') },
    })
  }

  const target = features.targets?.best
  if (target && (profile.targetsToShow === 'folded' || profile.targetsToShow === 'both') && target.foldedHands.length > 0) {
    claims.push({
      id: 'foldedHands',
      polarity: 'supports',
      priority: 60,
      data: { hands: target.foldedHands.slice(0, 3).map((hand) => hand.hand).join(', ') },
    })
  }
}

function pushCheckClaims(claims: Claim[], decision: ReviewDecision, features: SpotFeatures, interpretation: SpotInterpretation): void {
  const descriptor = interpretation.handDescriptor
  if (decision.boardAtDecision.length < 5 && (descriptor.drawsJa.length > 0 || descriptor.backdoorsJa.length > 0)) {
    claims.push({
      id: 'checkDraw',
      polarity: 'supports',
      priority: 100,
      data: { draws: [...descriptor.drawsJa, ...descriptor.backdoorsJa].join('・') },
    })
  } else {
    claims.push({
      id: 'checkShowdown',
      polarity: 'supports',
      priority: 100,
      data: { sdvLevel: descriptor.sdvLevel, aheadPct: features.currentShowdown.heroAheadPct },
    })
  }
  if (decision.seat === 0 && (features.handClass === 'MONSTER' || features.handClass === 'STRONG_MADE')) {
    claims.push({ id: 'checkTrap', polarity: 'supports', priority: 80, data: { position: 'OOP' } })
  }
  if (Math.abs(features.comboVsClass.deltaPp) >= CLASS_BASELINE_MIN_DELTA_PP) {
    claims.push({
      id: 'classBaseline',
      polarity: 'neutral',
      priority: 70,
      data: {
        comboAggPct: features.comboVsClass.comboAggFreq * 100,
        classAggPct: features.comboVsClass.classAggFreq * 100,
        deltaPp: features.comboVsClass.deltaPp,
        rangeContext: interpretation.classBaseline.rangeContextJa ?? '',
      },
    })
  }
}

function pushMdfClaim(claims: Claim[], features: SpotFeatures, bestLabel: string): void {
  if (features.mdf === null || Number.isNaN(features.eqPercentileInRange)) return
  const topPct = Math.round(100 - features.eqPercentileInRange)
  const mdfPct = features.mdf * 100
  const within = topPct <= mdfPct
  claims.push({
    id: 'mdfVsPercentile',
    polarity: bestLabel === 'fold' ? (within ? 'opposes' : 'supports') : within ? 'supports' : 'opposes',
    priority: 95,
    data: { mdfPct, topPct, within },
  })
}

function pushPotOddsClaim(claims: Claim[], features: SpotFeatures, bestLabel: string): void {
  if (features.potOddsRequiredEq === null) return
  const requiredPct = features.potOddsRequiredEq * 100
  const currentPct = features.currentShowdown.heroEquity * 100
  const finalPct = features.heroComboEquity * 100
  if (![requiredPct, currentPct, finalPct].every(Number.isFinite)) return
  const state = currentPct >= requiredPct ? 'currentEnough' : finalPct >= requiredPct ? 'improvementNeeded' : 'insufficient'
  const polarity: ClaimPolarity =
    state === 'improvementNeeded' ? 'neutral' : bestLabel === 'fold' ? (state === 'insufficient' ? 'supports' : 'opposes') : state === 'insufficient' ? 'opposes' : 'supports'
  claims.push({ id: 'potOdds', polarity, priority: 90, data: { requiredPct, currentPct, finalPct, state } })
}

function pushDefenseBlockerClaim(claims: Claim[], features: SpotFeatures, bestLabel: string): void {
  if (features.sdvLevel === 'none') return
  const valuePct = features.blockers.valueCombosReducedPct
  const weakPct = features.blockers.bluffCombosReducedPct
  const netPp = valuePct - weakPct
  if (Math.abs(netPp) < BLOCKER_NET_MIN_PP) return
  const supportsCall = netPp > 0
  claims.push({
    id: 'defenseBlockerNet',
    polarity: bestLabel === 'call' ? (supportsCall ? 'supports' : 'opposes') : supportsCall ? 'opposes' : 'supports',
    priority: 60,
    data: { valuePct, weakPct, netPp },
  })
}

function pushStreetStructureClaim(claims: Claim[], features: SpotFeatures): void {
  const { flopCheckedThrough, bettorIsIp } = features.streetStructure
  if (flopCheckedThrough !== true || bettorIsIp === null) return
  if (bettorIsIp && features.nutsAdvantage.villainTopPct > features.nutsAdvantage.heroTopPct + 3) return
  claims.push({ id: 'streetStructure', polarity: 'neutral', priority: 40, data: { bettorIsIp } })
}

function pushRaiseRejectionClaim(claims: Claim[], decision: ReviewDecision, features: SpotFeatures): void {
  const raiseLabel = decision.decodedNode.actionLabels.find((label) => actionCategoryOf(label) === 'bet')
  if (!raiseLabel) return
  const raise = decision.grading.actionBreakdown.find((action) => action.label === raiseLabel)
  const best = decision.grading.actionBreakdown.find((action) => action.label === decision.grading.bestLabel)
  if (!raise || !best || best.evBb <= raise.evBb) return
  const response = features.responses.find((candidate) => candidate.forLabel === raiseLabel)
  const data: Claim['data'] = {
    raiseLabel,
    raiseEvBb: raise.evBb,
    evDiffBb: best.evBb - raise.evBb,
  }
  if (response?.heroEquityVsContinueRange !== null && response?.heroEquityVsContinueRange !== undefined) {
    data.continueEquityPct = response.heroEquityVsContinueRange * 100
  }
  claims.push({
    id: 'raiseRejection',
    polarity: 'neutral',
    priority: 30,
    data,
  })
}

function ensureCoverage(claims: Claim[], decision: ReviewDecision): void {
  if (claims.length >= 2) return
  const originalCount = claims.length
  const best = decision.grading.actionBreakdown.find((action) => action.label === decision.grading.bestLabel)
  if (originalCount === 0 && best) {
    claims.push({ id: 'frequencyReference', polarity: 'neutral', priority: 20, data: { label: best.label, freqPct: best.freq * 100 } })
  }
  claims.push({ id: 'insufficientEvidence', polarity: 'neutral', priority: 10, data: { availableCount: originalCount } })
}

export function selectClaims(decision: ReviewDecision, features: SpotFeatures, interpretation: SpotInterpretation): Claim[] {
  const claims: Claim[] = []
  const bestLabel = decision.grading.bestLabel
  const category = actionCategoryOf(bestLabel)
  if (category === 'bet') pushBetClaims(claims, features, interpretation)
  else if (category === 'check') pushCheckClaims(claims, decision, features, interpretation)
  else {
    pushMdfClaim(claims, features, bestLabel)
    pushPotOddsClaim(claims, features, bestLabel)
    pushDefenseBlockerClaim(claims, features, bestLabel)
    pushStreetStructureClaim(claims, features)
    if (category === 'call') pushRaiseRejectionClaim(claims, decision, features)
  }
  pushDeviationClaim(claims, interpretation)
  ensureCoverage(claims, decision)
  return claims.sort((a, b) => b.priority - a.priority)
}
