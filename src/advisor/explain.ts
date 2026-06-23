import type { Position } from '../engine/types'
import type { PlayerType } from '../engine/types'

export type ExplainCode =
  | 'POT_ODDS_CALL'
  | 'POT_ODDS_FOLD'
  | 'VALUE_BET'
  | 'CBET'
  | 'CHECK_BEHIND'
  | 'RANGE_FOLD_PRE'
  | 'RANGE_FOLD_VS_RAISE'
  | 'RANGE_OPEN_PRE'
  | 'RANGE_3BET_PRE'
  | 'BB_DEFEND_CALL'
  | 'BB_CHECK_OPTION'
  | 'BB_ISO_RAISE'
  | 'EXPLOIT_ADJUST'
  | 'SEMI_BLUFF_RAISE'
  | 'BLUFF_FOLD'
  | 'BLUFF_BET'
  | 'TURN_INTO_BLUFF'
  | 'GIVE_UP_CHECK'
  | 'NO_SDV_FOLD'

export interface ExplainContext {
  equity?: number          // 実戦での読み（推奨の根拠）
  approxEquity?: number     // 同上（あなたの読み）
  exactEquity?: number      // 厳密エクイティ（答え合わせ用）
  requiredEquity?: number
  handClass?: string
  position?: Position
  hand?: string
  betSize?: string
  opponentType?: PlayerType
  adjustment?: string
  potOddsRatio?: string
}

export interface Explanation {
  code: ExplainCode
  text: string
  numbers: {
    equity?: string
    approxEquity?: string
    requiredEquity?: string
    potOddsRatio?: string
  }
}

function pct(v: number | undefined): string {
  if (v === undefined) return '?%'
  return `${Math.round(v * 100)}%`
}

export function buildExplanation(code: ExplainCode, ctx: ExplainContext): Explanation {
  const numbers = {
    equity: ctx.equity !== undefined ? pct(ctx.equity) : undefined,
    approxEquity: ctx.approxEquity !== undefined ? pct(ctx.approxEquity) : undefined,
    requiredEquity: ctx.requiredEquity !== undefined ? pct(ctx.requiredEquity) : undefined,
    potOddsRatio: ctx.potOddsRatio,
  }

  const texts: Record<ExplainCode, string> = {
    POT_ODDS_CALL: `あなたの読み ${pct(ctx.approxEquity)} が必要勝率 ${pct(ctx.requiredEquity)} を上回るのでコールが+EV。(答え: 実際の勝率は ${pct(ctx.exactEquity)})`,
    POT_ODDS_FOLD: `あなたの読み ${pct(ctx.approxEquity)} が必要勝率 ${pct(ctx.requiredEquity)} に届かないためフォールド。(答え: 実際の勝率は ${pct(ctx.exactEquity)})`,
    VALUE_BET: `${ctx.handClass ?? '強い手'} は十分強く、ショーダウンでも勝てる見込みが高い。劣る手からコールを引き出すバリューベット${ctx.betSize ? ` (${ctx.betSize})` : ''}。`,
    CBET: `プリフロップの主導権を継続。このボードは相手レンジに当たりにくく、ベットで降ろせる頻度が高い。`,
    CHECK_BEHIND: `ポットコントロール。弱い手でベットしても得られる価値が少なく、チェックで安全に次のカードを見る。`,
    RANGE_FOLD_PRE: `${ctx.position ?? ''} からの ${ctx.hand ?? 'この手'} はオープンレンジ外。長期的に損失になる手のためフォールド。`,
    RANGE_FOLD_VS_RAISE: `相手のレイズに直面。${ctx.hand ?? 'この手'} は3ベットするには弱く、コールで続ける価値もないためフォールド。(オープンレンジ内の手でも、レイズされた後は基準が厳しくなります)`,
    RANGE_OPEN_PRE: `${ctx.position ?? ''} からの ${ctx.hand ?? 'この手'} はオープンレンジ内。BB の3倍 (₱150) を目安にレイズでオープン。`,
    RANGE_3BET_PRE: `${ctx.hand ?? 'この手'} は3ベットレンジ内の強い手。相手のレイズ額の約3倍に再レイズしてポットを大きくする。`,
    BB_DEFEND_CALL: `BB はすでに ₱50 払っているため割引価格でコールできる。${ctx.hand ?? 'この手'} はBBディフェンスレンジ内。コールで様子を見る。`,
    BB_CHECK_OPTION: `誰もレイズしていないので、すでに払った BB(₱50) で無料でフロップが見られます。${ctx.hand ?? 'この手'} は弱めですが、フォールドは損(チェックは無料)。チェックして次のカードを見るのが最善です。`,
    BB_ISO_RAISE: `リンパー(コールだけで入った相手)は弱い手が多い。${ctx.hand ?? 'この手'} は十分強いので、レイズして孤立させ主導権を取る(アイソレート)。`,
    EXPLOIT_ADJUST: `相手は ${ctx.opponentType ?? ''}型。${ctx.adjustment ?? ''}`,
    SEMI_BLUFF_RAISE: `ドロー中だがエクイティ ${pct(ctx.equity)} があり、レイズでフォールドエクイティも加わる。セミブラフレイズが+EV。`,
    BLUFF_FOLD: `エクイティ不足でブラフを打っても長期的に損失。フォールドが最善。`,
    BLUFF_BET: `ショーダウンではほぼ勝てない(ショーダウンバリューなし)。チェックで回しても勝ち目が薄いので、相手の中途半端なハンドを降ろすためのブラフベット(バリューではない)。`,
    TURN_INTO_BLUFF: `一見ペア(役)があるように見えますが、ボードがペアになっており実質的に最弱クラス＝ショーダウンバリューなし。ここでのベットはバリューではなく、相手のより強いミドルペア(77や9など)を降ろすための「ブラフへの転化」です。`,
    GIVE_UP_CHECK: `ショーダウンバリューがなく、相手も降りにくい。無理にベットせずチェックして諦める(損失を最小化)。`,
    NO_SDV_FOLD: `ペアはあるものの、ボードのペアに支配されショーダウンバリューがほぼ無い。コールしても勝てないためフォールド。`,
  }

  return { code, text: texts[code], numbers }
}

export interface SizeVerdict {
  text: string
  tone: 'good' | 'bad' | 'neutral'
}

/** ユーザーが実際に投じたベット/レイズ額の妥当性を判定する */
export function betSizeVerdict(args: {
  type: string
  amount: number
  pot: number
  betLevel: number   // 決定時の currentBet (レイズ前の賭け額)
  recFraction?: number
}): SizeVerdict | null {
  const { type, amount, pot, betLevel, recFraction } = args

  if (type === 'bet') {
    if (pot <= 0 || amount <= 0) return null
    const frac = amount / pot
    const fp = Math.round(frac * 100)
    if (recFraction == null) return { text: `ポットの約${fp}%のベット`, tone: 'neutral' }
    const rp = Math.round(recFraction * 100)
    const ratio = frac / recFraction
    if (ratio < 0.7) return { text: `ポットの${fp}% (推奨 ${rp}%) → 小さすぎ。バリューを取りこぼし、相手に安く引かせてしまう`, tone: 'bad' }
    if (ratio > 1.5) return { text: `ポットの${fp}% (推奨 ${rp}%) → 大きすぎ。必要以上のリスクで、勝てる相手まで降ろしてしまう`, tone: 'bad' }
    return { text: `ポットの${fp}% (推奨 ${rp}%) → 適切なサイズ`, tone: 'good' }
  }

  if (type === 'raise' && betLevel > 0) {
    const mult = amount / betLevel
    const m = mult.toFixed(1)
    if (mult < 2.2) return { text: `相手のベットの${m}倍のレイズ → 小さめ。3倍前後が目安(安いコールを許しがち)`, tone: 'bad' }
    if (mult > 4.5) return { text: `相手のベットの${m}倍のレイズ → 大きすぎ。3倍前後が目安`, tone: 'bad' }
    return { text: `相手のベットの${m}倍のレイズ → 適切(3倍前後)`, tone: 'good' }
  }

  return null
}

/** ベット/レイズサイズの根拠説明 (学習用) */
export const SIZE_RATIONALE: Partial<Record<ExplainCode, string>> = {
  VALUE_BET: '強い手は大きめ (ポットの2/3〜3/4) でベット。劣る手からのコールを最大化するため。小さすぎると取れる価値が減り、大きすぎると降りられてしまう。',
  CBET: '相手に当たりにくい乾いたボードでは小さめ (ポットの1/3) で十分。少ないリスクで降ろせる。',
  SEMI_BLUFF_RAISE: 'セミブラフはポットの1/2〜2/3。相手を降ろせれば即勝ち、コールされてもドローが引ければ大きく勝てる、両取りのサイズ。',
  BLUFF_BET: 'ブラフは相手を降ろせる十分なサイズ (ポットの1/2〜2/3) で。小さすぎると安く見られてコールされ、降ろす目的が果たせない。',
  TURN_INTO_BLUFF: 'ブラフへの転化は、相手のミドルペアを降ろせるサイズ (ポットの1/2〜2/3) で打つ。中途半端に小さいと「降ろす」目的が達成できない。',
  RANGE_OPEN_PRE: 'プリフロップのオープンはBBの3倍 (₱150) が基準。リンパー(コールだけの人)が1人いるごとに+1BB足す。',
  RANGE_3BET_PRE: '3ベットは相手のレイズ額の約3倍。小さすぎると安いコールを許し、せっかくの強い手の価値が活きない。',
  BB_ISO_RAISE: 'アイソレートはリンパーの数に応じて大きめに。BB×4 + リンパー1人ごとに+1BB が目安。',
}
