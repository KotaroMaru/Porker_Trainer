import type { Card } from '../../engine/types'
import { CardView } from '../CardView'

// P11 Phase A: PlayScreen.tsxのSingleSpotPlayScreen(単発モード)とFullHandPlayScreen
// (通しモード)がほぼ同一のフェルトテーブルを個別に描画していたため、純粋表示コンポーネント
// として共通化した(挙動・DOM構造・スタイル値は不変。既存PlayScreen.test.tsxがそのまま
// 通ることで担保)。NF1(カスタム解析UI刷新)では手札を1枚ずつ選択している途中の状態を
// 表示する必要があり、heroComboの各要素がnullを取り得る設計にしてある(現行の呼び出し元は
// 常に非null)。

interface VillainInfo {
  position: string
  /** 直近アクションのチップテキスト(例:「ベット 4.1bb」)。無ければチップを出さない。 */
  latestActionText?: string | null
}

interface Props {
  board: Card[]
  /** 手札。構築途中(NF1のカスタム解析で未選択のカードがある状態)を許容するためnullを含みうる。 */
  heroCombo: [Card | null, Card | null]
  heroPosition: string
  potBb: number
  /** 相手側の表示。省略時は相手行を描画しない(NF1では相手カードを裏向き表示する必要がない場合がある、
      その場合はvillain省略で呼び出す)。 */
  villain?: VillainInfo
  /** 自分側の直近アクションチップテキスト。 */
  heroLatestActionText?: string | null
}

// 元PlayScreen.tsxの`ActionChip`をそのまま移設(data-testid="action-chip"は既存テストが
// 依存しているため不変)。
export function ActionChip({ text }: { text: string }) {
  return (
    <span
      data-testid="action-chip"
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--gold-light)',
        background: 'rgba(0,0,0,0.35)',
        padding: '2px 8px',
        borderRadius: 10,
        marginLeft: 6,
      }}
    >
      {text}
    </span>
  )
}

// heroComboの未選択スロット用プレースホルダ。CardView size="sm"と同じ寸法(36x50、
// src/ui/CardView.tsxのsizes.sm)に揃え、破線枠で「未選択」であることを示す
// (CardViewのfaceDown表示=相手の裏向きカードと視覚的に混同しないよう、実線の緑フェルト
// 調ではなく破線の空枠にした)。
function EmptyCardSlot() {
  return (
    <div
      style={{
        width: 36,
        height: 50,
        borderRadius: Math.max(5, 36 * 0.1),
        border: '1px dashed var(--text-dim)',
        background: 'transparent',
      }}
    />
  )
}

export function PokerTableView({ board, heroCombo, heroPosition, potBb, villain, heroLatestActionText }: Props) {
  return (
    <div
      style={{
        background: 'var(--green-felt)',
        borderRadius: 12,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
      }}
    >
      {villain && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <CardView faceDown size="sm" />
          <CardView faceDown size="sm" />
          <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 6 }}>{villain.position}</span>
          {villain.latestActionText && <ActionChip text={villain.latestActionText} />}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <div style={{ color: 'var(--gold-light)', fontSize: 14 }}>ポット {potBb.toFixed(1)}bb</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {board.map((c, i) => (
            <div key={i} style={{ border: '2px solid var(--gold)', borderRadius: 6 }}>
              <CardView card={c} size="md" />
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 12, marginRight: 6 }}>{heroPosition}(あなた)</span>
        {heroCombo[0] ? <CardView card={heroCombo[0]} size="sm" /> : <EmptyCardSlot />}
        {heroCombo[1] ? <CardView card={heroCombo[1]} size="sm" /> : <EmptyCardSlot />}
        {heroLatestActionText && <ActionChip text={heroLatestActionText} />}
      </div>
    </div>
  )
}
