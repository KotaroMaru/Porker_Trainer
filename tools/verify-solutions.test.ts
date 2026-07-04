import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { decodeSolutionFile } from '../src/gto/loader/binaryFormat'

// P3パイロットバッチの検証(スポットチェック+サイズ確認)。
// public/gto/solutions/{scenarioId}/*.bin を全件、TS側の本物のデコーダで読み、
// 構造・整合性・統計を検証する(=Rustライタ↔TSリーダの実データ統合テストを兼ねる)。
//
// 実行: npx vitest run tools/verify-solutions.test.ts
// 解ファイルがまだ存在しない環境(CI等)では自動スキップする。
// バッチ実行途中でも、生成済みのファイルだけを対象に検証できる(バッチはファイルを
// アトミックに書き出すため、進行中でも安全)。

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SOLUTIONS_DIR = join(ROOT, 'public/gto/solutions')

const RUST_SUITS = ['c', 'd', 'h', 's'] as const
const RANK_CHARS: Record<number, string> = { 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
function cardIdToRustString(cardId: number): string {
  const rank = Math.floor(cardId / 4) + 2
  const suit = RUST_SUITS[cardId % 4]
  return `${RANK_CHARS[rank] ?? String(rank)}${suit}`
}

function listScenarioDirs(): string[] {
  if (!existsSync(SOLUTIONS_DIR)) return []
  return readdirSync(SOLUTIONS_DIR).filter((d) => statSync(join(SOLUTIONS_DIR, d)).isDirectory())
}

const scenarioDirs = listScenarioDirs()
const hasSolutions = scenarioDirs.some(
  (d) => readdirSync(join(SOLUTIONS_DIR, d)).filter((f) => f.endsWith('.bin')).length > 0,
)

describe.skipIf(!hasSolutions)('事前計算解(.bin)の整合性検証', () => {
  for (const scenarioId of scenarioDirs) {
    const dir = join(SOLUTIONS_DIR, scenarioId)
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.bin'))
      .sort()
    if (files.length === 0) continue

    it(`${scenarioId}: 全${files.length}ファイルがデコード可能で構造・値が妥当`, () => {
      let totalBytes = 0
      const sizes: number[] = []
      const problems: string[] = []

      for (const file of files) {
        const bytes = readFileSync(join(dir, file))
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        totalBytes += bytes.length
        sizes.push(bytes.length)

        try {
          const sol = decodeSolutionFile(buf)

          if (sol.scenarioId !== scenarioId) {
            problems.push(`${file}: scenarioId mismatch header=${sol.scenarioId}`)
          }
          // ヘッダのフロップはpostflop-solver(flop_from_str)がカードID昇順に
          // ソートして保持するため、ファイル名(flops.jsonの元の並び)とは順序が
          // 異なりうる。集合として一致すればよい。
          const flopFromName = file.replace(/\.bin$/, '')
          const nameCards = (flopFromName.match(/[2-9TJQKA][cdhs]/g) ?? []).sort().join('')
          const headerCards = sol.flopCardIds.map(cardIdToRustString).sort().join('')
          if (nameCards !== headerCards) {
            problems.push(`${file}: flop mismatch header=${headerCards} filename=${nameCards}`)
          }

          if (sol.nodes.size === 0) problems.push(`${file}: no nodes`)
          const rootNode = sol.nodes.get('')
          if (!rootNode) problems.push(`${file}: missing root node`)
          else if (rootNode.player !== 0) problems.push(`${file}: root player should be 0(OOP), got ${rootNode.player}`)

          if (sol.oopCombos.length === 0 || sol.ipCombos.length === 0) {
            problems.push(`${file}: empty combo table oop=${sol.oopCombos.length} ip=${sol.ipCombos.length}`)
          }

          // 戦略頻度: 手ごとに合計≈1(u8量子化誤差許容)。レンジ重み0や完全ブロックの
          // コンボは全アクション0でありうるため合計≈0も許容する。
          //
          // EVの上限: FORMAT.md 4.5のEV規約は「この時点からの期待獲得チップ
          // (サンクコスト除外)」なので、既に自分が投入済みのチップがある状態で
          // 最終ポット全額を獲得すると EV = 開始ポット + 2×実効スタック − 将来投入額
          // となり、最大で 開始ポット+2×実効スタック(≈200bb)に達しうる
          // (例: モノトーンボードのナッツフラッシュがレイズ後のオールインをコール)。
          const evBound = sol.startingPotBb + 2 * sol.effectiveStackBb + 1
          let badFreqRows = 0
          let totalRows = 0
          let badEvs = 0
          for (const [nodeId, node] of sol.nodes) {
            const handCount = node.player === 0 ? sol.oopCombos.length : sol.ipCombos.length
            const actionCount = node.actionLabels.length
            if (node.freqs.length !== actionCount * handCount) {
              problems.push(`${file} node ${nodeId}: freqs length ${node.freqs.length} != ${actionCount * handCount}`)
              continue
            }
            for (let h = 0; h < handCount; h++) {
              totalRows++
              let sum = 0
              for (let a = 0; a < actionCount; a++) sum += node.freqs[a * handCount + h]
              const tol = 0.01 * actionCount
              if (!(Math.abs(sum - 1) <= tol || sum <= tol)) badFreqRows++
            }
            for (let i = 0; i < node.evsBb.length; i++) {
              const ev = node.evsBb[i]
              if (!Number.isFinite(ev) || Math.abs(ev) > evBound) badEvs++
            }
          }
          if (badFreqRows > 0) {
            problems.push(`${file}: ${badFreqRows}/${totalRows} freq rows do not sum to ~1 or ~0`)
          }
          if (badEvs > 0) problems.push(`${file}: ${badEvs} EV entries out of ±${evBound}bb or non-finite`)
        } catch (e) {
          problems.push(`${file}: decode error: ${(e as Error).message}`)
        }
      }

      sizes.sort((a, b) => a - b)
      // eslint-disable-next-line no-console
      console.log(
        `${scenarioId}: files=${files.length} total=${(totalBytes / 1e6).toFixed(2)}MB ` +
          `avg=${(totalBytes / files.length / 1024).toFixed(1)}KB ` +
          `min=${(sizes[0] / 1024).toFixed(1)}KB max=${(sizes[sizes.length - 1] / 1024).toFixed(1)}KB`,
      )

      expect(problems, problems.join('\n')).toEqual([])
      // ファイルサイズの妥当性: プラン想定は1ファイル≈74KB前後(実測80-93KB)。
      // 異常に小さい/大きいファイル(書きかけ・破損)を検出する。
      expect(sizes[0]).toBeGreaterThan(20_000)
      expect(sizes[sizes.length - 1]).toBeLessThan(500_000)
    })
  }
})

describe.skipIf(hasSolutions)('事前計算解が未生成の環境', () => {
  it('スキップ(public/gto/solutions/に.binがない)', () => {
    expect(true).toBe(true)
  })
})
