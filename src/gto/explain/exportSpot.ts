// P5 Step B5: 決断1つを、外部AIチャット(ChatGPT/Claude)に貼るだけで文脈が
// 完全に伝わる自己完結マークダウンに変換する(「AIに質問用コピー」機能の中核)。
// シナリオ/ボード/自分の手/履歴/GTO戦略表/両者のレンジ/features数値/解説文を含む。
// features/explanationは計算前(featuresStatus:'computing'中)でも骨子だけ出せるよう
// null許容とする。

import type { Combo } from '../../analysis/range'
import { cardLabel } from '../../engine/deck'
import { handStrFromCombo, type ReviewData, type ReviewDecision } from '../trainer/reviewBuilder'
import { HAND_CLASS_JA, type SpotFeatures } from './features'
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

function buildFeaturesSection(features: SpotFeatures | null): string {
  if (!features) return '(計算中、または未計算)'
  const lines: string[] = [
    `- ハンドクラス: ${HAND_CLASS_JA[features.handClass]}`,
    `- 実質エクイティ: ${pct(features.heroComboEquity)}(レンジ内上位${Math.round(100 - features.eqPercentileInRange)}%相当)`,
    `- レンジ優位: ${features.rangeAdvantage.verdictJa}(自分平均${pct(features.rangeAdvantage.heroAvg)} / 相手平均${pct(features.rangeAdvantage.villainAvg)})`,
    `- ナッツ優位: ${features.nutsAdvantage.verdictJa}(自分${features.nutsAdvantage.heroTopPct.toFixed(0)}% / 相手${features.nutsAdvantage.villainTopPct.toFixed(0)}%)`,
    `- ブロッカー: 相手のバリューコンボを${features.blockers.valueCombosReducedPct.toFixed(0)}%ブロック` + (features.blockers.blockedExamples.length > 0 ? `(例: ${features.blockers.blockedExamples.join(', ')})` : ''),
    `- SPR: ${features.sprBucket.spr.toFixed(1)}(${features.sprBucket.labelJa})`,
  ]
  if (features.mdf !== null) lines.push(`- MDF: ${pct(features.mdf)}`)
  if (features.potOddsRequiredEq !== null) lines.push(`- 必要勝率(ポットオッズ): ${pct(features.potOddsRequiredEq)}`)
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
    '## 特徴量',
    buildFeaturesSection(features),
    '',
    '## 解説',
    buildExplanationSection(explanation),
    '',
    '---',
    `この状況について質問: なぜ${actionJa(decision.grading.bestLabel)}が最善なのですか?`,
  ].join('\n')
}
