// P6 Step B4: 「ストリートローカル木+ノードデータプロバイダ」統一モデル(D1)。
// フロップ(事前計算)・ターン/リバー(ライブソルブ)のいずれも、この1つの
// インターフェースの背後に隠す。gameFlow.ts(単発モード、フロップのみ)は
// このシームを使わず既存のまま維持し、fullHandFlow.ts(通しモード、P6 B5)が
// これを使って複数ストリートを横断する。
//
// 実装は3つ: precomputedProvider.ts(フロップ・DecodedSolutionのラップ、同期)、
// worker/workerProviderFactory.ts(ターン/リバー・Web Worker裏付け、本番用)、
// inProcessProviderFactory.ts(ターン/リバー・同一パイプラインを同期実行する
// テストシーム。Workerはjsdom環境で動かせないため、fullHandFlow等のテストは
// これを注入して使う)。

import type { Card } from '../../engine/types'
import type { Combo } from '../../analysis/range'
import type { DecodedNode, DecodedSolution } from '../loader/binaryFormat'

export type Street = 'flop' | 'turn' | 'river'

export interface RefineOptions {
  targetExploitability: number
  maxIterations: number
  chunkIterations: number
}

export interface StreetNodeProvider {
  readonly street: Street
  /** そのストリート開始時点のボード(flop=3枚, turn=4枚, river=5枚)。 */
  readonly board: Card[]
  readonly oopCombos: readonly Combo[]
  readonly ipCombos: readonly Combo[]
  /** ボットが行動できる(=解が完成した)時点でresolveする。precomputedは常に解決済み。 */
  readonly ready: Promise<void>
  /** 指定nodeIdの決断ノードをDecodedNode形状で取得する(木に存在しないnodeIdはnull)。 */
  getNodes(nodeIds: string[]): Promise<Map<string, DecodedNode | null>>
  /** 現在アクティブな初期ソルブ/精密化の進捗(0..1)。アイドル中・事前計算解ではnull。 */
  progress(): { fraction: number } | null
  /**
   * このストリートの既存セッションを背景で継続精密化する(P9-3)。fire-and-forget:
   * 呼び出し直後にprogress()が非nullへ戻り、目標到達または反復上限到達後にnullへ戻る。
   * 事前計算解ではno-op。ready未解決時の呼び出しは、初期ソルブ完了後に開始する。
   */
  refine(opts: RefineOptions): void
  /** このストリートのソルブを中断する(Worker実装ではcancelのみ、Workerごとの終了はfactory.dispose()側)。事前計算解では何もしない。 */
  dispose(): void
}

export interface StreetSolveInput {
  street: 'turn' | 'river'
  /** ターンなら4枚、リバーなら5枚。 */
  board: Card[]
  oopCombos: Combo[]
  oopReach: number[]
  ipCombos: Combo[]
  ipReach: number[]
  potBb: number
  effectiveStackBb: number
  maxIterations?: number
  targetExploitability?: number
  checkEveryIterations?: number
}

export interface NodeProviderFactory {
  forFlop(solution: DecodedSolution, board: Card[]): StreetNodeProvider
  /** 構築した時点でソルブが(バックグラウンドで)開始される。firstToActは常に0(D1のプレイヤー番号規約)。 */
  forLiveStreet(input: StreetSolveInput): StreetNodeProvider
  /** ファクトリ全体のリソース解放(Worker実装ではterminate)。事前計算/インプロセス実装では何もしない。ハンド終了時に必ず呼ぶ。 */
  dispose(): void
}
