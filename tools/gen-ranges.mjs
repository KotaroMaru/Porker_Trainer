#!/usr/bin/env node
// GTO近似プリフロップレンジの生成スクリプト。
//
// 方針: 169ハンドをChenフォーミュラ(公知・決定論的なハンド強度指標, Chen 1996)で
// 順位付けし、各シナリオについて「上位が純粋にアクション(freq=1)、境界で頻度が
// 線形にテーパーして0へ」という、実際のソルバー出力に典型的な形状でレンジを構築する。
// 各シナリオの目標パーセンテージ(オープン%・BBディフェンス%・コールドコール%等)は
// 公開されているGTOチャート・ソルバー要約記事の集計値に較正している(下記コメント参照)。
// これは「厳密なソルバー出力」ではなく「GTO近似」であり、P3で本物のRust製ソルバー
// 事前計算に置き換わるまでの実用的な近似データとして位置づける。
//
// 実行: node tools/gen-ranges.mjs
// 出力: tools/solver/ranges/*.json (シナリオごとの原本)
//       src/gto/data/preflopRanges.json (アプリが読み込む単一バンドル)

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RANGES_DIR = join(ROOT, 'tools/solver/ranges')
const BUNDLE_PATH = join(ROOT, 'src/gto/data/preflopRanges.json')

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const RANK_VALUE = { A: 14, K: 13, Q: 12, J: 11, T: 10, 9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 4: 4, 3: 3, 2: 2 }

function comboCount(handStr) {
  if (handStr.length === 2) return 6 // pair
  return handStr.endsWith('s') ? 4 : 12
}

// ---- Chenフォーミュラ(1996, David Sklansky/Chen) ----
// 高い方のカード点 + (ペア倍化 or スーテッド+2) - ギャップ減点 + ストレートボーナス、0.5刻みで切り上げ。
function chenHighCardPoints(v) {
  if (v === 14) return 10
  if (v === 13) return 8
  if (v === 12) return 7
  if (v === 11) return 6
  return v / 2 // T=5, 9=4.5, ..., 2=1
}

function chenScore(rHi, rLo, suited) {
  const vHi = RANK_VALUE[rHi]
  const vLo = RANK_VALUE[rLo]
  if (vHi === vLo) {
    return Math.max(5, chenHighCardPoints(vHi) * 2)
  }
  let pts = chenHighCardPoints(vHi)
  if (suited) pts += 2
  const gap = vHi - vLo - 1
  if (gap === 1) pts -= 1
  else if (gap === 2) pts -= 2
  else if (gap === 3) pts -= 4
  else if (gap >= 4) pts -= 5
  // ストレートボーナス: ギャップ0-1かつ両方Qより下ならプラス1
  if (gap <= 1 && vHi < 12) pts += 1
  return Math.ceil(pts * 2) / 2
}

// 169ハンドをChenスコア降順(同点はより強いキッカー順)にランク付け
function buildHandRanking() {
  const hands = []
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      if (i === j) {
        hands.push({ str: `${RANKS[i]}${RANKS[j]}`, score: chenScore(RANKS[i], RANKS[j], false), hi: RANK_VALUE[RANKS[i]], lo: RANK_VALUE[RANKS[i]] })
      } else if (i < j) {
        hands.push({ str: `${RANKS[i]}${RANKS[j]}s`, score: chenScore(RANKS[i], RANKS[j], true), hi: RANK_VALUE[RANKS[i]], lo: RANK_VALUE[RANKS[j]] })
      } else {
        hands.push({ str: `${RANKS[j]}${RANKS[i]}o`, score: chenScore(RANKS[j], RANKS[i], false), hi: RANK_VALUE[RANKS[j]], lo: RANK_VALUE[RANKS[i]] })
      }
    }
  }
  hands.sort((a, b) => b.score - a.score || b.hi - a.hi || b.lo - a.lo)
  return hands.map((h) => h.str)
}

const FULL_RANKING = buildHandRanking()

/**
 * rankedHands中の指定範囲(コンボ数ベース)に、pure→mixed(線形テーパー)の頻度を割り当てる。
 * skipCombos: 上位から何コンボ分をスキップしてから割り当てを開始するか(3betに回す等の除外用)。
 * pureCombos: 頻度1.0を割り当てるコンボ数。mixedCombos: その後、1→0へ線形にテーパーするコンボ数。
 */
function assignTier(rankedHands, skipCombos, pureCombos, mixedCombos) {
  const freqs = {}
  let cum = 0
  const pureEnd = skipCombos + pureCombos
  const mixedEnd = pureEnd + mixedCombos
  for (const h of rankedHands) {
    const c = comboCount(h)
    const startCum = cum
    const endCum = cum + c
    const midCum = (startCum + endCum) / 2
    cum = endCum
    if (midCum < skipCombos) continue
    if (midCum <= pureEnd) {
      freqs[h] = 1
    } else if (midCum <= mixedEnd) {
      const t = (midCum - pureEnd) / (mixedEnd - pureEnd)
      const freq = Math.round(Math.max(0, 1 - t) * 100) / 100
      if (freq > 0.02) freqs[h] = freq
    }
  }
  return freqs
}

/** 全169ハンドから、percentOfTotal(0..1)に相当するコンボ数を頻度1→0のテーパーで構築 */
function buildRangeByPercent(rankedHands, percentOfTotal, mixedFraction = 0.18, skipPercent = 0) {
  const totalCombos = rankedHands.reduce((s, h) => s + comboCount(h), 0)
  const skipCombos = skipPercent * totalCombos
  const targetCombos = percentOfTotal * totalCombos
  const mixedCombos = targetCombos * mixedFraction
  const pureCombos = targetCombos - mixedCombos
  return assignTier(rankedHands, skipCombos, pureCombos, mixedCombos)
}

/** freqRange中で頻度>0のハンドだけを、元のFULL_RANKING順序を保って抽出 */
function rankedHandsWithinRange(freqRange) {
  return FULL_RANKING.filter((h) => (freqRange[h] ?? 0) > 0)
}

// ============================================================
// RFI(オープン)レンジ 5種
// 較正元: pokercoaching.com等の公開GTOチャート集計(6-max 100bb)
//   UTG 17.6% / HJ 21.4% / CO 27.8% / BTN 43.5%
//   SB: 「オープンorコール62.3%」はリンプ込みの数値のため、
//   本トレーナーはリンプなし(レイズ/フォールドのみ)を採用しSB単独のレイズ比率として38%に較正。
// ============================================================
const RFI = {
  rfi_utg: buildRangeByPercent(FULL_RANKING, 0.176),
  rfi_hj: buildRangeByPercent(FULL_RANKING, 0.214),
  rfi_co: buildRangeByPercent(FULL_RANKING, 0.278),
  rfi_btn: buildRangeByPercent(FULL_RANKING, 0.435),
  rfi_sb: buildRangeByPercent(FULL_RANKING, 0.38),
}

// ============================================================
// BB vs オープン: コール/3ベット 10種(5オープン×2アクション)
// 較正元: 公開ソルバー要約記事(GTO Wizardブログ等)の傾向
//   - オープンが後ろのポジションほどBBの継続率(コール+3ベット)は上がる
//   - 3ベット比率もオープナーが後ろになるほど上がる(オープナーのレンジが広く弱いため)
//   総継続率: vsUTG 24% / vsHJ 30% / vsCO 38% / vsBTN 52% / vsSB 58%
//   うち3ベット: vsUTG 4% / vsHJ 5% / vsCO 7% / vsBTN 9% / vsSB 12%
// ============================================================
function buildBbVsOpen(totalPct, threebetPct) {
  const callPct = totalPct - threebetPct
  // 3ベットは最上位(最強)コンボから、コールはその次の層から
  const threebet = buildRangeByPercent(FULL_RANKING, threebetPct, 0.25)
  const call = buildRangeByPercent(FULL_RANKING, callPct, 0.2, threebetPct * 0.85)
  return { call, threebet }
}

const bbVsUtg = buildBbVsOpen(0.24, 0.04)
const bbVsHj = buildBbVsOpen(0.30, 0.05)
const bbVsCo = buildBbVsOpen(0.38, 0.07)
const bbVsBtn = buildBbVsOpen(0.52, 0.09)
const bbVsSb = buildBbVsOpen(0.58, 0.12)

// ============================================================
// IPコールドコール 6種
// 較正元: 「ノーレイクならHU100bbコールドコールは標準的なフロート戦略として妥当な広さになる」
// (本プロジェクトはレーキなし設定のため、ソルバー要約が言及する「レイクありだと稀」より広めに設定)
// 後ろのポジションほど(スクイーズを受けにくいため)広くコール。
// 最上位コンボは3ベットに回るためスキップし、中間層をコールドコール域とする。
// ============================================================
function buildColdCall(percentOfTotal, skipPercent) {
  return buildRangeByPercent(FULL_RANKING, percentOfTotal, 0.3, skipPercent)
}

const COLD_CALL = {
  cc_hj_vs_utg: buildColdCall(0.08, 0.02),
  cc_co_vs_utg: buildColdCall(0.10, 0.02),
  cc_btn_vs_utg: buildColdCall(0.14, 0.02),
  cc_co_vs_hj: buildColdCall(0.11, 0.02),
  cc_btn_vs_hj: buildColdCall(0.16, 0.02),
  cc_btn_vs_co: buildColdCall(0.19, 0.015),
}

// ============================================================
// 3ベッター側レンジ 6種(うちBTNvsBB3betは上のbbVsBtn.threebetを再利用)
// 較正元: オープナーのポジション/レンジの広さに応じて3ベット側の広さも変化する一般傾向
// ============================================================
const THREEBET = {
  threebet_btn_vs_co: buildRangeByPercent(FULL_RANKING, 0.10, 0.25),
  threebet_sb_vs_btn: buildRangeByPercent(FULL_RANKING, 0.12, 0.25),
  threebet_co_vs_hj: buildRangeByPercent(FULL_RANKING, 0.09, 0.25),
  threebet_btn_vs_hj: buildRangeByPercent(FULL_RANKING, 0.11, 0.25),
  threebet_btn_vs_utg: buildRangeByPercent(FULL_RANKING, 0.07, 0.25),
}

// ============================================================
// オープナー側 vs 3ベット: コール/4ベット 12種(6ペア×2アクション)
// オープナー自身のレンジ(RFI)の部分集合として構築するのが正しい
// (オープンしていない手でコール/4ベットは起こり得ない)。
// 較正元: 一般的な「オープナーのコンティニュー率30-45%、4ベット5-10%」の目安
// ============================================================
function buildDefendVs3bet(rfiRange, callPctOfOwnRange, fourbetPctOfOwnRange) {
  const subset = rankedHandsWithinRange(rfiRange)
  const totalCombos = subset.reduce((s, h) => s + comboCount(h), 0)
  const fourbetCombos = fourbetPctOfOwnRange * totalCombos
  const callCombos = callPctOfOwnRange * totalCombos
  const fourbet = assignTier(subset, 0, fourbetCombos * 0.8, fourbetCombos * 0.2)
  const call = assignTier(subset, fourbetCombos * 0.7, callCombos * 0.85, callCombos * 0.15)
  return { call, fourbet }
}

const defendCoVsBtn3bet = buildDefendVs3bet(RFI.rfi_co, 0.34, 0.06)
const defendBtnVsSb3bet = buildDefendVs3bet(RFI.rfi_btn, 0.36, 0.07)
const defendBtnVsBb3bet = buildDefendVs3bet(RFI.rfi_btn, 0.38, 0.07)
const defendHjVsCo3bet = buildDefendVs3bet(RFI.rfi_hj, 0.30, 0.05)
const defendHjVsBtn3bet = buildDefendVs3bet(RFI.rfi_hj, 0.32, 0.05)
const defendUtgVsBtn3bet = buildDefendVs3bet(RFI.rfi_utg, 0.30, 0.05)

// ============================================================
// バンドル組み立て
// ============================================================
const ALL_RANGES = {
  ...RFI,
  bb_call_vs_utg: bbVsUtg.call,
  bb_3bet_vs_utg: bbVsUtg.threebet,
  bb_call_vs_hj: bbVsHj.call,
  bb_3bet_vs_hj: bbVsHj.threebet,
  bb_call_vs_co: bbVsCo.call,
  bb_3bet_vs_co: bbVsCo.threebet,
  bb_call_vs_btn: bbVsBtn.call,
  bb_3bet_vs_btn: bbVsBtn.threebet,
  bb_call_vs_sb: bbVsSb.call,
  bb_3bet_vs_sb: bbVsSb.threebet,
  ...COLD_CALL,
  ...THREEBET,
  defend_call_co_vs_btn3bet: defendCoVsBtn3bet.call,
  defend_4bet_co_vs_btn3bet: defendCoVsBtn3bet.fourbet,
  defend_call_btn_vs_sb3bet: defendBtnVsSb3bet.call,
  defend_4bet_btn_vs_sb3bet: defendBtnVsSb3bet.fourbet,
  defend_call_btn_vs_bb3bet: defendBtnVsBb3bet.call,
  defend_4bet_btn_vs_bb3bet: defendBtnVsBb3bet.fourbet,
  defend_call_hj_vs_co3bet: defendHjVsCo3bet.call,
  defend_4bet_hj_vs_co3bet: defendHjVsCo3bet.fourbet,
  defend_call_hj_vs_btn3bet: defendHjVsBtn3bet.call,
  defend_4bet_hj_vs_btn3bet: defendHjVsBtn3bet.fourbet,
  defend_call_utg_vs_btn3bet: defendUtgVsBtn3bet.call,
  defend_4bet_utg_vs_btn3bet: defendUtgVsBtn3bet.fourbet,
}

mkdirSync(RANGES_DIR, { recursive: true })
for (const [id, range] of Object.entries(ALL_RANGES)) {
  writeFileSync(join(RANGES_DIR, `${id}.json`), JSON.stringify(range, null, 2) + '\n')
}
writeFileSync(BUNDLE_PATH, JSON.stringify(ALL_RANGES, null, 2) + '\n')

const totalCombos1326 = FULL_RANKING.reduce((s, h) => s + comboCount(h), 0)
function pctOf(range) {
  const c = Object.entries(range).reduce((s, [h, f]) => s + comboCount(h) * f, 0)
  return Math.round((c / totalCombos1326) * 1000) / 10
}

console.log(`生成完了: ${Object.keys(ALL_RANGES).length}レンジ → ${RANGES_DIR} と ${BUNDLE_PATH}`)
console.log('---- 検算(VPIP%相当) ----')
for (const [id, range] of Object.entries(ALL_RANGES)) {
  console.log(`${id.padEnd(28)} ${pctOf(range)}%`)
}
