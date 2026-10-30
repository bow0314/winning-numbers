import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseRss, parsePage, parsePeriodLabel, drawDateOf } from "../lib/parse.js";
import { planUpdate, SOURCE } from "../lib/update.js";
import { buildPeriod, checkSequence, nextKeyOf } from "../lib/validate.js";

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const rssXml = fx("invoice.xml");
const ROCS = ["11507", "11505", "11503", "11501", "11411", "11409"];
const pageHtml = (it) => fx(`page-${it.roc}.html`);
const NOW = "2026-10-31T00:00:00Z";

test("期別標籤與開獎日", () => {
  assert.deepEqual(parsePeriodLabel("115年 07~08月"), { key: "2026-07", roc: "11507", label: "115年 07~08月" });
  assert.equal(parsePeriodLabel("115年 07 ~ 08 月").key, "2026-07");
  assert.equal(parsePeriodLabel("115年 08~09月"), null);
  assert.equal(drawDateOf("2026-07"), "2026-09-25");
  assert.equal(drawDateOf("2025-11"), "2026-01-25"); // 11–12 月期跨年
});

test("RSS 解析 6 期、號碼是字串且保留前導 0", () => {
  const items = parseRss(rssXml);
  assert.equal(items.length, 6);
  assert.deepEqual(items.map((i) => i.roc), ROCS);
  assert.equal(items[0].special, "89996565");
  assert.deepEqual(items[0].firsts, ["54348835", "44991397", "06595111"]);
  assert.deepEqual(items[2].firsts, ["07225810", "20231230", "83518781"]);
  assert.equal(items[4].grand, "00507588");
  for (const i of items) assert.deepEqual(i.extras, []);
});

test("官方頁面解析：號碼、領獎期間（含延期）", () => {
  const p = parsePage(fx("page-11507.html"));
  assert.equal(p.key, "2026-07");
  assert.equal(p.special, "89996565");
  assert.deepEqual(p.firsts, ["54348835", "44991397", "06595111"]);
  assert.equal(p.claimStart, "2026-10-06");
  assert.equal(p.claimEnd, "2027-01-05");
  assert.equal(parsePage(fx("page-11505.html")).claimEnd, "2026-11-05");
});

test("實抓 6 期：RSS 與頁面逐期互證", () => {
  for (const it of parseRss(rssXml)) {
    const p = parsePage(pageHtml(it));
    assert.equal(p.key, it.key);
    assert.deepEqual([p.special, p.grand, p.firsts], [it.special, it.grand, it.firsts]);
  }
});

test("空檔一次補 6 期，產生 winning.json", () => {
  const out = planUpdate({ rssXml, pageHtml, current: null, now: NOW });
  assert.equal(out.schema, 1);
  assert.equal(out.version, 1);
  assert.equal(out.periods.length, 6);
  assert.deepEqual(out.periods.map((p) => p.key), ["2026-07", "2026-05", "2026-03", "2026-01", "2025-11", "2025-09"]);
  const p = out.periods[0];
  assert.equal(p.drawDate, "2026-09-25");
  assert.equal(p.source, "auto");
  assert.equal(p.verified, true);
  assert.deepEqual(p.extras, []);
});

test("沒有新期別 → null（不 commit）", () => {
  const cur = planUpdate({ rssXml, pageHtml, current: null, now: NOW });
  assert.equal(planUpdate({ rssXml, pageHtml, current: cur, now: NOW }), null);
});

test("新一期往前一期，version +1，只保留最近 12 期", () => {
  const cur = planUpdate({ rssXml, pageHtml, current: null, now: NOW });
  const old = { ...cur, periods: cur.periods.slice(1) }; // 假裝還沒抓到最新期
  const out = planUpdate({ rssXml, pageHtml, current: old, now: NOW });
  assert.equal(out.version, old.version + 1);
  assert.equal(out.periods.length, 6);
  const keys = ["2024-07", "2024-09", "2024-11", "2025-01", "2025-03", "2025-05", "2025-07", "2025-09", "2025-11", "2026-01", "2026-03", "2026-05"];
  const many = { ...cur, periods: keys.map((key) => ({ ...cur.periods[5], key })).reverse() };
  const out2 = planUpdate({ rssXml, pageHtml, current: many, now: NOW });
  assert.equal(out2.periods.length, 12);
  assert.equal(out2.periods[0].key, "2026-07");
  assert.equal(out2.periods.at(-1).key, "2024-09"); // 最舊的一期被丟掉
});

// ---- 六項驗證各一個失敗案例 ----
const base = () => { const it = parseRss(rssXml)[0]; return { rss: it, page: parsePage(pageHtml(it)) }; };

test("① 跳期失敗", () => {
  assert.equal(nextKeyOf("2025-11"), "2026-01");
  assert.throws(() => checkSequence([{ key: "2026-03" }], "2026-07"), /不能跳期/);
});
test("② 格式失敗（位數、非數字）", () => {
  const { rss, page } = base();
  assert.throws(() => buildPeriod({ ...rss, special: "1234567" }, page, [], NOW), /特別獎格式錯/);
  assert.throws(() => buildPeriod({ ...rss, firsts: ["12345678", "abcdefgh"] }, page, [], NOW), /頭獎格式錯/);
  assert.throws(() => buildPeriod({ ...rss, extras: ["12"] }, page, [], NOW), /增開六獎格式錯/);
});
test("③ RSS 與頁面不一致失敗", () => {
  const { rss, page } = base();
  assert.throws(() => buildPeriod(rss, { ...page, grand: "00000000" }, [], NOW), /不一致/);
});
test("④ 同一期已在檔內但內容不同 → 失敗不覆蓋", () => {
  const { rss, page } = base();
  const old = { key: rss.key, special: "11111111", grand: rss.grand, firsts: rss.firsts, extras: [] };
  assert.throws(() => buildPeriod(rss, page, [old], NOW), /已在檔內/);
});
test("⑤ 出現「增開」卻解析不出 3 碼 → 失敗", () => {
  const { rss, page } = base();
  assert.throws(() => buildPeriod({ ...rss, hasExtraWord: true }, { ...page, hasExtraWord: true }, [], NOW), /增開/);
  // 有解析到 3 碼就通過
  const ok = buildPeriod({ ...rss, hasExtraWord: true, extras: ["456"] }, { ...page, hasExtraWord: true, extras: ["456"] }, [], NOW);
  assert.deepEqual(ok.extras, ["456"]);
});
test("⑥ 領獎期間不合理失敗；解析不到則留空", () => {
  const { rss, page } = base();
  assert.throws(() => buildPeriod(rss, { ...page, claimStart: "2026-12-01" }, [], NOW), /起日/);
  assert.throws(() => buildPeriod(rss, { ...page, claimEnd: "2026-11-01" }, [], NOW), /迄日/);
  const blank = buildPeriod(rss, { ...page, claimStart: "", claimEnd: "" }, [], NOW);
  assert.equal(blank.claimEnd, "");
});

test("失敗時 planUpdate 丟錯（呼叫端不寫檔）", () => {
  const bad = (it) => fx(`page-${it.roc}.html`).replace("89996565", "89996566");
  assert.throws(() => planUpdate({ rssXml, pageHtml: bad, current: null, now: NOW }), /不一致|格式/);
});

test("頂層 source 出處欄位；舊檔沒有 source 時沒有新期別也會重寫一次", () => {
  const cur = planUpdate({ rssXml, pageHtml, current: null, now: NOW });
  assert.equal(cur.source, SOURCE);
  assert.match(cur.source, /政府資料開放授權條款第 1 版/);
  const { source, ...legacy } = cur;
  const out = planUpdate({ rssXml, pageHtml, current: legacy, now: NOW });
  assert.equal(out.source, SOURCE);
  assert.equal(out.version, legacy.version + 1);
  assert.equal(out.schema, 1); // 加欄位不升 schema，客戶端忽略未知欄位
  assert.deepEqual(out.periods, legacy.periods);
});
