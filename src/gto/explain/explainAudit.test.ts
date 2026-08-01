/// <reference types="node" />
// P14 S0: 解説文の恒久監査ハーネス。
//
// 既知の1スポットの文言ではなく、収録済みシナリオを横断して同型の矛盾を検出する。
// S0では現行実装の違反を基準線として記録し、S1〜S5で検査をゼロ基準へ移行する。

import { beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cardKey } from '../../engine/deck'
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
import { selectEvidence } from './evidence'
import { computeSpotFeatures } from './features'
import { interpretSpot } from './interpretation'
import { buildExplanation } from './templates'

const ROTATING_FLOPS = ['7h7sKd', 'AsQsJs', '5s4d3h'] as const
const SAMPLE_PER_NODE = 3
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
        const evidences = selectEvidence(decision, features)
        const explanation = buildExplanation(decision, features, interpretation)
        const betKind = interpretation.betProfile
        const bestTarget = features.targets?.best
        const facingBet = features.nodeContext.kind === 'facingBet'
        const comboAggFreq = aggregateFrequency(decision.grading.actionBreakdown, facingBet)
        const classAggFreq = aggregateFrequency(features.sameClass.actionMix, facingBet)

        results.push({
          where: `${scenario.id}/${flopStr}/node="${nodeId}"/${handStrFromCombo(userCombo)}`,
          seat: decision.seat,
          paragraphs: explanation.paragraphs,
          sameClassLine: explanation.sameClassLine,
          fullText: [explanation.headline, ...explanation.paragraphs, explanation.sameClassLine].join('\n'),
          sdvLevel: features.sdvLevel,
          hasAnyDraw: features.draws.hasFlushDraw || features.draws.hasOESD || features.draws.hasGutshot,
          currentAheadPct: features.currentShowdown.heroAheadPct,
          betKind: betKind?.kind ?? null,
          evidenceCount: evidences.length,
          valueTargetCount:
            interpretation.betProfile?.targetsToShow === 'continueWeak' || interpretation.betProfile?.targetsToShow === 'both'
              ? (bestTarget?.continueWeakHands.length ?? 0)
              : 0,
          deltaPp: (comboAggFreq - classAggFreq) * 100,
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

describe('P14 S0: 解説文の恒久監査(全シナリオ横断)', () => {
  let results: AuditSpotResult[]

  beforeAll(async () => {
    const reported = SCENARIOS.find((scenario) => scenario.id === 'srp_co_vs_btn_cc')
    const cases: { scenario: Scenario; flopStr: string }[] = reported ? [{ scenario: reported, flopStr: '7h7sKd' }] : []
    SCENARIOS.forEach((scenario, index) => {
      if (scenario.id !== 'srp_co_vs_btn_cc') cases.push({ scenario, flopStr: ROTATING_FLOPS[index % ROTATING_FLOPS.length] })
    })
    results = await collectResults(cases)
  }, 300_000)

  it('監査対象と逸脱分布を実データから収集できる', () => {
    expect(results.length).toBeGreaterThan(100)
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

  it('S2移行後: 解釈層の単一定義でC1/C3/C5/C7を解消し、残る叙述層の違反を検出する', () => {
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
      c2IpImpossible: 8,
      c3Sdv: 0,
      c4Draw: 0,
      c5Target: 0,
      c6ThinEvidence: 133,
      c7PureBluffAhead: 0,
      c8InvalidText: 0,
    })
  })
})
