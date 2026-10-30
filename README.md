# winning-numbers

每兩個月自動抓財政部統一發票開獎號碼，兩個官方來源（RSS、各期頁面）互相核對無誤後，發布 `winning.json`。
只有公開號碼，沒有任何使用者資料。

## 資料格式
`winning.json`：`schema`、`version`（每次寫檔 +1）、`updated`、`periods[]`（最近 12 期，新到舊）。
每期：`key`（`YYYY-MM`）、`roc`、`label`、`drawDate`、`claimStart`、`claimEnd`（取不到為空字串）、`special`、`grand`、`firsts[]`、`extras[]`（增開六獎，3 碼）、`source: "auto"`、`verified`、`fetched`。號碼一律字串（保留前導 0）。

## 驗證（任一失敗＝整次失敗、不覆蓋舊檔）
1. 新期別必須剛好是檔內最新期的下一期　2. 位數／數字格式　3. RSS 與官方頁面一致　4. 已在檔內的期別內容不可不同　5. 出現「增開」字樣卻解析不出 3 碼　6. 領獎期間合理（取不到就留空）。

## 運作
- `update.yml`：每 3 小時（UTC）；RSS 帶 ETag，沒有新期別就結束；失敗開 Issue「號碼更新失敗 YYYY-MM」。
- `heartbeat.yml`：每週一 commit 一次，避免 60 天無活動被停用排程。
- `pages.yml`：`winning.json` 變動時發布到 GitHub Pages（預設帶 `Access-Control-Allow-Origin: *`，網頁版可直接下載）。
- 官方更正號碼：人工確認後，手動執行 `update-winning-numbers`，填 `overwrite_key`（只能覆蓋最新一期）。

## 抓取禮儀
只做條件 GET（帶 ETag；RSS 沒變就 304 結束），不做高頻輪詢；遇到 403／429 立刻停手、不重試，整次失敗並開 Issue「號碼更新失敗 YYYY-MM」，等人處理。User-Agent 說明用途。

## 發布與驗證 Pages
`GITHUB_TOKEN` 推的 commit 不會觸發別的 workflow，所以 `update.yml` 在有新資料時用 `gh workflow run pages.yml`（workflow_dispatch 不受這個限制）明確叫 `pages.yml`。驗證：Actions 頁在 `update-winning-numbers` 之後應出現一筆 `pages`，完成後 `curl -sI https://<帳號>.github.io/winning-numbers/winning.json` 應回 200 且帶 `access-control-allow-origin: *`。

## 安全
- 第三方 action 都釘到完整 commit SHA（旁邊註明版本），`.github/dependabot.yml` 每月提 PR 更新。
- `permissions` 最小：update（contents／issues／actions 寫入）、heartbeat（contents 寫入）、pages（pages／id-token 寫入、contents 讀取）。
- commit 作者用 GitHub noreply 信箱（`11662507+bow0314@users.noreply.github.com`），歷史裡不留真實信箱。

## 出處
`winning.json` 頂層 `source` 是出處文字（財政部財政資訊中心「統一發票」網站，政府資料開放授權條款第 1 版；格式待真人律師確認）。客戶端要原樣顯示、並忽略不認得的欄位。

## 本機
```
npm test
npm run update
```
