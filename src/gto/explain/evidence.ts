// P13 Phase D-1: 解説文(templates.ts)が使う「証拠選択層」。旧buildReasonParagraphは
// actionCategory×handClassの巨大if/elseで、各分岐が固定の事実セットを無条件に並べていた
// (該当しない理由を書く/結論と無関係な証拠を混ぜる、というユーザー報告バグの根本原因)。
// ここでは「その手・その局面で事実として成立する場合のみ」証拠を選び、成立しない証拠は
// 出さない。polarity==='opposes'の証拠は落とさず、templates.ts側で「ただし〜」と
// 明示的に打ち消す形で提示する(結論との矛盾を放置しない)。

import type { ReviewDecision } from '../trainer/reviewBuilder'
import type { SpotFeatures } from './features'
import { classifyBetKind } from './betKind'

export type EvidencePolarity = 'supports' | 'opposes' | 'neutral'

export type EvidenceId = 'betKind' | 'checkPotControlStrong' | 'checkDraw' | 'checkPotControlMiddle' | 'mdfVsPercentile' | 'potOdds' | 'blockerNet' | 'streetStructure' | 'raiseRejection'

export interface Evidence {
  id: EvidenceId
  /** 結論(bestLabel)を支持/反対/中立。 */
  polarity: EvidencePolarity
  /** 表示優先度(高いほど先)。 */
  priority: number
  textJa: string
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

function actionCategoryOf(label: string): ActionCategory {
  if (label === 'check') return 'check'
  if (label === 'call') return 'call'
  if (label === 'fold') return 'fold'
  return 'bet'
}

/** 現時点で相手レンジの25%以上に勝っていれば、薄くてもSDVありとみなす。 */
function hasShowdownValue(features: SpotFeatures): boolean {
  return features.sdvLevel !== 'none'
}

function pushCheckEvidence(list: Evidence[], features: SpotFeatures): void {
  if (features.handClass === 'MONSTER' || features.handClass === 'STRONG_MADE') {
    list.push({
      id: 'checkPotControlStrong',
      polarity: 'supports',
      priority: 100,
      textJa: '強い手ですが、ここでベットしても相手のコール/継続レンジから十分な価値を引き出しにくいため、チェックで相手のベットを誘い、チェックレイズにつなげる方が得です。',
    })
    return
  }
  // P13 Phase D-1(問題1の根絶): 旧実装はdraws を見ずに一律「次のストリートでエクイティを
  // 活かす」と書いていた(ドロー皆無の手にも当てはまらない理由が付く不具合)。draws に
  // 該当があるときだけドロー前提の理由を出す。
  const hasDraw = features.draws.hasFlushDraw || features.draws.hasOESD || features.draws.hasGutshot
  if (hasDraw) {
    list.push({
      id: 'checkDraw',
      polarity: 'supports',
      priority: 100,
      textJa: '完成すれば強くなるドローを持っており、無理に攻めずチェックでポットを小さく保ち、次のストリートでの改善を待つ方針です。',
    })
    return
  }
  list.push({
    id: 'checkPotControlMiddle',
    polarity: 'supports',
    priority: 100,
    textJa: 'ドローが無く、ベットして良い手にレイズされるリスクを避けつつエクイティを守るチェックが優位です(ポットコントロール)。',
  })
}

/** MDF(最低ディフェンス頻度)と、自分のレンジ内順位を突き合わせる(call/fold共通)。 */
function pushMdfEvidence(list: Evidence[], features: SpotFeatures, bestLabel: string): void {
  if (features.mdf === null || Number.isNaN(features.eqPercentileInRange)) return
  const percentileTop = Math.round(100 - features.eqPercentileInRange)
  const mdfPct = features.mdf * 100
  const withinMdf = percentileTop <= mdfPct
  const polarity: EvidencePolarity = bestLabel === 'fold' ? (withinMdf ? 'opposes' : 'supports') : withinMdf ? 'supports' : 'opposes'
  list.push({
    id: 'mdfVsPercentile',
    polarity,
    priority: 90,
    textJa:
      `このサイズへの最低ディフェンス頻度(MDF)は${mdfPct.toFixed(0)}%。この手はレンジ内で上位${percentileTop}%` +
      (withinMdf ? `にあり、続行させるべき範囲に入っています。` : `で、続行させるべき範囲の外側です。`),
  })
}

/**
 * ポットオッズの適用可否を、D-0-aのcurrentShowdown(改善なしの勝率)で判定する。
 * 現行の「単純なポットオッズ上も+EV」という無条件表現は、改善分と現時点の勝率が
 * 混ざっているために誤りうる(ユーザー報告のQ♦J♣ケース)ため、ここで区別する。
 */
function pushPotOddsEvidence(list: Evidence[], features: SpotFeatures, bestLabel: string): void {
  if (features.potOddsRequiredEq === null) return
  const req = features.potOddsRequiredEq
  const current = features.currentShowdown.heroEquity
  const final = features.heroComboEquity
  if (Number.isNaN(current) || Number.isNaN(final)) return

  if (current >= req) {
    list.push({
      id: 'potOdds',
      polarity: bestLabel === 'fold' ? 'opposes' : 'supports',
      priority: 95,
      textJa: `改善しなくても現時点の勝率が${(current * 100).toFixed(0)}%あり、必要勝率${(req * 100).toFixed(0)}%を単独で上回るため、ポットオッズをそのまま適用できます。`,
    })
    return
  }
  if (final >= req) {
    // 改善前提の分をどう評価するかはレンジ全体の防御(MDF)等、他の証拠が判断する領域のため、
    // このブランチ自体はcall/foldどちらの結論も後押し/否定しない「注意喚起」として中立で出す。
    list.push({
      id: 'potOdds',
      polarity: 'neutral',
      priority: 95,
      textJa: `最終的なエクイティは${(final * 100).toFixed(0)}%で必要勝率${(req * 100).toFixed(0)}%を満たしますが、今のままの勝率は${(current * 100).toFixed(0)}%しかなく、大半は今後の改善が前提です。改善できなければ降りるコストを踏まえると、ポットオッズをそのまま当てはめられません。`,
    })
    return
  }
  list.push({
    id: 'potOdds',
    polarity: bestLabel === 'fold' ? 'supports' : 'opposes',
    priority: 95,
    textJa: `最終的なエクイティ${(final * 100).toFixed(0)}%でも必要勝率${(req * 100).toFixed(0)}%に届きません。`,
  })
}

const BLOCKER_NET_THRESHOLD_PCT = 3

/**
 * D-0-bのバリュー側・ブラフ側を併記し、差し引きの符号で向きを言う。片側だけの提示は
 * 誤誘導になるため、常に両側を見た上で差が十分あるときだけ出す。ブラフキャッチ判断の
 * 文脈(call/fold)かつヒーローにSDVがある場合のみ選ぶ(問題2の根絶: fold文脈でしか
 * 意味を持たない値がbetの文脈に混入していた旧実装の反省)。
 */
function pushBlockerEvidence(list: Evidence[], features: SpotFeatures, bestLabel: string): void {
  if (!hasShowdownValue(features)) return
  const { valueCombosReducedPct: valuePct, bluffCombosReducedPct: bluffPct } = features.blockers
  const net = valuePct - bluffPct // 正: バリューを多く減らす(コール寄り)
  if (Math.abs(net) < BLOCKER_NET_THRESHOLD_PCT) return
  const supportsCall = net > 0
  const polarity: EvidencePolarity = bestLabel === 'call' ? (supportsCall ? 'supports' : 'opposes') : supportsCall ? 'opposes' : 'supports'
  const directionJa = supportsCall ? 'バリューを多く減らしており、相手の残りレンジはブラフ寄りに偏ります' : 'ブラフ/弱いハンドを多く減らしており、相手の残りレンジはバリュー寄りに偏ります'
  list.push({
    id: 'blockerNet',
    polarity,
    priority: 60,
    textJa: `あなたの手は相手のバリューハンドを${valuePct.toFixed(0)}%、ブラフ/弱いハンドを${bluffPct.toFixed(0)}%ブロックしています。差し引きで${directionJa}。`,
  })
}

const NUTS_ADVANTAGE_CONTRADICTION_TOLERANCE_PCT = 3

/**
 * 直前ストリートの構造(D-0-c)。flopCheckedThrough&&bettorIsIpの向きは
 * features.nutsAdvantageの実測値と矛盾しないことを確認してから出す(実測で相手の
 * ナッツ比率がヒーローを明確に上回っているのに「相手のレンジ上限が抑えられている」
 * とは書かない)。
 */
function pushStreetStructureEvidence(list: Evidence[], features: SpotFeatures): void {
  const { flopCheckedThrough, bettorIsIp } = features.streetStructure
  if (flopCheckedThrough !== true || bettorIsIp === null) return

  if (bettorIsIp) {
    if (features.nutsAdvantage.villainTopPct > features.nutsAdvantage.heroTopPct + NUTS_ADVANTAGE_CONTRADICTION_TOLERANCE_PCT) return
    list.push({
      id: 'streetStructure',
      polarity: 'neutral',
      priority: 40,
      textJa: '前のストリートは両者チェックで回っており、相手はIPとしてベットしているため、そのレンジの上限は抑えられています。',
    })
    return
  }
  list.push({
    id: 'streetStructure',
    polarity: 'neutral',
    priority: 40,
    textJa: '前のストリートは両者チェックで回っていますが、相手はOOPとしてベットしておりチェックレイズ狙いで強い手もチェックする戦略のため、レンジの上限は完全には下がっていません。',
  })
}

/**
 * レイズを却下する理由は手の性質で述べる(「ナッツ劣位だから」ではなく「勝っている弱い手
 * だけを降ろし、負けている強い手には降りてもらえないため」)。レイズ応答後の継続レンジに
 * 対するヒーローのエクイティ(features.responses)が算出できた場合のみこの主張をし、
 * できなければEV差の提示に留める。ナッツ劣位は補足として残すが主論拠にしない。
 */
function pushRaiseRejectionEvidence(list: Evidence[], decision: ReviewDecision, features: SpotFeatures): void {
  const raiseLabel = decision.decodedNode.actionLabels.find((l) => actionCategoryOf(l) === 'bet')
  if (!raiseLabel) return
  const raiseAction = decision.grading.actionBreakdown.find((a) => a.label === raiseLabel)
  const bestAction = decision.grading.actionBreakdown.find((a) => a.label === decision.grading.bestLabel)
  if (!raiseAction || !bestAction) return
  const evDiff = bestAction.evBb - raiseAction.evBb
  if (evDiff <= 0) return // レイズの方がEVが高いなら却下理由は出さない(結論と矛盾するため)

  const nutsNote = features.nutsAdvantage.verdictJa === 'ナッツ劣位' ? `(参考: ナッツ級の比率でも${features.nutsAdvantage.verdictJa}です)` : ''

  const raiseResponse = features.responses.find((r) => r.forLabel === raiseLabel)
  if (raiseResponse && !raiseResponse.terminal && raiseResponse.heroEquityVsContinueRange !== null) {
    list.push({
      id: 'raiseRejection',
      polarity: 'opposes',
      priority: 30,
      textJa: `${actionJa(raiseLabel)}は相手の継続レンジに対するエクイティが${(raiseResponse.heroEquityVsContinueRange * 100).toFixed(0)}%にとどまり(EV${raiseAction.evBb.toFixed(2)}bb、コール比-${evDiff.toFixed(2)}bb)、勝っている弱い手だけを降ろして負けている強い手には降りてもらえないため、コールに留めるのが最善です。${nutsNote}`,
    })
    return
  }
  list.push({
    id: 'raiseRejection',
    polarity: 'opposes',
    priority: 30,
    textJa: `${actionJa(raiseLabel)}はEV${raiseAction.evBb.toFixed(2)}bbでコールより${evDiff.toFixed(2)}bb劣ります。${nutsNote}`,
  })
}

export function selectEvidence(decision: ReviewDecision, features: SpotFeatures): Evidence[] {
  const bestLabel = decision.grading.bestLabel
  const category = actionCategoryOf(bestLabel)
  const evidences: Evidence[] = []

  if (category === 'bet') {
    const betKind = classifyBetKind(bestLabel, features)
    if (betKind) evidences.push({ id: 'betKind', polarity: 'supports', priority: 100, textJa: betKind.reasonJa })
  } else if (category === 'check') {
    pushCheckEvidence(evidences, features)
  } else {
    pushMdfEvidence(evidences, features, bestLabel)
    pushPotOddsEvidence(evidences, features, bestLabel)
    pushBlockerEvidence(evidences, features, bestLabel)
    pushStreetStructureEvidence(evidences, features)
    if (category === 'call') pushRaiseRejectionEvidence(evidences, decision, features)
  }

  return evidences.sort((a, b) => b.priority - a.priority)
}
