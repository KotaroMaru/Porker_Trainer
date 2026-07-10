/// <reference types="node" />
// tsconfig.app.jsonは"node"型を含まない(srcはブラウザ向けlib構成)ため、
// node:fsを使うにはこのファイル限定で上の参照ディレクティブが必要。
//
// 注意: このファイルではimport.meta.url経由のURL構築("The URL must be of scheme
// file"エラー、原因未特定)が再現し、gameFlow.test.tsと同一のコード・同一の
// describe構造でも解消しなかった。process.cwd()基準のパス解決に切り替えて回避する
// (vitestは常にプロジェクトルートから実行される前提)。

import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gradeDecision, CORRECT_FREQ_ABS_THRESHOLD, CORRECT_FREQ_REL_THRESHOLD, GRADING_TOLERANCE_BAND } from './grading'
import { decodeSolutionFile, type DecodedNode, type DecodedSolution } from '../loader/binaryFormat'

function makeNode(actionLabels: string[], freqsPerHand: number[][], evsPerHand: number[][]): DecodedNode {
  const handCount = freqsPerHand.length
  const freqs = new Float32Array(actionLabels.length * handCount)
  const evsBb = new Float32Array(actionLabels.length * handCount)
  for (let h = 0; h < handCount; h++) {
    for (let a = 0; a < actionLabels.length; a++) {
      freqs[a * handCount + h] = freqsPerHand[h][a]
      evsBb[a * handCount + h] = evsPerHand[h][a]
    }
  }
  return { player: 0, actionLabels, freqs, evsBb }
}

describe('gradeDecision', () => {
  it('最頻度アクションを選べば常に正解(EVロス0)', () => {
    const node = makeNode(['check', 'bet33'], [[0.2, 0.8]], [[1.0, 2.0]])
    const result = gradeDecision(node, 0, 'bet33')
    expect(result.verdict).toBe('correct')
    expect(result.evLossBb).toBeCloseTo(0, 6)
    expect(result.bestLabel).toBe('bet33')
  })

  it('絶対閾値(0.15)を許容バンド分以上下回る頻度は不正解', () => {
    // 最頻度0.9のとき相対閾値=0.25*0.9=0.225 > 絶対閾値0.15なので、相対閾値が支配的
    // ここでは選択したアクションの頻度を0.1にして閾値-バンド(0.225-0.05=0.175)未満にする
    const node = makeNode(['check', 'bet33'], [[0.1, 0.9]], [[1.0, 2.0]])
    const result = gradeDecision(node, 0, 'check')
    expect(result.verdict).toBe('incorrect')
    expect(result.evLossBb).toBeCloseTo(1.0, 6) // best(2.0) - chosen(1.0)
  })

  it('相対閾値(最頻度×0.25)ちょうどの境界はmarginal(許容バンド内)になる', () => {
    // 最頻度0.4 → 相対閾値0.1 < 絶対閾値0.15 なので絶対閾値0.15が支配的
    // 選択頻度がちょうど0.15(=閾値)は、閾値+バンド(0.20)未満なのでmarginal
    const node = makeNode(['check', 'bet33', 'bet75'], [[0.4, 0.15, 0.45]], [[1.0, 1.5, 2.0]])
    const result = gradeDecision(node, 0, 'bet33')
    expect(result.verdict).toBe('marginal')
  })

  it('混合戦略で複数アクションが頻度を持つ場合、閾値+バンドを超えていれば正解', () => {
    const node = makeNode(['check', 'bet33'], [[0.4, 0.6]], [[1.0, 1.2]])
    const result = gradeDecision(node, 0, 'check')
    // 閾値 = max(0.15, 0.25*0.6=0.15) = 0.15。0.4 >= 0.15+0.05=0.2 なので正解
    expect(result.verdict).toBe('correct')
    expect(result.evLossBb).toBeCloseTo(0.2, 6)
  })

  it('存在しないアクションラベルはエラーを投げる', () => {
    const node = makeNode(['check', 'bet33'], [[0.5, 0.5]], [[1.0, 1.0]])
    expect(() => gradeDecision(node, 0, 'raise55')).toThrow()
  })

  it('閾値・バンド定数が仕様通り(絶対0.15・相対0.25・バンド0.05)', () => {
    expect(CORRECT_FREQ_ABS_THRESHOLD).toBe(0.15)
    expect(CORRECT_FREQ_REL_THRESHOLD).toBe(0.25)
    expect(GRADING_TOLERANCE_BAND).toBe(0.05)
  })
})

describe('gradeDecision: 許容バンドのゴールデン境界テスト', () => {
  // 4アクション中'check'を常に0.5固定(相対閾値=0.25*0.5=0.125<絶対閾値0.15なので
  // 常にthreshold=0.15になる)、'bet33'の頻度だけを動かして境界を確認する。
  // 残りはbet75に寄せる(allinは0でも良い、maxFreqに影響しない範囲)。
  function makeBoundaryNode(bet33Freq: number): DecodedNode {
    const rest = 1 - 0.5 - bet33Freq
    return makeNode(['check', 'bet33', 'bet75', 'allin'], [[0.5, bet33Freq, rest, 0]], [[1.0, 2.0, 1.5, 0.0]])
  }

  it.each([
    [0.09, 'incorrect'],
    [0.13, 'marginal'],
    [0.15, 'marginal'],
    [0.17, 'marginal'],
    [0.21, 'correct'],
  ] as const)('bet33頻度%s → verdict=%s', (freq, expected) => {
    const node = makeBoundaryNode(freq)
    const result = gradeDecision(node, 0, 'bet33')
    expect(result.verdict).toBe(expected)
  })
})

describe('gradeDecision: 異常EV防御(実.binフィクスチャ)', () => {
  // FORMAT.md 4.5: 頻度・重みがほぼ0のコンボのEVは無意味値(実測で100bb超)になりうる。
  // 実際に配られたコンボ(=そのノードでの戦略頻度合計が1に近い)を採点する限りは
  // 理論上限(開始ポット+2×実効スタック=200.5bb、余裕を見て210)に収まることを確認する。
  let solution: DecodedSolution

  beforeAll(async () => {
    const binPath = join(process.cwd(), 'public/gto/solutions/srp_btn_vs_bb/KcJc2c.bin')
    const buf = await readFile(binPath)
    const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    solution = decodeSolutionFile(arrayBuf)
  })

  it('戦略頻度合計が1に近いコンボ(=実際に配られうるコンボ)は採点EVが理論上限に収まる', () => {
    const root = solution.nodes.get('')
    if (!root) throw new Error('root node not found in fixture')
    const handCount = solution.oopCombos.length
    let checkedCount = 0
    for (let h = 0; h < handCount; h++) {
      let freqSum = 0
      for (let a = 0; a < root.actionLabels.length; a++) freqSum += root.freqs[a * handCount + h]
      if (freqSum < 0.9) continue // レンジ外/ブロックされたコンボは採点対象外(FORMAT.md 4.5)
      checkedCount++
      const result = gradeDecision(root, h, root.actionLabels[0])
      expect(Number.isFinite(result.bestEvBb)).toBe(true)
      expect(Number.isFinite(result.chosenEvBb)).toBe(true)
      expect(Math.abs(result.bestEvBb)).toBeLessThan(210)
      expect(Math.abs(result.chosenEvBb)).toBeLessThan(210)
    }
    // フィルタが機能して実際にいくつか検査できていることを確認(0件ならテストが無意味)
    expect(checkedCount).toBeGreaterThan(100)
  })
})
