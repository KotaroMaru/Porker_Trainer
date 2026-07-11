// P6 Step B10: 保存済みブックマーク一覧画面。日付/シナリオ/ボード/verdictチップ/収支を
// 一覧表示し、「開く」でstore.openBookmark(id)へ委譲する(activeTabを'play'へ切り替えて
// 単発モードと共通のReviewScreenに合流させる、storeのopenBookmark参照)。

import { useState, useEffect } from 'react'
import { useGtoStore } from '../../gto/store'
import { listBookmarks, deleteBookmark, type BookmarkMeta } from '../../gto/bookmarks/storage'
import { VERDICT_COLOR } from './labels'
import type { GradeVerdict } from '../../gto/trainer/grading'

function verdictMark(verdict: GradeVerdict): string {
  return verdict === 'correct' ? '○' : verdict === 'marginal' ? '△' : '✕'
}

function formatDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function BookmarksScreen() {
  const { openBookmark } = useGtoStore()
  const [items, setItems] = useState<BookmarkMeta[]>([])

  useEffect(() => {
    setItems(listBookmarks())
  }, [])

  function handleDelete(id: string): void {
    deleteBookmark(id)
    setItems(listBookmarks())
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-dim)' }}>
        保存済みのハンドはまだありません。レビュー画面の「ハンドを保存」から保存できます。
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((m) => (
        <div
          key={m.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            border: '1px solid var(--panel-border)',
            borderRadius: 8,
            background: 'var(--panel-bg)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: '1 1 160px', fontSize: 12, color: 'var(--text-dim)' }}>{formatDate(m.createdAt)}</div>
          <div style={{ flex: '1 1 140px', fontSize: 13 }}>{m.scenarioLabel}</div>
          <div style={{ flex: '1 1 120px', fontSize: 13, color: 'var(--text-muted)' }}>{m.boardStr}</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {m.verdicts.map((v, i) => (
              <span key={i} style={{ color: VERDICT_COLOR[v], fontSize: 13 }}>
                {verdictMark(v)}
              </span>
            ))}
          </div>
          {m.netBb !== null && (
            <div style={{ fontSize: 13, fontWeight: 600, color: m.netBb >= 0 ? 'var(--green-light)' : 'var(--red)' }}>
              {m.netBb >= 0 ? '+' : ''}
              {m.netBb.toFixed(1)}bb
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            <button
              onClick={() => openBookmark(m.id)}
              style={{ padding: '5px 12px', fontSize: 12.5, borderRadius: 6, border: '1px solid var(--green-light)', background: 'var(--green-mid)', color: 'var(--gold-light)' }}
            >
              開く
            </button>
            <button
              onClick={() => handleDelete(m.id)}
              style={{ padding: '5px 12px', fontSize: 12.5, borderRadius: 6, border: '1px solid var(--panel-border)', background: 'var(--panel-bg-light)', color: 'var(--red)' }}
            >
              削除
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
