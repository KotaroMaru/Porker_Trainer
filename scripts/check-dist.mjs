#!/usr/bin/env node
// P8-6: ビルド後dist検査(precache混入ガード)。npm run build後に自動実行し、
// GTO解データ(public/gto/solutions/*.bin)がService Workerの事前キャッシュ
// (precacheマニフェスト)へ混入していないこと、代わりに実行時キャッシュ
// (runtimeCaching、CacheFirst)として正しく設定されていることを検査する。
//
// 背景: .binは大量(17マッチアップ×95フロップ)かつビルド成果物ではなくバッチ生成物
// (tools/solver/precompute)であり、vite.config.tsのworkbox.globPatternsには含めない
// 設計(P6 B11)。もし将来の設定変更で誤ってglobPatternsに拾われると、ビルドのたびに
// 全.binをprecache対象にしてしまい、初回ロードが極端に重くなる・SWの更新のたびに
// 再ダウンロードが走るなどの深刻な回帰になる。このスクリプトはその回帰を
// `npm run build`実行時に自動検出する。

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const swPath = join(repoRoot, 'dist/sw.js')

function fail(message) {
  console.error(`[check-dist] NG: ${message}`)
  process.exitCode = 1
}

if (!existsSync(swPath)) {
  fail(`dist/sw.js not found (${swPath}). npm run buildを先に実行してください。`)
  process.exit(1)
}

const sw = readFileSync(swPath, 'utf8')

// (a) precacheマニフェストに.binが混入していないこと。
// vite-plugin-pwa(generateSW)は`precacheAndRoute([{url:"...",revision:...}, ...], {})`
// という形でprecache対象を書き出す。この配列部分だけを抜き出して検査する
// (runtimeCachingの正規表現リテラル `/\.bin$/` 自体に"bin"の文字列を含むため、
// ファイル全体を検査すると誤検知するのを避けるため)。
const precacheMatch = sw.match(/precacheAndRoute\(\[(.*?)\],\s*\{\}\)/s)
if (!precacheMatch) {
  fail('dist/sw.js内にprecacheAndRoute(...)が見つからない(vite-plugin-pwaの出力形式が変わった可能性)')
} else {
  const precacheBody = precacheMatch[1]
  if (precacheBody.includes('.bin"') || precacheBody.includes(".bin'")) {
    fail('precacheマニフェストに.binファイルが混入している(vite.config.tsのworkbox.globPatternsを確認)')
  } else {
    console.log('[check-dist] OK: precacheマニフェストに.binの混入なし')
  }
}

// (b) gto-solutions(.bin用CacheFirst)のruntimeCachingが正しく含まれていること。
if (!sw.includes('gto-solutions') || !sw.includes('CacheFirst')) {
  fail('gto-solutions(CacheFirst)のruntimeCachingがdist/sw.jsに見つからない(vite.config.tsのworkbox.runtimeCachingを確認)')
} else {
  console.log('[check-dist] OK: gto-solutions(CacheFirst)のruntimeCachingを確認')
}

if (process.exitCode === 1) {
  console.error('[check-dist] 検査failed。上記のNGを解消してください。')
} else {
  console.log('[check-dist] 全チェック合格')
}
