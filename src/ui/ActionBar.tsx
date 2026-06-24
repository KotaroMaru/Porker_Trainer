import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../store/state'
import { getLegalActions } from '../engine/game'
import { useIsMobile } from '../hooks/useIsMobile'
import type { ActionType } from '../engine/types'

const STEP = 50      // BB unit stepper increment
const ROUND = 25     // chip rounding unit

function roundTo(v: number, unit: number): number {
  return Math.round(v / unit) * unit
}

export function ActionBar() {
  const { game, submitAction } = useAppStore()
  const isMobile = useIsMobile()
  const [betSize, setBetSize] = useState(100)

  useEffect(() => {
    if (!game) return
    const pot = game.pots.reduce((s, p) => s + p.amount, 0)
    const user = game.players.find(p => p.isUser)
    const legal = getLegalActions(game)
    const betAction = legal.find(a => a.type === 'bet' || a.type === 'raise')
    const minBet = betAction?.minAmount ?? 100
    const half = roundTo(pot / 2, ROUND)
    setBetSize(Math.max(minBet, Math.min(half, user?.stack ?? 100)))
  }, [game?.street, game?.actionIndex])

  if (!game) return null
  const user = game.players.find(p => p.isUser)
  if (!user || user.folded) return null

  const legal = getLegalActions(game)
  const legalTypes = new Set(legal.map(a => a.type))
  const potTotal = game.pots.reduce((s, p) => s + p.amount, 0)
  const callAction = legal.find(a => a.type === 'call')
  const betAction = legal.find(a => a.type === 'bet' || a.type === 'raise')

  const minBet = betAction?.minAmount ?? 0
  const maxBet = betAction?.maxAmount ?? user.stack

  const clamp = (v: number) => Math.max(minBet, Math.min(v, maxBet))

  const presets = [
    { label: '1/3', value: roundTo(potTotal / 3, ROUND) },
    { label: '1/2', value: roundTo(potTotal / 2, ROUND) },
    { label: '2/3', value: roundTo(potTotal * 2 / 3, ROUND) },
    { label: 'ポット', value: roundTo(potTotal, ROUND) },
    { label: '全部', value: maxBet },
  ].filter(p => p.value >= minBet)

  function act(type: ActionType, amount = 0) {
    if (!game || !user) return
    submitAction({ type, amount, playerId: user.id })
  }

  const outerPad = isMobile ? 10 : 14
  const sizingPad = isMobile ? 8 : 10
  const outerGap = isMobile ? 7 : 10
  const amountFontSize = isMobile ? 18 : 21

  return (
    <div style={{ padding: outerPad, display: 'flex', flexDirection: 'column', gap: outerGap }}>
      {/* Main action buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        {legalTypes.has('fold') && (
          <ActionBtn label="フォールド" color="var(--red-dark)" onClick={() => act('fold')} />
        )}
        {legalTypes.has('check') && (
          <ActionBtn label="チェック" color="var(--green-mid)" onClick={() => act('check')} />
        )}
        {callAction && (
          <ActionBtn label={`コール ₱${callAction.minAmount}`} color="var(--green-light)" onClick={() => act('call', callAction.minAmount)} />
        )}
      </div>

      {/* Bet/raise sizing */}
      {betAction && (
        <div style={{
          background: 'rgba(0,0,0,0.25)', borderRadius: 10, padding: sizingPad,
          display: 'flex', flexDirection: 'column', gap: isMobile ? 6 : 8,
          border: '1px solid var(--panel-border)',
        }}>
          {/* Presets */}
          <div style={{ display: 'flex', gap: 5 }}>
            {presets.map(p => {
              const val = clamp(p.value)
              const selected = betSize === val
              return (
                <button
                  key={p.label}
                  onClick={() => setBetSize(val)}
                  style={{
                    flex: 1,
                    background: selected ? 'var(--gold)' : 'var(--panel-bg)',
                    color: selected ? '#1a2a1a' : 'var(--text-muted)',
                    border: `1px solid ${selected ? 'var(--gold)' : 'var(--panel-border)'}`,
                    padding: isMobile ? '5px 2px' : '6px 4px',
                    fontSize: isMobile ? 12 : 12.5,
                    borderRadius: 6,
                    fontWeight: selected ? 700 : 500,
                  }}
                >
                  {p.label}
                </button>
              )
            })}
          </div>

          {/* Stepper + amount + confirm */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <StepBtn label={`−${STEP}`} onClick={() => setBetSize(v => clamp(roundTo(v - STEP, ROUND)))} disabled={betSize <= minBet} />
            <div style={{
              flex: 1, textAlign: 'center',
              background: 'rgba(0,0,0,0.35)', borderRadius: 8,
              padding: isMobile ? '5px 4px' : '7px 4px',
            }}>
              <div style={{ fontSize: amountFontSize, fontWeight: 700, color: 'var(--gold-light)', lineHeight: 1.1 }}>
                ₱{betSize}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>
                最小₱{minBet} / 最大₱{maxBet}
              </div>
            </div>
            <StepBtn label={`+${STEP}`} onClick={() => setBetSize(v => clamp(roundTo(v + STEP, ROUND)))} disabled={betSize >= maxBet} />
          </div>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => act(betAction.type, betSize)}
            disabled={betSize < minBet}
            style={{
              background: 'linear-gradient(180deg, var(--gold-light), var(--gold))',
              color: '#1a2a1a',
              padding: isMobile ? '9px 14px' : '11px 14px',
              fontSize: isMobile ? 15 : 16,
              borderRadius: 8,
              fontWeight: 700, boxShadow: 'var(--shadow-sm)',
              minHeight: 44,
            }}
          >
            {betAction.type === 'raise' ? `レイズ ₱${betSize}` : `ベット ₱${betSize}`}
          </motion.button>
        </div>
      )}

      {legalTypes.has('allin') && (
        <ActionBtn label={`オールイン ₱${user.stack}`} color="#7a3a00" onClick={() => act('allin', user.stack)} />
      )}
    </div>
  )
}

function ActionBtn({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      style={{
        background: color, color: 'var(--text)',
        padding: '11px 14px', fontSize: 15, borderRadius: 8,
        fontWeight: 700, flex: 1, boxShadow: 'var(--shadow-sm)',
        minHeight: 44,
      }}
    >
      {label}
    </motion.button>
  )
}

function StepBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: 'var(--panel-bg-light)', color: 'var(--gold-light)',
        border: '1px solid var(--panel-border)',
        width: 58, padding: '12px 0', fontSize: 14, fontWeight: 700, borderRadius: 8,
        minHeight: 44,
      }}
    >
      {label}
    </button>
  )
}
