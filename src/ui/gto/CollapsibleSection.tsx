// P5 Step B8: 折りたたみセクション(HistoryView.tsxのDecisionRowの▼/▲
// ローカルuseStateパターンをgto/配下で共通化した新規コンポーネント。既存
// HistoryView自体は変更しない)。

import { useState, type ReactNode } from 'react'

interface Props {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}

export function CollapsibleSection({ title, children, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div style={{ border: '1px solid var(--panel-border)', borderRadius: 8, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '10px 12px',
          background: 'var(--panel-bg-light)',
          border: 'none',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 13.5,
          fontWeight: 600,
          color: 'var(--text)',
          cursor: 'pointer',
        }}
      >
        <span>{title}</span>
        <span style={{ color: 'var(--text-dim)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: 12 }}>{children}</div>}
    </div>
  )
}
