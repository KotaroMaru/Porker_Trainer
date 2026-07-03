import type { Position } from '../engine/types'

/**
 * 頻度付きレンジ: ハンド表記("AKs","QQ","72o")→アクション頻度(0..1)。
 * キーが存在しない、または値が0のハンドはそのアクションを取らない。
 * 同一シナリオ内で複数のFreqRange(例: call/3bet/fold)を持つ場合、
 * 各ハンドの合計が1を超えないことを前提とする(超えた分はUI/サンプラー側でクランプする)。
 */
export type FreqRange = Record<string, number>

export type ScenarioKind = 'SRP' | 'THREEBET'

/** シナリオ内の各プレイヤーの役割 */
export type PlayerRole = 'raiser' | 'caller' | 'threebettor' | 'coldcaller'

export interface ScenarioPlayer {
  position: Position
  role: PlayerRole
  /** このプレイヤーがこのシナリオでプレイするレンジのID(ranges.tsで解決) */
  rangeId: string
}

export interface Scenario {
  id: string
  kind: ScenarioKind
  label: string
  /** 日本語の状況説明(トレーナーUIで表示) */
  descriptionJa: string
  /** アグレッサー(オープナー) */
  raiser: ScenarioPlayer
  /** ディフェンダー(コーラー/3ベッター) */
  defender: ScenarioPlayer
  /** フロップ開始時点のポット(bb) */
  potBb: number
  /** フロップ開始時点の実効スタック(bb、両者同じ100bb構造なので単一値) */
  effectiveStackBb: number
  /** 出題時のランダム抽選に使う実戦頻度重み(相対値、合計1である必要はない) */
  weight: number
}

export interface FlopDef {
  /** 例: "KcQh6d" のような3枚のカード表記(rank+suit) */
  cards: [string, string, string]
  /** テクスチャ分類(参考情報。抽選には重みのみ使用) */
  texture: {
    paired: boolean
    monotone: boolean
    twoTone: boolean
    highCardCount: number // T以上のカード枚数
  }
  /** 代表フロップ集合内での相対抽選重み */
  weight: number
}
