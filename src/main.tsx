import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// P12 Phase A-3: 実利用がGTO練習主体になったため、GTO専用シェル(GtoApp)を描画対象にした。
// 旧アプリ(テーブル/履歴/統計/一問一答/学習資料の6タブ構成)はApp.tsxにそのまま残っている。
// 旧アプリへ戻す場合はここのimport/JSXを `import { App } from './App.tsx'` / `<App />` へ戻す。
import { GtoApp } from './GtoApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GtoApp />
  </StrictMode>,
)
