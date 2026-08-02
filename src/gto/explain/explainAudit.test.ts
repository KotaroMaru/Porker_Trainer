/// <reference types="node" />
// P14 S0: 解説文の恒久監査ハーネス。
//
// 既知の1スポットの文言ではなく、収録済みシナリオを横断して同型の矛盾を検出する。
// S0では現行実装の違反を基準線として記録し、S1〜S5で検査をゼロ基準へ移行する。

import { beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cardKey } from '../../engine/deck'
import { createDeck } from '../../engine/deck'
import type { Combo } from '../../analysis/range'
import { FLOPS } from '../data/flops'
import { SCENARIOS } from '../data/scenarios'
import { decodeSolutionFile, type DecodedSolution } from '../loader/binaryFormat'
import type { DecisionNode } from '../solver/cfr'
import { actionLabelsWithAmounts } from '../trainer/actionMath'
import { applyUserAction } from '../trainer/gameFlow'
import { buildReview, handStrFromCombo } from '../trainer/reviewBuilder'
import { buildStreetTree } from '../tree/actionTree'
import type { FlopDef, Scenario } from '../types'
import { CLASS_BASELINE_MIN_DELTA_PP, selectClaims, type Claim } from './evidence'
import { computeSpotFeatures } from './features'
import { interpretSpot, type SpotInterpretation } from './interpretation'
import { buildExplanation, MIXED_STRATEGY_MIN_FREQ, renderClaim, type Explanation } from './templates'
import { buildSpotMarkdown } from './exportSpot'
import type { ReviewData } from '../trainer/reviewBuilder'
import type { SpotFeatures } from './features'

const ROTATING_FLOPS = ['7h7sKd', 'AsQsJs', '5s4d3h'] as const
// 通常CIは全17シナリオ×3ノード×1コンボ+実bin固定ケースで負荷を抑える。
// P14_AUDIT_FULL=1 では各ノード3コンボ(本実装時182スポット)を横断する。
const SAMPLE_PER_NODE = process.env.P14_AUDIT_FULL === '1' ? 3 : 1
const PATHS: string[][] = [[], ['check'], ['bet33']]

interface AuditSpotResult {
  where: string
  seat: 0 | 1
  paragraphs: string[]
  sameClassLine: string
  fullText: string
  sdvLevel: string
  hasAnyDraw: boolean
  currentAheadPct: number
  betKind: string | null
  evidenceCount: number
  valueTargetCount: number
  deltaPp: number
  claimNumberMismatch: string[]
  forbiddenIntent: boolean
  drawMismatch: boolean
  chosenDiffMissingBest: boolean
  mixedBelowThreshold: boolean
  targetCollision: boolean
  suitPattern: SpotFeatures['boardTexture']['suitPattern']
}

interface ExactAnalysis {
  review: ReviewData
  features: SpotFeatures
  interpretation: SpotInterpretation
  claims: Claim[]
  explanation: Explanation
}

function walk(root: DecisionNode, labels: string[]): DecisionNode | null {
  let node = root
  for (const label of labels) {
    const index = node.actionLabels.indexOf(label)
    if (index < 0) return null
    const child = node.children[index]
    if (child.kind !== 'decision') return null
    node = child
  }
  return node
}

async function loadSolution(scenarioId: string, flopStr: string): Promise<DecodedSolution | null> {
  try {
    const file = await readFile(join(process.cwd(), 'public/gto/solutions', scenarioId, `${flopStr}.bin`))
    return decodeSolutionFile(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength))
  } catch {
    return null
  }
}

function aggregateFrequency(entries: readonly { label: string; freq: number }[], facingBet: boolean): number {
  return entries.reduce((sum, entry) => {
    const included = facingBet ? entry.label !== 'fold' : entry.label !== 'check'
    return sum + (included ? entry.freq : 0)
  }, 0)
}

const ACTION_LABEL_JA: Record<string, string> = { check: 'チェック', fold: 'フォールド', call: 'コール', bet33: 'ベット33%', bet75: 'ベット75%', raise55: 'レイズ55%', allin: 'オールイン' }

function hasStraight(ranks: ReadonlySet<number>): boolean {
  const views = new Set(ranks)
  if (ranks.has(14)) views.add(1)
  for (let low = 1; low <= 10; low++) {
    if ([low, low + 1, low + 2, low + 3, low + 4].every((rank) => views.has(rank))) return true
  }
  return false
}

function exhaustiveDrawOuts(userCombo: Combo, board: readonly { rank: number; suit: string }[]): { straight: number; flush: number } {
  const known = [...userCombo, ...board]
  const knownKeys = new Set(known.map((card) => `${card.rank}${card.suit}`))
  const ranks = new Set(known.map((card) => card.rank))
  const suitCounts = new Map<string, number>()
  known.forEach((card) => suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1))
  const alreadyStraight = hasStraight(ranks)
  const alreadyFlush = [...suitCounts.values()].some((count) => count >= 5)
  let straight = 0
  let flush = 0
  for (const card of createDeck()) {
    if (knownKeys.has(cardKey(card))) continue
    const withRank = new Set(ranks)
    withRank.add(card.rank)
    if (!alreadyStraight && hasStraight(withRank)) straight++
    if (!alreadyFlush && (suitCounts.get(card.suit) ?? 0) === 4) flush++
  }
  return { straight, flush }
}

function analyzeCombo(scenario: Scenario, flop: FlopDef, solution: DecodedSolution, path: string[], userCombo: Combo): ExactAnalysis {
  const tree = buildStreetTree({ potBb: scenario.potBb, effectiveStackBb: scenario.effectiveStackBb, firstToAct: 0 })
  if (tree.kind !== 'decision') throw new Error('expected decision root')
  const node = walk(tree, path)
  const nodeId = path.join('/')
  const decoded = solution.nodes.get(nodeId)
  if (!node || !decoded) throw new Error(`missing node ${nodeId}`)
  const userSeat = decoded.player
  const otherPool = userSeat === 0 ? solution.ipCombos : solution.oopCombos
  const userKeys = new Set(userCombo.map(cardKey))
  const botCombo = otherPool.find((combo) => !combo.some((card) => userKeys.has(cardKey(card))))
  if (!botCombo) throw new Error('missing non-colliding bot combo')
  const spot = {
    scenario,
    flop,
    solution,
    userSeat,
    userCombo,
    botCombo,
    decisionNode: node,
    decodedNode: decoded,
    nodeId,
    botActionsBefore: path.map((label) => ({ nodeId: '', label })),
    actionsWithAmounts: actionLabelsWithAmounts(node),
  }
  const chosenLabel = decoded.actionLabels[0]
  const grading = applyUserAction(spot, chosenLabel)
  const review = buildReview(spot, grading, chosenLabel)
  const features = computeSpotFeatures(review, 0)
  const interpretation = interpretSpot(review.decisions[0], features)
  const claims = selectClaims(review.decisions[0], features, interpretation)
  const explanation = buildExplanation(review.decisions[0], features, interpretation, claims)
  return { review, features, interpretation, claims, explanation }
}

function claimNumberMismatches(claims: Claim[]): string[] {
  const mismatches: string[] = []
  for (const claim of claims) {
    const rendered = renderClaim(claim)
    for (const [key, value] of Object.entries(claim.data)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      const candidates = [value.toFixed(0), value.toFixed(1), value.toFixed(2)]
      if (!candidates.some((candidate) => rendered.includes(candidate))) mismatches.push(`${claim.id}.${key}=${value}`)
    }
  }
  return mismatches
}

async function collectResults(cases: { scenario: Scenario; flopStr: string }[]): Promise<AuditSpotResult[]> {
  const results: AuditSpotResult[] = []
  for (const { scenario, flopStr } of cases) {
    const flop = FLOPS.find((candidate) => candidate.cards.join('') === flopStr)
    const solution = await loadSolution(scenario.id, flopStr)
    if (!flop || !solution) continue
    const flopDef: FlopDef = flop
    const tree = buildStreetTree({ potBb: scenario.potBb, effectiveStackBb: scenario.effectiveStackBb, firstToAct: 0 })
    if (tree.kind !== 'decision') continue

    for (const path of PATHS) {
      const node = walk(tree, path)
      const nodeId = path.join('/')
      const decoded = solution.nodes.get(nodeId)
      if (!node || !decoded) continue
      const userSeat = decoded.player
      const pool = userSeat === 0 ? solution.oopCombos : solution.ipCombos
      const otherPool = userSeat === 0 ? solution.ipCombos : solution.oopCombos
      const step = Math.max(1, Math.floor(pool.length / SAMPLE_PER_NODE))

      for (let index = 0; index < pool.length; index += step) {
        const userCombo: Combo = pool[index]
        const userKeys = new Set(userCombo.map(cardKey))
        const botCombo = otherPool.find((combo) => !combo.some((card) => userKeys.has(cardKey(card))))
        if (!botCombo) continue
        const spot = {
          scenario,
          flop: flopDef,
          solution,
          userSeat,
          userCombo,
          botCombo,
          decisionNode: node,
          decodedNode: decoded,
          nodeId,
          botActionsBefore: path.map((label) => ({ nodeId: '', label })),
          actionsWithAmounts: actionLabelsWithAmounts(node),
        }
        const chosenLabel = decoded.actionLabels[0]
        const grading = applyUserAction(spot, chosenLabel)
        const review = buildReview(spot, grading, chosenLabel)
        const decision = review.decisions[0]
        const features = computeSpotFeatures(review, 0)
        const interpretation = interpretSpot(decision, features)
        const claims = selectClaims(decision, features, interpretation)
        const explanation = buildExplanation(decision, features, interpretation, claims)
        const fullText = [explanation.headline, ...explanation.paragraphs, explanation.sameClassLine].join('\n')
        const betKind = interpretation.betProfile
        const bestTarget = features.targets?.best
        const facingBet = features.nodeContext.kind === 'facingBet'
        const comboAggFreq = aggregateFrequency(decision.grading.actionBreakdown, facingBet)
        const classAggFreq = aggregateFrequency(features.sameClass.actionMix, facingBet)
        const exactOuts = exhaustiveDrawOuts(userCombo, decision.boardAtDecision)
        const targetHands = [...(bestTarget?.foldedHands ?? []), ...(bestTarget?.continueWeakHands ?? [])].map((target) => target.hand)
        const legalHands = new Set(
          decision.villainCombos
            .filter((combo, comboIndex) => decision.villainWeights[comboIndex] > 0 && !combo.some((card) => userKeys.has(cardKey(card))))
            .map(handStrFromCombo),
        )
        const impossibleHands = new Set(
          decision.villainCombos
            .filter((combo, comboIndex) => decision.villainWeights[comboIndex] > 0 && combo.some((card) => userKeys.has(cardKey(card))))
            .map(handStrFromCombo)
            .filter((hand) => !legalHands.has(hand)),
        )
        const mixed = explanation.paragraphs.some((paragraph) => paragraph.includes('混ぜます'))
        const chosenFreq = decision.grading.actionBreakdown.find((action) => action.label === decision.chosenLabel)?.freq ?? 0
        const bestFreq = decision.grading.actionBreakdown.find((action) => action.label === decision.grading.bestLabel)?.freq ?? 0

        results.push({
          where: `${scenario.id}/${flopStr}/node="${nodeId}"/${handStrFromCombo(userCombo)}`,
          seat: decision.seat,
          paragraphs: explanation.paragraphs,
          sameClassLine: explanation.sameClassLine,
          fullText,
          sdvLevel: features.sdvLevel,
          hasAnyDraw: features.draws.hasFlushDraw || features.draws.hasOESD || features.draws.hasGutshot,
          currentAheadPct: features.currentShowdown.heroAheadPct,
          betKind: betKind?.kind ?? null,
          evidenceCount: claims.length,
          valueTargetCount:
            interpretation.betProfile?.targetsToShow === 'continueWeak' || interpretation.betProfile?.targetsToShow === 'both'
              ? (bestTarget?.continueWeakHands.length ?? 0)
              : 0,
          deltaPp: (comboAggFreq - classAggFreq) * 100,
          claimNumberMismatch: claimNumberMismatches(claims),
          forbiddenIntent: /主目的|意図|狙い|ピュアブラフです/.test(fullText),
          drawMismatch: exactOuts.straight !== features.draws.straightDrawOuts || exactOuts.flush !== features.draws.flushDrawOuts,
          chosenDiffMissingBest:
            decision.chosenLabel !== decision.grading.bestLabel &&
            !explanation.paragraphs.slice(1).some((paragraph) => paragraph.includes(ACTION_LABEL_JA[decision.grading.bestLabel] ?? decision.grading.bestLabel)),
          mixedBelowThreshold: mixed && (chosenFreq < MIXED_STRATEGY_MIN_FREQ || bestFreq < MIXED_STRATEGY_MIN_FREQ),
          targetCollision: targetHands.some((hand) => impossibleHands.has(hand)),
          suitPattern: features.boardTexture.suitPattern,
        })
      }
    }
  }
  return results
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))]
}

describe('P14 S5: 解説文の恒久監査(全シナリオ横断)', () => {
  let results: AuditSpotResult[]
  let reportedA3: ExactAnalysis
  let ipCheckKqs: ExactAnalysis
  let bettingAjo: ExactAnalysis
  let blockedNinesTargets: string[]

  beforeAll(async () => {
    const reported = SCENARIOS.find((scenario) => scenario.id === 'srp_co_vs_btn_cc')
    const cases: { scenario: Scenario; flopStr: string }[] = reported ? [{ scenario: reported, flopStr: '7h7sKd' }] : []
    SCENARIOS.forEach((scenario, index) => {
      if (scenario.id !== 'srp_co_vs_btn_cc') cases.push({ scenario, flopStr: ROTATING_FLOPS[index % ROTATING_FLOPS.length] })
    })
    results = await collectResults(cases)

    if (!reported) throw new Error('reported scenario is missing')
    const flop = FLOPS.find((candidate) => candidate.cards.join('') === '7h7sKd')
    const solution = await loadSolution(reported.id, '7h7sKd')
    if (!flop || !solution) throw new Error('reported fixture is missing')
    const node = solution.nodes.get('check')
    if (!node || node.player !== 1) throw new Error('reported IP node is missing')
    const pool = solution.ipCombos
    const a3 = pool.find((combo) => new Set(combo.map(cardKey)).size === 2 && combo.some((card) => cardKey(card) === '14d') && combo.some((card) => cardKey(card) === '3d'))
    if (!a3) throw new Error('A3dd is missing')
    reportedA3 = analyzeCombo(reported, flop, solution, ['check'], a3)

    const kqsCandidates = pool.filter((combo) => handStrFromCombo(combo) === 'KQs')
    const kqs = kqsCandidates.find((combo) => analyzeCombo(reported, flop, solution, ['check'], combo).review.decisions[0].grading.bestLabel === 'check')
    if (!kqs) throw new Error('IP check KQs regression combo is missing')
    ipCheckKqs = analyzeCombo(reported, flop, solution, ['check'], kqs)

    const ajoCandidates = pool.filter((combo) => handStrFromCombo(combo) === 'AJo')
    const ajo = ajoCandidates.find((combo) => analyzeCombo(reported, flop, solution, ['check'], combo).review.decisions[0].grading.bestLabel !== 'check')
    if (!ajo) throw new Error('betting AJo regression combo is missing')
    bettingAjo = analyzeCombo(reported, flop, solution, ['check'], ajo)

    const blockerScenario = SCENARIOS.find((scenario) => scenario.id === 'srp_btn_vs_bb')
    const blockerFlop = FLOPS.find((candidate) => candidate.cards.join('') === 'AsKs9c')
    const blockerSolution = await loadSolution('srp_btn_vs_bb', 'AsKs9c')
    if (!blockerScenario || !blockerFlop || !blockerSolution) throw new Error('blocker fixture is missing')
    const blockerTree = buildStreetTree({ potBb: blockerScenario.potBb, effectiveStackBb: blockerScenario.effectiveStackBb, firstToAct: 0 })
    if (blockerTree.kind !== 'decision') throw new Error('blocker root is missing')
    const checkIndex = blockerTree.actionLabels.indexOf('check')
    const blockerDecisionNode = blockerTree.children[checkIndex]
    const blockerNode = blockerSolution.nodes.get('check')
    if (blockerDecisionNode.kind !== 'decision' || !blockerNode) throw new Error('blocker check node is missing')
    const nines = blockerSolution.ipCombos.find((combo) => combo.some((card) => cardKey(card) === '9h') && combo.some((card) => cardKey(card) === '9s'))
    if (!nines) throw new Error('9h9s blocker combo is missing')
    const blockerKeys = new Set(nines.map(cardKey))
    const blockerBot = blockerSolution.oopCombos.find((combo) => !combo.some((card) => blockerKeys.has(cardKey(card))))
    if (!blockerBot) throw new Error('blocker bot combo is missing')
    blockedNinesTargets = []
    for (const chosenLabel of blockerNode.actionLabels.filter((label) => label !== 'check')) {
      const spot = { scenario: blockerScenario, flop: blockerFlop, solution: blockerSolution, userSeat: 1 as const, userCombo: nines, botCombo: blockerBot, decisionNode: blockerDecisionNode, decodedNode: blockerNode, nodeId: 'check', botActionsBefore: [{ nodeId: '', label: 'check' }], actionsWithAmounts: actionLabelsWithAmounts(blockerDecisionNode) }
      const grading = applyUserAction(spot, chosenLabel)
      const review = buildReview(spot, grading, chosenLabel)
      const features = computeSpotFeatures(review, 0)
      for (const target of [features.targets?.chosen, features.targets?.best]) {
        blockedNinesTargets.push(...(target?.foldedHands.map((hand) => hand.hand) ?? []), ...(target?.continueWeakHands.map((hand) => hand.hand) ?? []))
      }
    }
  }, 300_000)

  it('監査対象と逸脱分布を実データから収集できる', () => {
    expect(results.length).toBeGreaterThan(50)
    const absoluteDeltas = results.map((result) => Math.abs(result.deltaPp)).sort((a, b) => a - b)
    const distribution = {
      n: absoluteDeltas.length,
      p50: quantile(absoluteDeltas, 0.5),
      p75: quantile(absoluteDeltas, 0.75),
      p90: quantile(absoluteDeltas, 0.9),
      p95: quantile(absoluteDeltas, 0.95),
      max: absoluteDeltas.at(-1),
      atLeast10: absoluteDeltas.filter((delta) => delta >= 10).length,
      atLeast15: absoluteDeltas.filter((delta) => delta >= 15).length,
      atLeast20: absoluteDeltas.filter((delta) => delta >= 20).length,
    }
    console.log('P14 S0 |Δ| distribution:', distribution)
    expect(Object.values(distribution).every((value) => value !== undefined && Number.isFinite(value))).toBe(true)
  })

  it('S5完了条件: C1〜C8の既知違反を0にする', () => {
    const violations = {
      c1Label: results.filter((result) => {
        const hand = result.paragraphs[0]?.match(/あなたの手は(.+?)で、/)?.[1]
        const same = result.sameClassLine.match(/同じ「(.+?)」クラス/)?.[1]
        return Boolean(hand?.includes('ショーダウン価値のある') && same?.includes('ショーダウン価値なし'))
      }).length,
      c2IpImpossible: results.filter((result) => result.seat === 1 && /チェックレイズ|相手のベットを誘い/.test(result.fullText)).length,
      c3Sdv: results.filter((result) => result.sdvLevel !== 'none' && result.fullText.includes('ショーダウン価値がほとんど無く')).length,
      c4Draw: results.filter((result) => !result.hasAnyDraw && /次のストリートで(エクイティを活かす|の改善)/.test(result.fullText)).length,
      c5Target: results.filter((result) => result.betKind === 'pureBluff' && result.valueTargetCount > 0).length,
      c6ThinEvidence: results.filter((result) => result.evidenceCount < 2).length,
      c7PureBluffAhead: results.filter((result) => result.betKind === 'pureBluff' && result.currentAheadPct >= 35).length,
      c8InvalidText: results.filter((result) => /NaN|undefined|null/.test(result.fullText)).length,
    }
    console.log('P14 S0 violation baseline:', violations)
    expect(violations).toEqual({
      c1Label: 0,
      c2IpImpossible: 0,
      c3Sdv: 0,
      c4Draw: 0,
      c5Target: 0,
      c6ThinEvidence: 0,
      c7PureBluffAhead: 0,
      c8InvalidText: 0,
    })
  })

  it('C9: Claimの全数値が同じClaimの描画文へ埋め込まれる', () => {
    expect(results.flatMap((result) => result.claimNumberMismatch.map((mismatch) => `${result.where}: ${mismatch}`))).toEqual([])
  })

  it('C10: ソルバーが示していない意図を断定する語彙を出さない', () => {
    expect(results.filter((result) => result.forbiddenIntent).map((result) => result.where)).toEqual([])
  })

  it('C11: 本文へ内部識別子を露出しない', () => {
    expect(results.filter((result) => /\b(?:thin|solid|none|pureBluff|semiBluff|protection|value)\b/.test(result.fullText)).map((result) => result.where)).toEqual([])
  })

  it('C12: 数値表記へマイナスゼロを出さない', () => {
    expect(results.filter((result) => /-0(?:\.0+)?(?:%|pp|bb)/.test(result.fullText)).map((result) => result.where)).toEqual([])
  })

  it('C13: ドロー主張のアウツ数は残りデッキ全列挙と一致する', () => {
    expect(results.filter((result) => result.drawMismatch).map((result) => result.where)).toEqual([])
  })

  it('C14: クラス平均との差が表示閾値未満なら差の根拠を出さない', () => {
    expect(results.filter((result) => Math.abs(result.deltaPp) < CLASS_BASELINE_MIN_DELTA_PP && result.fullText.includes('このコンボの積極頻度')).map((result) => result.where)).toEqual([])
  })

  it('C15: 選択手と最善手が異なる理由段落には最善手名を含む', () => {
    expect(results.filter((result) => result.chosenDiffMissingBest).map((result) => result.where)).toEqual([])
  })

  it('C16: リバー決断では将来の改善を示唆しない', () => {
    const decision = { ...reportedA3.review.decisions[0], street: 'river' as const, boardAtDecision: [...reportedA3.review.decisions[0].boardAtDecision, { rank: 2 as const, suit: 'c' as const }, { rank: 3 as const, suit: 'h' as const }], chosenLabel: 'check', grading: { ...reportedA3.review.decisions[0].grading, bestLabel: 'check' } }
    const features = { ...reportedA3.features, boardCardCount: 5, draws: { hasFlushDraw: false, hasOESD: true, hasGutshot: false, flushDrawOuts: 0, straightDrawOuts: 8 } }
    const text = buildExplanation(decision, features).paragraphs.join('\n')
    expect(text).not.toMatch(/改善余地|次のストリート|今後/)
  })

  it('C17: 低頻度アクションを混合戦略として説明しない', () => {
    expect(results.filter((result) => result.mixedBelowThreshold).map((result) => result.where)).toEqual([])
    const baseDecision = reportedA3.review.decisions[0]
    const bestLabel = baseDecision.grading.bestLabel
    const decision = {
      ...baseDecision,
      grading: {
        ...baseDecision.grading,
        verdict: 'marginal' as const,
        evLossBb: 0.01,
        actionBreakdown: baseDecision.grading.actionBreakdown.map((action) => (action.label === bestLabel ? { ...action, freq: 0 } : action)),
      },
    }
    expect(buildExplanation(decision, reportedA3.features).paragraphs.join('\n')).not.toContain('混ぜます')
  })

  it('C18: ヒーローと衝突して持てない相手ハンドをターゲット表示しない', () => {
    expect(results.filter((result) => result.targetCollision).map((result) => result.where)).toEqual([])
    expect(blockedNinesTargets).not.toContain('99')
  })

  it('C19: exportは対象決断より後のボードと履歴を含まない', () => {
    const review = reportedA3.review
    const flopDecision = review.decisions[0]
    const synthetic = {
      ...review,
      board: [...review.board, { rank: 2 as const, suit: 'c' as const }, { rank: 3 as const, suit: 'h' as const }],
      history: [
        ...review.history,
        { street: 'turn' as const, position: review.botPosition, label: 'future-turn-action', isUserDecision: false },
        { street: 'river' as const, position: review.botPosition, label: 'future-river-action', isUserDecision: false },
      ],
      decisions: [flopDecision],
    }
    const markdown = buildSpotMarkdown(synthetic, 0, null, null)
    expect(markdown).not.toMatch(/2♣|3♥|future-turn-action|future-river-action/)
  })

  it('C20: レインボー以外のボードをドライと説明しない', () => {
    expect(results.filter((result) => result.suitPattern !== 'rainbow' && result.fullText.includes('ドライ')).map((result) => result.where)).toEqual([])
    const features = { ...reportedA3.features, boardTexture: { ...reportedA3.features.boardTexture, connected: false, suitPattern: 'twoTone' as const } }
    const text = buildExplanation(reportedA3.review.decisions[0], features).paragraphs.join('\n')
    expect(text).not.toContain('ドライ')
  })

  it('実bin回帰: A♦3♦ on 7♥7♠K♦は保護型・ナッツBDFD・非ホイール・+38pp級の外れ値', () => {
    expect(reportedA3.interpretation.betProfile?.kind).toBe('protection')
    expect(reportedA3.features.backdoors).toEqual({ flush: { has: true, isNut: true }, straight: { has: false, isWheel: false } })
    expect(reportedA3.features.comboVsClass.deltaPp).toBeGreaterThan(35)
    expect(reportedA3.interpretation.deviation.drivers).toEqual(expect.arrayContaining(['blocker', 'backdoor', 'thinSdv']))
    expect([reportedA3.explanation.headline, ...reportedA3.explanation.paragraphs].join('\n')).not.toMatch(/ホイール|ピュアブラフ/)
  })

  it('実bin回帰: IPのKQsチェックに実行不能なチェックレイズ提案を出さない', () => {
    expect(ipCheckKqs.review.decisions[0].seat).toBe(1)
    expect(ipCheckKqs.review.decisions[0].grading.bestLabel).toBe('check')
    expect(ipCheckKqs.explanation.paragraphs.join('\n')).not.toMatch(/チェックレイズ|相手のベットを誘い/)
  })

  it('実bin回帰: AJoのベットを、現時点で35%以上勝つ場合にpureBluff扱いしない', () => {
    expect(bettingAjo.review.decisions[0].grading.bestLabel).not.toBe('check')
    if (bettingAjo.features.currentShowdown.heroAheadPct >= 35) {
      expect(bettingAjo.interpretation.betProfile?.kind).not.toBe('pureBluff')
    }
  })
})
