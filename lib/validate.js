// 第四節六項驗證。任一項失敗就丟 Error（整次失敗、不覆蓋舊檔）。
import { drawDateOf } from "./parse.js";

const DAY = 86400000;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const isDigits = (s, n) => typeof s === "string" && new RegExp(`^\\d{${n}}$`).test(s);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = (msg) => { throw new Error(msg); };

// ① 只往前一期、不能跳期（檔內沒有任何期別時不限）
export function nextKeyOf(key) {
  const [y, m] = key.split("-").map(Number);
  return m >= 11 ? `${y + 1}-01` : `${y}-${String(m + 2).padStart(2, "0")}`;
}
export function checkSequence(existing, key) {
  if (!existing.length) return;
  const latest = existing.map((p) => p.key).sort().at(-1);
  if (key === latest) return; // 已在檔內：交給第④項比對
  if (key !== nextKeyOf(latest)) fail(`期別 ${key} 不是 ${latest} 的下一期（不能跳期，補歷史期請用手動模式）`);
}

// ② 格式
export function checkFormat(p) {
  if (!isDigits(p.special, 8)) fail(`特別獎格式錯：${p.special}`);
  if (!isDigits(p.grand, 8)) fail(`特獎格式錯：${p.grand}`);
  if (!Array.isArray(p.firsts) || p.firsts.length < 1 || p.firsts.length > 3 || !p.firsts.every((s) => isDigits(s, 8))) fail(`頭獎格式錯：${JSON.stringify(p.firsts)}`);
  if (!Array.isArray(p.extras) || p.extras.length > 3 || !p.extras.every((s) => isDigits(s, 3))) fail(`增開六獎格式錯：${JSON.stringify(p.extras)}`);
}

// ③ RSS 與官方頁面必須一致
export function checkAgree(rss, page) {
  for (const f of ["special", "grand", "firsts", "extras"]) if (!same(rss[f], page[f])) fail(`RSS 與官方頁面的${f}不一致：${JSON.stringify(rss[f])} vs ${JSON.stringify(page[f])}`);
  if (rss.key !== page.key) fail(`RSS 與官方頁面期別不一致：${rss.key} vs ${page.key}`);
}

// ④ 已在檔內的同一期必須完全相同
export function checkUnchanged(existing, p) {
  const old = existing.find((e) => e.key === p.key);
  if (!old) return false;
  for (const f of ["special", "grand", "firsts", "extras"]) if (!same(old[f], p[f])) fail(`${p.key} 已在檔內，但${f}與官方現在不同（官方更正請人工確認後用手動模式覆蓋）`);
  return true;
}

// ⑤ 出現「增開」字樣卻解析不出 3 碼
export function checkExtraWord(rss, page) {
  for (const s of [rss, page]) if (s.hasExtraWord && s.extras.length === 0) fail("偵測到「增開」字樣但解析不出增開六獎號碼");
}

// ⑥ 領獎期間合理；解析不到就留空（回傳 {claimStart:"",claimEnd:""}）
export function checkClaim(drawDate, page) {
  const { claimStart: s, claimEnd: e } = page;
  if (!s || !e) return { claimStart: "", claimEnd: "" };
  const a = days(drawDate, s), b = days(s, e);
  if (a < 1 || a > 40) fail(`領獎起日 ${s} 不在開獎日 ${drawDate} 後 1～40 天`);
  if (b < 80 || b > 120) fail(`領獎迄日 ${e} 不在起日後 80～120 天`);
  return { claimStart: s, claimEnd: e };
}

export function buildPeriod(rss, page, existing, now) {
  checkSequence(existing, rss.key);
  checkFormat(rss);
  checkFormat(page);
  checkAgree(rss, page);
  checkExtraWord(rss, page);
  const drawDate = drawDateOf(rss.key);
  const claim = checkClaim(drawDate, page);
  if (checkUnchanged(existing, rss)) return null; // 已有且相同：不動
  return {
    key: rss.key, roc: rss.roc, label: rss.label, drawDate, ...claim,
    special: rss.special, grand: rss.grand, firsts: rss.firsts, extras: rss.extras,
    source: "auto", verified: true, fetched: now,
  };
}
