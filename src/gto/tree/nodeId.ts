/**
 * ノードID: アクション履歴を正規の文字列表現にエンコードする。
 * 事前計算されたフロップ解(P3でRust側が出力するバイナリ)の中から、特定の
 * ベッティングライン(決断ノード)を引くためのキーとして使う。
 *
 * 形式: アクションラベルを"-"で連結("check-bet33-call"のように)。
 * ルートノード(履歴なし)は空文字列 "" とする。
 *
 * この形式自体は本モジュール内で完結しており、Rust側の実際の出力形式は
 * P3で事前計算パイプラインを実装する際に本モジュールと同期させる
 * (tools/solver/FORMAT.mdが正典となる想定)。
 */

export type NodeId = string

const ROOT_NODE_ID: NodeId = ''

export function rootNodeId(): NodeId {
  return ROOT_NODE_ID
}

/** 親ノードのIDと、そこから取ったアクションラベルから子ノードのIDを作る。 */
export function childNodeId(parentId: NodeId, actionLabel: string): NodeId {
  if (parentId === ROOT_NODE_ID) return actionLabel
  return `${parentId}-${actionLabel}`
}

/** ノードIDをアクションラベルの配列に分解する(空文字列はルート=空配列)。 */
export function parseNodeId(id: NodeId): string[] {
  if (id === ROOT_NODE_ID) return []
  return id.split('-')
}

/** アクションラベルの配列からノードIDを組み立てる(parseNodeIdの逆)。 */
export function buildNodeId(actionLabels: string[]): NodeId {
  return actionLabels.join('-')
}
