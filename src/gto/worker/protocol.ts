import type { Card } from '../../engine/types'
import type { PlayerIdx } from '../solver/cfr'
import type { DecodedNode } from '../loader/binaryFormat'

/**
 * Worker境界を越える(structured cloneされる)ためのプレーンなデータ型のみで構成する。
 * cfr.tsのCfrSolutionはgetStrategyがクロージャを持つため直接は送れない。
 *
 * P6 Step B3(プロトコルv2): 旧v1はsolveTurnSubgame1回で全決断ノード(ターン部分
 * ゲームで約11k)の戦略を丸ごとシリアライズしていた(潜在的性能バグ、EVを足すと
 * 数十MB級になる)。v2はWorkerが最新1ソルブの解を保持し(D2「収穫」パターン)、
 * UIはgetNodesで実際に必要なノード(手番決断+その応答子、1ハンドあたり数個)
 * だけを個別取得する。DecodedNode(loader/binaryFormat.ts、Rust事前計算パイプラインと
 * 同じ形状)をそのまま使うことで、grading.gradeDecision等の下流モジュールが
 * 事前計算/ライブソルブのどちらのデータでも無改造で動く。
 */

export interface SolveStreetRequest {
  kind: 'solveStreet'
  requestId: string
  street: 'turn' | 'river'
  /** ターンなら4枚、リバーなら5枚。 */
  board: Card[]
  oopCombos: [Card, Card][]
  oopReach: number[]
  ipCombos: [Card, Card][]
  ipReach: number[]
  potBb: number
  effectiveStackBb: number
  /** アプリコードでは常に0(OOP先手)。D1のプレイヤー番号規約。 */
  firstToAct: PlayerIdx
  maxIterations?: number
  targetExploitability?: number
  /** exploitabilityチェック(収束判定)の間隔。小さいほど早期打ち切りの精度は上がるが
   * チェック自体のコストが増える。P7-6a: プレイ用の粗いターンソルブは短い間隔(25)で
   * ~4秒での打ち切りを狙う。 */
  checkEveryIterations?: number
}

export interface GetNodesRequest {
  kind: 'getNodes'
  requestId: string
  /** solveStreetの結果で受け取ったsolveId。直近のソルブ以外を要求するとエラーになる。 */
  solveId: string
  nodeIds: string[]
}

export type WorkerRequest = SolveStreetRequest | GetNodesRequest | { kind: 'cancel'; requestId: string }

export interface SolveResultSummary {
  solveId: string
  iterationsRun: number
  exploitability: number
  gameValue: [number, number]
}

export interface ProgressMessage {
  kind: 'progress'
  requestId: string
  iterationsRun: number
  exploitability: number
}

export interface ResultMessage {
  kind: 'result'
  requestId: string
  solution: SolveResultSummary
  elapsedMs: number
}

export interface NodesMessage {
  kind: 'nodes'
  requestId: string
  /** nodeId -> DecodedNode形状(木に存在しないnodeId=terminal等はnull)。 */
  nodes: Record<string, DecodedNode | null>
}

export interface ErrorMessage {
  kind: 'error'
  requestId: string
  message: string
}

export type WorkerResponse = ProgressMessage | ResultMessage | NodesMessage | ErrorMessage
