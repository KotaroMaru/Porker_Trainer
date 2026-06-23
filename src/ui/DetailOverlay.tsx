import { motion, AnimatePresence } from 'framer-motion'
import type { ReactNode } from 'react'

interface Props {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  maxWidth?: number
}

/** 共通モーダルオーバーレイ。判定パネルのドリルダウンやチュートリアルで使用 */
export function DetailOverlay({ open, title, onClose, children, maxWidth = 560 }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'max(12px, env(safe-area-inset-top)) 12px 12px',
          }}
        >
          <motion.div
            initial={{ scale: 0.92, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, y: 8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--panel-bg)',
              border: '1px solid var(--panel-border)',
              borderRadius: 14,
              boxShadow: 'var(--shadow-lg)',
              width: `min(${maxWidth}px, calc(100vw - 24px))`,
              maxHeight: '85dvh',
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 20px',
              borderBottom: '1px solid var(--panel-border)',
              background: 'rgba(0,0,0,0.2)',
            }}>
              <h3 style={{ color: 'var(--gold)', fontSize: 16, fontWeight: 700 }}>{title}</h3>
              <button
                onClick={onClose}
                style={{
                  background: 'transparent', color: 'var(--text-muted)',
                  fontSize: 20, lineHeight: 1, padding: '2px 8px',
                }}
                aria-label="閉じる"
              >
                ×
              </button>
            </div>
            <div style={{ padding: 20, overflowY: 'auto', fontSize: 14, lineHeight: 1.8, color: 'var(--text)' }}>
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
