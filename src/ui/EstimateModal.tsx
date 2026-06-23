import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore, ESTIMATE_BANDS } from '../store/state'
import { TargetIcon, CheckIcon, CrossIcon, ApproxIcon } from './icons'

export function EstimateModal() {
  const { estimatePending, lastEstimate, submitEstimate, confirmEstimate } = useAppStore()

  const open = estimatePending || lastEstimate !== null

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
          }}
        >
          <motion.div
            initial={{ scale: 0.9, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            style={{
              background: 'var(--panel-bg)', borderRadius: 14, padding: 28,
              border: '1px solid var(--panel-border)',
              width: 'min(440px, calc(100vw - 24px))',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            {lastEstimate === null ? (
              /* ===== 出題フェーズ ===== */
              <>
                <h3 style={{ color: 'var(--gold)', marginBottom: 14, fontSize: 17, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <TargetIcon size={18} /> 勝率を見積もってください
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: 13.5, marginBottom: 18, lineHeight: 1.7 }}>
                  いまのあなたの勝率(エクイティ)はどのくらいだと思いますか?<br />
                  アウツを数えて 4-2ルール(フロップ×4 / ターン×2)で暗算してみましょう。
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {ESTIMATE_BANDS.map((band, i) => (
                    <motion.button
                      key={band.label}
                      initial={{ opacity: 0, x: -14 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.06 * i }}
                      whileHover={{ scale: 1.02, x: 4 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => submitEstimate(band.label)}
                      style={{
                        background: 'var(--green-dark)', color: 'var(--text)',
                        padding: '11px 18px', fontSize: 15, borderRadius: 8,
                        border: '1px solid var(--green-mid)',
                        textAlign: 'left', fontWeight: 600,
                      }}
                    >
                      {band.label}
                    </motion.button>
                  ))}
                </div>
              </>
            ) : (
              /* ===== 結果フェーズ ===== */
              <>
                <h3 style={{
                  color: lastEstimate.correct ? 'var(--green-light)' : lastEstimate.adjacent ? 'var(--gold)' : 'var(--red)',
                  marginBottom: 14, fontSize: 19, display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  {lastEstimate.correct ? <CheckIcon size={20} /> : lastEstimate.adjacent ? <ApproxIcon size={20} /> : <CrossIcon size={20} />}
                  {lastEstimate.correct ? '正解!' : lastEstimate.adjacent ? '惜しい!' : '不正解'}
                </h3>
                <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                  <table style={{ width: '100%', fontSize: 14.5, borderCollapse: 'collapse' }}>
                    <tbody>
                      <tr>
                        <td style={{ padding: '5px 0', color: 'var(--text-muted)' }}>あなたの見積もり</td>
                        <td style={{ textAlign: 'right', color: 'var(--text)', fontWeight: 700 }}>{lastEstimate.band}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '5px 0', color: 'var(--text-muted)' }}>真の勝率 (厳密計算)</td>
                        <td style={{ textAlign: 'right', color: 'var(--gold-light)', fontWeight: 700, fontSize: 17 }}>
                          {Math.round(lastEstimate.trueEquity * 100)}%
                        </td>
                      </tr>
                      {lastEstimate.approxEquity != null && (
                        <tr>
                          <td style={{ padding: '5px 0', color: 'var(--text-muted)' }}>推奨の根拠(あなたの読み)</td>
                          <td style={{ textAlign: 'right', color: 'var(--text)', fontWeight: 700 }}>
                            {Math.round(lastEstimate.approxEquity * 100)}%
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.7 }}>
                  {lastEstimate.correct
                    ? 'この感覚を維持しましょう。見積もり精度は統計タブで確認できます。'
                    : 'アウツの数え方を確認しましょう。判定パネルの「人力概算」をクリックすると内訳が見られます。'}
                </p>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={confirmEstimate}
                  style={{
                    width: '100%',
                    background: 'linear-gradient(180deg, var(--gold-light), var(--gold))',
                    color: '#1a2a1a', padding: '11px 18px', fontSize: 15,
                    borderRadius: 8, fontWeight: 700,
                  }}
                >
                  アクションを実行 →
                </motion.button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
