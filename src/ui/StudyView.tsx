import { useState } from 'react'
import type { ComponentType } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RangeGrid } from './RangeGrid'
import { YokosawaRangeGrid } from './YokosawaRangeGrid'
import { CardView } from './CardView'
import { POSITION_INFO, GLOSSARY } from './glossary'
import { BulbIcon, BrickIcon, RockIcon, FireIcon, CapIcon, FishIcon, WarningIcon } from './icons'
import { TIER_INFO, TIER_DISPLAY_ORDER } from '../advisor/yokosawa'
import type { Position, Card, Rank, Suit } from '../engine/types'

const POSITIONS: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB']

function c(rank: Rank, suit: Suit): Card { return { rank, suit } }

// ---- Section definitions ----
const SECTIONS = [
  { id: 'hands', label: '役の強さ' },
  { id: 'positions', label: 'ポジション' },
  { id: 'ranges', label: 'レンジ表' },
  { id: 'outs', label: 'アウツと4-2' },
  { id: 'potodds', label: 'ポットオッズ' },
  { id: 'opponents', label: '相手タイプ' },
  { id: 'glossary', label: '用語集' },
  { id: 'yokosawa_range', label: 'ヨコサワレンジ表' },
  { id: 'yokosawa_model', label: 'ヨコサワモデル解説' },
  { id: 'mistakes', label: 'ミスプレイ解説' },
] as const

type SectionId = typeof SECTIONS[number]['id']

const HAND_RANKINGS: { name: string; en: string; desc: string; cards: Card[] }[] = [
  { name: 'ロイヤルフラッシュ', en: 'Royal Flush', desc: '同じスートのA-K-Q-J-10。最強の役', cards: [c(14,'s'),c(13,'s'),c(12,'s'),c(11,'s'),c(10,'s')] },
  { name: 'ストレートフラッシュ', en: 'Straight Flush', desc: '同じスートの連続した5枚', cards: [c(9,'h'),c(8,'h'),c(7,'h'),c(6,'h'),c(5,'h')] },
  { name: 'フォーカード', en: 'Four of a Kind', desc: '同じランク4枚', cards: [c(12,'s'),c(12,'h'),c(12,'d'),c(12,'c'),c(7,'s')] },
  { name: 'フルハウス', en: 'Full House', desc: 'スリーカード + ワンペア', cards: [c(11,'s'),c(11,'h'),c(11,'d'),c(8,'c'),c(8,'s')] },
  { name: 'フラッシュ', en: 'Flush', desc: '同じスート5枚(連続でなくてよい)', cards: [c(14,'d'),c(11,'d'),c(8,'d'),c(6,'d'),c(3,'d')] },
  { name: 'ストレート', en: 'Straight', desc: '連続した5枚(スートはバラバラでよい)', cards: [c(8,'s'),c(7,'h'),c(6,'d'),c(5,'c'),c(4,'s')] },
  { name: 'スリーカード', en: 'Three of a Kind', desc: '同じランク3枚', cards: [c(7,'s'),c(7,'h'),c(7,'d'),c(13,'c'),c(2,'s')] },
  { name: 'ツーペア', en: 'Two Pair', desc: 'ペアが2組', cards: [c(14,'s'),c(14,'h'),c(9,'d'),c(9,'c'),c(5,'s')] },
  { name: 'ワンペア', en: 'One Pair', desc: '同じランク2枚', cards: [c(13,'s'),c(13,'h'),c(11,'d'),c(7,'c'),c(3,'s')] },
  { name: 'ハイカード', en: 'High Card', desc: '役なし。一番強いカードで勝負', cards: [c(14,'s'),c(12,'h'),c(9,'d'),c(6,'c'),c(2,'s')] },
]

const OUTS_TABLE = [
  { type: 'フラッシュドロー', outs: 9, flop: 36, turn: 18, example: '♥4枚持ち → 残り♥9枚' },
  { type: 'OESD (両面ストレート)', outs: 8, flop: 32, turn: 16, example: '5678 → 4か9で完成' },
  { type: 'フラッシュ+ガットショット', outs: 12, flop: 48, turn: 24, example: '2つのドローの複合' },
  { type: 'ガットショット', outs: 4, flop: 16, turn: 8, example: '5689 → 7のみで完成' },
  { type: 'オーバーカード×2', outs: 6, flop: 24, turn: 12, example: 'AK vs 小さいペア → AかK計6枚' },
  { type: 'セット→フルハウス等', outs: 7, flop: 28, turn: 14, example: 'ボードペア化など' },
  { type: 'ツーペア→フルハウス', outs: 4, flop: 16, turn: 8, example: 'どちらかが3枚目を引く' },
]

const OPPONENTS: { name: string; type: string; Icon: ComponentType<{ size?: number }>; trait: string; spot: string; tactics: string }[] = [
  { name: 'Station さん', type: 'コーリングステーション', Icon: BrickIcon,
    trait: 'なんでもコールする。降りない。',
    spot: 'プリフロップでほぼ毎回コール、どんなボードでもついてくる人。',
    tactics: 'ブラフ禁止(降りないから)。普通なら見送る中くらいの手でも厚くバリューベット。' },
  { name: 'Rock さん', type: 'タイトパッシブ', Icon: RockIcon,
    trait: '滅多に参加しない。レイズ=超強い手。',
    spot: '1時間に数回しか参加せず、参加時は無言で静かな人。',
    tactics: 'この人のレイズには素直に降りる。逆にブラインドは積極的に盗む。ブラフが一番通る相手。' },
  { name: 'Maniac さん', type: 'マニアック', Icon: FireIcon,
    trait: 'なんでもレイズ。圧力をかけまくる。',
    spot: '毎ハンドのようにレイズし、チップを荒く積む人。',
    tactics: '強い手で受け止めてコールダウン。自分からブラフは打たない。振り回されず淡々と。' },
  { name: 'Reg さん', type: 'レギュラー (TAG)', Icon: CapIcon,
    trait: '教科書どおりの堅実なプレイ。',
    spot: 'ポジションを意識し、適切なサイズでベットする上手い人。',
    tactics: '無理に絡まない。こちらも基本に忠実に。ブラフとバリューのバランスで対抗。' },
  { name: 'Fishy さん', type: 'ルースパッシブ', Icon: FishIcon,
    trait: '広く参加してコール多め。たまに変なレイズ。',
    spot: 'いろんな手で参加するが、攻めは弱い人。',
    tactics: 'バリューベット多め、ブラフ控えめ。突然のレイズは本物のことが多いので注意。' },
]

export function StudyView() {
  const [section, setSection] = useState<SectionId>('hands')
  const [rangePos, setRangePos] = useState<Position>('BTN')

  return (
    <div style={{ padding: '16px 24px', maxWidth: 980, margin: '0 auto' }}>
      {/* Section nav */}
      <div style={{
        display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap',
        position: 'sticky', top: 0, zIndex: 5,
        background: 'var(--bg)', padding: '8px 0',
      }}>
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            style={{
              background: section === s.id ? 'var(--gold)' : 'var(--panel-bg)',
              color: section === s.id ? '#1a2a1a' : 'var(--text-muted)',
              border: `1px solid ${section === s.id ? 'var(--gold)' : 'var(--panel-border)'}`,
              padding: '7px 16px', borderRadius: 8, fontSize: 14,
              fontWeight: section === s.id ? 700 : 500,
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={section}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {section === 'hands' && <HandsSection />}
          {section === 'positions' && <PositionsSection />}
          {section === 'ranges' && <RangesSection pos={rangePos} setPos={setRangePos} />}
          {section === 'outs' && <OutsSection />}
          {section === 'potodds' && <PotOddsSection />}
          {section === 'opponents' && <OpponentsSection />}
          {section === 'glossary' && <GlossarySection />}
          {section === 'yokosawa_range' && <YokosawaRangeSection />}
          {section === 'yokosawa_model' && <YokosawaModelSection />}
          {section === 'mistakes' && <MistakesSection />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function Intro({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: 14, lineHeight: 1.8, color: 'var(--text-muted)',
      background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '12px 16px',
      borderLeft: '3px solid var(--gold)', marginBottom: 20,
    }}>
      {children}
    </p>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ color: 'var(--gold)', fontSize: 19, marginBottom: 12 }}>{children}</h2>
}

// ---- 1. Hand rankings ----
function HandsSection() {
  return (
    <section>
      <SectionTitle>役の強さ一覧</SectionTitle>
      <Intro>
        ポーカーの役を強い順に並べました。手札2枚+共通カード5枚の計7枚から、
        最強の5枚の組み合わせが自動的にあなたの役になります。まずはこの順番を体で覚えましょう。
      </Intro>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {HAND_RANKINGS.map((h, i) => (
          <div key={h.en} style={{
            display: 'flex', alignItems: 'center', gap: 16,
            background: 'var(--panel-bg)', borderRadius: 10, padding: '10px 16px',
            border: '1px solid var(--panel-border)',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: i < 4 ? 'var(--gold)' : 'var(--green-mid)',
              color: i < 4 ? '#1a2a1a' : 'var(--text)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 14,
            }}>
              {i + 1}
            </div>
            <div style={{ width: 190, flexShrink: 0 }}>
              <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: 15 }}>{h.name}</div>
              <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>{h.en}</div>
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {h.cards.map((card, j) => <CardView key={j} card={card} size="sm" />)}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>{h.desc}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ---- 2. Positions ----
const TABLE_SEATS: { pos: Position; x: number; y: number }[] = [
  { pos: 'BTN', x: 50, y: 86 },
  { pos: 'SB',  x: 15, y: 68 },
  { pos: 'BB',  x: 12, y: 28 },
  { pos: 'UTG', x: 50, y: 12 },
  { pos: 'HJ',  x: 88, y: 28 },
  { pos: 'CO',  x: 85, y: 68 },
]

const POS_RANK: Record<Position, { rank: string; color: string }> = {
  BTN:    { rank: '最有利', color: 'var(--gold)' },
  CO:     { rank: '有利',   color: 'var(--gold-light)' },
  HJ:     { rank: '普通',   color: 'var(--green-light)' },
  UTG:    { rank: '不利',   color: 'var(--text-muted)' },
  'UTG+1':{ rank: '不利',   color: 'var(--text-muted)' },
  MP:     { rank: '普通',   color: 'var(--green-light)' },
  SB:     { rank: '不利',   color: 'var(--text-muted)' },
  BB:     { rank: '特殊',   color: 'var(--text-muted)' },
}

function PositionsSection() {
  return (
    <section>
      <SectionTitle>ポジション(席の役割)</SectionTitle>
      <Intro>
        ポーカーでは「どの席に座っているか」が手の強さと同じくらい重要です。
        後から行動できる席ほど相手の出方を見てから決められるので有利。
        ボタン(BTN)が毎ハンド時計回りに移動するので、全員が順番に各ポジションを経験します。
      </Intro>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Mini table diagram */}
        <div style={{
          position: 'relative', width: 'min(360px, 100%)', height: 250, flexShrink: 0,
          margin: '10px 0',
        }}>
          <div style={{
            position: 'absolute', left: '12%', right: '12%', top: '14%', bottom: '14%',
            background: 'var(--green-felt)', borderRadius: '50%',
            border: '5px solid #14301f',
          }} />
          <div style={{
            position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
            color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center', lineHeight: 1.5,
          }}>
            行動順 ↻<br />(時計回り)
          </div>
          {TABLE_SEATS.map(seat => (
            <div key={seat.pos} style={{
              position: 'absolute', left: `${seat.x}%`, top: `${seat.y}%`,
              transform: 'translate(-50%,-50%)', textAlign: 'center',
            }}>
              <div style={{
                background: seat.pos === 'BTN' ? 'var(--gold)' : 'var(--panel-bg)',
                color: seat.pos === 'BTN' ? '#1a2a1a' : 'var(--text)',
                border: '1px solid var(--panel-border)',
                borderRadius: 6, padding: '3px 10px', fontSize: 13, fontWeight: 700,
              }}>
                {seat.pos}
              </div>
              <div style={{ fontSize: 10, color: POS_RANK[seat.pos].color, marginTop: 2, fontWeight: 600 }}>
                {POS_RANK[seat.pos].rank}
              </div>
            </div>
          ))}
        </div>

        {/* Position descriptions */}
        <div style={{ flex: 1, minWidth: 300, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(['UTG','HJ','CO','BTN','SB','BB'] as Position[]).map(p => {
            const info = POSITION_INFO[p]
            return (
              <div key={p} style={{
                background: 'var(--panel-bg)', borderRadius: 8, padding: '9px 14px',
                border: '1px solid var(--panel-border)', fontSize: 13, lineHeight: 1.6,
              }}>
                <strong style={{ color: 'var(--gold-light)' }}>{p}</strong>
                <span style={{ color: 'var(--text)', marginLeft: 6, fontWeight: 600 }}>{info.nameJa}</span>
                <span style={{ color: POS_RANK[p].color, marginLeft: 8, fontSize: 11, fontWeight: 700 }}>[{POS_RANK[p].rank}]</span>
                <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{info.description}</div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ---- 3. Ranges ----
function RangesSection({ pos, setPos }: { pos: Position; setPos: (p: Position) => void }) {
  return (
    <section>
      <SectionTitle>ポジション別オープンレンジ表</SectionTitle>
      <Intro>
        「レンジ表」は、各ポジションから<strong style={{ color: 'var(--text)' }}>最初のレイズ(オープン)で参加してよい手</strong>の一覧です。
        左上から右下への対角線がペア、対角線の右上がスーテッド(s)、左下がオフスート(o)。
        後ろのポジション(BTNに近い)ほど緑のマスが多い=広い手で参加できることを確認してみてください。
      </Intro>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {POSITIONS.map(p => (
          <button
            key={p}
            onClick={() => setPos(p)}
            style={{
              background: pos === p ? 'var(--gold)' : 'var(--panel-bg)',
              color: pos === p ? '#1a2a1a' : 'var(--text-muted)',
              border: '1px solid var(--panel-border)',
              padding: '6px 16px', borderRadius: 6, fontSize: 14,
              fontWeight: pos === p ? 700 : 500,
            }}
          >
            {p}
          </button>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}><RangeGrid position={pos} cellSize={34} /></div>
      <p style={{ marginTop: 14, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
        <BulbIcon size={14} style={{ verticalAlign: '-2px' }} /> 読み方の例: 「ATs」= AとT(10)のスーテッド。BTNからは緑(オープンOK)だが、UTGからはフォールド。<br />
        BBはすでに₱50を払っているため「オープン」の概念がなく、相手のレイズに対する守り(コール/3ベット)が中心になります。
      </p>
    </section>
  )
}

// ---- 4. Outs ----
function OutsSection() {
  return (
    <section>
      <SectionTitle>アウツと4-2ルール</SectionTitle>
      <Intro>
        「アウツ」=自分の手を勝ち手に変えてくれる残りカードの枚数。
        アウツを数えて<strong style={{ color: 'var(--text)' }}>フロップなら×4、ターンなら×2</strong>すると、おおよその勝率(%)が暗算できます。
        これが実戦で最も使う計算です。
      </Intro>

      <div style={{ background: 'var(--panel-bg)', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--panel-border)', marginBottom: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--green-dark)', color: 'var(--gold-light)' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>ドローの種類</th>
              <th style={{ padding: '10px 14px', textAlign: 'center' }}>アウツ</th>
              <th style={{ padding: '10px 14px', textAlign: 'center' }}>フロップ (×4)</th>
              <th style={{ padding: '10px 14px', textAlign: 'center' }}>ターン (×2)</th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>例</th>
            </tr>
          </thead>
          <tbody>
            {OUTS_TABLE.map((row, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--panel-border)', color: 'var(--text)' }}>
                <td style={{ padding: '9px 14px' }}>{row.type}</td>
                <td style={{ padding: '9px 14px', textAlign: 'center', color: 'var(--gold)', fontWeight: 700 }}>{row.outs}</td>
                <td style={{ padding: '9px 14px', textAlign: 'center' }}>≈{row.flop}%</td>
                <td style={{ padding: '9px 14px', textAlign: 'center' }}>≈{row.turn}%</td>
                <td style={{ padding: '9px 14px', fontSize: 12, color: 'var(--text-muted)' }}>{row.example}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{
        background: 'rgba(0,0,0,0.25)', borderRadius: 10, padding: 16,
        fontSize: 14, lineHeight: 1.9, border: '1px solid var(--panel-border)',
      }}>
        <strong style={{ color: 'var(--gold)' }}>計算手順(フロップでフラッシュドローの例)</strong><br />
        ① 自分の♥2枚+ボードの♥2枚=4枚。フラッシュ完成にはあと1枚<br />
        ② ♥は全部で13枚 → 残り 13-4 = <strong style={{ color: 'var(--gold-light)' }}>9枚がアウツ</strong><br />
        ③ フロップ(あと2回めくる)なので 9 × 4 = <strong style={{ color: 'var(--gold-light)' }}>約36%</strong><br />
        ④ この36%と「必要勝率」(ポットオッズ)を比べて、上回っていればコール!
      </div>
    </section>
  )
}

// ---- 5. Pot odds ----
function PotOddsSection() {
  return (
    <section>
      <SectionTitle>ポットオッズ(必要勝率)</SectionTitle>
      <Intro>
        コールすべきか降りるべきかは「勘」ではなく割り算で決まります。
        必要なのはたった1つの式: <strong style={{ color: 'var(--text)' }}>必要勝率 = コール額 ÷ (ポット + コール額)</strong>。
        自分の勝率(4-2ルールの概算でOK)がこれを上回ればコールが得です。
      </Intro>

      {/* Visual example */}
      <div style={{
        background: 'var(--panel-bg)', borderRadius: 10, padding: 20,
        border: '1px solid var(--panel-border)', marginBottom: 16,
      }}>
        <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600, marginBottom: 14 }}>
          例: ポット₱200 に相手が ₱100 ベットしてきた
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 14, height: 38 }}>
          <div style={{ flex: 200, background: 'var(--green-mid)', height: '100%', borderRadius: '6px 0 0 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 600 }}>
            元のポット ₱200
          </div>
          <div style={{ flex: 100, background: 'var(--green-light)', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 600 }}>
            相手 ₱100
          </div>
          <div style={{ flex: 100, background: 'var(--gold)', color: '#1a2a1a', height: '100%', borderRadius: '0 6px 6px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 700 }}>
            あなた ₱100
          </div>
        </div>
        <div style={{ fontSize: 15, lineHeight: 2, color: 'var(--text)' }}>
          必要勝率 = <strong style={{ color: 'var(--gold)' }}>100</strong> ÷ (200 + 100 + <strong style={{ color: 'var(--gold)' }}>100</strong>) = <strong style={{ color: 'var(--gold-light)', fontSize: 18 }}>25%</strong>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.8, marginTop: 6 }}>
          → 勝率25%以上ならコールが得。フラッシュドロー(約36%)ならコール、
          ガットショットだけ(約16%)ならフォールド。
        </div>
      </div>

      <div style={{
        background: 'rgba(0,0,0,0.25)', borderRadius: 10, padding: 16,
        fontSize: 13.5, lineHeight: 1.9, border: '1px solid var(--panel-border)', color: 'var(--text-muted)',
      }}>
        <strong style={{ color: 'var(--gold)' }}>よく出る必要勝率(暗記推奨)</strong><br />
        相手のベットがポットの 1/2 → 必要勝率 <strong style={{ color: 'var(--text)' }}>25%</strong> /
        2/3ポット → <strong style={{ color: 'var(--text)' }}>28.5%</strong> /
        ポットと同額 → <strong style={{ color: 'var(--text)' }}>33%</strong>
      </div>
    </section>
  )
}

// ---- 6. Opponents ----
function OpponentsSection() {
  return (
    <section>
      <SectionTitle>相手タイプと対策</SectionTitle>
      <Intro>
        低レートのライブポーカーでは、相手の「型」を見抜いて戦い方を変えるだけで大きな差がつきます。
        このアプリのボット5体は、実際によくいるタイプを再現しています。
        ハンドに参加する頻度と、ベットへの反応を観察して見分けましょう。
      </Intro>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
        {OPPONENTS.map(o => (
          <div key={o.name} style={{
            background: 'var(--panel-bg)', borderRadius: 10, padding: 16,
            border: '1px solid var(--panel-border)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{
                color: 'var(--gold-light)', background: 'rgba(200,168,75,0.12)',
                borderRadius: 8, padding: 7, display: 'flex',
              }}>
                <o.Icon size={22} />
              </span>
              <div>
                <div style={{ color: 'var(--gold)', fontSize: 15, fontWeight: 700 }}>{o.name}</div>
                <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>{o.type}</div>
              </div>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text)', marginBottom: 6 }}>
              <strong style={{ color: 'var(--text-muted)' }}>特徴:</strong> {o.trait}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-muted)', marginBottom: 6 }}>
              <strong>見分け方:</strong> {o.spot}
            </div>
            <div style={{
              fontSize: 13, lineHeight: 1.7, color: 'var(--gold-light)',
              background: 'rgba(200,168,75,0.08)', borderRadius: 6, padding: '8px 10px',
            }}>
              <strong>対策:</strong> {o.tactics}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ---- 7. Glossary ----
function GlossarySection() {
  return (
    <section>
      <SectionTitle>用語集</SectionTitle>
      <Intro>
        プレイ中や判定パネルに出てくる用語の一覧です。分からない言葉が出てきたらここで確認しましょう。
      </Intro>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {GLOSSARY.map(g => (
          <div key={g.term} style={{
            background: 'var(--panel-bg)', borderRadius: 8, padding: '10px 16px',
            border: '1px solid var(--panel-border)',
            display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'baseline',
          }}>
            <div style={{ width: 170, flexShrink: 0 }}>
              <span style={{ color: 'var(--gold-light)', fontWeight: 700, fontSize: 14 }}>{g.term}</span>
              {g.reading && <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>{g.reading}</div>}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 13.5, lineHeight: 1.7 }}>{g.description}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ============================================================
// ヨコサワレンジ表セクション
// ============================================================
function YokosawaRangeSection() {
  return (
    <section>
      <SectionTitle>ヨコサワレンジ表</SectionTitle>
      <Intro>
        「世界のヨコサワ」オリジナルのハンドレンジ表です。手の強さを<strong>8色のティア（段階）</strong>で表し、
        ポジション（後ろの人数）に応じて参加・フォールドを判断します。
        まずこの表で自分の手が何色かを確認しましょう。
      </Intro>
      <div style={{ overflowX: 'auto' }}>
        <YokosawaRangeGrid cellSize={34} />
      </div>
      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SectionTitle>各ティアの意味</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
          {TIER_DISPLAY_ORDER.map(t => {
            const info = TIER_INFO[t]
            const behindLabel =
              t === 'navy' ? '常に参加(8人/強)' :
              t === 'red' ? '常に参加(8人/弱)' :
              t === 'yellow' ? '後ろ6〜7人以下で参加' :
              t === 'green' ? '後ろ4〜5人以下で参加' :
              t === 'lightblue' ? '後ろ3人以下で参加' :
              t === 'white' ? '後ろ2人以下で参加' :
              t === 'pink' ? '境界：BTNのレイズにBBだけコール可' :
              '参加しない（フォールド）'
            return (
              <div key={t} style={{
                background: 'var(--panel-bg)', borderRadius: 8, padding: '10px 14px',
                border: `2px solid ${info.color}`, display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 6, background: info.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: info.textColor, fontWeight: 700, fontSize: 14, flexShrink: 0,
                }}>{info.labelJa}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{behindLabel}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ============================================================
// ヨコサワモデル解説セクション
// ============================================================
function YokosawaModelSection() {
  const cards = [
    {
      title: 'RFI（オープンレイズ）',
      color: 'var(--green-light)',
      content: (
        <>
          後ろの人数がティアの基準以下ならレイズでオープン。基準を超えるポジションではフォールド。
          <br /><strong>例:</strong> 緑は後ろ4〜5人以下。6人卓のCO(後3)なら参加、UTG(後5)でも参加。HJは後ろ4人なので参加OK。
          <br />紺・赤は<strong>どのポジションでも常に参加</strong>（後ろ何人でもレイズ）。
        </>
      ),
    },
    {
      title: '対レイズ（3bet/コール/フォールド）',
      color: '#9fb0e8',
      content: (
        <>
          レイザーのポジションから「相手の想定ティア（そのポジションが開く最も弱い手）」を推定。
          自分のティアとの差で判断:
          <br />・<strong>2ランク以上強い</strong> → リレイズ（3bet）
          <br />・<strong>1ランク強い</strong> → コール
          <br />・<strong>同ランク</strong> → 通常フォールド（3bet以上ならコール可）
          <br />・<strong>弱い</strong> → フォールド
          <br />ただし<strong>紺・赤はフォールドしない</strong>（必ずコールかリレイズ）。
          再レイズが重なるほど想定ティアが+2ランク強くなる。
        </>
      ),
    },
    {
      title: 'BBディフェンス',
      color: 'var(--gold)',
      content: (
        <>
          BBが相手のレイズに直面した場合の基準:
          <br />・<strong>通常</strong>: 水色まではコールで参加
          <br />・<strong>COのレイズ</strong>: 白まで参加
          <br />・<strong>BTNのレイズ</strong>: 白＋境界13ハンド（ピンク枠の灰）まで参加
          <br />境界13ハンド: A6o, 98o, 54s, 64s, 75s, 86s, 96s, T7s, J6s, Q5s, Q4s, Q3s, Q2s
          <br />紺・赤は<strong>常にコール（またはリレイズ）</strong>。
        </>
      ),
    },
  ]

  return (
    <section>
      <SectionTitle>ヨコサワモデル解説</SectionTitle>
      <Intro>
        ヨコサワモデルは「後ろの人数」と「ティア（色）の比較」だけでプリフロップの判断を統一するシステムです。
        6〜8人テーブルどこでも正確に使えます。
      </Intro>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
        {cards.map(card => (
          <div key={card.title} style={{
            background: 'var(--panel-bg)', borderRadius: 10, padding: 16,
            border: `1px solid var(--panel-border)`,
            borderTop: `3px solid ${card.color}`,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: card.color, marginBottom: 10 }}>{card.title}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.8 }}>{card.content}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ============================================================
// ミスプレイ解説セクション
// ============================================================
const MISTAKE_CARDS = [
  {
    title: 'ドンクベット',
    icon: <WarningIcon size={18} />,
    color: '#e84393',
    what: '前のストリートのアグレッサー（ベット/レイズした相手）が控えているのに、相手のアクション前にこちらからベットすること。',
    why: '相手のレンジはあなたより強い傾向があり、強い手ならコールかリレイズ、弱い手ならフォールドされます。どちらに転んでもあなたに不利な「両方向プレッシャー」を受けます。',
    fix: '基本はチェックして相手のアクションを引き出し、それに対応する方が長期的に得です。強い手の場合も、チェックレイズで相手の弱いベットを誘う戦略が有効です。',
  },
  {
    title: '割に合わないコール（マイナスEV）',
    icon: <BulbIcon size={18} />,
    color: 'var(--red)',
    what: 'ポットオッズ（必要勝率）に対して、実際の勝率が大きく下回っているのにコールすること。',
    why: '長期的に見ると損失になる（マイナスEV）コールです。例：ポット100₱にコール50₱ → 必要勝率33%。自分の勝率が20%ならフォールドが正解。',
    fix: 'アウツを数え（フラッシュドロー=9枚、両面ストレート=8枚）、4-2ルールで勝率を計算。必要勝率と比較してからコール判断しましょう。',
  },
  {
    title: '利益のあるフォールド（プラスEVなのにフォールド）',
    icon: <BulbIcon size={18} />,
    color: 'var(--green-light)',
    what: 'コールが長期的に得（プラスEV）な場面なのに、誤ってフォールドしてしまうこと。',
    why: 'ポットが大きく、コール額が小さい場面では、弱い手でもコールが得なことがあります。例：ポット200₱にコール20₱ → 必要勝率9%。フラッシュドロー(36%)なら明らかにコールが得。',
    fix: 'ポットオッズを計算してからフォールドを判断。特に金額が小さいコールは「自動フォールド」せず、アウツと勝率を確認する習慣をつけましょう。',
  },
]

function MistakesSection() {
  return (
    <section>
      <SectionTitle>ミスプレイ解説</SectionTitle>
      <Intro>
        ポーカーでよくある3種類のミスを解説します。このアプリでは実際にこれらのミスをした時に判定パネルで警告が表示されます。
      </Intro>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {MISTAKE_CARDS.map(card => (
          <div key={card.title} style={{
            background: 'var(--panel-bg)', borderRadius: 10, padding: 18,
            border: '1px solid var(--panel-border)',
            borderLeft: `4px solid ${card.color}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ color: card.color }}>{card.icon}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: card.color }}>{card.title}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5, lineHeight: 1.75 }}>
              <div>
                <span style={{ fontWeight: 700, color: 'var(--text)' }}>【何が問題か】</span>
                <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{card.what}</span>
              </div>
              <div>
                <span style={{ fontWeight: 700, color: 'var(--text)' }}>【なぜ損するか】</span>
                <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{card.why}</span>
              </div>
              <div style={{
                background: 'rgba(58,153,96,0.1)', borderRadius: 8, padding: '10px 14px',
                border: '1px solid var(--green-mid)',
              }}>
                <span style={{ fontWeight: 700, color: 'var(--green-light)' }}>【改善策】</span>
                <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{card.fix}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
