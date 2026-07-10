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

// フロップ街の決断ノードの「ゴールデン」nodeId→{player, actionLabels}集合。
// P3バッチ出力レビュー(2026-07-05、全95ファイル実測)で確定した構造:
// ルート=check/bet33/bet75/allin、ベット直面=fold/call/raise55/allin、
// レイズ直面=fold/call/allin、オールイン直面=fold/call の20ノード。
const GOLDEN_NODES: Record<string, { player: 0 | 1; actionLabels: string[] }> = {
  '': { player: 0, actionLabels: ['check', 'bet33', 'bet75', 'allin'] },
  check: { player: 1, actionLabels: ['check', 'bet33', 'bet75', 'allin'] },
  'check-bet33': { player: 0, actionLabels: ['fold', 'call', 'raise55', 'allin'] },
  'check-bet33-raise55': { player: 1, actionLabels: ['fold', 'call', 'allin'] },
  'check-bet33-raise55-allin': { player: 0, actionLabels: ['fold', 'call'] },
  'check-bet33-allin': { player: 1, actionLabels: ['fold', 'call'] },
  'check-bet75': { player: 0, actionLabels: ['fold', 'call', 'raise55', 'allin'] },
  'check-bet75-raise55': { player: 1, actionLabels: ['fold', 'call', 'allin'] },
  'check-bet75-raise55-allin': { player: 0, actionLabels: ['fold', 'call'] },
  'check-bet75-allin': { player: 1, actionLabels: ['fold', 'call'] },
  'check-allin': { player: 0, actionLabels: ['fold', 'call'] },
  bet33: { player: 1, actionLabels: ['fold', 'call', 'raise55', 'allin'] },
  'bet33-raise55': { player: 0, actionLabels: ['fold', 'call', 'allin'] },
  'bet33-raise55-allin': { player: 1, actionLabels: ['fold', 'call'] },
  'bet33-allin': { player: 0, actionLabels: ['fold', 'call'] },
  bet75: { player: 1, actionLabels: ['fold', 'call', 'raise55', 'allin'] },
  'bet75-raise55': { player: 0, actionLabels: ['fold', 'call', 'allin'] },
  'bet75-raise55-allin': { player: 1, actionLabels: ['fold', 'call'] },
  'bet75-allin': { player: 0, actionLabels: ['fold', 'call'] },
  allin: { player: 1, actionLabels: ['fold', 'call'] },
}
const GOLDEN_NODE_IDS = Object.keys(GOLDEN_NODES).sort()

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

  it('95フロップ全件が生成済みである', () => {
    expect(binFiles.length).toBe(95)
  })

  it('全ファイルが構造的に妥当(ゴールデン20ノードID集合の完全一致・戦略合計≈1・EV妥当性・fold EV≈0)', () => {
    expect(binFiles.length).toBeGreaterThan(0)

    for (const f of binFiles) {
      const buf = readFileSync(join(SOLUTIONS_DIR, f))
      const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      const sol = decodeSolutionFile(arrayBuf)

      expect(sol.scenarioId, f).toBe(SCENARIO_ID)
      expect(sol.startingPotBb, f).toBeCloseTo(5.5, 6)
      expect(sol.effectiveStackBb, f).toBeCloseTo(97.5, 6)
      expect(sol.oopCombos.length, f).toBeGreaterThan(0)
      expect(sol.ipCombos.length, f).toBeGreaterThan(0)

      // ゴールデンnodeId集合(20ノード)との完全一致
      const actualIds = [...sol.nodes.keys()].sort()
      expect(actualIds, f).toEqual(GOLDEN_NODE_IDS)

      for (const [nodeId, node] of sol.nodes) {
        const golden = GOLDEN_NODES[nodeId]
        expect(node.player, `${f} node=${nodeId}`).toBe(golden.player)
        expect(node.actionLabels, `${f} node=${nodeId}`).toEqual(golden.actionLabels)

        const handCount = node.player === 0 ? sol.oopCombos.length : sol.ipCombos.length
        expect(node.freqs.length, `${f} node=${nodeId}`).toBe(node.actionLabels.length * handCount)
        expect(node.evsBb.length, `${f} node=${nodeId}`).toBe(node.actionLabels.length * handCount)

        const foldIdx = node.actionLabels.indexOf('fold')

        // 各コンボについて、アクション頻度の合計は1に近いはず(量子化誤差を許容)
        for (let h = 0; h < handCount; h++) {
          let sum = 0
          for (let a = 0; a < node.actionLabels.length; a++) sum += node.freqs[a * handCount + h]
          expect(sum, `${f} node=${nodeId} hand=${h} freq sum`).toBeGreaterThan(0.9)
          expect(sum, `${f} node=${nodeId} hand=${h} freq sum`).toBeLessThan(1.1)

          // FORMAT.md 4.5規約: foldのEVは常に0(「降りれば追加の損得なし」基準)
          if (foldIdx >= 0) {
            expect(node.evsBb[foldIdx * handCount + h], `${f} node=${nodeId} hand=${h} fold EV`).toBeCloseTo(0, 1)
          }
        }

        // EVは有限値で、理論上限(開始ポット+2×実効スタック=200.5bb)を超えないはず
        for (const ev of node.evsBb) {
          expect(Number.isFinite(ev), f).toBe(true)
          expect(Math.abs(ev), f).toBeLessThan(210)
        }
      }
    }
  }, 120_000)

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
