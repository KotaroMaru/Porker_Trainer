// P5 Step B7: アクションラベル→表示色の対応(ポーカー標準配色: ベット/レイズ=赤系濃淡、
// チェック/コール=緑、フォールド=青)。StrategyMixBar/RangeHeatGridで共有する。
// 既存CSS変数(index.css)に青系は無いためfold用のみローカル定数を使う。

export const ACTION_COLORS: Record<string, string> = {
  check: 'var(--green-light)',
  call: 'var(--green-felt)',
  fold: '#3a6ea8',
  bet33: '#d95555',
  bet75: '#c23030',
  raise55: '#a82020',
  allin: '#7a1515',
}

export function actionColor(label: string): string {
  return ACTION_COLORS[label] ?? 'var(--text-dim)'
}
