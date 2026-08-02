// P5 Step B4: 特徴量(features.ts)+採点結果(grading.ts)から、日本語のルールベース
//解説を生成する。本機能の差別化点(「EVは出るがなぜそのアクションが優れているか
// 分からない」の解決)そのもの。全決断(正解/不正解問わず)に表示する。
//
// v1はルールベースのテンプレート合成で、文面の質はユーザーの実プレイフィードバックで
// 反復改善する前提(マスタープラン「リスクと対策」参照)。ここで保証するのは
// 「壊れていないこと」(数値が全て具体値に補間され、NaN/undefined文字列が
// 混入しないこと)。

import type { HandStrength } from '../../advisor/postflop'
import type { ReviewDecision } from '../trainer/reviewBuilder'
import type { SpotFeatures } from './features'
import { BET_PROFILE_LABEL_JA, interpretSpot, type SpotInterpretation } from './interpretation'
import { selectClaims, type Claim } from './evidence'

export interface Explanation {
  /** 結論1行。 */
  headline: string
  /** 理由→証拠の段落(2〜4個)。 */
  paragraphs: string[]
  /** 同クラス比較(全verdictで必須)。 */
  sameClassLine: string
}

const ACTION_LABEL_JA: Record<string, string> = {
  check: 'チェック',
  fold: 'フォールド',
  call: 'コール',
  bet33: 'ベット33%',
  bet75: 'ベット75%',
  raise55: 'レイズ55%',
  allin: 'オールイン',
}

function actionJa(label: string): string {
  return ACTION_LABEL_JA[label] ?? label
}

/** NaN/undefinedを絶対に文字列化しないための防御的フォーマッタ。引数は0..1の比率。 */
function pctFrac(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '不明'
  return fixed(v * 100, 0) + '%'
}

/** 同上だが引数は既に0..100スケールの値(features.tsの*Pctフィールド等)。 */
function pctVal(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '不明'
  return fixed(v, 0) + '%'
}

function bb(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '不明'
  return fixed(v, 2) + 'bb'
}

function fixed(v: number, digits: number): string {
  const rounded = Number(v.toFixed(digits))
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(digits)
}

function findAction(decision: ReviewDecision, label: string) {
  return decision.grading.actionBreakdown.find((a) => a.label === label)
}

function buildHeadline(decision: ReviewDecision): string {
  const { grading } = decision
  const bestFreq = findAction(decision, grading.bestLabel)?.freq
  const chosenFreq = findAction(decision, decision.chosenLabel)?.freq

  if (grading.verdict === 'correct') {
    // P7-5: 採点(grading.ts)は頻度ベース(GTOがどれだけ混ぜるか)であり、EV最大手★とは
    // 別の基準。「が最善」と書くとEV最大手(★)と矛盾するように見えるため、採点基準を
    // 明示する「GTO正解」に言い換える。EV最大手との関係は必要な場合のみ
    // buildMixedStrategyNoteで別途補足する。
    return `○ ${actionJa(decision.chosenLabel)}はGTO正解(頻度${pctFrac(chosenFreq)})`
  }
  if (grading.verdict === 'marginal') {
    return `△ ${actionJa(decision.chosenLabel)}は境界上の手(頻度${pctFrac(chosenFreq)}・EVロス${bb(grading.evLossBb)})。${actionJa(grading.bestLabel)}も有力`
  }
  return `✕ ${actionJa(grading.bestLabel)}が最善(頻度${pctFrac(bestFreq)}・EV${bb(grading.bestEvBb)})。${actionJa(decision.chosenLabel)}はEVロス${bb(grading.evLossBb)}`
}

/**
 * 選んだ手がGTO正解/境界上の手だが、EV表の★(最高EVのアクション)とは異なる場合に、
 * 「なぜ食い違って見えるか」を補足する注記を返す(P7-5)。EV差が大きい場合
 * (収束誤差では説明しにくい)は補足しない — 本当にEVが劣る可能性があるため。
 * 閾値はP3で確認済みの収束ノイズの目安(このボードのポットに対する数%)に合わせている。
 */
const MIXED_STRATEGY_EV_TOLERANCE_FRAC = 0.05
export const MIXED_STRATEGY_MIN_FREQ = 0.01

function buildMixedStrategyNote(decision: ReviewDecision): string | null {
  const { grading } = decision
  if (grading.verdict !== 'correct' && grading.verdict !== 'marginal') return null
  if (decision.chosenLabel === grading.bestLabel) return null
  const chosenFreq = findAction(decision, decision.chosenLabel)?.freq ?? 0
  const bestFreq = findAction(decision, grading.bestLabel)?.freq ?? 0
  if (chosenFreq < MIXED_STRATEGY_MIN_FREQ || bestFreq < MIXED_STRATEGY_MIN_FREQ) return null
  const potRef = decision.potBbAtDecision > 0 ? decision.potBbAtDecision : 1
  if (grading.evLossBb / potRef > MIXED_STRATEGY_EV_TOLERANCE_FRAC) return null
  return (
    `GTOはこの手で${actionJa(decision.chosenLabel)}と${actionJa(grading.bestLabel)}を混ぜます。均衡では混合されるアクションのEVは` +
    `ほぼ等しく、表示上の差(${bb(grading.evLossBb)})はソルバーの収束誤差の範囲内です。`
  )
}

function buildHandParagraph(decision: ReviewDecision, features: SpotFeatures, interpretation: SpotInterpretation): string {
  const topPct = Number.isNaN(features.eqPercentileInRange) ? null : Math.round(100 - features.eqPercentileInRange)
  const handClassLabel = interpretation.handDescriptor.classJa
  const base = `あなたの手は${handClassLabel}で、実質エクイティは${pctVal(features.heroComboEquity * 100)}` + (topPct !== null ? `(自分のレンジ内で上位${topPct}%相当)` : '') + 'です。'
  const drawParts = interpretation.handDescriptor.drawsJa
  const drawLine = drawParts.length > 0 ? (decision.boardAtDecision.length === 5 ? `${drawParts.join('・')}は完成せずに終わりました。` : `${drawParts.join('・')}を持っています。`) : ''
  return base + drawLine
}

/**
 * P13 Phase D-2: 旧buildReasonParagraphはactionCategory×handClassの巨大if/elseで、
 * 各分岐が固定の事実セットを無条件に並べていた(該当しない理由を書く/結論と無関係な
 * 証拠を混ぜる、というユーザー報告バグの根本原因)。selectEvidence()が「その手・その
 * 局面で事実として成立する証拠」だけを優先度順に返すので、ここでは1証拠=1段落として
 * 組み立てるだけにする。polarity==='opposes'の証拠は落とさず、「ただし〜」で明示的に
 * 打ち消して提示する(結論との矛盾を放置しない、外部レビュー対応)。
 */
function claimNumber(claim: Claim, key: string): number {
  const value = claim.data[key]
  return typeof value === 'number' ? value : NaN
}

function claimString(claim: Claim, key: string): string {
  const value = claim.data[key]
  return typeof value === 'string' ? value : ''
}

export function renderClaim(claim: Claim): string {
  let text: string
  switch (claim.id) {
    case 'betProfile': {
      const kind = claimString(claim, 'kind') as keyof typeof BET_PROFILE_LABEL_JA
      const continueEq = claimNumber(claim, 'continueEquityPct')
      const foldFreq = claimNumber(claim, 'foldFreqPct')
      const observations = [
        Number.isFinite(continueEq) ? `継続レンジへのエクイティ${fixed(continueEq, 0)}%` : null,
        Number.isFinite(foldFreq) ? `観測フォールド率${fixed(foldFreq, 0)}%` : null,
      ].filter((value) => value !== null).join('、')
      if (kind === 'value') text = `${BET_PROFILE_LABEL_JA[kind]}です。${observations}。`
      else if (kind === 'protection') text = `${BET_PROFILE_LABEL_JA[kind]}で、現時点のショーダウン価値があります。${observations}。`
      else if (kind === 'semiBluff') text = `${BET_PROFILE_LABEL_JA[kind]}で、通常またはバックドアのドローがあります。${observations}。`
      else text = `${BET_PROFILE_LABEL_JA.pureBluff}で、現時点のショーダウン価値とドローが乏しい状態です。${observations}。`
      break
    }
    case 'classBaseline': {
      const context = claimString(claim, 'rangeContext')
      text = `このコンボの積極頻度は${fixed(claimNumber(claim, 'comboAggPct'), 0)}%、同クラス平均は${fixed(claimNumber(claim, 'classAggPct'), 0)}%(差${fixed(claimNumber(claim, 'deltaPp'), 0)}pp)です。${context ? `${context}。` : ''}`
      break
    }
    case 'deviation': {
      const driverLabels: Record<string, string> = { blocker: 'ブロッカー', backdoor: 'バックドア', thinSdv: '脆いショーダウン価値' }
      const drivers = claimString(claim, 'drivers').split(',').filter(Boolean).map((driver) => driverLabels[driver] ?? driver)
      text = `同クラス平均から${fixed(claimNumber(claim, 'deltaPp'), 0)}pp逸脱しています。${drivers.length > 0 ? `検出できた固有要因は${drivers.join('・')}です。` : '追加の固有要因は事実データから特定できません。'}`
      break
    }
    case 'betBlockerNet':
      text = `ベット文脈のブロッカーは、強い相手を${fixed(claimNumber(claim, 'valuePct'), 0)}%、弱い相手を${fixed(claimNumber(claim, 'weakPct'), 0)}%減らしています(差${fixed(claimNumber(claim, 'netPp'), 0)}pp)。${claimString(claim, 'examples') ? `例: ${claimString(claim, 'examples')}。` : ''}`
      break
    case 'foldedHands':
      text = `相手の応答戦略では${claimString(claim, 'hands')}がフォールド側に多く配分されています。`
      break
    case 'checkShowdown':
      text = `ショーダウン価値は${({ solid: '十分', thin: '限定的', none: 'ほぼなし' } as Record<string, string>)[claimString(claim, 'sdvLevel')] ?? '不明'}で、現時点で相手レンジの${fixed(claimNumber(claim, 'aheadPct'), 0)}%に勝っています。`
      break
    case 'checkDraw':
      text = `${claimString(claim, 'draws')}があり、チェック後のランアウトでも改善余地があります。`
      break
    case 'checkTrap':
      text = 'OOPではチェック後にも相手のベットへ応答できるため、強い手をチェックレンジに残せます。'
      break
    case 'mdfVsPercentile':
      text = `最低ディフェンス頻度(MDF)は${fixed(claimNumber(claim, 'mdfPct'), 0)}%、この手はレンジ内上位${fixed(claimNumber(claim, 'topPct'), 0)}%で、${claim.data.within ? '続行圏内' : '続行圏外'}です。`
      break
    case 'potOdds': {
      const state = claimString(claim, 'state')
      const required = fixed(claimNumber(claim, 'requiredPct'), 0)
      const current = fixed(claimNumber(claim, 'currentPct'), 0)
      const final = fixed(claimNumber(claim, 'finalPct'), 0)
      text =
        state === 'currentEnough'
          ? `現時点の勝率${current}%が必要勝率${required}%を単独で上回ります(最終エクイティ${final}%)。`
          : state === 'improvementNeeded'
            ? `最終エクイティ${final}%は必要勝率${required}%を満たしますが、現時点は${current}%で改善が前提のため、そのまま当てはめられません。`
            : `現時点の勝率${current}%、最終エクイティ${final}%とも必要勝率${required}%に届きません。`
      break
    }
    case 'defenseBlockerNet':
      text = `相手の強い側を${fixed(claimNumber(claim, 'valuePct'), 0)}%、弱い側を${fixed(claimNumber(claim, 'weakPct'), 0)}%ブロックしています(差${fixed(claimNumber(claim, 'netPp'), 0)}pp)。`
      break
    case 'streetStructure':
      text = claim.data.bettorIsIp ? '前ストリートはチェックで回り、相手はIPからベットしています。' : '前ストリートはチェックで回り、相手はOOPからベットしています。'
      break
    case 'raiseRejection': {
      const continueEq = claimNumber(claim, 'continueEquityPct')
      text = `${actionJa(claimString(claim, 'raiseLabel'))}はEV${fixed(claimNumber(claim, 'raiseEvBb'), 2)}bbで、推奨アクションより${fixed(claimNumber(claim, 'evDiffBb'), 2)}bb低いです。${continueEq >= 0 ? `継続レンジへのエクイティは${fixed(continueEq, 0)}%です。` : ''}`
      break
    }
    case 'frequencyReference':
      text = `${actionJa(claimString(claim, 'label'))}のソルバー頻度は${fixed(claimNumber(claim, 'freqPct'), 0)}%です。`
      break
    case 'insufficientEvidence':
      text = `このスポットで数値から特定できる補助根拠は${fixed(claimNumber(claim, 'availableCount'), 0)}件です。決め手は上の頻度表を参照してください。`
      break
  }
  if (claim.polarity === 'opposes') {
    return `ただし、${text}この点は他の根拠と相殺されます。`
  }
  return text
}

function buildReasonParagraphs(decision: ReviewDecision, features: SpotFeatures, interpretation: SpotInterpretation, sharedClaims?: Claim[]): string[] {
  const claims = sharedClaims ?? selectClaims(decision, features, interpretation)
  if (claims.length === 0) {
    return [`${actionJa(decision.grading.bestLabel)}がこの局面のGTO解です。`]
  }
  const paragraphs = claims.map(renderClaim)
  if (decision.chosenLabel !== decision.grading.bestLabel) {
    paragraphs.unshift(`この局面のEV最善手は${actionJa(decision.grading.bestLabel)}です。`)
  }
  return paragraphs
}

function buildComparisonParagraph(decision: ReviewDecision): string | null {
  if (decision.grading.verdict === 'correct') return null
  const { grading } = decision
  return `${actionJa(decision.chosenLabel)}のEV${bb(grading.chosenEvBb)}に対し、${actionJa(grading.bestLabel)}はEV${bb(grading.bestEvBb)}(差${bb(grading.evLossBb)})です。`
}

function buildSameClassLine(features: SpotFeatures, interpretation: SpotInterpretation): string {
  const classJa = interpretation.handDescriptor.baselineClassJa
  if (features.sameClass.actionMix.length === 0 || features.sameClass.comboCount === 0) {
    return `同じ「${classJa}」クラスの手のデータが不足しています。`
  }
  const top = features.sameClass.actionMix.reduce((a, b) => (b.freq > a.freq ? b : a))
  return `同じ「${classJa}」クラスの手はGTOで平均${pctFrac(top.freq)}が${actionJa(top.label)}を選びます。`
}

export function buildExplanation(decision: ReviewDecision, features: SpotFeatures, sharedInterpretation?: SpotInterpretation, sharedClaims?: Claim[]): Explanation {
  const interpretation = sharedInterpretation ?? interpretSpot(decision, features)
  const headline = buildHeadline(decision)
  const paragraphs: string[] = [buildHandParagraph(decision, features, interpretation), ...buildReasonParagraphs(decision, features, interpretation, sharedClaims)]
  const comparison = buildComparisonParagraph(decision)
  if (comparison) paragraphs.push(comparison)
  const mixedNote = buildMixedStrategyNote(decision)
  if (mixedNote) paragraphs.push(mixedNote)
  const sameClassLine = buildSameClassLine(features, interpretation)

  return { headline, paragraphs, sameClassLine }
}

export type { HandStrength }
