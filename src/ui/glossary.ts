import type { Position } from '../engine/types'

export interface PositionInfo {
  abbr: Position
  nameJa: string
  nameEn: string
  description: string
}

export const POSITION_INFO: Record<Position, PositionInfo> = {
  'UTG+1': {
    abbr: 'UTG+1',
    nameJa: 'アンダー・ザ・ガン+1',
    nameEn: 'Under The Gun +1',
    description: '7人卓でUTGの次の席。2番目に行動する不利なポジション。タイトなレンジで参加するのが基本。',
  },
  MP: {
    abbr: 'MP',
    nameJa: 'ミドルポジション',
    nameEn: 'Middle Position',
    description: '8人卓での中間ポジション。UTGより少し広いレンジで参加できるが、まだ後ろの人数が多い。',
  },
  UTG: {
    abbr: 'UTG',
    nameJa: 'アンダー・ザ・ガン',
    nameEn: 'Under The Gun',
    description: 'BBの左隣。プリフロップで最初に行動する最も不利な席。強い手だけで参加するのが基本。',
  },
  HJ: {
    abbr: 'HJ',
    nameJa: 'ハイジャック',
    nameEn: 'Hijack',
    description: 'COの右隣。やや不利な中間ポジション。UTGより少し広いレンジで参加できる。',
  },
  CO: {
    abbr: 'CO',
    nameJa: 'カットオフ',
    nameEn: 'Cutoff',
    description: 'ボタンの右隣。2番目に有利な席。広いレンジでオープンでき、スチールも狙える。',
  },
  BTN: {
    abbr: 'BTN',
    nameJa: 'ボタン(ディーラー)',
    nameEn: 'Button',
    description: 'ディーラー位置。フロップ以降つねに最後に行動できる最有利の席。最も広いレンジで参加できる。',
  },
  SB: {
    abbr: 'SB',
    nameJa: 'スモールブラインド',
    nameEn: 'Small Blind',
    description: '強制ベット₱25を払う席。フロップ以降は最初に行動する不利な席。',
  },
  BB: {
    abbr: 'BB',
    nameJa: 'ビッグブラインド',
    nameEn: 'Big Blind',
    description: '強制ベット₱50を払う席。プリフロップでは最後に行動でき、割引価格でコールできる。',
  },
}

export interface GlossaryEntry {
  term: string
  reading?: string
  description: string
}

export const GLOSSARY: GlossaryEntry[] = [
  { term: 'エクイティ', reading: 'Equity', description: 'いま全員の手をオープンして最後までめくったとき、自分が勝つ確率。「勝率」とほぼ同じ意味。' },
  { term: 'アウツ', reading: 'Outs', description: '自分の手を勝ち手に変えてくれる残りのカードの枚数。例: フラッシュドローなら同スートの残り9枚。' },
  { term: 'ポットオッズ', reading: 'Pot Odds', description: 'コールに必要な額とポット総額の比率。「必要勝率 = コール額 ÷ (ポット + コール額)」で、これ以上の勝率があればコールは得。' },
  { term: '4-2ルール', reading: 'Rule of 4 and 2', description: 'アウツから勝率を暗算する方法。フロップ(あと2枚)ならアウツ×4%、ターン(あと1枚)ならアウツ×2%。' },
  { term: '+EV / -EV', reading: 'Expected Value', description: '期待値がプラス(長期的に得する)かマイナス(損する)か。EVはExpected Value(期待値)の略。' },
  { term: 'オープン(レイズ)', description: 'まだ誰もレイズしていない状態で最初にレイズして参加すること。' },
  { term: '3ベット', reading: '3-bet', description: '相手のオープンレイズに対するさらなるレイズ(リレイズ)。強い手のサイン。' },
  { term: 'レンジ', reading: 'Range', description: 'ある状況でプレイヤーが持ちうる手の集合。「この人のレンジは強い」=強い手しか持っていないはず、という意味。' },
  { term: 'スーテッド / オフスート', reading: 'suited / offsuit', description: '2枚の手札が同じスート(マーク)ならスーテッド(例: A♥K♥ = AKs)、違うならオフスート(AKo)。スーテッドはフラッシュが狙える分やや強い。' },
  { term: 'Cベット', reading: 'Continuation Bet', description: 'プリフロップでレイズした人が、フロップでも続けてベットすること。主導権を活かすプレイ。' },
  { term: 'ブラフ', reading: 'Bluff', description: '弱い手で強い手のふりをしてベットし、相手を降ろすプレイ。' },
  { term: 'セミブラフ', reading: 'Semi-bluff', description: '今は弱いがドロー(伸びしろ)のある手でのベット。相手が降りても良し、コールされても引けば勝てる。' },
  { term: 'バリューベット', reading: 'Value Bet', description: '自分が勝っていると思うときに、より弱い手からコールを引き出すためのベット。' },
  { term: 'チェック', reading: 'Check', description: 'ベットせずに手番を次へ回すこと。誰もベットしていないときだけ可能。' },
  { term: 'オールイン', reading: 'All-in', description: '持っているチップを全部賭けること。' },
  { term: 'ドロー', reading: 'Draw', description: 'あと1枚で完成する未完成の手。フラッシュドロー(あと1枚で フラッシュ)、ストレートドローなど。' },
  { term: 'OESD', reading: 'Open-Ended Straight Draw', description: '両端どちらでもストレートが完成するドロー。例: 5678 → 4か9で完成(アウツ8枚)。' },
  { term: 'ガットショット', reading: 'Gutshot', description: '真ん中の1種類のカードだけでストレートが完成するドロー。例: 5689 → 7のみ(アウツ4枚)。' },
  { term: 'キッカー', reading: 'Kicker', description: '同じ役同士の勝負を決める2番目のカード。AK vs AQ で両方Aペアなら、KとQ(キッカー)で勝負が決まる。' },
  { term: 'ストリート', reading: 'Street', description: 'ゲームの進行段階。プリフロップ → フロップ(3枚) → ターン(4枚目) → リバー(5枚目)。' },
  { term: 'ショーダウン', reading: 'Showdown', description: 'リバーのベッティング終了後、残ったプレイヤーが手札を見せ合って勝敗を決めること。' },
  { term: 'VPIP', description: '自分から進んでポットにお金を入れた割合。高い=ルース(参加しすぎ)、低い=タイト。' },
  { term: 'PFR', reading: 'Preflop Raise', description: 'プリフロップでレイズした割合。VPIPとの差が大きい人はコール好き(パッシブ)。' },
]

// Action labels in Japanese
export const ACTION_LABELS: Record<string, string> = {
  fold: 'フォールド',
  check: 'チェック',
  call: 'コール',
  bet: 'ベット',
  raise: 'レイズ',
  allin: 'オールイン',
}

// 推奨アクション表記 (open/3bet を含む)
export const ACTION_JA: Record<string, string> = {
  ...ACTION_LABELS,
  open: 'レイズ (オープン)',
  '3bet': '3ベット',
}

// Hand category names in Japanese
export const CATEGORY_JA: Record<string, string> = {
  ROYAL_FLUSH: 'ロイヤルフラッシュ',
  STRAIGHT_FLUSH: 'ストレートフラッシュ',
  FOUR_OF_A_KIND: 'フォーカード',
  FULL_HOUSE: 'フルハウス',
  FLUSH: 'フラッシュ',
  STRAIGHT: 'ストレート',
  THREE_OF_A_KIND: 'スリーカード',
  TWO_PAIR: 'ツーペア',
  ONE_PAIR: 'ワンペア',
  HIGH_CARD: 'ハイカード',
}

// Street labels in Japanese
export const STREET_JA: Record<string, string> = {
  PREFLOP_BETTING: 'プリフロップ',
  FLOP: 'フロップ', FLOP_BETTING: 'フロップ',
  TURN: 'ターン', TURN_BETTING: 'ターン',
  RIVER: 'リバー', RIVER_BETTING: 'リバー',
  SHOWDOWN: 'ショーダウン', PAYOUT: 'ショーダウン',
}
