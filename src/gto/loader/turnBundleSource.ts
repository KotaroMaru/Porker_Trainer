// P15 S4: Hugging Face上の事前計算ターンバンドルを取得する。
// 収録範囲をここだけに集約し、未収録局面では404を発生させない。

import type { Card } from '../../engine/types'
import { cardKey } from '../../engine/deck'
import type { DecodedSolution } from './binaryFormat'
import { decodeBundleIndex, decodeBundleTurn } from './bundleFormat'
import TURN_BUNDLE_FLOPS from '../data/turnBundleFlops.json'

export const TURN_BUNDLE_BASE_URL =
  'https://huggingface.co/datasets/Kota903/poker-trainer-gto-turn/resolve/main'

/**
 * バンドルを生成済みのシナリオと経路。
 *
 * 経路一覧は .github/workflows/gto-turn-bundles.yml の paths 入力の既定値と
 * 一致していなければならない。ずれると「バンドルは存在するのにアプリが取りに
 * 行かず、常にライブソルブへ退避する」という、型にもテストにも現れない欠落が起きる。
 * src/gto/tree/turnPaths.test.ts がワークフロー・フロップ木・この定数の
 * 三者一致を検査している。
 *
 * オールインを含む経路は載せない。残りスタックが無くターン以降に決断が存在せず、
 * ランアウトするだけなのでターン部分ゲームの解を必要としないため。
 */
export const RECORDED_TURN_BUNDLES: Readonly<Record<string, readonly string[]>> = {
  srp_btn_vs_bb: [
    'check-check',
    'check-bet33-call',
    'check-bet33-raise55-call',
    'check-bet75-call',
    'check-bet75-raise55-call',
    'bet33-call',
    'bet33-raise55-call',
    'bet75-call',
    'bet75-raise55-call',
  ],
}

export interface TurnBundleRequest {
  scenarioId: string
  /** tools/solver/scenarios/*.jsonのflops要素そのもの(例: AsQsJs)。 */
  flopId: string
  flopCards: readonly Card[]
  pathId: string
  turnCard: Card
}

export function hasRecordedTurnBundle(scenarioId: string, pathId: string): boolean {
  return RECORDED_TURN_BUNDLES[scenarioId]?.includes(pathId) ?? false
}

/**
 * ターンバンドルが全経路そろっているフロップID一覧(シナリオ別)。
 *
 * フロップ解(public/gto/solutions)とターンバンドル(HF)は別々のCIで生成されるため、
 * 「フロップ解はあるがターンバンドルが無い」中途半端な状態が生じる。特化モードは
 * 「待ち時間なし」が売りなので、その状態のフロップは出題対象から外す
 * (外さないとターンで毎回ソルブが走り、特化モードの意味がなくなる)。
 *
 * tools/sync-turn-bundle-flops.mjs でHFの実際の収録状況から再生成する。
 */
export function fullyBundledFlopIds(scenarioId: string): readonly string[] | undefined {
  const list = (TURN_BUNDLE_FLOPS as Record<string, unknown>)[scenarioId]
  return Array.isArray(list) ? (list as string[]) : undefined
}

/** 特化モードの対象にできる(=ターンバンドルが収録済みの)シナリオID一覧。 */
export function focusEligibleScenarioIds(): string[] {
  return Object.keys(RECORDED_TURN_BUNDLES)
}

/**
 * 指定ターンの事前計算解を返す。取得・検証・デコードの失敗はすべてnullへ畳み、
 * 呼び出し側が従来のライブソルブへ必ず退避できるようにする。
 */
export async function loadTurnBundleSolution(request: TurnBundleRequest): Promise<DecodedSolution | null> {
  if (!hasRecordedTurnBundle(request.scenarioId, request.pathId)) return null

  try {
    const url = `${TURN_BUNDLE_BASE_URL}/${encodeURIComponent(request.scenarioId)}/${encodeURIComponent(request.flopId)}/${encodeURIComponent(request.pathId)}.bin`
    const response = await fetch(url)
    if (!response.ok) return null

    const buf = await response.arrayBuffer()
    const index = decodeBundleIndex(buf)
    const expectedFlopKeys = request.flopCards.map(cardKey)
    if (
      index.scenarioId !== request.scenarioId ||
      index.pathId !== request.pathId ||
      index.flopCardKeys.length !== expectedFlopKeys.length ||
      index.flopCardKeys.some((key, i) => key !== expectedFlopKeys[i])
    ) {
      return null
    }

    const entry = index.entries.get(cardKey(request.turnCard))
    if (!entry) return null
    const solution = decodeBundleTurn(buf, entry)
    if (
      solution.scenarioId !== request.scenarioId ||
      solution.flop.length !== expectedFlopKeys.length ||
      solution.flop.some((card, i) => cardKey(card) !== expectedFlopKeys[i])
    ) {
      return null
    }
    return solution
  } catch {
    return null
  }
}
