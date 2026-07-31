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
    boardAtDecision: [],
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
    boardTexture: { paired: false, suitPattern: 'rainbow', heightJa: 'ミドル', connected: false, summaryJa: 'レインボー・ドライ' },
    handClass,
    noPairShowdownValue: handClass === 'AIR' ? 'highCard' : null,
    weakPairSubtype: handClass === 'WEAK_PAIR' ? 'bluffCatcher' : null,
    draws: { hasFlushDraw: false, hasOESD: false, hasGutshot: false, flushDrawOuts: 0, straightDrawOuts: 0 },
    heroComboEquity: 0.55,
    currentShowdown: { heroEquity: 0.5, heroAheadPct: 45 },
    eqPercentileInRange: 62,
    rangeAdvantage: { heroAvg: 0.5, villainAvg: 0.48, verdictJa: '互角' },
    nutsAdvantage: { heroTopPct: 12, villainTopPct: 10, verdictJa: '互角' },
    equityBuckets: Array.from({ length: 10 }, (_, i) => ({ lo: i * 10, hi: (i + 1) * 10, heroPct: 10, villainPct: 10 })),
    responses,
    blockers: {
      valueCombosReducedPct: 8,
      bluffCombosReducedPct: 4,
      continueCombosReducedPct: kind === 'facingBet' ? 5 : null,
      blockedExamples: ['AKs'],
      valueBlockedHands: [{ hand: 'AKs', comboCount: 1, weightPct: 100 }],
      bluffBlockedHands: [{ hand: '72o', comboCount: 1, weightPct: 100 }],
      continueBlockedHands: kind === 'facingBet' ? [{ hand: 'AKs', comboCount: 1, weightPct: 100 }] : null,
    },
    betTarget: null,
    mdf: kind === 'facingBet' ? 0.6 : null,
    potOddsRequiredEq: kind === 'facingBet' ? 0.33 : null,
    sprBucket: { spr: 4, labelJa: '中SPR(3-6)' },
    sameClass: { classJa: HAND_CLASS_JA[handClass], comboCount: 10, actionMix: [{ label: bestLabel, freq: 0.7 }, { label: 'check', freq: 0.3 }] },
    streetStructure: { flopCheckedThrough: kind === 'facingBet' ? true : null, bettorIsIp: kind === 'facingBet' ? true : null },
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
  // P13 Phase D-2: ベットターゲット(TT・99からバリューを狙う、等)は専用パネル
  // (BetIntentPanel、Phase C)へ移設し、解説文の理由段落からは重複を避けるため削除した。
  // ボードテクスチャの一般論的な一文(「ストレートが増えやすく」等)も、D-1の証拠選択層
  // では「その手・その局面で事実として成立する証拠」に絞る方針のため対象外にした。

  it('ベットターゲットの有無によらず理由段落を生成でき、undefinedを含まない', () => {
    const decision = buildSyntheticDecision('root', 'correct')
    const features = buildSyntheticFeatures('root', 'MIDDLE')
    const without = buildExplanation(decision, features).paragraphs.join('')
    expect(without).not.toContain('undefined')

    features.betTarget = { chosen: { forLabel: 'bet33', valueTargetHands: [], bluffTargetHands: [] }, best: { forLabel: 'bet33', valueTargetHands: [], bluffTargetHands: [] } }
    const withEmptyTargets = buildExplanation(decision, features).paragraphs.join('')
    expect(withEmptyTargets).not.toContain('undefined')
  })

  it('チェック+MONSTERはチェックレイズ誘発(スロープレイ)の理由を含む', () => {
    const decision = buildSyntheticDecision('root', 'correct')
    decision.grading.bestLabel = 'check'
    decision.chosenLabel = 'check'
    const features = buildSyntheticFeatures('root', 'MONSTER')

    const reason = buildExplanation(decision, features).paragraphs.slice(1).join('')
    expect(reason).toContain('チェックレイズ')
  })

  it('fold: 改善込みの最終エクイティでも必要勝率に届かない場合は不足を理由にする', () => {
    const decision = buildSyntheticDecision('facingBet', 'correct')
    decision.grading.bestLabel = 'fold'
    decision.chosenLabel = 'fold'
    const features = buildSyntheticFeatures('facingBet', 'AIR')
    features.currentShowdown = { heroEquity: 0.1, heroAheadPct: 10 }
    features.heroComboEquity = 0.2
    features.potOddsRequiredEq = 0.33

    const reason = buildExplanation(decision, features).paragraphs.slice(1).join('')
    expect(reason).toContain('届きません')
  })

  it('fold: 改善なしの現時点勝率が既に必要勝率を上回る場合、ポットオッズ証拠は「ただし」で打ち消され、fold結論とは矛盾しない形で提示される', () => {
    const decision = buildSyntheticDecision('facingBet', 'correct')
    decision.grading.bestLabel = 'fold'
    decision.chosenLabel = 'fold'
    const features = buildSyntheticFeatures('facingBet', 'AIR')
    features.currentShowdown = { heroEquity: 0.4, heroAheadPct: 40 }
    features.heroComboEquity = 0.5
    features.potOddsRequiredEq = 0.2

    const reason = buildExplanation(decision, features).paragraphs.slice(1).join('')
    expect(reason).toContain('ただし')
    expect(reason).toContain('単独で上回る')
  })

  it('call: 改善なしでは必要勝率に届かないが最終的には届く場合、単純なポットオッズ適用を断定しない', () => {
    const decision = buildSyntheticDecision('facingBet', 'correct')
    const features = buildSyntheticFeatures('facingBet', 'MIDDLE')
    features.currentShowdown = { heroEquity: 0.1, heroAheadPct: 10 }
    features.heroComboEquity = 0.4
    features.potOddsRequiredEq = 0.33

    const reason = buildExplanation(decision, features).paragraphs.slice(1).join('')
    expect(reason).toContain('そのまま当てはめられません')
    expect(reason).not.toContain('コールが+EV')
  })

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

  it('比較段落: 継続レンジに対するエクイティが低いアクションを優位と断定しない', () => {
    const decision = buildSyntheticDecision('root', 'incorrect')
    const features = buildSyntheticFeatures('root', 'MIDDLE')

    const comparison = buildExplanation(decision, features).paragraphs[2]
    expect(comparison).not.toContain('エクイティもベット33%の方が')
  })

  it('correct時は比較段落(不正解時の追加段落)が生成されない', () => {
    const decision = buildSyntheticDecision('root', 'correct')
    const features = buildSyntheticFeatures('root', 'MONSTER')
    const explanation = buildExplanation(decision, features)
    expect(explanation.paragraphs.length).toBe(2)
  })

  it('marginal/incorrect時は比較段落が追加される', () => {
    // marginalはevLossBb=0.3/potBb=10=3%(収束誤差の許容内)のため、P7-5で追加した
    // 混合戦略注記(buildMixedStrategyNote)も加わり4段落になる。incorrectはevLossBb比率
    // 15%で許容外のため注記は付かず3段落のまま。
    const expected: Record<'marginal' | 'incorrect', number> = { marginal: 4, incorrect: 3 }
    for (const verdict of ['marginal', 'incorrect'] as const) {
      const decision = buildSyntheticDecision('root', verdict)
      const features = buildSyntheticFeatures('root', 'MIDDLE')
      const explanation = buildExplanation(decision, features)
      expect(explanation.paragraphs.length).toBe(expected[verdict])
    }
  })
})

describe('P13 Phase D-4: ユーザー報告ケースの回帰テスト', () => {
  it('A♠2♥ on K♥9♠3♦(チェック推奨): 「エア(ショーダウン価値なし)」も「次のストリートでエクイティを活かす」も理由段落に含まれない', () => {
    const actionLabels = ['check', 'bet33']
    const actionBreakdown = [
      { label: 'check', freq: 0.8, evBb: 1.2 },
      { label: 'bet33', freq: 0.2, evBb: 0.9 },
    ]
    const grading: GradeResult = { verdict: 'correct', evLossBb: 0, bestLabel: 'check', bestEvBb: 1.2, chosenEvBb: 1.2, actionBreakdown }
    const decodedNode: DecodedNode = { player: 0, actionLabels, freqs: new Float32Array(0), evsBb: new Float32Array(0) }
    const decision: ReviewDecision = {
      street: 'flop',
      nodeId: '',
      seat: 0,
      boardAtDecision: [],
      chosenLabel: 'check',
      grading,
      potBbAtDecision: 6,
      effectiveStackRemainingBb: 94,
      actionsWithAmounts: [],
      decodedNode,
      heroCombos: [],
      heroWeights: [],
      villainCombos: [],
      villainWeights: [],
      responseNodes: [],
    }

    const features: SpotFeatures = {
      nodeContext: { kind: 'root' },
      boardTexture: { paired: false, suitPattern: 'rainbow', heightJa: 'ハイ', connected: false, summaryJa: 'レインボー・ドライ' },
      handClass: 'AIR', // A♠2♥ on K♥9♠3♦: ノーペア
      noPairShowdownValue: 'highCard', // A(14) > ボード最高ランクK(13)
      weakPairSubtype: null,
      draws: { hasFlushDraw: false, hasOESD: false, hasGutshot: false, flushDrawOuts: 0, straightDrawOuts: 0 }, // K♥9♠3♦レインボー・A♠2♥もバラバラでドロー無し
      heroComboEquity: 0.22,
      currentShowdown: { heroEquity: 0.22, heroAheadPct: 20 },
      eqPercentileInRange: 40,
      rangeAdvantage: { heroAvg: 0.5, villainAvg: 0.5, verdictJa: '互角' },
      nutsAdvantage: { heroTopPct: 5, villainTopPct: 5, verdictJa: '互角' },
      equityBuckets: [],
      responses: [
        { forLabel: 'check', terminal: false, breakdown: [], foldFreq: 0, heroEquityVsContinueRange: null },
        { forLabel: 'bet33', terminal: false, breakdown: [{ label: 'fold', freq: 0.5 }, { label: 'call', freq: 0.5 }], foldFreq: 0.5, heroEquityVsContinueRange: 0.15 },
      ],
      blockers: { valueCombosReducedPct: 0, bluffCombosReducedPct: 0, continueCombosReducedPct: null, blockedExamples: [], valueBlockedHands: [], bluffBlockedHands: [], continueBlockedHands: null },
      betTarget: null,
      mdf: null,
      potOddsRequiredEq: null,
      sprBucket: { spr: 15, labelJa: '高SPR(>6)' },
      // sameClass.classJaは意図的にHAND_CLASS_JA[handClass]のまま(B-2の既存契約、
      // 「同じXクラスの手は」という母集団の呼称であり個別のハンド表記の修正対象外)。
      sameClass: { classJa: HAND_CLASS_JA.AIR, comboCount: 20, actionMix: [{ label: 'check', freq: 0.8 }, { label: 'bet33', freq: 0.2 }] },
      streetStructure: { flopCheckedThrough: null, bettorIsIp: null },
    }

    const explanation = buildExplanation(decision, features)
    // 「あなたの手は〜」(buildHandParagraph)と理由段落(evidence由来)には、
    // 修正済みのSDVラベルのみが出るはず(sameClassLineの母集団呼称は対象外)。
    expect(explanation.paragraphs.join('\n')).not.toContain('エア(ショーダウン価値なし)')
    const fullText = [explanation.headline, ...explanation.paragraphs, explanation.sameClassLine].join('\n')
    expect(fullText).not.toContain('次のストリートでエクイティを活かす')
  })

  it('Q♦J♣ on 5♠4♦3♥(フォールド推奨・必要勝率は最終的には満たす): MDFとレンジ内順位の対比を含み、ブロッカー率は含まない', () => {
    const actionLabels = ['fold', 'call', 'raise55']
    const actionBreakdown = [
      { label: 'fold', freq: 0.6, evBb: 0 },
      { label: 'call', freq: 0.3, evBb: -0.3 },
      { label: 'raise55', freq: 0.1, evBb: -0.8 },
    ]
    const grading: GradeResult = { verdict: 'correct', evLossBb: 0, bestLabel: 'fold', bestEvBb: 0, chosenEvBb: 0, actionBreakdown }
    const decodedNode: DecodedNode = { player: 0, actionLabels, freqs: new Float32Array(0), evsBb: new Float32Array(0) }
    const decision: ReviewDecision = {
      street: 'flop',
      nodeId: '',
      seat: 0,
      boardAtDecision: [],
      chosenLabel: 'fold',
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

    const features: SpotFeatures = {
      nodeContext: { kind: 'facingBet', betAmountBb: 5, potBeforeCallBb: 10 },
      boardTexture: { paired: false, suitPattern: 'rainbow', heightJa: 'ロー', connected: true, summaryJa: 'レインボー・コネクテッド' },
      handClass: 'AIR', // Q♦J♣ on 5♠4♦3♥: ノーペア(Qハイ)
      noPairShowdownValue: 'highCard', // Q(12) > ボード最高ランク5
      weakPairSubtype: null,
      draws: { hasFlushDraw: false, hasOESD: false, hasGutshot: false, flushDrawOuts: 0, straightDrawOuts: 0 },
      heroComboEquity: 0.27, // 最終的な(改善込みの)エクイティ。ユーザー報告と同じ27%
      currentShowdown: { heroEquity: 0.08, heroAheadPct: 8 }, // 改善なしではほぼ勝てない(残りは改善前提)
      eqPercentileInRange: 15, // レンジ内上位85%相当
      rangeAdvantage: { heroAvg: 0.45, villainAvg: 0.55, verdictJa: 'レンジ劣位' },
      nutsAdvantage: { heroTopPct: 3, villainTopPct: 8, verdictJa: 'ナッツ劣位' },
      equityBuckets: [],
      responses: [
        { forLabel: 'fold', terminal: true, breakdown: [], foldFreq: 0, heroEquityVsContinueRange: null },
        { forLabel: 'call', terminal: true, breakdown: [], foldFreq: 0, heroEquityVsContinueRange: null },
        { forLabel: 'raise55', terminal: false, breakdown: [{ label: 'fold', freq: 0.3 }, { label: 'call', freq: 0.7 }], foldFreq: 0.3, heroEquityVsContinueRange: null },
      ],
      // バリュー側・ブラフ側の差が閾値未満(D-1のBLOCKER_NET_THRESHOLD_PCT=3)なので
      // ブロッカー証拠は出ない想定(片側だけの誤誘導表示を避ける、というD-0-bの設計)。
      blockers: { valueCombosReducedPct: 6, bluffCombosReducedPct: 5, continueCombosReducedPct: null, blockedExamples: [], valueBlockedHands: [], bluffBlockedHands: [], continueBlockedHands: null },
      betTarget: null,
      mdf: 0.6, // 60%
      potOddsRequiredEq: 0.2, // ユーザー報告と同じ必要勝率20%
      sprBucket: { spr: 9, labelJa: '高SPR(>6)' },
      sameClass: { classJa: HAND_CLASS_JA.AIR, comboCount: 30, actionMix: [{ label: 'fold', freq: 0.6 }, { label: 'call', freq: 0.3 }] },
      streetStructure: { flopCheckedThrough: null, bettorIsIp: true },
    }

    const explanation = buildExplanation(decision, features)
    const reasonText = explanation.paragraphs.slice(1).join('\n')
    // レンジ内上位85% > MDF60%(続行範囲の外側) → MDF対比が理由に含まれる。
    expect(reasonText).toContain('MDF')
    expect(reasonText).toContain('85%')
    // バリュー/ブラフ側の差が閾値未満のため、ブロッカーの言及自体が出ない。
    expect(reasonText).not.toContain('ブロック')
  })
})
