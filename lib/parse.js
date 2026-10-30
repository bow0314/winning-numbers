// 解析官方 RSS 與各期頁面。號碼一律字串（保留前導 0）。
const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const eight = /(?<!\d)\d{8}(?!\d)/g;

// "115年 07~08月" / "115年 07 ~ 08 月" → { key: "2026-07", roc: "11507", label }
export function parsePeriodLabel(text) {
  const m = /(\d+)年\s*(\d\d)\s*~\s*(\d\d)\s*月/.exec(text);
  if (!m) return null;
  const rocYear = Number(m[1]), start = Number(m[2]), end = Number(m[3]);
  if (start % 2 !== 1 || end !== start + 1) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return {
    key: `${rocYear + 1911}-${pad(start)}`,
    roc: `${String(rocYear).padStart(3, "0")}${pad(start)}`,
    label: `${rocYear}年 ${pad(start)}~${pad(end)}月`,
  };
}

// 開獎日＝起始月 +2 個月的 25 日（11–12 月期→隔年 1/25）
export function drawDateOf(key) {
  const [y, m] = key.split("-").map(Number);
  const mm = m + 2;
  const year = mm > 12 ? y + 1 : y;
  const month = mm > 12 ? mm - 12 : mm;
  return `${year}-${String(month).padStart(2, "0")}-25`;
}

function numbersFromHtml(html) {
  const text = decode(html);
  const grab = (name) => {
    const m = new RegExp(`${name}[：:]\\s*([0-9、,\\s]+)`).exec(text);
    return m ? m[1].match(eight) || [] : [];
  };
  return { special: grab("特別獎"), grand: grab("特獎"), firsts: grab("頭獎") };
}

// RSS：回傳 [{ ...label, special, grand, firsts, extras, hasExtraWord, pubDate }]，新到舊
export function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1];
    const pick = (tag) => {
      const r = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`).exec(body);
      return r ? r[1].trim() : "";
    };
    const label = parsePeriodLabel(pick("title"));
    if (!label) continue;
    const desc = pick("description");
    const n = numbersFromHtml(desc);
    items.push({
      ...label,
      special: n.special[0] || "",
      grand: n.grand[0] || "",
      firsts: n.firsts,
      extras: extrasFrom(desc),
      hasExtraWord: desc.includes("增開"),
      pubDate: new Date(pick("pubDate")).toISOString(),
    });
  }
  return items;
}

// 增開六獎：「增開六獎：123、456」；沒有就空
function extrasFrom(text) {
  const m = /增開六獎[：:]\s*([0-9、,\s]+)/.exec(decode(text));
  return m ? m[1].match(/(?<!\d)\d{3}(?!\d)/g) || [] : [];
}

// 各期頁面：特別獎、特獎、頭獎在「二獎」字樣之前；領獎期間從注意事項解析
export function parsePage(html) {
  const label = /年月份[\s\S]*?(\d+年\s*\d+\s*~\s*\d+\s*月)/.exec(html);
  const parsed = label ? parsePeriodLabel(label[1].replace(/\s+/g, " ").replace(/(\d+)年 (\d+) ~ (\d+) 月/, (_, a, b, c) => `${a}年 ${b}~${c}月`)) : null;
  const t0 = Math.max(0, html.indexOf("年月份"));
  const a = html.indexOf("特別獎", t0);
  const head = a < 0 ? "" : html.slice(html.lastIndexOf("<th", a), html.indexOf("二獎", a));
  const rows = head.split(/<th[^>]*>/).slice(1);
  const nums = {};
  for (const row of rows) {
    const name = row.slice(0, row.indexOf("</th>")).replace(/<[^>]*>/g, "").trim();
    if (["特別獎", "特獎", "頭獎"].includes(name)) nums[name] = row.match(eight) || [];
  }
  const c = /領獎期間自(\d+)年(\d+)月(\d+)日起至(\d+)年(\d+)月(\d+)日止/.exec(html);
  const iso = (y, mo, d) => `${Number(y) + 1911}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return {
    ...(parsed || {}),
    special: (nums["特別獎"] || [])[0] || "",
    grand: (nums["特獎"] || [])[0] || "",
    firsts: nums["頭獎"] || [],
    extras: extrasFrom(html.replace(/<[^>]*>/g, " ")),
    hasExtraWord: /增開/.test(html),
    claimStart: c ? iso(c[1], c[2], c[3]) : "",
    claimEnd: c ? iso(c[4], c[5], c[6]) : "",
  };
}
