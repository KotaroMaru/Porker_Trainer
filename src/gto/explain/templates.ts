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
  return (v * 100).toFixed(0) + '%'
}

/** 同上だが引数は既に0..100スケールの値(features.tsの*Pctフィールド等)。 */
function pctVal(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '不明'
  return v.toFixed(0) + '%'
}

function bb(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '不明'
  return v.toFixed(2) + 'bb'
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

function buildMixedStrategyNote(decision: ReviewDecision): string | null {
  const { grading } = decision
  if (grading.verdict !== 'correct' && grading.verdict !== 'marginal') return null
  if (decision.chosenLabel === grading.bestLabel) return null
  const potRef = decision.potBbAtDecision > 0 ? decision.potBbAtDecision : 1
  if (grading.evLossBb / potRef > MIXED_STRATEGY_EV_TOLERANCE_FRAC) return null
  return (
    `GTOはこの手で${actionJa(decision.chosenLabel)}と${actionJa(grading.bestLabel)}を混ぜます。均衡では混合されるアクションのEVは` +
    `ほぼ等しく、表示上の差(${bb(grading.evLossBb)})はソルバーの収束誤差の範囲内です。`
  )
}

function buildHandParagraph(features: SpotFeatures, interpretation: SpotInterpretation): string {
  const topPct = Number.isNaN(features.eqPercentileInRange) ? null : Math.round(100 - features.eqPercentileInRange)
  const handClassLabel = interpretation.handDescriptor.classJa
  const base = `あなたの手は${handClassLabel}で、実質エクイティは${pctVal(features.heroComboEquity * 100)}` + (topPct !== null ? `(自分のレンジ内で上位${topPct}%相当)` : '') + 'です。'
  const drawParts: string[] = []
  if (features.draws.hasFlushDraw) drawParts.push('フラッシュドロー')
  if (features.draws.hasOESD) drawParts.push('オープンエンドストレートドロー')
  else if (features.draws.hasGutshot) drawParts.push('ガットショット')
  const drawLine = drawParts.length > 0 ? `${drawParts.join('・')}を持っています。` : ''
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
      if (kind === 'value') text = `${BET_PROFILE_LABEL_JA[kind]}型で、相手の継続レンジに対するエクイティは${continueEq.toFixed(0)}%です。`
      else if (kind === 'protection') text = `${BET_PROFILE_LABEL_JA[kind]}型です。現時点のショーダウン価値があり、相手の観測フォールド率は${foldFreq >= 0 ? `${foldFreq.toFixed(0)}%` : '未計算'}です。`
      else if (kind === 'semiBluff') text = `${BET_PROFILE_LABEL_JA[kind]}型で、通常またはバックドアのドローがあります。相手の観測フォールド率は${foldFreq >= 0 ? `${foldFreq.toFixed(0)}%` : '未計算'}です。`
      else text = `${BET_PROFILE_LABEL_JA.pureBluff}型です。現時点のショーダウン価値とドローが乏しく、相手の観測フォールド率は${foldFreq >= 0 ? `${foldFreq.toFixed(0)}%` : '未計算'}です。`
      break
    }
    case 'classBaseline': {
      const context = claimString(claim, 'rangeContext')
      text = `このコンボの積極頻度は${claimNumber(claim, 'comboAggPct').toFixed(0)}%、同クラス平均は${claimNumber(claim, 'classAggPct').toFixed(0)}%(差${claimNumber(claim, 'deltaPp').toFixed(0)}pp)です。${context ? `${context}。` : ''}`
      break
    }
    case 'deviation': {
      const driverLabels: Record<string, string> = { blocker: 'ブロッカー', backdoor: 'バックドア', thinSdv: '脆いショーダウン価値' }
      const drivers = claimString(claim, 'drivers').split(',').filter(Boolean).map((driver) => driverLabels[driver] ?? driver)
      text = `同クラス平均から${claimNumber(claim, 'deltaPp').toFixed(0)}pp逸脱しています。${drivers.length > 0 ? `検出できた固有要因は${drivers.join('・')}です。` : '追加の固有要因は事実データから特定できません。'}`
      break
    }
    case 'betBlockerNet':
      text = `ベット文脈のブロッカーは、強い相手を${claimNumber(claim, 'valuePct').toFixed(0)}%、弱い相手を${claimNumber(claim, 'weakPct').toFixed(0)}%減らしています(差${claimNumber(claim, 'netPp').toFixed(0)}pp)。${claimString(claim, 'examples') ? `例: ${claimString(claim, 'examples')}。` : ''}`
      break
    case 'foldedHands':
      text = `相手の応答戦略では${claimString(claim, 'hands')}がフォールド側に多く配分されています。`
      break
    case 'checkShowdown':
      text = `現時点で相手レンジの${claimNumber(claim, 'aheadPct').toFixed(0)}%に勝っており、チェック後もショーダウン価値を残せます。`
      break
    case 'checkDraw':
      text = `${claimString(claim, 'draws')}があり、チェック後のランアウトでも改善余地があります。`
      break
    case 'checkTrap':
      text = 'OOPではチェック後にも相手のベットへ応答できるため、強い手をチェックレンジに残せます。'
      break
    case 'mdfVsPercentile':
      text = `最低ディフェンス頻度(MDF)は${claimNumber(claim, 'mdfPct').toFixed(0)}%、この手はレンジ内上位${claimNumber(claim, 'topPct').toFixed(0)}%です。`
      break
    case 'potOdds': {
      const state = claimString(claim, 'state')
      const required = claimNumber(claim, 'requiredPct').toFixed(0)
      const current = claimNumber(claim, 'currentPct').toFixed(0)
      const final = claimNumber(claim, 'finalPct').toFixed(0)
      text =
        state === 'currentEnough'
          ? `現時点の勝率${current}%が必要勝率${required}%を単独で上回ります(最終エクイティ${final}%)。`
          : state === 'improvementNeeded'
            ? `最終エクイティ${final}%は必要勝率${required}%を満たしますが、現時点は${current}%で改善が前提のため、そのまま当てはめられません。`
            : `現時点の勝率${current}%、最終エクイティ${final}%とも必要勝率${required}%に届きません。`
      break
    }
    case 'defenseBlockerNet':
      text = `相手の強い側を${claimNumber(claim, 'valuePct').toFixed(0)}%、弱い側を${claimNumber(claim, 'weakPct').toFixed(0)}%ブロックしています(差${claimNumber(claim, 'netPp').toFixed(0)}pp)。`
      break
    case 'streetStructure':
      text = claim.data.bettorIsIp ? '前ストリートはチェックで回り、相手はIPからベットしています。' : '前ストリートはチェックで回り、相手はOOPからベットしています。'
      break
    case 'raiseRejection': {
      const continueEq = claimNumber(claim, 'continueEquityPct')
      text = `${actionJa(claimString(claim, 'raiseLabel'))}はEV${claimNumber(claim, 'raiseEvBb').toFixed(2)}bbで、推奨アクションより${claimNumber(claim, 'evDiffBb').toFixed(2)}bb低いです。${continueEq >= 0 ? `継続レンジへのエクイティは${continueEq.toFixed(0)}%です。` : ''}`
      break
    }
    case 'frequencyReference':
      text = `${actionJa(claimString(claim, 'label'))}のソルバー頻度は${claimNumber(claim, 'freqPct').toFixed(0)}%です。`
      break
    case 'insufficientEvidence':
      text = `このスポットで数値から特定できる補助根拠は${claimNumber(claim, 'availableCount').toFixed(0)}件です。決め手は上の頻度表を参照してください。`
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
  return claims.map(renderClaim)
}

function buildComparisonParagraph(decision: ReviewDecision, features: SpotFeatures): string | null {
  if (decision.grading.verdict === 'correct') return null
  const { grading } = decision
  const chosenResponse = features.responses.find((r) => r.forLabel === decision.chosenLabel)
  const bestResponse = features.responses.find((r) => r.forLabel === grading.bestLabel)

  let line = `${actionJa(decision.chosenLabel)}のEV${bb(grading.chosenEvBb)}に対し、${actionJa(grading.bestLabel)}はEV${bb(grading.bestEvBb)}(差${bb(grading.evLossBb)})です。`

  if (chosenResponse && bestResponse && !chosenResponse.terminal && !bestResponse.terminal) {
    if (chosenResponse.heroEquityVsContinueRange !== null && bestResponse.heroEquityVsContinueRange !== null) {
      if (bestResponse.heroEquityVsContinueRange > chosenResponse.heroEquityVsContinueRange) {
        line += `相手の継続レンジに対するエクイティも${actionJa(grading.bestLabel)}の方が${pctVal(bestResponse.heroEquityVsContinueRange * 100)}(${actionJa(decision.chosenLabel)}は${pctVal(chosenResponse.heroEquityVsContinueRange * 100)})と優れています。`
      }
    }
  }
  return line
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
  const paragraphs: string[] = [buildHandParagraph(features, interpretation), ...buildReasonParagraphs(decision, features, interpretation, sharedClaims)]
  const comparison = buildComparisonParagraph(decision, features)
  if (comparison) paragraphs.push(comparison)
  const mixedNote = buildMixedStrategyNote(decision)
  if (mixedNote) paragraphs.push(mixedNote)
  const sameClassLine = buildSameClassLine(features, interpretation)

  return { headline, paragraphs, sameClassLine }
}

export type { HandStrength }
