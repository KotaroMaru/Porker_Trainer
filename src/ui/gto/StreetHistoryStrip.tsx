import type { Card } from '../../engine/types'
import type { Scenario } from '../../gto/types'
import type { BotActionLogEntry } from '../../gto/trainer/gameFlow'
import type { Street, HistoryEntry } from '../../gto/trainer/reviewBuilder'
import { buildPreflopScript } from '../../gto/trainer/preflopScript'
import { actionLabelJa, rankLabel, suitSymbol, STREET_LABEL_JA } from './labels'

// P13 Phase A: PlayScreen.tsx(単発/通し両モード)にあったストリート別履歴ストリップを
// 共有部品へ抽出した(挙動不変)。DailyChallengeScreen.tsxにこのストリップが無く、
// プリフロップのアクションが表示されないというフィードバックへの対応(単発・通し両方に
// 元々欠けていた)。単発と通しはデータ形状・見た目が異なるため、1ファイル内に
// 2つの専用コンポーネントとして持つ(無理に共通propsへ押し込めない)。

const STRIP_CONTAINER_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: 0,
  border: '1px solid var(--panel-border)',
  borderRadius: 8,
  overflow: 'hidden',
  fontSize: 13,
}

interface SingleSpotHistoryStripProps {
  scenario: Scenario
  board: Card[]
  potBb: number
  userPosition: string
  botPosition: string
  botActionsBefore: readonly BotActionLogEntry[]
}

/** 単発モード用: プリフロップ列+フロップ列(現在の決断待ちをバッジで示す)。 */
export function SingleSpotHistoryStrip({ scenario, board, potBb, userPosition, botPosition, botActionsBefore }: SingleSpotHistoryStripProps) {
  const preflopLines = buildPreflopScript(scenario)
  return (
    <div style={STRIP_CONTAINER_STYLE}>
      <div style={{ flex: 1, padding: 8, borderRight: '1px solid var(--panel-border)' }}>
        <div style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 4 }}>プリフロップ</div>
        {preflopLines.map((line, i) => (
          <div key={i} style={{ color: 'var(--text)' }}>
            {line.position}: {line.action} {line.amountBb}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, padding: 8, background: 'var(--panel-bg-light)' }}>
        <div style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 4, display: 'flex', gap: 4, alignItems: 'center' }}>
          <span>フロップ</span>
          {board.map((c, i) => (
            <span key={i} style={{ color: c.suit === 'h' || c.suit === 'd' ? 'var(--card-red)' : 'var(--text)' }}>
              {rankLabel(c.rank)}
              {suitSymbol(c.suit)}
            </span>
          ))}
          <span>({potBb})</span>
        </div>
        {botActionsBefore.map((entry, i) => (
          <div key={i} style={{ color: 'var(--text)' }}>
            {botPosition}: {actionLabelJa(entry.label)}
          </div>
        ))}
        <div style={{ background: 'var(--gold)', color: '#000', display: 'inline-block', padding: '1px 6px', borderRadius: 4 }}>{userPosition}: ?</div>
      </div>
    </div>
  )
}

interface FullHandHistoryStripProps {
  history: readonly HistoryEntry[]
  currentStreet: Street
}

/** 通しモード用: preflop+到達済みの各ストリートを列として並べる。 */
export function FullHandHistoryStrip({ history, currentStreet }: FullHandHistoryStripProps) {
  const grouped = new Map<Street, HistoryEntry[]>()
  for (const entry of history) {
    if (!grouped.has(entry.street)) grouped.set(entry.street, [])
    grouped.get(entry.street)!.push(entry)
  }
  if (!grouped.has(currentStreet)) grouped.set(currentStreet, []) // 遷移直後、まだ誰も行動していない列も表示する

  return (
    <div style={{ ...STRIP_CONTAINER_STYLE, overflowX: 'auto' }}>
      {[...grouped.entries()].map(([street, lines]) => (
        <div
          key={street}
          style={{
            flex: '1 0 90px',
            padding: 8,
            borderRight: '1px solid var(--panel-border)',
            background: street === currentStreet ? 'var(--panel-bg-light)' : undefined,
          }}
        >
          <div style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 4 }}>{STREET_LABEL_JA[street]}</div>
          {lines.map((line, i) => (
            <div key={i} style={{ color: line.isUserDecision ? 'var(--gold-light)' : 'var(--text)' }}>
              {line.position}: {street === 'preflop' ? line.label : actionLabelJa(line.label)}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
