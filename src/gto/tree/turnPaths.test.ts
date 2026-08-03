// P15: ターン事前計算バンドルを生成すべきフロップ経路の一覧が、実際のフロップ木と
// 一致していることを恒久的に検査する。
//
// なぜ必要か: 生成対象の経路は .github/workflows/gto-turn-bundles.yml に
// リテラルで書かれている。actionTree.ts のベットサイズやレイズ構造を変えると、
// ワークフローの一覧だけが古いまま取り残され、「新しい経路のバンドルが永久に
// 生成されない(=常にライブソルブへ退避する)」という、テストにも型にも
// 引っかからない欠落が起きる。ここで両者を突き合わせて防ぐ。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildStreetTree } from './actionTree'
import { RECORDED_TURN_BUNDLES } from '../loader/turnBundleSource'

const WORKFLOW_PATH = resolve(__dirname, '../../../.github/workflows/gto-turn-bundles.yml')

/**
 * フロップ木のうち「ターン解を必要とする経路」を列挙する。
 *
 * 条件は showdown 終端であること、かつオールインを含まないこと。
 * オールイン経路は残りスタックが無く、ターン以降に決断が存在しないまま
 * ランアウトするだけなので(fullHandFlow の runOutRemainingCardsAndFinalize)、
 * ターン部分ゲームの解を持つ意味がない。
 */
function enumerateTurnPaths(): string[] {
  // ポット・スタックは srp_btn_vs_bb の値。木の形は経路の集合に影響しない範囲で
  // 代表値を使う(オールインの有無は実効スタックに依存するため実値を使うこと)。
  const tree = buildStreetTree({ potBb: 5.5, effectiveStackBb: 97.5, firstToAct: 0 })
  const showdownPaths: string[] = []

  const walk = (node: ReturnType<typeof buildStreetTree>, labels: string[]): void => {
    if (node.kind === 'terminal') {
      if (node.outcome.kind === 'showdown') showdownPaths.push(labels.join('-'))
      return
    }
    if (node.kind !== 'decision') return
    node.children.forEach((child, i) => walk(child, [...labels, node.actionLabels[i]]))
  }
  walk(tree, [])

  return showdownPaths.filter((path) => !path.split('-').includes('allin'))
}

function workflowDefaultPaths(): string[] {
  const yaml = readFileSync(WORKFLOW_PATH, 'utf8')
  // 経路一覧の正典は env.TURN_PATHS_ALL。workflow_run 起動では inputs が空になるため
  // workflow_dispatch の入力ではなく env に置いている。
  const match = yaml.match(/^\s*TURN_PATHS_ALL:\s*'([^']+)'\s*$/m)
  if (!match) throw new Error('gto-turn-bundles.yml から TURN_PATHS_ALL が読み取れない')
  return match[1].split(/\s+/).filter(Boolean)
}

describe('ターンバンドル生成対象の経路', () => {
  it('オールインを除くshowdown終端が9件あり、区切りは"-"である', () => {
    const paths = enumerateTurnPaths()
    expect(paths).toHaveLength(9)
    for (const path of paths) {
      expect(path).not.toContain('/')
      expect(path.length).toBeGreaterThan(0)
    }
  })

  it('ワークフローの既定値がフロップ木の列挙結果と完全に一致する', () => {
    // 順序差で落とさない(ワークフロー側は人が読みやすい順に並べてよい)。
    expect([...workflowDefaultPaths()].sort()).toEqual([...enumerateTurnPaths()].sort())
  })

  it('アプリ側の収録定数がフロップ木の列挙結果と完全に一致する', () => {
    // ここがずれると「バンドルは生成済みなのにアプリが取りに行かず、
    // 常にライブソルブへ退避する」という、型にもテストにも現れない欠落になる。
    expect([...RECORDED_TURN_BUNDLES.srp_btn_vs_bb].sort()).toEqual([...enumerateTurnPaths()].sort())
  })

  it('オールイン経路は対象に含めない(ランアウトのみで決断が無いため)', () => {
    expect(enumerateTurnPaths().some((p) => p.includes('allin'))).toBe(false)
  })
})
