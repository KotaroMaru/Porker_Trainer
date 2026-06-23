import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../store/state'
import type { HandRecord } from '../store/state'
import { DetailOverlay } from './DetailOverlay'
import { RangeGrid } from './RangeGrid'
import { JudgmentCard } from './JudgmentCard'
import { handString } from '../advisor/ranges'
import { classifyHandStrength } from '../advisor/postflop'
import { drawOutCards } from '../analysis/outs'
import { betSizeVerdict } from '../advisor/explain'
import { CardView } from './CardView'
import {
  getYokosawaAdvice, getYokosawaContext, userHandStr,
  TIER_INFO, YOKOSAWA_ACTION_JA,
} from '../advisor/yokosawa'
import { YokosawaRangeGrid } from './YokosawaRangeGrid'
import { RangeVsRangeCard } from './RangeVsRangeCard'
import { POSITION_INFO, ACTION_JA, STREET_JA } from './glossary'
import { BulbIcon, GridIcon, CoinIcon, WarningIcon, GearIcon, InfoIcon, CheckIcon, CrossIcon, ExpandIcon } from './icons'

const STRENGTH_JA: Record<string, string> = {
  MONSTER: 'モンスター(ほぼ最強)',
  STRONG_MADE: '強い完成手',
  MIDDLE: 'そこそこの完成手(トップペア級)',
  WEAK_PAIR: '弱いペア',
  STRONG_DRAW: '強いドロー',
  WEAK_DRAW: '弱いドロー',
  AIR: 'ノーハンド(エア)',
}

type Drill = 'exact' | 'approx' | 'required' | 'range' | 'yokosawa' | null

function pctOrDash(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`
}

export function JudgePanel() {
  const { recommendation, showRecommendation, requestHint, game, handHistory, showBotTypes, judgePanelSettings } = useAppStore()
  const [drill, setDrill] = useState<Drill>(null)
  const [logOverlay, setLogOverlay] = useState<number | null>(null)

  const user = game?.players.find(p => p.isUser)
  const isUserTurn = game?.players[game.actionIndex]?.isUser
  const handOver = game?.handOver
  const isPreflop = game?.street === 'PREFLOP_BETTING'

  const potTotal = game?.pots.reduce((s, p) => s + p.amount, 0) ?? 0
  const callAmount = game && user ? Math.max(0, game.currentBet - user.bet) : 0

  // user hand notation (e.g. 'AKs') for range overlay
  const userHand = user && user.holeCards.length === 2
    ? handString(user.holeCards[0].rank, user.holeCards[1].rank, user.holeCards[0].suit === user.holeCards[1].suit)
    : undefined

  const rec = recommendation
  // 7〜8人卓のプリフロップでは標準GTOレンジは正確でないため非表示
  const isLargeTable = isPreflop && (game?.players.length ?? 6) > 6

  // ヨコサワモデル: プリフロップのみ算出 (既存の標準モデルとは独立)
  const yokoHand = user ? userHandStr(user) : null
  const yokoResult = isPreflop && user && game && yokoHand
    ? (() => {
        const ctx = getYokosawaContext(game, user)
        const advice = getYokosawaAdvice({
          position: user.position,
          handStr: yokoHand,
          facingRaise: ctx.facingRaise,
          raiserPosition: ctx.raiserPosition,
          raiseCount: ctx.raiseCount,
          tableSize: ctx.tableSize,
        })
        return { advice, ctx }
      })()
    : null

  // フォールド後もヨコサワカードを表示し続ける (ハンドが変わったらクリア)
  type YokoSnapshot = { advice: ReturnType<typeof getYokosawaAdvice>, ctx: ReturnType<typeof getYokosawaContext> }
  const yokoSnapshotRef = useRef<YokoSnapshot | null>(null)
  const snapshotHandNumRef = useRef<number | null>(null)
  useEffect(() => {
    if (!game) return
    if (game.handNumber !== snapshotHandNumRef.current) {
      snapshotHandNumRef.current = game.handNumber
      yokoSnapshotRef.current = null
    }
    if (yokoResult) yokoSnapshotRef.current = yokoResult
  })
  // isPreflop中のみスナップショットを使う（フロップ以降には表示しない）
  const displayedYoko = yokoResult ?? (isPreflop ? yokoSnapshotRef.current : null)

  const yokoAdvice = displayedYoko?.advice ?? null
  const yokoCtx = displayedYoko?.ctx ?? null

  // このハンドの判断ログ (ターン毎の判定パネル履歴)
  const handLog = game ? handHistory.filter(r => r.handNumber === game.handNumber) : []

  // 直近アクションがbet/raiseのときのみサイズ判定を表示 (フォールド後に前のレイズが出ないよう最後の1件のみ見る)
  const lastRecord = [...handLog].reverse()[0]
  const lastBet = lastRecord?.userAction &&
    (lastRecord.userAction.type === 'bet' || lastRecord.userAction.type === 'raise')
    ? lastRecord : null
  const sizeJudge = lastBet?.userAction
    ? betSizeVerdict({
        type: lastBet.userAction.type,
        amount: lastBet.userAction.amount,
        pot: lastBet.potTotal,
        betLevel: lastBet.betLevel,
        recFraction: lastBet.recommendation?.betSizeFraction,
      })
    : null

  return (
    <div style={{
      flex: 1, padding: 16, overflow: 'auto',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ color: 'var(--gold)', fontSize: 15, fontWeight: 700 }}>判定パネル</h3>
        {isUserTurn && !showRecommendation && !handOver && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={requestHint}
            style={{
              background: 'var(--green-mid)', color: 'var(--gold-light)',
              padding: '6px 14px', fontSize: 13, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <BulbIcon size={15} /> ヒント
          </motion.button>
        )}
      </div>

      <AnimatePresence mode="wait">
      {showRecommendation && rec ? (
        <motion.div
          key="rec"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          {/* Recommended action (7-8人卓プリフロップは標準レンジ非表示) */}
          {!isLargeTable && <div
            onClick={isPreflop ? () => setDrill('range') : undefined}
            style={{
              background: 'linear-gradient(160deg, var(--green-dark), #14301f)',
              borderRadius: 10, padding: 14,
              border: '1px solid var(--green-mid)',
              cursor: isPreflop ? 'pointer' : undefined,
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
              <span>推奨アクション</span>
              {isPreflop && <span style={{ color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: 4 }}><GridIcon size={13} /> レンジ表を見る</span>}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--gold)' }}>
              {ACTION_JA[rec.action] ?? rec.action.toUpperCase()}
              {rec.betSizeFraction && (
                <span style={{ fontSize: 14, color: 'var(--text-muted)', marginLeft: 8 }}>
                  (ポットの約{Math.round(rec.betSizeFraction * 100)}%)
                </span>
              )}
            </div>
            {rec.sizeRationale && (
              <div style={{
                marginTop: 8, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6,
                borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8,
                display: 'flex', gap: 6,
              }}>
                <CoinIcon size={15} style={{ color: 'var(--gold-light)', marginTop: 2 }} />
                <span><strong style={{ color: 'var(--gold-light)' }}>サイズの根拠:</strong> {rec.sizeRationale}</span>
              </div>
            )}
          </div>}

          {/* Number block: あなたの読み(根拠) / 実際の勝率(答え) / 必要勝率 */}
          <div style={{
            background: 'rgba(0,0,0,0.3)', borderRadius: 10, padding: 12,
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
          }}>
            <NumberRow
              label={!isPreflop && rec.equity.estimateMethod === 'draw' ? 'アウツ勝率' : 'あなたの読み'}
              sub={isPreflop ? 'レンジ表で判断'
                : rec.equity.estimateMethod === 'draw' ? `アウツ${rec.equity.estimateOuts}枚→4-2`
                : rec.equity.estimateMethod === 'air' ? 'ノーハンド'
                : rec.equity.estimateMethod === 'no_sdv' ? '役はあるが価値なし'
                : '手の強さの読み'}
              value={pctOrDash(rec.equity.estimate)}
              highlight
              onClick={() => setDrill('approx')}
            />
            <NumberRow
              label="実際の勝率"
              sub="答え(本来は見えない)"
              value={pctOrDash(rec.equity.exact)}
              onClick={() => setDrill('exact')}
            />
            <NumberRow
              label="必要勝率"
              sub="コールが得な最低ライン"
              value={`${Math.round(rec.equity.required * 100)}%`}
              onClick={() => setDrill('required')}
            />
          </div>

          {/* 判定バナー (推奨に連動) */}
          <div style={{
            borderRadius: 10, padding: '10px 14px', fontSize: 14, fontWeight: 600,
            background: rec.verdictTone === 'good' ? 'rgba(58,153,96,0.15)'
              : rec.verdictTone === 'bad' ? 'rgba(217,64,64,0.15)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${rec.verdictTone === 'good' ? 'var(--green-light)'
              : rec.verdictTone === 'bad' ? 'var(--red)' : 'var(--panel-border)'}`,
            color: rec.verdictTone === 'good' ? 'var(--green-light)'
              : rec.verdictTone === 'bad' ? 'var(--red)' : 'var(--text-muted)',
          }}>
            判定: {rec.verdictText}
          </div>

          {/* ===== レンジ対レンジ勝率 (各ストリート) ===== */}
          {judgePanelSettings.rangeVsRange && game && !game.handOver && <RangeVsRangeCard game={game} />}

          {/* ===== ヨコサワモデルの欄 (プリフロップのみ・クリックで色分けレンジ表) ===== */}
          {judgePanelSettings.yokosawa && yokoAdvice && (
            <div
              onClick={() => setDrill('yokosawa')}
              style={{
                background: 'linear-gradient(160deg, #20283f, #161d2e)',
                borderRadius: 10, padding: 13,
                border: '1px solid #34406a', cursor: 'pointer',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#9fb0e8', fontWeight: 700, letterSpacing: 0.5 }}>ヨコサワモデル</span>
                <span style={{ color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <GridIcon size={13} /> 色分け表を見る
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {/* 手のティア色チップ */}
                <span style={{
                  background: TIER_INFO[yokoAdvice.tier].color,
                  color: TIER_INFO[yokoAdvice.tier].textColor,
                  borderRadius: 6, padding: '4px 10px', fontSize: 13, fontWeight: 700,
                  border: '1px solid rgba(255,255,255,0.2)', whiteSpace: 'nowrap',
                }}>
                  あなた: {TIER_INFO[yokoAdvice.tier].labelJa}
                </span>
                {/* 対レイズ時: 相手の想定ティアチップ */}
                {yokoAdvice.assumedOpponentTier && (
                  <>
                    <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>vs</span>
                    <span style={{
                      background: TIER_INFO[yokoAdvice.assumedOpponentTier].color,
                      color: TIER_INFO[yokoAdvice.assumedOpponentTier].textColor,
                      borderRadius: 6, padding: '4px 10px', fontSize: 13, fontWeight: 700,
                      border: '1px solid rgba(255,255,255,0.2)', whiteSpace: 'nowrap',
                    }}>
                      {yokoCtx?.raiserPosition ? `相手(${yokoCtx.raiserPosition})` : '相手'}: {TIER_INFO[yokoAdvice.assumedOpponentTier].labelJa}
                    </span>
                  </>
                )}
                <span style={{ fontSize: 18, fontWeight: 700, color: '#cdd6f4' }}>
                  → {YOKOSAWA_ACTION_JA[yokoAdvice.action]}
                </span>
              </div>
              <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.65 }}>
                {yokoAdvice.reasoning}
              </div>
            </div>
          )}

          {/* ベット/レイズ額の判定 (直近に自分がベット/レイズした場合) */}
          {judgePanelSettings.sizeJudge && sizeJudge && (
            <div style={{
              borderRadius: 10, padding: '10px 14px', fontSize: 13.5, lineHeight: 1.6,
              background: sizeJudge.tone === 'good' ? 'rgba(58,153,96,0.12)'
                : sizeJudge.tone === 'bad' ? 'rgba(217,64,64,0.12)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${sizeJudge.tone === 'good' ? 'var(--green-light)'
                : sizeJudge.tone === 'bad' ? 'var(--red)' : 'var(--panel-border)'}`,
              color: sizeJudge.tone === 'good' ? 'var(--green-light)'
                : sizeJudge.tone === 'bad' ? 'var(--red)' : 'var(--text-muted)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <CoinIcon size={15} /> サイズ判定: {sizeJudge.text}
            </div>
          )}

          {/* ミス警告バナー (ドンクベット等) */}
          {judgePanelSettings.mistake && (() => {
            const lastMistake = [...handLog].reverse().find(r => r.mistake)?.mistake
            if (!lastMistake) return null
            return (
              <div style={{
                background: 'rgba(217,64,64,0.12)', borderRadius: 10, padding: '10px 14px',
                border: '1px solid rgba(217,64,64,0.45)',
                display: 'flex', gap: 8, alignItems: 'flex-start',
              }}>
                <WarningIcon size={16} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 3 }} />
                <div>
                  <div style={{ color: 'var(--red)', fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                    ミス: {lastMistake.label}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12.5, lineHeight: 1.7 }}>
                    {lastMistake.explanation}
                  </div>
                </div>
              </div>
            )
          })()}

          {/* ギャップ警告 (読みと実際が食い違う局面) */}
          {judgePanelSettings.gapWarning && rec.gapWarning && (
            <div style={{
              background: 'rgba(200,168,75,0.12)', borderRadius: 10, padding: 11,
              border: '1px solid rgba(200,168,75,0.4)', fontSize: 13, color: 'var(--gold-light)', lineHeight: 1.7,
              display: 'flex', gap: 7,
            }}>
              <WarningIcon size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{rec.gapWarning}</span>
            </div>
          )}

          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: -4, textAlign: 'right' }}>
            各数値をクリックすると計算の内訳が見られます
          </div>

          {/* Explanation */}
          {judgePanelSettings.explanation && (
            <div style={{
              background: 'var(--panel-bg)', borderRadius: 10, padding: 13,
              border: '1px solid var(--panel-border)', fontSize: 14, lineHeight: 1.7, color: 'var(--text)',
            }}>
              {rec.explanation}
            </div>
          )}

          {/* Alternatives */}
          {judgePanelSettings.alternatives && rec.alternatives.length > 0 && (
            <div style={{ fontSize: 13 }}>
              <div style={{ color: 'var(--text-dim)', marginBottom: 6 }}>他の選択肢</div>
              {rec.alternatives.map((alt, i) => (
                <div key={i} style={{
                  background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '7px 11px',
                  marginBottom: 4, color: 'var(--text-muted)', lineHeight: 1.6,
                }}>
                  <span style={{ color: 'var(--text)', fontWeight: 600 }}>{ACTION_JA[alt.action] ?? alt.action}</span>
                  {' — '}{alt.reasoning}
                </div>
              ))}
            </div>
          )}

          {/* Exploit note (相手タイプ分析) — 「型表示」ON時のみ */}
          {showBotTypes && rec.exploitNote && (
            <div style={{
              background: 'rgba(200,168,75,0.08)', borderRadius: 10, padding: 11,
              border: '1px solid rgba(200,168,75,0.2)', fontSize: 13, color: 'var(--gold-light)', lineHeight: 1.6,
              display: 'flex', gap: 7,
            }}>
              <GearIcon size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{rec.exploitNote}</span>
            </div>
          )}
        </motion.div>
      ) : (
        <motion.div
          key="waiting"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{ color: 'var(--text-dim)', fontSize: 14, textAlign: 'center', marginTop: 24, lineHeight: 1.8 }}
        >
          {isUserTurn
            ? <>まず自分で判断してみましょう。<br />迷ったら<BulbIcon size={14} style={{ verticalAlign: '-2px' }} />ヒントを押すと推奨が見られます。</>
            : 'ボットが考え中...'}
        </motion.div>
      )}
      </AnimatePresence>

      {/* ===== このハンドの判断ログ (クリックでフルサイズ表示) ===== */}
      {judgePanelSettings.handLog && handLog.length > 0 && (
        <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: 10 }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 8, fontWeight: 600 }}>
            このハンドの判断履歴 <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(クリックで詳しく)</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {handLog.map((r, i) => (
              <DecisionLogRow key={i} record={r} onOpen={() => setLogOverlay(i)} />
            ))}
          </div>
        </div>
      )}

      {/* 判断履歴のフルサイズ表示 */}
      <DetailOverlay
        open={logOverlay !== null}
        title={logOverlay !== null && handLog[logOverlay]
          ? `判定の振り返り — ${STREET_JA[handLog[logOverlay].street] ?? handLog[logOverlay].street}`
          : '判定の振り返り'}
        onClose={() => setLogOverlay(null)}
        maxWidth={460}
      >
        {logOverlay !== null && handLog[logOverlay] && <JudgmentCard record={handLog[logOverlay]} />}
      </DetailOverlay>

      {/* User's current hand info */}
      {user && !user.folded && game && (
        <div style={{ marginTop: 'auto', fontSize: 13, color: 'var(--text-muted)', borderTop: '1px solid var(--panel-border)', paddingTop: 10 }}>
          ポジション: <strong style={{ color: 'var(--gold-light)' }}>{user.position}</strong>
          <span style={{ color: 'var(--text-dim)' }}> ({POSITION_INFO[user.position].nameJa})</span>
          {' '}| スタック: ₱{user.stack}
        </div>
      )}

      {/* ===== ヨコサワモデル: 色分けレンジ表オーバーレイ ===== */}
      <DetailOverlay
        open={drill === 'yokosawa'}
        title="ヨコサワモデル — オリジナルハンドレンジ"
        onClose={() => setDrill(null)}
        maxWidth={560}
      >
        <p style={{ marginBottom: 12, fontSize: 13, lineHeight: 1.8 }}>
          手の強さを <strong style={{ color: '#9fb0e8' }}>7 色のティア</strong> で表したレンジ表です。
          色が「<strong>紺→赤→黄→緑→水色→白→灰</strong>」の順で弱くなり、各色には
          各色には参加できる後ろの人数の目安があります
          （<strong>紺=8人/強 → 赤=8人/弱 → 黄=6〜7人 → 緑=4〜5人 → 水色=3人 → 白=2人 → 灰=不参加</strong>）。
        </p>
        {yokoAdvice && (
          <div style={{
            background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 12,
            fontSize: 13.5, lineHeight: 1.7,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{
                background: TIER_INFO[yokoAdvice.tier].color, color: TIER_INFO[yokoAdvice.tier].textColor,
                borderRadius: 6, padding: '3px 9px', fontSize: 12.5, fontWeight: 700,
              }}>
                あなたの手: {TIER_INFO[yokoAdvice.tier].labelJa}
              </span>
              {yokoAdvice.assumedOpponentTier && (
                <>
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>vs</span>
                  <span style={{
                    background: TIER_INFO[yokoAdvice.assumedOpponentTier].color,
                    color: TIER_INFO[yokoAdvice.assumedOpponentTier].textColor,
                    borderRadius: 6, padding: '3px 9px', fontSize: 12.5, fontWeight: 700,
                    border: '1px solid rgba(255,255,255,0.15)',
                  }}>
                    {yokoCtx?.raiserPosition ? `相手(${yokoCtx.raiserPosition})` : '相手'}: {TIER_INFO[yokoAdvice.assumedOpponentTier].labelJa}
                  </span>
                </>
              )}
              <strong style={{ color: 'var(--gold-light)' }}>→ {YOKOSAWA_ACTION_JA[yokoAdvice.action]}</strong>
            </div>
            <div style={{ color: 'var(--text-muted)' }}>{yokoAdvice.reasoning}</div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <YokosawaRangeGrid highlightHand={yokoHand ?? undefined} cellSize={30} />
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.8 }}>
          <div style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}>使い方のポイント</div>
          ・<strong>リレイズ判断</strong>: レイザーのポジションから相手の色を仮定し、自分が1ランク上ならコール、2ランク上ならリレイズ。<br />
          ・<strong>再レイズ</strong>が重なるほど相手の色を強く見積もる（白→緑→赤→紺）。<br />
          ・<strong>BB</strong>はどこからのレイズでも水色までコール、COは白、BTNは白＋ピンク枠の境界13ハンドまで。<br />
          ・<strong>参加頻度</strong>はおよそ5回に1回。短期は配牌次第なので、長期で約1/5になればOK。
        </div>
      </DetailOverlay>

      {/* ===== Drill-down overlays ===== */}
      <DetailOverlay open={drill === 'exact'} title="実際の勝率(答え)とは" onClose={() => setDrill(null)}>
        <p style={{ marginBottom: 12 }}>
          <strong style={{ color: 'var(--gold)' }}>エクイティ(勝率)</strong> = 残りのカードを最後まで配り切ったとき、
          <strong>あなたの手が一番強くなって勝つ確率</strong>です。
          「いま勝っているか」ではなく「最終的に勝つ確率」である点に注意。
        </p>
        <p style={{ marginBottom: 12, color: 'var(--gold-light)', fontSize: 13, background: 'rgba(200,168,75,0.08)', padding: '8px 12px', borderRadius: 8 }}>
          これは「答え」の値です。<strong>実戦のテーブルでは見えません。</strong>
          このアプリでは推奨アクションは「あなたの読み」をもとに出し、この厳密値は答え合わせ用に表示しています。
        </p>
        {rec && rec.equity.exact != null ? (
          <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--gold-light)', textAlign: 'center' }}>
              {Math.round(rec.equity.exact * 100)}%
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', marginTop: 4 }}>
              残ったプレイヤー {game ? game.players.filter(p => !p.folded).length - 1 : '?'}人 との対戦勝率
            </div>
          </div>
        ) : (
          <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 14, marginBottom: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-dim)' }}>—</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
              プリフロップでは計算しません(ボードが開いてから表示されます)
            </div>
          </div>
        )}
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          計算方法: 残りの未公開カードの組み合わせをすべて列挙し、勝ち・引き分け・負けを数えて算出しています。
        </p>
      </DetailOverlay>

      <DetailOverlay open={drill === 'approx'} title="あなたの読み(実戦での見積もり方)" onClose={() => setDrill(null)}>
        <p style={{ marginBottom: 12, color: 'var(--gold-light)', fontSize: 13, background: 'rgba(200,168,75,0.08)', padding: '8px 12px', borderRadius: 8 }}>
          推奨アクションは、この<strong>「あなたが実戦で見積もれる勝率」</strong>をもとに出しています。
          実戦のテーブルで実際にやる計算を再現したものです。
        </p>
        {isPreflop ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13.5, lineHeight: 1.8 }}>
            プリフロップは勝率を見積もるのではなく、<strong style={{ color: 'var(--text)' }}>レンジ表</strong>
            (ポジションごとの参加基準)で判断します。推奨アクションをクリックするとレンジ表が見られます。
          </p>
        ) : rec?.equity.estimateMethod === 'draw' ? (
          <>
            <p style={{ marginBottom: 12, fontSize: 13.5, lineHeight: 1.8 }}>
              あなたの手は<strong style={{ color: 'var(--gold)' }}>ドロー</strong>(未完成)。
              勝ち手に変わるカード(<strong>アウツ</strong>)を数え、
              フロップなら×4、ターンなら×2して勝率を概算します。
            </p>
            <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
              <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '4px 0', color: 'var(--text-muted)' }}>アウツ</td>
                    <td style={{ textAlign: 'right', color: 'var(--gold-light)', fontWeight: 700 }}>{rec.equity.estimateOuts} 枚</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 0', color: 'var(--text-muted)' }}>
                      {game?.board.length === 3 ? 'フロップ → ×4' : 'ターン → ×2'}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--gold-light)', fontWeight: 700 }}>
                      ≈ {Math.round((rec.equity.estimate ?? 0) * 100)}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* アウツの実カード一覧 */}
            {user && game && (() => {
              const { flush, straight } = drawOutCards(user.holeCards, game.board)
              if (flush.length === 0 && straight.length === 0) return null
              return (
                <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {flush.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 6 }}>
                        フラッシュのアウツ ({flush.length}枚)
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {flush.map((c, i) => <CardView key={i} card={c} size="sm" />)}
                      </div>
                    </div>
                  )}
                  {straight.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 6 }}>
                        ストレートのアウツ ({straight.length}枚)
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {straight.map((c, i) => <CardView key={i} card={c} size="sm" />)}
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}

            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              <div style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 6 }}>代表的なアウツ早見表</div>
              フラッシュドロー: 9枚 (フロップで≈36%) / OESD: 8枚 (≈32%) /
              ガットショット: 4枚 (≈16%) / オーバーカード2枚: 6枚 (≈24%)
            </div>
          </>
        ) : rec?.equity.estimateMethod === 'air' || rec?.equity.estimateMethod === 'no_sdv' ? (
          <>
            <p style={{ marginBottom: 12, fontSize: 13.5, lineHeight: 1.8 }}>
              {rec?.equity.estimateMethod === 'no_sdv' ? (
                <>あなたの手は<strong style={{ color: 'var(--red)' }}>役はあるがショーダウンバリューなし</strong>。
                ペア等は作っていますが、<strong>ボードのペアに支配され実質最弱クラス</strong>です。</>
              ) : (
                <>あなたの手は<strong style={{ color: 'var(--red)' }}>ノーハンド</strong>。
                ペアもドローもなく、<strong>場のカードに勝てていない状態</strong>です。</>
              )}
            </p>
            <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
              <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '4px 0', color: 'var(--text-muted)' }}>手の強さ</td>
                    <td style={{ textAlign: 'right', color: 'var(--text)', fontWeight: 700 }}>
                      {user && game ? (STRENGTH_JA[classifyHandStrength(user.holeCards, game.board)] ?? '') : ''}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 0', color: 'var(--text-muted)' }}>ショーダウンで勝てる見込み</td>
                    <td style={{ textAlign: 'right', color: 'var(--gold-light)', fontWeight: 700 }}>
                      ≈ {Math.round((rec?.equity.estimate ?? 0) * 100)}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              ショーダウンバリュー(チェックで回して勝てる見込み)がない手は、
              基本はチェック、ベットに直面したらフォールド。
              ただし<strong>降ろせる相手なら「ブラフへの転化」</strong>として、
              相手のより強い中途半端な手を降ろすためにベットする選択もあります(バリューではなくブラフ)。
            </div>
          </>
        ) : (
          <>
            <p style={{ marginBottom: 12, fontSize: 13.5, lineHeight: 1.8 }}>
              あなたの手は<strong style={{ color: 'var(--gold)' }}>完成手</strong>。
              完成手はアウツを数えるのではなく、<strong>「いま自分がどれくらいリードしているか」</strong>
              を手の強さから読みます。
            </p>
            <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
              <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '4px 0', color: 'var(--text-muted)' }}>手の強さ</td>
                    <td style={{ textAlign: 'right', color: 'var(--text)', fontWeight: 700 }}>
                      {user && game ? (STRENGTH_JA[classifyHandStrength(user.holeCards, game.board)] ?? '') : ''}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 0', color: 'var(--text-muted)' }}>読みの勝率</td>
                    <td style={{ textAlign: 'right', color: 'var(--gold-light)', fontWeight: 700 }}>
                      ≈ {Math.round((rec?.equity.estimate ?? 0) * 100)}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              強さの目安: モンスター(フルハウス以上)≈90%+ / 強い完成手(フラッシュ・セット等)≈75% /
              トップペア級≈55% / 弱いペア≈42%。これはあくまで「読み」なので、
              右の「実際の勝率」とのズレを見て感覚を補正しましょう。
            </div>
          </>
        )}
      </DetailOverlay>

      <DetailOverlay open={drill === 'required'} title="必要勝率 (ポットオッズ) の計算" onClose={() => setDrill(null)}>
        <p style={{ marginBottom: 12 }}>
          <strong style={{ color: 'var(--gold)' }}>必要勝率</strong> = コールが「割に合う」ために最低限必要な勝率。
          これよりエクイティが高ければコールは長期的に得(+EV)です。
        </p>
        <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 16, marginBottom: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 15, color: 'var(--text)', marginBottom: 8 }}>
            必要勝率 = コール額 ÷ (ポット + コール額)
          </div>
          {callAmount > 0 ? (
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--gold-light)' }}>
              ₱{callAmount} ÷ (₱{potTotal} + ₱{callAmount}) = {Math.round(callAmount / (potTotal + callAmount) * 100)}%
            </div>
          ) : (
            <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
              いまはコールする額がない(チェック可能)ため、必要勝率は 0% です。
            </div>
          )}
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          例: ポット₱200に相手が₱100ベット → ポットは₱300、コール額は₱100。
          必要勝率 = 100 ÷ (300 + 100) = 25%。勝率が25%以上ならコールが得です。
        </p>
      </DetailOverlay>

      <DetailOverlay
        open={drill === 'range'}
        title={rec?.facingRaise
          ? `${user?.position ?? ''} の対レイズレンジ表 (3ベット/フォールド)`
          : user?.position === 'BB'
          ? 'BB アイソレート(レイズ)レンジ表'
          : `${user?.position ?? ''} のオープンレンジ表`}
        onClose={() => setDrill(null)}
        maxWidth={520}
      >
        {rec?.facingRaise ? (
          <p style={{ marginBottom: 12, fontSize: 13, lineHeight: 1.8 }}>
            <strong style={{ color: 'var(--gold)' }}>相手がすでにレイズしているため、オープンレンジは使いません。</strong><br />
            レイズに対しては基準がぐっと厳しくなり、赤のマス(3ベット)だけで再レイズ、
            {user?.position === 'BB' && '緑のマス(BBのみ)はコール、'}
            それ以外はオープンレンジ内の手でもフォールドが基本です。
          </p>
        ) : user?.position === 'BB' ? (
          <p style={{ marginBottom: 12, fontSize: 13, lineHeight: 1.8 }}>
            <strong style={{ color: 'var(--gold)' }}>BBは誰もレイズしていなければ無料でチェックできます。</strong><br />
            緑のマスはレイズして相手を孤立させる(アイソレート)強い手。
            金色があなたの手。<strong>レンジ外でもフォールドではなく「チェック」</strong>して無料でフロップを見ます。
          </p>
        ) : (
          <p style={{ marginBottom: 12, fontSize: 13, lineHeight: 1.8 }}>
            緑のマスが「このポジションからレイズで参加してよい手」です。
            金色があなたの現在の手。レンジ外の手は長期的に損失となるためフォールドが基本です。
          </p>
        )}
        {user && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <RangeGrid
              position={user.position}
              mode={rec?.facingRaise ? 'vsraise' : 'open'}
              highlightHand={userHand}
              cellSize={28}
            />
          </div>
        )}
      </DetailOverlay>
    </div>
  )
}

// このハンドの判断履歴の1行 (クリックでフルサイズ表示)
function DecisionLogRow({ record, onOpen }: { record: HandRecord; onOpen: () => void }) {
  const r = record
  return (
    <div
      onClick={onOpen}
      style={{
        background: 'rgba(0,0,0,0.2)', borderRadius: 8,
        border: `1px solid ${r.matched ? 'var(--panel-border)' : 'rgba(217,64,64,0.45)'}`,
        padding: '7px 11px', cursor: 'pointer', fontSize: 12.5,
        display: 'flex', alignItems: 'center', gap: 8,
      }}
    >
      <span style={{ color: 'var(--gold-light)', fontWeight: 700, minWidth: 64 }}>
        {STREET_JA[r.street] ?? r.street}
      </span>
      <span style={{ color: r.matched ? 'var(--green-light)' : 'var(--red)', display: 'flex', alignItems: 'center' }}>
        {r.matched ? <CheckIcon size={14} /> : <CrossIcon size={14} />}
      </span>
      <span style={{ color: 'var(--text)' }}>
        {ACTION_JA[r.userAction?.type ?? ''] ?? r.userAction?.type}
      </span>
      {!r.matched && r.recommendation && (
        <span style={{ color: 'var(--text-dim)' }}>
          (推奨: {ACTION_JA[r.recommendation.action] ?? r.recommendation.action})
        </span>
      )}
      {r.mistake && (
        <span style={{
          color: 'var(--red)', fontSize: 11, padding: '1px 6px',
          background: 'rgba(217,64,64,0.12)', borderRadius: 3,
          border: '1px solid rgba(217,64,64,0.3)', whiteSpace: 'nowrap',
        }}>
          {r.mistake.label}
        </span>
      )}
      <ExpandIcon size={14} style={{ marginLeft: 'auto', color: 'var(--text-dim)' }} />
    </div>
  )
}

function NumberRow({ label, sub, value, highlight, onClick }: {
  label: string; sub: string; value: string; highlight?: boolean; onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: highlight ? 'rgba(200,168,75,0.1)' : 'rgba(255,255,255,0.04)',
        borderRadius: 8, padding: '8px 10px',
        cursor: onClick ? 'pointer' : 'default',
        border: `1px solid ${highlight ? 'rgba(200,168,75,0.35)' : 'transparent'}`,
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => { if (onClick) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--gold)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = highlight ? 'rgba(200,168,75,0.35)' : 'transparent' }}
    >
      <div style={{ fontSize: 11, color: highlight ? 'var(--gold-light)' : 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 3 }}>
        {label}{onClick && <InfoIcon size={11} style={{ color: 'var(--gold)' }} />}
      </div>
      <div style={{
        fontSize: 17, fontWeight: 700, margin: '2px 0',
        color: highlight ? 'var(--gold-light)' : 'var(--text)',
      }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>{sub}</div>
    </div>
  )
}
