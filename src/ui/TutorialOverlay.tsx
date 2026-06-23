import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { DetailOverlay } from './DetailOverlay'
import { BulbIcon, SpadeIcon } from './icons'

interface Props {
  open: boolean
  onClose: () => void
}

interface Step {
  title: string
  body: React.ReactNode
}

const G = ({ children }: { children: React.ReactNode }) =>
  <strong style={{ color: 'var(--gold)' }}>{children}</strong>

const STEPS: Step[] = [
  {
    title: 'ようこそ! — ゲームの流れ',
    body: (
      <>
        <p style={{ marginBottom: 10 }}>
          このアプリは、マニラのライブポーカー(₱25/50テキサスホールデム、6人テーブル)に向けた練習用トレーナーです。
          あなた+5体のクセのあるボットで実戦形式の練習をします。
        </p>
        <p style={{ marginBottom: 10 }}>1ハンドの流れ:</p>
        <ol style={{ paddingLeft: 22, lineHeight: 2 }}>
          <li><G>プリフロップ</G> — 手札2枚が配られ、参加するか降りるか決める</li>
          <li><G>フロップ</G> — 共通カード3枚が開く</li>
          <li><G>ターン</G> — 4枚目が開く</li>
          <li><G>リバー</G> — 5枚目が開く</li>
          <li><G>ショーダウン</G> — 残った人で勝負。手札2枚+共通5枚から最強の5枚で役を作る</li>
        </ol>
        <p style={{ marginTop: 10, fontSize: 13, color: 'var(--text-muted)' }}>
          各段階の間にベッティング(賭け)があります。SB(₱25)とBB(₱50)は強制ベットです。
        </p>
      </>
    ),
  },
  {
    title: 'テーブル画面の見方',
    body: (
      <>
        <ul style={{ paddingLeft: 22, lineHeight: 2.1 }}>
          <li><G>下中央</G> — あなたの席。手札2枚が表で見えます</li>
          <li><G>中央の数字</G> — ポット(これまで賭けられたチップの合計)</li>
          <li><G>中央のカード</G> — 共通カード(全員が使える)</li>
          <li><G>金色に光っている人</G> — いま行動する番のプレイヤー</li>
          <li><G>名前の上のバッジ</G> — その人の直近のアクション(コール、レイズなど)</li>
          <li><G>UTG / CO / BTN などの小さなタグ</G> — ポジション(席の役割)。マウスを乗せると説明が出ます</li>
        </ul>
        <p style={{ marginTop: 10, fontSize: 13, color: 'var(--text-muted)' }}>
          ポジションは超重要: BTN(ボタン)に近いほど後から行動でき有利。後ろの席ほど広い手で参加できます。
        </p>
      </>
    ),
  },
  {
    title: 'アクションの選び方',
    body: (
      <>
        <ul style={{ paddingLeft: 22, lineHeight: 2.1 }}>
          <li><G>フォールド</G> — 降りる。それまで賭けたチップは戻りません</li>
          <li><G>チェック</G> — 賭けずにパス(誰もベットしていないときだけ可能)</li>
          <li><G>コール</G> — 相手のベットと同額を支払って続行</li>
          <li><G>ベット / レイズ</G> — 自分から賭ける / 相手のベットをさらに上乗せ</li>
          <li><G>オールイン</G> — 持っているチップ全部を賭ける</li>
        </ul>
        <p style={{ marginTop: 10 }}>
          レイズ額は <G>1/3・1/2・2/3・ポット</G> のボタンか、<G>±ボタン</G>(₱50刻み)で調整します。
          「ポットの半分」のように、ポットに対する比率で考えるクセをつけましょう。
        </p>
      </>
    ),
  },
  {
    title: '判定パネルの見方(重要!)',
    body: (
      <>
        <p style={{ marginBottom: 10 }}>
          アクションを選ぶと、右側の判定パネルに「正解」と3つの数字が表示されます:
        </p>
        <ul style={{ paddingLeft: 22, lineHeight: 2.1 }}>
          <li><G>あなたの読み</G> — 実戦でテーブルで見積もれる勝率。ドローはアウツ×4(フロップ)/×2(ターン)、完成手は手の強さから読む。<strong>推奨アクションはこの値をもとに出しています</strong></li>
          <li><G>実際の勝率</G> — 厳密に計算した「答え」。実戦では見えない値で、答え合わせ用</li>
          <li><G>必要勝率</G> — コール額÷(ポット+コール額)。あなたの読みがこれを上回ればコールが得</li>
        </ul>
        <p style={{ marginTop: 10 }}>
          下の<G>判定</G>は、推奨アクションに連動して「コールは割に合う/合わない」などを表示します。
          そして<strong>「あなたの読み」と「実際の勝率」がズレてコール/フォールドの結論が変わる局面では警告</strong>が出ます ── ここが一番の学びどころです。
        </p>
        <div style={{ marginTop: 10, background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 12, fontSize: 13 }}>
          例: ポット₱300に₱100のコール → 必要勝率 100÷400 = 25%。<br />
          フラッシュドロー(アウツ9枚)はフロップで 9×4 ≈ 36% &gt; 25% → コールが得!
        </div>
      </>
    ),
  },
  {
    title: 'ヒントと見積もりモード',
    body: (
      <>
        <p style={{ marginBottom: 10 }}>
          このアプリの学習方法は<G>アクティブリコール</G>(先に自分で考えてから答え合わせ)です。
        </p>
        <ul style={{ paddingLeft: 22, lineHeight: 2.1 }}>
          <li><G><BulbIcon size={14} style={{ verticalAlign: '-2px' }} /> ヒントボタン</G> — 行動する前に推奨を見たいときに。使用回数が記録されるので、徐々に頼らず判断できるようになるのが目標</li>
          <li><G>見積もりモード</G>(ヘッダーのトグル) — ベットに直面したとき、まず自分の勝率を5択で見積もってから行動するモード。見積もりの精度が採点され、勝率感覚が鍛えられます</li>
        </ul>
        <p style={{ marginTop: 10, fontSize: 13, color: 'var(--text-muted)' }}>
          慣れてきたら見積もりモードをONにして、4-2ルールの暗算を実戦の速度で回す練習をしましょう。
        </p>
      </>
    ),
  },
  {
    title: 'その他のタブ',
    body: (
      <>
        <ul style={{ paddingLeft: 22, lineHeight: 2.1 }}>
          <li><G>履歴</G> — 過去のハンドの自分の選択と推奨の一致/不一致を復習。「不一致のみ」フィルタで弱点を集中チェック。JSONでエクスポート/インポートも可能</li>
          <li><G>統計</G> — 推奨一致率、収支(BB)、ヒント使用率などのセッション成績</li>
          <li><G>学習資料</G> — 役の強さ、ポジション、レンジ表、アウツ早見表、相手タイプ対策、用語集</li>
        </ul>
        <p style={{ marginTop: 12 }}>
          まずは1ハンドプレイしてみましょう。分からない言葉が出てきたら、
          学習資料タブの<G>用語集</G>か、この説明(ヘッダーの「?」ボタン)にいつでも戻れます。
        </p>
        <p style={{ marginTop: 10, color: 'var(--gold-light)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <SpadeIcon size={16} /> Good luck at the tables!
        </p>
      </>
    ),
  },
]

export function TutorialOverlay({ open, onClose }: Props) {
  const [step, setStep] = useState(0)
  const isLast = step === STEPS.length - 1

  function close() {
    onClose()
    setStep(0)
  }

  return (
    <DetailOverlay open={open} title={`使い方 ${step + 1}/${STEPS.length} — ${STEPS[step].title}`} onClose={close} maxWidth={620}>
      <div style={{ minHeight: 300 }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.2 }}
          >
            {STEPS[step].body}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer nav */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--panel-border)',
      }}>
        <button
          onClick={() => setStep(s => Math.max(0, s - 1))}
          disabled={step === 0}
          style={{ background: 'var(--panel-bg-light)', color: 'var(--text)', padding: '8px 18px', fontSize: 14, border: '1px solid var(--panel-border)' }}
        >
          ← 前へ
        </button>

        <div style={{ display: 'flex', gap: 6 }}>
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              style={{
                width: 9, height: 9, borderRadius: '50%', padding: 0,
                background: i === step ? 'var(--gold)' : 'var(--panel-border)',
              }}
              aria-label={`ステップ ${i + 1}`}
            />
          ))}
        </div>

        <button
          onClick={() => isLast ? close() : setStep(s => s + 1)}
          style={{
            background: 'linear-gradient(180deg, var(--gold-light), var(--gold))',
            color: '#1a2a1a', padding: '8px 18px', fontSize: 14, fontWeight: 700,
          }}
        >
          {isLast ? '始める!' : '次へ →'}
        </button>
      </div>
    </DetailOverlay>
  )
}
