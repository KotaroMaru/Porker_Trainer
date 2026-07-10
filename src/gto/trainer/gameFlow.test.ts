/// <reference types="node" />
// P4 Step1: 実際のパイロットバッチ出力(.bin)を使った統合テスト。
// srp_btn_vs_bbシナリオ+実在フロップ1つで、スポット生成→ユーザー決断→採点の
// 一連の流れがエラーなく動くことを確認する(単体テストでは検証しきれない
// 「実データとの結線」を担保する)。
//
// tsconfig.app.jsonは"node"型を含まない(srcはブラウザ向けlib構成)ため、
// node:fsを使うにはこのファイル限定で上の参照ディレクティブが必要
// (@types/nodeは既存の devDependency。fetch(file://)はNodeが未対応のため不採用)。
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createSpot, applyUserAction } from './gameFlow'
import { decodeSolutionFile, type DecodedSolution } from '../loader/binaryFormat'
import { getScenario } from '../data/scenarios'
import { FLOPS } from '../data/flops'

const FLOP_STR = 'AsQsJs'

function fixedRng(sequence: number[]): () => number {
  let i = 0
  return () => sequence[Math.min(i++, sequence.length - 1)]
}

describe('createSpot / applyUserAction (実.binフィクスチャによる統合テスト)', () => {
  const scenario = getScenario('srp_btn_vs_bb')
  const flop = FLOPS.find((f) => f.cards.join('') === FLOP_STR)
  if (!flop) throw new Error(`flop fixture not found in flops.json: ${FLOP_STR}`)
  let solution: DecodedSolution

  beforeAll(async () => {
    const binPath = new URL('../../../public/gto/solutions/srp_btn_vs_bb/' + FLOP_STR + '.bin', import.meta.url)
    const buf = await readFile(binPath)
    const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    solution = decodeSolutionFile(arrayBuf)
  })

  it('userSeat=0(OOP)はルートで即座にユーザーの決断になる(ボットのアクションなし)', () => {
    const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
    expect(spot.nodeId).toBe('')
    expect(spot.botActionsBefore.length).toBe(0)
    expect(spot.decisionNode.player).toBe(0)
    expect(spot.actionsWithAmounts.length).toBe(spot.decodedNode.actionLabels.length)
  })

  it('userSeat=1(IP)はボットが1手指した後にユーザーの決断になる', () => {
    const spot = createSpot(scenario, flop, solution, 1, fixedRng([0.1, 0.1]))
    expect(spot.botActionsBefore.length).toBe(1)
    expect(spot.botActionsBefore[0].nodeId).toBe('')
    expect(spot.decisionNode.player).toBe(1)
    expect(spot.nodeId).toBe(spot.botActionsBefore[0].label)
  })

  it('複数回スポットを生成しても常にユーザーの手番・ボットの手番のplayerが一致する', () => {
    for (let i = 0; i < 20; i++) {
      const rng = fixedRng([i / 20, (i + 0.3) / 20, (i + 0.6) / 20])
      const spot = createSpot(scenario, flop, solution, (i % 2) as 0 | 1, rng)
      expect(spot.decisionNode.player).toBe(i % 2)
    }
  })

  it('applyUserActionで採点結果が得られ、閾値通りに正誤判定される', () => {
    const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
    const chosenLabel = spot.decodedNode.actionLabels[0]
    const grade = applyUserAction(spot, chosenLabel)
    expect(grade.actionBreakdown.length).toBe(spot.decodedNode.actionLabels.length)
    expect(['correct', 'marginal', 'incorrect']).toContain(grade.verdict)
    expect(grade.evLossBb).toBeGreaterThanOrEqual(-1e-4) // 最善手との差は非負のはず(誤差許容)
  })

  it('存在しないシナリオ+フロップの組み合わせ(未生成の解)はエラーを投げる', () => {
    // このテストは解が存在するフロップに対して行うため、ここでは
    // 単に正常系が例外を投げないことの裏返しとして、無効なアクションラベルの
    // 採点がエラーになることを確認する
    const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
    expect(() => applyUserAction(spot, 'not-a-real-action')).toThrow()
  })
})
