import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { decodeSolutionFile } from '../src/gto/loader/binaryFormat'

// P3完了条件のスポットチェック: パイロットバッチ(tools/gto-solver/precompute)が
// 出力したpublic/gto/solutions/{scenarioId}/*.binを実際にTSデコーダで読み、
// 構造的な不変条件(ノード数・戦略の合計≈1・EVが有限値)を検証する。
// バッチが完走していない場合は生成済み分のみを対象にスキップ的に扱う
// (このテストの目的は「壊れたファイルを作っていないか」の検証であり、
// バッチの完走そのものは別途件数で確認する)。

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SCENARIO_ID = 'srp_btn_vs_bb'
const SOLUTIONS_DIR = join(ROOT, 'public/gto/solutions', SCENARIO_ID)
const SCENARIO_JSON_PATH = join(ROOT, 'tools/solver/scenarios', `${SCENARIO_ID}.json`)

function listBinFiles(): string[] {
  try {
    return readdirSync(SOLUTIONS_DIR).filter((f) => f.endsWith('.bin'))
  } catch {
    return []
  }
}

describe('GTO解データ(パイロットバッチ出力)のスポットチェック', () => {
  const binFiles = listBinFiles()

  it('少なくとも1件は生成済みである(バッチが起動・出力できている)', () => {
    expect(binFiles.length).toBeGreaterThan(0)
  })

  it('生成済みファイル名は、シナリオJSONが定義する95フロップの部分集合である', () => {
    const scenario = JSON.parse(readFileSync(SCENARIO_JSON_PATH, 'utf8')) as { flops: string[] }
    const expectedFlops = new Set(scenario.flops)
    for (const f of binFiles) {
      const flopStr = f.replace(/\.bin$/, '')
      expect(expectedFlops.has(flopStr)).toBe(true)
    }
    console.log(`進捗: ${binFiles.length}/${scenario.flops.length}フロップ生成済み`)
  })

  it('サンプル(先頭10件、または全件が10件未満ならその全件)が構造的に妥当', () => {
    const sample = binFiles.slice(0, 10)
    expect(sample.length).toBeGreaterThan(0)

    for (const f of sample) {
      const buf = readFileSync(join(SOLUTIONS_DIR, f))
      const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      const sol = decodeSolutionFile(arrayBuf)

      expect(sol.scenarioId).toBe(SCENARIO_ID)
      expect(sol.startingPotBb).toBeCloseTo(5.5, 6)
      expect(sol.effectiveStackBb).toBeCloseTo(97.5, 6)
      expect(sol.oopCombos.length).toBeGreaterThan(0)
      expect(sol.ipCombos.length).toBeGreaterThan(0)
      // フロップ街の決断ノード数は既知の抽象(check/bet33/bet75/allin×レイズ許可)で20
      expect(sol.nodes.size).toBe(20)

      for (const [nodeId, node] of sol.nodes) {
        const handCount = node.player === 0 ? sol.oopCombos.length : sol.ipCombos.length
        expect(node.freqs.length).toBe(node.actionLabels.length * handCount)
        expect(node.evsBb.length).toBe(node.actionLabels.length * handCount)

        // 各コンボについて、アクション頻度の合計は1に近いはず(量子化誤差を許容)
        for (let h = 0; h < handCount; h++) {
          let sum = 0
          for (let a = 0; a < node.actionLabels.length; a++) sum += node.freqs[a * handCount + h]
          expect(sum, `node=${nodeId} hand=${h} freq sum`).toBeGreaterThan(0.9)
          expect(sum, `node=${nodeId} hand=${h} freq sum`).toBeLessThan(1.1)
        }

        // EVは有限値で、100bbスタック相手に非現実的な絶対値(200bb超)にならないはず
        for (const ev of node.evsBb) {
          expect(Number.isFinite(ev)).toBe(true)
          expect(Math.abs(ev)).toBeLessThan(200)
        }
      }
    }
  }, 30_000)

  it('全体サイズは1マッチアップあたりの想定(数MB〜十数MB)に収まる', () => {
    let totalBytes = 0
    for (const f of binFiles) {
      totalBytes += statSync(join(SOLUTIONS_DIR, f)).size
    }
    const totalMb = totalBytes / 1e6
    console.log(`現在の合計サイズ: ${totalMb.toFixed(2)}MB (${binFiles.length}ファイル)`)
    // 95ファイル完走時の推定値でも1マッチアップ数MB〜20MB程度に収まるはず
    const projectedFullMb = binFiles.length > 0 ? (totalMb / binFiles.length) * 95 : 0
    expect(projectedFullMb).toBeLessThan(20)
  })
})
