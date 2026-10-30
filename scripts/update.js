// 每次排程執行：抓 RSS（帶 ETag）→ 有新期別才抓官方各期頁面 → 驗證 → 寫 winning.json。失敗不覆蓋舊檔。
import { readFile, writeFile } from "node:fs/promises";
import { planUpdate } from "../lib/update.js";

const RSS = "https://invoice.etax.nat.gov.tw/invoice.xml";
const UA = process.env.WN_USER_AGENT || "winning-numbers/1.0 (+https://github.com/; scheduled fetch of public winning numbers, once per run)";
const RETRY = Number(process.env.RETRY_DELAY_MS ?? 5 * 60 * 1000);
const OUT = new URL("../winning.json", import.meta.url);
const STATE = new URL("../state.json", import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = async (u, d) => { try { return JSON.parse(await readFile(u, "utf8")); } catch { return d; } };

async function get(url, headers = {}) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, ...headers }, redirect: "follow", signal: AbortSignal.timeout(30000) });
      if (r.status === 304) return { status: 304 };
      if (r.status === 403 || r.status === 429) { const e = new Error(`${url} → HTTP ${r.status}（被擋或限流，停手、不重試）`); e.stop = true; throw e; }
      if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
      return { status: r.status, text: await r.text(), etag: r.headers.get("etag") || "" };
    } catch (e) { last = e; if (e.stop) break; if (i < 2) await sleep(RETRY); }
  }
  throw last;
}

const current = await readJson(OUT, null);
const state = await readJson(STATE, {});
const overwriteKey = process.env.OVERWRITE_KEY || "";
const rss = await get(RSS, state.rssEtag && !overwriteKey && current ? { "If-None-Match": state.rssEtag } : {});
if (rss.status === 304) { console.log("RSS 沒有變（304）"); process.exit(0); }

// 先看有哪些新期別，再逐期抓頁面（planUpdate 在需要時才呼叫 pageHtml；這裡預抓同步結果）
const { parseRss } = await import("../lib/parse.js");
const pages = {};
const have = new Set((current?.periods || []).map((p) => p.key));
for (const it of parseRss(rss.text)) {
  if (have.has(it.key) && it.key !== overwriteKey) continue;
  pages[it.key] = (await get(`https://www.etax.nat.gov.tw/etw-main/ETW183W2_${it.roc}`)).text;
}
const next = planUpdate({ rssXml: rss.text, pageHtml: (it) => pages[it.key] ?? "", current, now: new Date().toISOString().replace(/\.\d+Z$/, "Z"), overwriteKey });
if (!next) { console.log("沒有新期別"); await writeFile(STATE, JSON.stringify({ rssEtag: rss.etag }, null, 2) + "\n"); process.exit(0); }
await writeFile(OUT, JSON.stringify(next, null, 2) + "\n");
await writeFile(STATE, JSON.stringify({ rssEtag: rss.etag }, null, 2) + "\n");
console.log(`已更新 winning.json v${next.version}，最新期 ${next.periods[0].key}`);
