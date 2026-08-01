// P5 Step B5: 決断1つを、外部AIチャット(ChatGPT/Claude)に貼るだけで文脈が
// 完全に伝わる自己完結マークダウンに変換する(「AIに質問用コピー」機能の中核)。
// シナリオ/ボード/自分の手/履歴/GTO戦略表/両者のレンジ/features数値/解説文を含む。
// features/explanationは計算前(featuresStatus:'computing'中)でも骨子だけ出せるよう
// null許容とする。

import type { Combo } from '../../analysis/range'
import { cardLabel } from '../../engine/deck'
import { handStrFromCombo, type ReviewData, type ReviewDecision } from '../trainer/reviewBuilder'
import { handClassLabelJa, type SpotFeatures } from './features'
import { selectEvidence } from './evidence'
import type { Explanation } from './templates'

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

// ui/gto/labels.tsのSTREET_LABEL_JAと同内容だが、gto/はui/に依存しない方針
// (ACTION_LABEL_JA同様、既存の意図的な重複)のためここにも定義する。
const STREET_LABEL_JA: Record<ReviewDecision['street'], string> = {
  flop: 'フロップ',
  turn: 'ターン',
  river: 'リバー',
}

function streetJa(street: ReviewDecision['street']): string {
  return STREET_LABEL_JA[street] ?? street
}

function pct(v: number): string {
  return (v * 100).toFixed(1) + '%'
}

/** weight>0のコンボをhandStrFromComboで集計し、そのレンジ内シェア(%)を降順で列挙する。 */
function summarizeRange(combos: readonly Combo[], weights: readonly number[]): string {
  const byHand = new Map<string, number>()
  for (let i = 0; i < combos.length; i++) {
    if (weights[i] <= 0) continue
    const hand = handStrFromCombo(combos[i])
    byHand.set(hand, (byHand.get(hand) ?? 0) + weights[i])
  }
  const total = [...byHand.values()].reduce((a, b) => a + b, 0)
  if (total <= 0) return '(レンジ情報なし)'
  return [...byHand.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([hand, w]) => `${hand} ${((w / total) * 100).toFixed(0)}%`)
    .join(', ')
}

function buildStrategyTable(decision: ReviewDecision): string {
  const rows = decision.grading.actionBreakdown.map((a) => `| ${actionJa(a.label)} | ${pct(a.freq)} | ${a.evBb.toFixed(2)}bb |`)
  return ['| アクション | 頻度 | EV |', '|---|---|---|', ...rows].join('\n')
}

/**
 * P13 Phase D-3: 生の数値表(外部AIが独自に検証できるよう残す)。以前はブロッカーを
 * 「相手のバリューコンボをX%ブロック」という一方的な言い回しで出しており、fold文脈でも
 * 無条件に表示されるため「じゃあコールでは?」と読み手が誤誘導される原因になっていた
 * (ユーザー報告)。ここでは方向性を主張せず、バリュー側・ブラフ側の両方を数値のまま示す。
 * 実際の「この数値がどちらへの根拠になるか」の判断は下の「根拠」セクション
 * (selectEvidence())に委ねる。
 */
function buildFeaturesSection(features: SpotFeatures | null): string {
  if (!features) return '(計算中、または未計算)'
  const lines: string[] = [
    `- ハンドクラス: ${handClassLabelJa(features.handClass, features.sdvLevel, features.weakPairSubtype)}`,
    `- 最終エクイティ(残りストリートの改善込み): ${pct(features.heroComboEquity)}(レンジ内上位${Math.round(100 - features.eqPercentileInRange)}%相当)`,
    `- 現時点の勝率(改善なし): ${pct(features.currentShowdown.heroEquity)}(相手レンジのうち現時点で優っている割合 ${features.currentShowdown.heroAheadPct.toFixed(0)}%)`,
    `- レンジ優位: ${features.rangeAdvantage.verdictJa}(自分平均${pct(features.rangeAdvantage.heroAvg)} / 相手平均${pct(features.rangeAdvantage.villainAvg)})`,
    `- ナッツ優位: ${features.nutsAdvantage.verdictJa}(自分${features.nutsAdvantage.heroTopPct.toFixed(0)}% / 相手${features.nutsAdvantage.villainTopPct.toFixed(0)}%)`,
    `- ブロッカー(バリュー側): 相手のバリューコンボを${features.blockers.valueCombosReducedPct.toFixed(0)}%ブロック` +
      (features.blockers.blockedExamples.length > 0 ? `(例: ${features.blockers.blockedExamples.join(', ')})` : ''),
    `- ブロッカー(ブラフ/弱いハンド側): ${features.blockers.bluffCombosReducedPct.toFixed(0)}%ブロック`,
    `- SPR: ${features.sprBucket.spr.toFixed(1)}(${features.sprBucket.labelJa})`,
  ]
  if (features.mdf !== null) lines.push(`- MDF: ${pct(features.mdf)}`)
  if (features.potOddsRequiredEq !== null) lines.push(`- 必要勝率(ポットオッズ): ${pct(features.potOddsRequiredEq)}`)
  return lines.join('\n')
}

/** P13 Phase D-3: selectEvidence()の出力を「この結論の根拠」「打ち消し要因」に分けて出力する。 */
function buildEvidenceSection(decision: ReviewDecision | null, features: SpotFeatures | null): string {
  if (!decision || !features) return '(計算中、または未計算)'
  const evidences = selectEvidence(decision, features)
  if (evidences.length === 0) return '(この決断向けの証拠は選定されませんでした)'
  const supporting = evidences.filter((e) => e.polarity !== 'opposes')
  const opposing = evidences.filter((e) => e.polarity === 'opposes')
  const lines: string[] = ['### この結論の根拠', ...(supporting.length > 0 ? supporting.map((e) => `- ${e.textJa}`) : ['(該当なし)'])]
  if (opposing.length > 0) {
    lines.push('', '### 打ち消し要因(結論には織り込み済み)', ...opposing.map((e) => `- ${e.textJa}`))
  }
  return lines.join('\n')
}

function buildExplanationSection(explanation: Explanation | null): string {
  if (!explanation) return '(計算中、または未計算)'
  return [explanation.headline, '', ...explanation.paragraphs, '', explanation.sameClassLine].join('\n')
}

/** 決断1つ(review.decisions[decisionIdx])を自己完結マークダウンに変換する。 */
export function buildSpotMarkdown(review: ReviewData, decisionIdx: number, features: SpotFeatures | null, explanation: Explanation | null): string {
  const decision = review.decisions[decisionIdx]
  if (!decision) throw new Error(`buildSpotMarkdown: no decision at index ${decisionIdx}`)

  const boardStr = review.board.map(cardLabel).join(' ')
  const userComboStr = review.userCombo.map(cardLabel).join(' ')
  const historyLines = review.history.map((h) => `- [${h.street}] ${h.position}: ${h.label}${h.isUserDecision ? '(あなたの決断)' : ''}`)

  // decision.seatは常にユーザーのシート(reviewBuilder.buildReviewの実装契約)。
  const heroLabel = review.userPosition
  const villainLabel = review.botPosition

  return [
    '# GTOポストフロップスポット',
    '',
    '## シナリオ',
    review.scenario.label,
    review.scenario.descriptionJa,
    `ポット: ${review.scenario.potBb}bb / 実効スタック: ${review.scenario.effectiveStackBb}bb`,
    '',
    '## ボード',
    boardStr,
    '',
    '## 自分の手',
    `${review.userPosition}: ${userComboStr}`,
    '',
    '## 履歴',
    ...historyLines,
    '',
    '## この決断',
    `ストリート: ${streetJa(decision.street)}`,
    `この決断時点のボード: ${decision.boardAtDecision.map(cardLabel).join(' ')}`,
    `手番: ${heroLabel}(相手: ${villainLabel})`,
    `選択したアクション: ${actionJa(decision.chosenLabel)}`,
    `判定: ${decision.grading.verdict}(EVロス ${decision.grading.evLossBb.toFixed(2)}bb、最善手: ${actionJa(decision.grading.bestLabel)})`,
    '',
    '## GTO戦略(このノード)',
    buildStrategyTable(decision),
    '',
    '## 両者のレンジ(この決断到達時点)',
    `### 自分側`,
    summarizeRange(decision.heroCombos, decision.heroWeights),
    `### 相手側`,
    summarizeRange(decision.villainCombos, decision.villainWeights),
    '',
    '## 特徴量(生の数値、外部AIによる独自検証用)',
    buildFeaturesSection(features),
    '',
    '## 根拠',
    buildEvidenceSection(decision, features),
    '',
    '## 解説',
    buildExplanationSection(explanation),
    '',
    '---',
    `この状況について質問: なぜ${actionJa(decision.grading.bestLabel)}が最善なのですか?`,
  ].join('\n')
}
