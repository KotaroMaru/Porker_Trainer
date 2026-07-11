// P6 Step B10: ブックマークの永続化(localStorage)。
// - index: `poker_trainer_gto_bookmarks_index`(BookmarkMeta[]のJSON、新しい順)
// - 本体: `poker_trainer_gto_bookmark_<id>`(codec.tsでエンコード→base64化したReviewData)
// CAP=200件(確定判断3: 容量超過時は自動削除せずエラー表示で手動削除を促す)。
// quota超過(setItemが例外を投げる)時は、書き込み済みの本体データをロールバックして
// 半端な状態を残さない(index更新のみ成功・本体だけ残る、の両方向を防ぐ)。

import { cardLabel } from '../../engine/deck'
import { encodeReview, decodeReview, toBase64, fromBase64 } from './codec'
import type { ReviewData } from '../trainer/reviewBuilder'
import type { GradeVerdict } from '../trainer/grading'

const INDEX_KEY = 'poker_trainer_gto_bookmarks_index'
const ITEM_KEY_PREFIX = 'poker_trainer_gto_bookmark_'

export const BOOKMARK_CAP = 200

export interface BookmarkMeta {
  id: string
  createdAt: number
  scenarioId: string
  scenarioLabel: string
  boardStr: string
  verdicts: GradeVerdict[]
  /** 通しモード(ハンド全体)の収支。単発モードの保存ではnull。 */
  netBb: number | null
  mode: 'single' | 'full'
}

export interface SaveBookmarkInput {
  mode: 'single' | 'full'
  netBb: number | null
}

export type SaveBookmarkResult = { ok: true; id: string } | { ok: false; reason: 'quota' | 'cap' }

function itemKey(id: string): string {
  return `${ITEM_KEY_PREFIX}${id}`
}

function loadIndex(): BookmarkMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as BookmarkMeta[]) : []
  } catch {
    return []
  }
}

function generateId(): string {
  return `bm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function saveBookmark(review: ReviewData, input: SaveBookmarkInput): SaveBookmarkResult {
  const index = loadIndex()
  if (index.length >= BOOKMARK_CAP) return { ok: false, reason: 'cap' }

  const id = generateId()
  try {
    const bytes = encodeReview(review)
    localStorage.setItem(itemKey(id), toBase64(bytes))
  } catch {
    return { ok: false, reason: 'quota' }
  }

  const meta: BookmarkMeta = {
    id,
    createdAt: Date.now(),
    scenarioId: review.scenario.id,
    scenarioLabel: review.scenario.label,
    boardStr: review.board.map(cardLabel).join(' '),
    verdicts: review.decisions.map((d) => d.grading.verdict),
    netBb: input.netBb,
    mode: input.mode,
  }

  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify([meta, ...index]))
  } catch {
    // indexの書き込みに失敗した場合、直前に書き込んだ本体データをロールバックする。
    try {
      localStorage.removeItem(itemKey(id))
    } catch {
      // ロールバック自体の失敗はbest-effortで無視する(元々quota逼迫の状況)。
    }
    return { ok: false, reason: 'quota' }
  }

  return { ok: true, id }
}

export function listBookmarks(): BookmarkMeta[] {
  return loadIndex()
}

export function loadBookmark(id: string): ReviewData | null {
  try {
    const raw = localStorage.getItem(itemKey(id))
    if (!raw) return null
    return decodeReview(fromBase64(raw))
  } catch {
    return null
  }
}

export function deleteBookmark(id: string): void {
  try {
    localStorage.removeItem(itemKey(id))
    localStorage.setItem(INDEX_KEY, JSON.stringify(loadIndex().filter((m) => m.id !== id)))
  } catch {
    // best effort(quota逼迫時でもremoveItem自体は基本的に失敗しないため実運用上は起きにくい)
  }
}
