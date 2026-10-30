// 純函式：給 RSS、各期頁面（以 key 對應 HTML）與現有 winning.json，算出新的 winning.json（沒變就回 null）。
import { parseRss, parsePage } from "./parse.js";
import { buildPeriod } from "./validate.js";

export const KEEP = 12;
// 頂層出處文字（待真人律師確認格式）；客戶端要忽略未知欄位，所以 schema 維持 1
export const SOURCE = "開獎號碼資料來源：財政部財政資訊中心「統一發票」網站（https://invoice.etax.nat.gov.tw），依政府資料開放授權條款第 1 版利用。本 App 非政府機關產品，結果僅供參考，請以財政部公告為準。";

export function planUpdate({ rssXml, pageHtml, current, now, overwriteKey }) {
  const cur = current && Array.isArray(current.periods) ? current : { schema: 1, version: 0, periods: [] };
  let existing = cur.periods;
  if (overwriteKey) existing = existing.filter((p) => p.key !== overwriteKey);
  const have = new Set(existing.map((p) => p.key));
  const items = parseRss(rssXml);
  if (!items.length) throw new Error("RSS 解析不到任何一期");
  const latest = existing.map((p) => p.key).sort().at(-1);
  // 只處理比檔內最新期新的（或指定覆蓋的那一期），舊到新，一期一期通過驗證
  const todo = items.filter((i) => !have.has(i.key) && (!latest || i.key > latest)).sort((a, b) => a.key.localeCompare(b.key));
  if (!todo.length) return cur.source === SOURCE || !cur.periods.length ? null : { ...cur, source: SOURCE, version: cur.version + 1, updated: now }; // 出處文字有改、沒有新期別也要重寫一次
  const added = [];
  for (const rss of todo) {
    const html = pageHtml(rss);
    const page = parsePage(html);
    const p = buildPeriod(rss, page, [...existing, ...added], now);
    if (p) added.push(p);
  }
  if (!added.length) return null;
  const periods = [...existing, ...added].sort((a, b) => b.key.localeCompare(a.key)).slice(0, KEEP);
  return { schema: 1, version: cur.version + 1, updated: now, source: SOURCE, periods };
}
