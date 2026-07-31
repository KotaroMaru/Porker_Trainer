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
import { handClassLabelJa, type SpotFeatures } from './features'

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

type ActionCategory = 'bet' | 'check' | 'call' | 'fold'

function actionCategory(label: string): ActionCategory {
  if (label === 'check') return 'check'
  if (label === 'call') return 'call'
  if (label === 'fold') return 'fold'
  return 'bet' // bet33/bet75/raise55/allinは全て「アグレッシブ」カテゴリとして扱う
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

function buildHandParagraph(features: SpotFeatures): string {
  const topPct = Number.isNaN(features.eqPercentileInRange) ? null : Math.round(100 - features.eqPercentileInRange)
  const handClassLabel = handClassLabelJa(features.handClass, features.noPairShowdownValue, features.weakPairSubtype)
  const base = `あなたの手は${handClassLabel}で、実質エクイティは${pctVal(features.heroComboEquity * 100)}` + (topPct !== null ? `(自分のレンジ内で上位${topPct}%相当)` : '') + 'です。'
  const drawParts: string[] = []
  if (features.draws.hasFlushDraw) drawParts.push('フラッシュドロー')
  if (features.draws.hasOESD) drawParts.push('オープンエンドストレートドロー')
  else if (features.draws.hasGutshot) drawParts.push('ガットショット')
  const drawLine = drawParts.length > 0 ? `${drawParts.join('・')}を持っています。` : ''
  return base + drawLine
}

/** 最善アクションに対応するターゲットだけを使い、別サイズの集計を誤って混ぜない。 */
function bestBetTargetHands(decision: ReviewDecision, features: SpotFeatures, kind: 'value' | 'bluff'): string[] {
  const best = features.betTarget?.best
  // 正解時はchosen/bestが同じ内容だが、データがbest側に無いケースにも防御的に対応する。
  const chosen = decision.chosenLabel === decision.grading.bestLabel ? features.betTarget?.chosen : null
  const target = best?.forLabel === decision.grading.bestLabel ? best : chosen?.forLabel === decision.grading.bestLabel ? chosen : null
  const hands = kind === 'value' ? target?.valueTargetHands : target?.bluffTargetHands
  return (hands ?? []).slice(0, 3).map((entry) => entry.hand).filter((hand) => hand.length > 0)
}

function buildBetTargetLine(decision: ReviewDecision, features: SpotFeatures, kind: 'value' | 'bluff'): string {
  const hands = bestBetTargetHands(decision, features, kind)
  if (hands.length === 0) return ''
  return kind === 'value' ? `相手の${hands.join('・')}からバリューを狙います。` : `相手の${hands.join('・')}をフォールドさせるブラフです。`
}

/** テクスチャが次ストリートの価値・危険度に直結する局面だけ、短く補足する。 */
function buildTextureLine(features: SpotFeatures, category: ActionCategory): string {
  const { boardTexture } = features
  if (category === 'bet' && boardTexture.connected) {
    return `この${boardTexture.summaryJa}ボードはターン以降にストレートが増えやすく、今のストリートでエクイティを実現する意味もあります。`
  }
  if (category === 'bet' && boardTexture.suitPattern === 'twoTone' && !features.draws.hasFlushDraw) {
    return `この${boardTexture.summaryJa}では相手にフラッシュドローを与えうるため、ベットで料金を課します。`
  }
  if (category === 'check' && boardTexture.paired) {
    return `この${boardTexture.summaryJa}では相手のトリップスやフルハウスへの発展も意識し、ポットをむやみに膨らませません。`
  }
  return ''
}

function buildReasonParagraph(decision: ReviewDecision, features: SpotFeatures): string {
  const bestLabel = decision.grading.bestLabel
  const category = actionCategory(bestLabel)
  const bestResponse = features.responses.find((r) => r.forLabel === bestLabel)

  if (category === 'bet') {
    const foldFreq = bestResponse && !bestResponse.terminal ? bestResponse.foldFreq : null
    const continueEq = bestResponse?.heroEquityVsContinueRange ?? null
    if (features.handClass === 'MONSTER' || features.handClass === 'STRONG_MADE' || features.handClass === 'MIDDLE') {
      return (
        `${features.rangeAdvantage.verdictJa}な状況で、相手の継続レンジに対しても${pctVal((continueEq ?? features.heroComboEquity) * 100)}のエクイティがあるためバリューを稼げます。` +
        buildBetTargetLine(decision, features, 'value') +
        (foldFreq !== null ? `相手のフォールド率は${pctFrac(foldFreq)}です。` : '') +
        buildTextureLine(features, category)
      )
    }
    if (features.handClass === 'STRONG_DRAW' || features.handClass === 'WEAK_DRAW') {
      return (
        `完成すれば強い手になるドローで、相手のフォールド率${pctFrac(foldFreq)}に加え、コールされても継続レンジに対して${pctVal((continueEq ?? features.heroComboEquity) * 100)}のエクイティを残すセミブラフです。` +
        (features.blockers.valueCombosReducedPct > 0 ? `相手のバリューハンドを${pctVal(features.blockers.valueCombosReducedPct)}ブロックしている点も後押しします。` : '') +
        buildTextureLine(features, category)
      )
    }
    return (
      `ショーダウン価値の低い手ですが、相手のフォールド率${pctFrac(foldFreq)}を突くブラフとして機能します。` +
      buildBetTargetLine(decision, features, 'bluff') +
      (features.blockers.valueCombosReducedPct > 0 ? `相手のバリューハンドを${pctVal(features.blockers.valueCombosReducedPct)}ブロックしています。` : '') +
      buildTextureLine(features, category)
    )
  }

  if (category === 'check') {
    if (features.handClass === 'MONSTER' || features.handClass === 'STRONG_MADE') {
      return '強い手ですが、ここでベットしても相手のコール/継続レンジから十分な価値を引き出しにくいため、チェックで相手のベットを誘い、チェックレイズにつなげる方が得です。' + buildTextureLine(features, category)
    }
    if (features.handClass === 'AIR' || features.handClass === 'STRONG_DRAW' || features.handClass === 'WEAK_DRAW') {
      return `無理に攻めずチェックでポットを小さく保ち、次のストリートでエクイティを活かす方針です(${features.nutsAdvantage.verdictJa})。`
    }
    return 'ミドル程度の強さで、ベットして良い手にレイズされるリスクを避けつつ、エクイティを守るチェックが優位です(ポットコントロール)。'
  }

  if (category === 'call') {
    const req = features.potOddsRequiredEq
    const equity = features.heroComboEquity
    if (equity >= (req ?? 0)) {
      return `必要勝率${pctVal((req ?? 0) * 100)}に対し実際のエクイティは${pctVal(equity * 100)}あり、コールが+EVです。` + (features.mdf !== null ? `このサイズに対する最低ディフェンス頻度は${pctVal(features.mdf * 100)}です。` : '')
    }
    return `実際のエクイティは${pctVal(equity * 100)}で単純なポットオッズ上の必要勝率${pctVal((req ?? 0) * 100)}には届きませんが、GTOではレンジ全体の防御を考慮してコールを選びます。` + (features.mdf !== null ? `このサイズに対する最低ディフェンス頻度は${pctVal(features.mdf * 100)}です。` : '')
  }

  // fold
  const req = features.potOddsRequiredEq
  const equity = features.heroComboEquity
  if (equity < (req ?? 0)) {
    return `必要勝率${pctVal((req ?? 0) * 100)}に対し実際のエクイティは${pctVal(equity * 100)}しかなく、ブロッカーも十分でないためフォールドが最善です。`
  }
  return `実際のエクイティ${pctVal(equity * 100)}はポットオッズ上の必要勝率${pctVal((req ?? 0) * 100)}を満たしていますが、単純なポットオッズだけでは判断できません。相手の継続レンジの強さや今後のストリートでの不利を総合すると、フォールドが優れています。`
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

function buildSameClassLine(features: SpotFeatures): string {
  if (features.sameClass.actionMix.length === 0 || features.sameClass.comboCount === 0) {
    return `同じ「${features.sameClass.classJa}」クラスの手のデータが不足しています。`
  }
  const top = features.sameClass.actionMix.reduce((a, b) => (b.freq > a.freq ? b : a))
  return `同じ「${features.sameClass.classJa}」クラスの手はGTOで平均${pctFrac(top.freq)}が${actionJa(top.label)}を選びます。`
}

export function buildExplanation(decision: ReviewDecision, features: SpotFeatures): Explanation {
  const headline = buildHeadline(decision)
  const paragraphs: string[] = [buildHandParagraph(features), buildReasonParagraph(decision, features)]
  const comparison = buildComparisonParagraph(decision, features)
  if (comparison) paragraphs.push(comparison)
  const mixedNote = buildMixedStrategyNote(decision)
  if (mixedNote) paragraphs.push(mixedNote)
  const sameClassLine = buildSameClassLine(features)

  return { headline, paragraphs, sameClassLine }
}

export type { HandStrength }
