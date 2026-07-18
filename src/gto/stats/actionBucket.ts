// P11 Phase D-1: NF5「GTOズレ測定」用のアクション分類。
// grading.tsのGradeResult.actionBreakdown(ActionBreakdownEntry[])が持つラベル
// (src/ui/gto/labels.ts ACTION_LABEL_JA・src/ui/gto/actionColors.ts ACTION_COLORSで
// 確認した既知ラベル: check, fold, call, bet33, bet75, raise55, allin)を、
// 降り(fold)/受け(passive=check・call)/攻め(aggressive=bet・raise・allin系)の
// 3カテゴリへ分類する。
//
// aggressiveはラベルのprefix(bet/raise/allin)で判定し、将来ベットサイズの
// バリエーションが増減しても(例: bet50, raise125)分類ロジックの変更を不要にする。
// ただし完全に未知の接頭辞(例: 新アクション種別の追加)は黙って誤分類せず、
// 明示的にthrowする(分類漏れを早期検出するため)。

export type ActionBucket = 'fold' | 'passive' | 'aggressive'

export function bucketOf(label: string): ActionBucket {
  if (label === 'fold') return 'fold'
  if (label === 'check' || label === 'call') return 'passive'
  if (label.startsWith('bet') || label.startsWith('raise') || label.startsWith('allin')) return 'aggressive'
  throw new Error(`bucketOf: unknown action label "${label}"`)
}
