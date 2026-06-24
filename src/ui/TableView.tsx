import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../store/state'
import { useIsMobile } from '../hooks/useIsMobile'
import { CardView } from './CardView'
import { JudgePanel } from './JudgePanel'
import { ActionBar } from './ActionBar'
import { EstimateModal } from './EstimateModal'
import { POSITION_INFO, ACTION_LABELS, CATEGORY_JA, STREET_JA } from './glossary'
import { evaluate, handDefiningCards } from '../engine/evaluator'
import { TrophyIcon } from './icons'
import type { Card, Player } from '../engine/types'

const TYPE_LABELS: Record<string, string> = {
  station: 'ステーション',
  rock: 'ロック',
  maniac: 'マニアック',
  reg: 'レギュラー',
  fishy: 'フィッシー',
  user: 'あなた',
}

const SEAT_COORDS: Record<number, { x: number; y: number }[]> = {
  6: [
    { x: 50, y: 82 },
    { x: 13, y: 66 },
    { x: 9,  y: 26 },
    { x: 50, y: 10 },
    { x: 91, y: 26 },
    { x: 87, y: 66 },
  ],
  7: [
    { x: 50, y: 82 },
    { x: 12, y: 70 },
    { x: 7,  y: 38 },
    { x: 22, y: 10 },
    { x: 78, y: 10 },
    { x: 93, y: 38 },
    { x: 88, y: 70 },
  ],
  8: [
    { x: 50, y: 82 },
    { x: 14, y: 72 },
    { x: 7,  y: 48 },
    { x: 13, y: 22 },
    { x: 50, y: 9  },
    { x: 87, y: 22 },
    { x: 93, y: 48 },
    { x: 86, y: 72 },
  ],
}

// Mobile-specific coords: seats sit in upper (y≤30%) or lower (y≥70%) bands,
// keeping the centre band (y≈42–66%) clear for board cards.
const SEAT_COORDS_MOBILE: Record<number, { x: number; y: number }[]> = {
  6: [
    { x: 50, y: 90 },
    { x: 15, y: 75 },
    { x: 13, y: 28 },
    { x: 50, y: 14 },
    { x: 87, y: 28 },
    { x: 85, y: 75 },
  ],
  7: [
    { x: 50, y: 90 },
    { x: 12, y: 74 },
    { x: 9,  y: 36 },
    { x: 26, y: 14 },
    { x: 74, y: 14 },
    { x: 91, y: 36 },
    { x: 88, y: 74 },
  ],
  8: [
    { x: 50, y: 90 },
    { x: 14, y: 74 },
    { x: 9,  y: 38 },
    { x: 15, y: 18 },
    { x: 50, y: 12 },
    { x: 85, y: 18 },
    { x: 91, y: 38 },
    { x: 86, y: 74 },
  ],
}

function getSeatPos(seatIndex: number, playerCount: number, mobile?: boolean): { x: number; y: number } {
  const coords = mobile
    ? (SEAT_COORDS_MOBILE[playerCount] ?? SEAT_COORDS_MOBILE[6])
    : (SEAT_COORDS[playerCount] ?? SEAT_COORDS[6])
  return coords[seatIndex % coords.length]
}

const cardKey = (c: Card) => `${c.rank}${c.suit}`

function actionBadgeStyle(type: string): { bg: string; color: string } {
  switch (type) {
    case 'fold': return { bg: 'var(--red-dark)', color: '#ffd9d9' }
    case 'check': return { bg: 'var(--green-mid)', color: 'var(--text)' }
    case 'call': return { bg: 'var(--green-light)', color: '#fff' }
    case 'bet':
    case 'raise':
    case 'allin': return { bg: 'var(--gold)', color: '#1a2a1a' }
    default: return { bg: 'var(--panel-bg)', color: 'var(--text)' }
  }
}

interface ShowdownHand {
  category: string
  usedKeys: Set<string>
  isWinner: boolean
}

function SeatView({ player, isCurrentActor, showTypes, revealCards, showdown, playerCount, compact }: {
  player: Player; isCurrentActor: boolean; showTypes: boolean; revealCards: boolean
  showdown?: ShowdownHand; playerCount: number; compact?: boolean
}) {
  const pos = getSeatPos(player.seatIndex, playerCount, compact)
  const isFolded = player.folded
  const posInfo = POSITION_INFO[player.position]

  const badge = isFolded
    ? { type: 'fold', amount: 0 }
    : player.lastAction ?? null

  const showFace = player.isUser || (revealCards && !isFolded)

  const cardSize = compact ? 'sm' : (player.isUser ? 'lg' : 'md')
  const nameFontSize = compact ? 11 : 15
  const stackFontSize = compact ? 11 : 14.5
  const badgeFontSize = compact ? 11 : 15
  const badgePadding = compact ? '3px 10px' : '5px 16px'
  const namePadding = compact ? '3px 8px' : '4px 14px'

  return (
    <div style={{
      position: 'absolute',
      left: `${pos.x}%`,
      top: `${pos.y}%`,
      transform: 'translate(-50%, -50%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: compact ? 2 : 5,
      opacity: isFolded ? 0.22 : 1,
      filter: isFolded ? 'grayscale(0.9)' : undefined,
      transition: 'opacity 0.5s, filter 0.5s',
      zIndex: showdown?.isWinner ? 5 : 3,
    }}>
      <div style={{ height: compact ? 22 : 30, display: 'flex', alignItems: 'center' }}>
        {showdown ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.6, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 22 }}
            style={{
              background: showdown.isWinner ? 'linear-gradient(180deg, var(--gold-light), var(--gold))' : 'var(--panel-bg)',
              color: showdown.isWinner ? '#1a2a1a' : 'var(--text)',
              border: `1px solid ${showdown.isWinner ? 'var(--gold)' : 'var(--panel-border)'}`,
              borderRadius: 14, padding: compact ? '2px 8px' : '4px 14px',
              fontSize: compact ? 11 : 14, fontWeight: 700, whiteSpace: 'nowrap',
              boxShadow: showdown.isWinner ? 'var(--glow-gold)' : 'var(--shadow-sm)',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            {showdown.isWinner && <TrophyIcon size={compact ? 11 : 15} />}{showdown.category}
          </motion.div>
        ) : (
          <AnimatePresence mode="popLayout">
            {badge && (
              <motion.div
                key={`${badge.type}-${badge.amount}`}
                initial={{ opacity: 0, scale: 0.4, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                style={{
                  ...((s) => ({ background: s.bg, color: s.color }))(actionBadgeStyle(badge.type)),
                  borderRadius: 16, padding: badgePadding,
                  fontSize: badgeFontSize, fontWeight: 700, whiteSpace: 'nowrap',
                  boxShadow: 'var(--shadow-md)',
                }}
              >
                {ACTION_LABELS[badge.type] ?? badge.type}
                {badge.amount > 0 && badge.type !== 'fold' && badge.type !== 'check' && ` ₱${badge.amount}`}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>

      <div style={{ height: compact ? 18 : 24, display: 'flex', alignItems: 'center' }}>
        <AnimatePresence>
          {player.bet > 0 && (
            <motion.div
              key={player.bet}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              style={{
                background: 'linear-gradient(180deg, var(--gold-light), var(--gold))',
                color: '#1a2a1a', borderRadius: 12,
                padding: compact ? '1px 8px' : '2px 12px',
                fontSize: compact ? 11 : 13.5, fontWeight: 700,
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              ₱{player.bet}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div style={{ display: 'flex', gap: compact ? 2 : 4, perspective: 400 }}>
        {player.holeCards.map((c, i) =>
          showFace ? (
            <motion.div
              key={`f${i}`}
              initial={player.isUser ? false : { rotateY: 90 }}
              animate={{ rotateY: 0 }}
              transition={{ duration: 0.3, delay: i * 0.1 }}
            >
              <CardView
                card={c}
                size={cardSize}
                highlight={showdown?.usedKeys.has(cardKey(c))}
                dimmed={showdown && showdown.usedKeys.size > 0 ? !showdown.usedKeys.has(cardKey(c)) : false}
              />
            </motion.div>
          ) : (
            <CardView key={`b${i}`} faceDown size={compact ? 'sm' : 'md'} />
          )
        )}
      </div>

      {!compact && (
        <div
          className={isCurrentActor ? 'actor-pulse' : undefined}
          style={{
            background: isCurrentActor ? 'var(--gold)' : 'var(--panel-bg)',
            color: isCurrentActor ? '#1a2a1a' : 'var(--text)',
            border: `1px solid ${isCurrentActor ? 'var(--gold)' : 'var(--panel-border)'}`,
            borderRadius: 8, padding: namePadding, fontSize: nameFontSize, whiteSpace: 'nowrap',
            fontWeight: isCurrentActor ? 700 : 500,
            transition: 'background 0.25s, color 0.25s',
          }}
        >
          {player.name}
          {showTypes && !player.isUser && (
            <span style={{ color: isCurrentActor ? '#3a4a3a' : 'var(--text-dim)', marginLeft: 4, fontSize: 12.5 }}>
              ({TYPE_LABELS[player.type] ?? player.type})
            </span>
          )}
        </div>
      )}

      <div
        className={compact && isCurrentActor ? 'actor-pulse' : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: compact ? 4 : 7,
          ...(compact && isCurrentActor ? {
            background: 'var(--gold)', borderRadius: 6, padding: '2px 6px',
          } : {}),
          transition: 'background 0.25s',
        }}
      >
        <span style={{
          fontSize: stackFontSize,
          color: compact && isCurrentActor ? '#1a2a1a' : 'var(--text-muted)',
          fontWeight: 600,
        }}>
          ₱{player.stack}
        </span>
        <div className="tooltip-host" style={{ cursor: 'help' }}>
          <span style={{
            fontSize: compact ? 10 : 12,
            color: compact && isCurrentActor ? '#1a2a1a' : 'var(--gold-light)',
            fontWeight: 700,
            background: compact && isCurrentActor ? 'transparent' : 'rgba(200,168,75,0.15)',
            borderRadius: 4, padding: compact ? '1px 5px' : '1px 8px',
          }}>
            {player.position}
          </span>
          <div className="tooltip-body">
            <strong style={{ color: 'var(--gold)' }}>{posInfo.abbr} {posInfo.nameJa}</strong><br />
            {posInfo.description}
          </div>
        </div>
      </div>
    </div>
  )
}

export function TableView() {
  const { game, showBotTypes, startNewGame, lastPayouts } = useAppStore()
  const isMobile = useIsMobile()
  const [dismissed, setDismissed] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const advancingRef = useRef(false)

  useEffect(() => {
    if (game?.handOver) {
      setDismissed(false)
      advancingRef.current = false
    }
  }, [game?.handOver])

  function nextHand() {
    if (advancingRef.current) return
    advancingRef.current = true
    setDismissed(true)
    setTimeout(startNewGame, 240)
  }

  if (!game) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={startNewGame}
        style={{ background: 'var(--green-mid)', color: 'var(--gold-light)', padding: '14px 40px', fontSize: 18, borderRadius: 10, boxShadow: 'var(--shadow-md)' }}
      >
        ゲーム開始
      </motion.button>
    </div>
  )

  const potTotal = game.pots.reduce((s, p) => s + p.amount, 0)
  const userPlayer = game.players.find(p => p.isUser)
  const isUserTurn = game.players[game.actionIndex]?.isUser && !game.handOver
  const isShowdown = game.street === 'SHOWDOWN' || game.street === 'PAYOUT' || game.handOver
  const nonFolded = game.players.filter(p => !p.folded)
  const revealCards = isShowdown && nonFolded.length >= 2

  const showdownHands = new Map<string, ShowdownHand>()
  const winnerBoardKeys = new Set<string>()
  if (revealCards && game.board.length === 5) {
    let bestScore = -1
    const evals = nonFolded.map(p => {
      const seven = [...p.holeCards, ...game.board]
      const r = evaluate(seven)
      const def = handDefiningCards(seven)
      bestScore = Math.max(bestScore, r.score)
      return { p, score: r.score, category: r.category, defining: def.cards }
    })
    for (const e of evals) {
      const isWinner = e.score === bestScore
      showdownHands.set(e.p.id, {
        category: CATEGORY_JA[e.category] ?? e.category,
        usedKeys: new Set(e.defining.map(cardKey)),
        isWinner,
      })
      if (isWinner) {
        for (const c of e.defining) {
          if (game.board.some(b => cardKey(b) === cardKey(c))) winnerBoardKeys.add(cardKey(c))
        }
      }
    }
  }

  const showOverlay = game.handOver && !dismissed

  const boardCardSize = isMobile ? 'sm' : 'xl'
  const boardPlaceholderW = isMobile ? 36 : 72
  const boardPlaceholderH = isMobile ? 50 : 100

  // ---- Mobile layout ----
  if (isMobile) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Table area: fills all remaining height, no fixed aspect ratio */}
        <div style={{ flex: 1, position: 'relative', minHeight: 280 }}>
          {/* Felt ellipse — wider horizontal margins for more room */}
          <div style={{
            position: 'absolute',
            left: '2%', right: '2%', top: '3%', bottom: '5%',
            background: 'radial-gradient(ellipse at 50% 40%, #358a5c 0%, var(--green-felt) 55%, #226342 100%)',
            borderRadius: '50%',
            border: '6px solid #14301f',
            boxShadow: 'inset 0 6px 28px rgba(0,0,0,0.45), var(--shadow-md)',
          }} />

          {/* Pot + street */}
          <div style={{
            position: 'absolute', left: '50%', top: '30%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center', zIndex: 2,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          }}>
            <AnimatePresence mode="popLayout">
              {potTotal > 0 && (
                <motion.div
                  key={potTotal}
                  initial={{ scale: 0.85, opacity: 0.6 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                  style={{
                    background: 'rgba(0,0,0,0.55)', borderRadius: 8, padding: '3px 12px',
                    fontSize: 14, fontWeight: 700, color: 'var(--gold)',
                  }}
                >
                  ポット ₱{potTotal}
                </motion.div>
              )}
            </AnimatePresence>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>
              {STREET_JA[game.street] ?? game.street}
              <span style={{ marginLeft: 8, fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                #{game.handNumber}
              </span>
            </div>
          </div>

          {/* Board cards */}
          <div style={{
            position: 'absolute', left: '50%', top: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex', gap: 4, zIndex: 2, perspective: 600,
          }}>
            {game.board.map((c, i) => (
              <motion.div
                key={`${c.rank}${c.suit}`}
                initial={{ rotateY: 90, opacity: 0 }}
                animate={{ rotateY: 0, opacity: 1 }}
                transition={{ duration: 0.35, delay: i >= 3 ? 0 : i * 0.12 }}
              >
                <CardView
                  card={c}
                  size={boardCardSize}
                  highlight={winnerBoardKeys.has(cardKey(c))}
                  dimmed={winnerBoardKeys.size > 0 && !winnerBoardKeys.has(cardKey(c))}
                />
              </motion.div>
            ))}
            {Array.from({ length: 5 - game.board.length }).map((_, i) => (
              <div key={i} style={{ width: boardPlaceholderW, height: boardPlaceholderH, borderRadius: 5, border: '1.5px dashed rgba(255,255,255,0.18)' }} />
            ))}
          </div>

          {/* Players — x coords compressed via compact prop (see SeatView) */}
          {game.players.map(p => (
            <SeatView
              key={p.id}
              player={p}
              playerCount={game.players.length}
              isCurrentActor={!game.handOver && game.players[game.actionIndex]?.id === p.id}
              showTypes={showBotTypes}
              revealCards={revealCards}
              showdown={showdownHands.get(p.id)}
              compact
            />
          ))}

          {/* Hand over popup */}
          <AnimatePresence>
            {showOverlay && (
              <motion.div
                key="handover"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ delay: revealCards ? 1.2 : 0, duration: 0.18 }}
                style={{ position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none' }}
              >
                <div style={{
                  position: 'absolute', left: '50%', top: '60%',
                  transform: 'translate(-50%, -100%)',
                  pointerEvents: 'auto',
                }}>
                  <motion.div
                    initial={{ scale: 0.9, y: 8 }}
                    animate={{ scale: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 24, delay: revealCards ? 1.2 : 0 }}
                    style={{
                      background: 'rgba(20,38,27,0.97)', borderRadius: 10,
                      padding: '8px 18px', textAlign: 'center',
                      border: '1px solid var(--gold)',
                      boxShadow: 'var(--shadow-lg), var(--glow-gold)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
                      maxWidth: 'calc(100vw - 32px)',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {[...lastPayouts.entries()].map(([id, amount]) => {
                        const p = game.players.find(pl => pl.id === id)
                        const sd = showdownHands.get(id)
                        return amount > 0 ? (
                          <div key={id} style={{ color: 'var(--text)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                            <TrophyIcon size={13} style={{ color: 'var(--gold)' }} />
                            {p?.name ?? id}
                            <strong style={{ color: 'var(--gold-light)' }}>+₱{amount}</strong>
                            {sd && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({sd.category})</span>}
                          </div>
                        ) : null
                      })}
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.96 }}
                      onClick={nextHand}
                      disabled={dismissed}
                      style={{
                        background: 'var(--green-mid)', color: 'var(--gold-light)',
                        padding: '7px 20px', fontSize: 14, borderRadius: 8, fontWeight: 600,
                        opacity: dismissed ? 0.6 : 1,
                      }}
                    >
                      次のハンド →
                    </motion.button>
                  </motion.div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ActionBar (inline, shrinks table area above) */}
        {isUserTurn && userPlayer && (
          <div style={{ borderTop: '1px solid var(--panel-border)', flexShrink: 0 }}>
            <ActionBar />
          </div>
        )}

        {/* Judge panel toggle button */}
        <button
          onClick={() => setSheetOpen(o => !o)}
          style={{
            width: '100%', padding: '8px 16px',
            background: 'var(--panel-bg)',
            color: 'var(--text-muted)',
            borderTop: '1px solid var(--panel-border)',
            borderRadius: 0, fontSize: 13, fontWeight: 600,
            flexShrink: 0,
          }}
        >
          判定パネル {sheetOpen ? '▼' : '▲'}
        </button>

        {/* Modal sheet: scrim + slide-up panel */}
        <AnimatePresence>
          {sheetOpen && (
            <>
              <motion.div
                key="judge-scrim"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setSheetOpen(false)}
                style={{
                  position: 'fixed', inset: 0,
                  background: 'rgba(0,0,0,0.55)',
                  zIndex: 79,
                }}
              />
              <motion.div
                key="judge-sheet"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', stiffness: 340, damping: 32 }}
                style={{
                  position: 'fixed',
                  left: 0, right: 0, bottom: 0,
                  maxHeight: '82dvh',
                  display: 'flex', flexDirection: 'column',
                  background: 'var(--panel-bg)',
                  borderTop: '2px solid var(--panel-border)',
                  borderTopLeftRadius: 16, borderTopRightRadius: 16,
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 80,
                  paddingBottom: 'env(safe-area-inset-bottom)',
                }}
              >
                {/* Grab handle + header row */}
                <div style={{ flexShrink: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px' }}>
                    <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--panel-border)' }} />
                  </div>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '4px 16px 10px',
                    borderBottom: '1px solid var(--panel-border)',
                  }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>判定パネル</span>
                    <button
                      onClick={() => setSheetOpen(false)}
                      style={{
                        width: 28, height: 28, borderRadius: '50%',
                        background: 'var(--panel-bg-light)',
                        color: 'var(--text-muted)',
                        fontSize: 14, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: '1px solid var(--panel-border)',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {/* Scrollable content */}
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  <JudgePanel />
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <EstimateModal />
      </div>
    )
  }

  // ---- Desktop layout (unchanged) ----
  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 53px)' }}>
      {/* Table area */}
      <div style={{ flex: 1, position: 'relative', padding: 8, minWidth: 0 }}>
        {/* Felt ellipse */}
        <div style={{
          position: 'absolute',
          left: '4%', right: '4%', top: '5%', bottom: '8%',
          background: 'radial-gradient(ellipse at 50% 40%, #358a5c 0%, var(--green-felt) 55%, #226342 100%)',
          borderRadius: '50%',
          border: '8px solid #14301f',
          boxShadow: 'inset 0 6px 28px rgba(0,0,0,0.45), var(--shadow-md)',
        }} />

        {/* Pot + street */}
        <div style={{
          position: 'absolute', left: '50%', top: '31%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center', zIndex: 2,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        }}>
          <AnimatePresence mode="popLayout">
            {potTotal > 0 && (
              <motion.div
                key={potTotal}
                initial={{ scale: 0.85, opacity: 0.6 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                style={{
                  background: 'rgba(0,0,0,0.55)', borderRadius: 10, padding: '6px 20px',
                  fontSize: 19, fontWeight: 700, color: 'var(--gold)',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                ポット ₱{potTotal}
              </motion.div>
            )}
          </AnimatePresence>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', fontWeight: 600, letterSpacing: 1 }}>
            {STREET_JA[game.street] ?? game.street}
            <span style={{ marginLeft: 10, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
              Hand #{game.handNumber}
            </span>
          </div>
        </div>

        {/* Board cards */}
        <div style={{
          position: 'absolute', left: '50%', top: '48%',
          transform: 'translate(-50%, -50%)',
          display: 'flex', gap: 8, zIndex: 2,
          perspective: 600,
        }}>
          {game.board.map((c, i) => (
            <motion.div
              key={`${c.rank}${c.suit}`}
              initial={{ rotateY: 90, opacity: 0 }}
              animate={{ rotateY: 0, opacity: 1 }}
              transition={{ duration: 0.35, delay: i >= 3 ? 0 : i * 0.12 }}
            >
              <CardView
                card={c}
                size="xl"
                highlight={winnerBoardKeys.has(cardKey(c))}
                dimmed={winnerBoardKeys.size > 0 && !winnerBoardKeys.has(cardKey(c))}
              />
            </motion.div>
          ))}
          {Array.from({ length: 5 - game.board.length }).map((_, i) => (
            <div key={i} style={{ width: 72, height: 100, borderRadius: 7, border: '1.5px dashed rgba(255,255,255,0.18)' }} />
          ))}
        </div>

        {/* Players */}
        {game.players.map(p => (
          <SeatView
            key={p.id}
            player={p}
            playerCount={game.players.length}
            isCurrentActor={!game.handOver && game.players[game.actionIndex]?.id === p.id}
            showTypes={showBotTypes}
            revealCards={revealCards}
            showdown={showdownHands.get(p.id)}
          />
        ))}

        {/* Hand over popup */}
        <AnimatePresence>
          {showOverlay && (
            <motion.div
              key="handover"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ delay: revealCards ? 1.2 : 0, duration: 0.18 }}
              style={{ position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none' }}
            >
              <div style={{
                position: 'absolute', left: '50%', top: '63%',
                transform: 'translate(-50%, -100%)',
                pointerEvents: 'auto',
              }}>
                <motion.div
                  initial={{ scale: 0.9, y: 8 }}
                  animate={{ scale: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 24, delay: revealCards ? 1.2 : 0 }}
                  style={{
                    background: 'rgba(20,38,27,0.97)', borderRadius: 12,
                    padding: '11px 26px', textAlign: 'center',
                    border: '1px solid var(--gold)',
                    boxShadow: 'var(--shadow-lg), var(--glow-gold)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {[...lastPayouts.entries()].map(([id, amount]) => {
                      const p = game.players.find(pl => pl.id === id)
                      const sd = showdownHands.get(id)
                      return amount > 0 ? (
                        <div key={id} style={{ color: 'var(--text)', fontSize: 15, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                          <TrophyIcon size={16} style={{ color: 'var(--gold)' }} />
                          {p?.name ?? id}
                          <strong style={{ color: 'var(--gold-light)' }}>+₱{amount}</strong>
                          {sd && <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>({sd.category})</span>}
                        </div>
                      ) : null
                    })}
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={nextHand}
                    disabled={dismissed}
                    style={{
                      background: 'var(--green-mid)', color: 'var(--gold-light)',
                      padding: '8px 26px', fontSize: 15, borderRadius: 8, fontWeight: 600,
                      opacity: dismissed ? 0.6 : 1,
                    }}
                  >
                    次のハンド →
                  </motion.button>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Right panel */}
      <div style={{ width: 430, flexShrink: 0, borderLeft: '1px solid var(--panel-border)', display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.12)' }}>
        <JudgePanel />
        {isUserTurn && userPlayer && (
          <div style={{ borderTop: '1px solid var(--panel-border)' }}>
            <ActionBar />
          </div>
        )}
      </div>

      <EstimateModal />
    </div>
  )
}
