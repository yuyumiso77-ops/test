// 매장 공유용 당월 실적 리포트
// - 매장마다 추측하기 어려운 링크(/s/<매장코드>/<서명>)를 만들어, 비밀번호 없이 그 매장 자료만 보여 줍니다.
// - 서명은 저장 공간에 둔 비밀 값으로 만듭니다. 비밀 값을 새로 만들면 예전 링크는 모두 막힙니다.
// - 다른 매장 이름, 담당자 이름은 보여 주지 않습니다. 같은 유통사 안 순위(숫자)만 보여 줍니다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (v) => v == null || !isFinite(v) ? '—' : Math.abs(v) >= 1e8 ? (v / 1e8).toFixed(2) + '억원' : Math.abs(v) >= 1e4 ? Math.round(v / 1e4).toLocaleString('ko-KR') + '만원' : Math.round(v).toLocaleString('ko-KR') + '원';
const pct = (v) => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(1) + '%';
const signed = (v) => v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
const tone = (v) => v == null || !isFinite(v) ? '' : v >= 0 ? 'up' : 'down';
const DOW = '일월화수목금토';
const dow = (d) => DOW[new Date(d + 'T00:00:00Z').getUTCDay()];
const md = (d) => `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`;
const shift = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const lyDate = (d) => (+d.slice(0, 4) - 1) + d.slice(4);
const cat = (line) => (line === 'Shoes' || line === 'S(임시)' ? '골프화' : line === 'Glove' ? '장갑' : line === 'J line' || line === 'Socks' ? '어패럴' : '기타');
const retailer = (s) => {
  const n = s.store || '', c = /롯데/.test(n) ? '롯데' : /현대/.test(n) ? '현대' : /신세계/.test(n) ? '신세계' : /갤러리아/.test(n) ? '갤러리아' : /AK/.test(n) ? 'AK플라자' : '';
  if (c && (s.type === '백화점' || s.type === '아울렛')) return `${c} ${s.type}`;
  return s.type === '가두점' ? '대리점' : '기타';
};

function secretFile(dataDir) { return path.join(dataDir, '.store_link_secret'); }
function getSecret(dataDir) {
  if (process.env.STORE_LINK_SECRET) return process.env.STORE_LINK_SECRET;
  const f = secretFile(dataDir);
  try { return fs.readFileSync(f, 'utf8').trim(); } catch {}
  return rotateSecret(dataDir);
}
function rotateSecret(dataDir) {
  const s = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(secretFile(dataDir), s, { mode: 0o600 });
  return s;
}
const sign = (secret, code) => crypto.createHmac('sha256', secret).update('store:' + code).digest('base64url').slice(0, 22);
function verify(secret, code, sig) {
  const a = Buffer.from(sign(secret, code)), b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 자료 읽기 (load(name) → {head, rows} 또는 null)
function table(load, name) {
  const t = load(name);
  if (!t) return [];
  return t.rows.map((r) => Object.fromEntries(t.head.map((h, i) => [h, r[i]])));
}

function ly0(load, first, last) {
  const a = lyDate(first), b = lyDate(last);
  return table(load, 'ly_store_daily.csv').filter((r) => r.date >= a && r.date <= b);
}

function storeList(load) {
  const cur = table(load, 'store_daily.csv'), by = new Map();
  for (const r of cur) {
    const o = by.get(r.store_code) || { store_code: r.store_code, store: r.store, type: r.type, net: 0 };
    o.net += +r.net || 0; o.store = r.store; o.type = r.type; by.set(r.store_code, o);
  }
  return [...by.values()].filter((s) => !/사용중지/.test(s.store));
}

function report(load, code, meta) {
  const cur = table(load, 'store_daily.csv');
  const mine = cur.filter((r) => r.store_code === code);
  if (!mine.length) return null;
  const s = { store: mine[mine.length - 1].store, type: mine[mine.length - 1].type };
  const dates = [...new Set(cur.map((r) => r.date))].sort(), first = dates[0], last = dates[dates.length - 1];
  const ym = last.slice(0, 7), y = +ym.slice(0, 4), m = +ym.slice(5, 7), dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const sum = (rows, k) => rows.reduce((a, r) => a + (+r[k] || 0), 0);
  const daily = new Map(); for (const r of mine) daily.set(r.date, (daily.get(r.date) || 0) + (+r.net || 0));
  const ly = table(load, 'ly_store_daily.csv').filter((r) => r.store_code === code);
  const lyDaily = new Map(); for (const r of ly) lyDaily.set(r.date, (lyDaily.get(r.date) || 0) + (+r.net || 0));
  const net = sum(mine, 'net'), sales = sum(mine, 'sales'), returns = sum(mine, 'returns'), receipts = sum(mine, 'receipts');
  const lyRange = ly.filter((r) => r.date >= lyDate(first) && r.date <= lyDate(last)), lyNet = sum(lyRange, 'net');
  const lyMonth = sum(ly.filter((r) => r.date.startsWith(lyDate(ym + '-01').slice(0, 7))), 'net');
  // 마감 예상: 남은 날을 이번 달 같은 요일 평균으로 채움
  const allDays = []; for (let d = first; d <= last; d = shift(d, 1)) allDays.push(d);
  const byDow = new Map(); for (const d of allDays) { const k = dow(d); const o = byDow.get(k) || []; o.push(daily.get(d) || 0); byDow.set(k, o); }
  const avg = (k) => { const v = byDow.get(k) || []; return v.length ? v.reduce((a, b) => a + b, 0) / v.length : net / allDays.length; };
  let rest = 0; for (let d = shift(last, 1); d.slice(0, 7) === ym; d = shift(d, 1)) rest += avg(dow(d));
  const projected = net + rest;
  // 최근 7일
  const w1 = allDays.slice(-7), w0 = w1.map((d) => shift(d, -7));
  const s7 = w1.reduce((a, d) => a + (daily.get(d) || 0), 0), p7 = w0.reduce((a, d) => a + (daily.get(d) || 0), 0);
  const l7 = w1.reduce((a, d) => a + (lyDaily.get(shift(d, -364)) || 0), 0);
  // 같은 유통사 안 순위
  const list = storeList(load), mine2 = list.find((x) => x.store_code === code), grp = retailer(s);
  const peers = list.filter((x) => retailer(x) === grp).sort((a, b) => b.net - a.net), rank = peers.findIndex((x) => x.store_code === code) + 1;
  // 회원
  const mem = table(load, 'member_daily.csv').filter((r) => r.store_code === code);
  const ms = sum(mem, 'member_sales'), ns = sum(mem, 'nonmember_sales'), newMembers = sum(mem, 'new_members');
  // 상품
  const ps = table(load, 'product_store.csv'), mineP = ps.filter((r) => r.store_code === code);
  const prodMap = new Map();
  for (const r of mineP) { const o = prodMap.get(r.product_code) || { name: r.product_name, item: r.item, cat: cat(r.line), qty: 0, net: 0 }; o.qty += +r.qty || 0; o.net += +r.net || 0; prodMap.set(r.product_code, o); }
  const best = [...prodMap.values()].filter((p) => p.net > 0).sort((a, b) => b.net - a.net).slice(0, 10);
  const catMap = new Map(); for (const p of prodMap.values()) catMap.set(p.cat, (catMap.get(p.cat) || 0) + p.net);
  const typeOf = new Map(list.map((x) => [x.store_code, x.type]));
  const co = new Map(); for (const r of ps) if (typeOf.get(r.store_code) === s.type) { const o = co.get(r.product_code) || { name: r.product_name, net: 0 }; o.net += +r.net || 0; co.set(r.product_code, o); }
  const soldHere = new Set(mineP.filter((r) => +r.qty > 0).map((r) => r.product_code));
  const missing = [...co].sort((a, b) => b[1].net - a[1].net).slice(0, 15).filter(([pc]) => !soldHere.has(pc)).map(([, o]) => o.name.replace(/^KR\s*/, ''));
  // ── 더 많은 정보 ──
  const by = (rows, kf, vf = (r) => +r.net || 0) => { const m = new Map(); for (const r of rows) { const k = kf(r); m.set(k, (m.get(k) || 0) + vf(r)); } return m; };
  const tag = sum(mine, 'tag'), confirmed = sum(mine, 'confirmed'), qty = sum(mine, 'qty');
  // 주별 (일~토)
  const wk = (d) => shift(d, -new Date(d + 'T00:00:00Z').getUTCDay());
  const weeks = [...by(allDays.map((d) => ({ d })), (x) => wk(x.d), (x) => daily.get(x.d) || 0)].map(([w, v]) => {
    const ds = allDays.filter((d) => wk(d) === w), l = ds.reduce((a, d) => a + (lyDaily.get(shift(d, -364)) || 0), 0);
    return { from: ds[0], to: ds[ds.length - 1], net: v, ly: l };
  });
  // 월별 (올해 1월~이번 달, 작년 같은 달)
  const hist = table(load, 'hist_store_daily.csv').filter((r) => r.store_code === code && r.date.slice(0, 4) === ym.slice(0, 4) && r.date.slice(0, 7) !== ym);
  const mon = by(hist.concat(mine), (r) => r.date.slice(0, 7)), lyMon = by(ly, (r) => r.date.slice(0, 7));
  const months = [...mon.keys()].sort().map((k) => ({ m: k, net: mon.get(k), ly: k === ym ? lyNet : lyMon.get(lyDate(k + '-01').slice(0, 7)) || 0 }));
  const lyYtd = ly.filter((r) => r.date <= lyDate(last)).reduce((a, r) => a + (+r.net || 0), 0), ytd = months.reduce((a, x) => a + x.net, 0);
  // 요일별 평균, 시간대
  const dowAvg = DOW.split('').map((k) => ({ k, v: avg(k), n: (byDow.get(k) || []).length }));
  const hours = [...by(table(load, 'hour_store.csv').filter((r) => r.store_code === code), (r) => +r.hour)].filter(([, v]) => v > 0).sort((a, b) => a[0] - b[0]);
  // 판매 형태
  const st = table(load, 'saletype_store.csv').filter((r) => r.store_code === code);
  const stypes = [...by(st, (r) => r.sale_type)].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  // 성별·아이템 (작년 같은 날짜와)
  const inLy = (r) => r.date >= lyDate(first) && r.date <= lyDate(last);
  const gi = table(load, 'gender_item_daily.csv').filter((r) => r.store_code === code), lgi = table(load, 'ly_gender_item_daily.csv').filter((r) => r.store_code === code && inLy(r));
  const gen = by(table(load, 'gender_daily.csv').filter((r) => r.store_code === code), (r) => r.gender), lgen = by(lgi, (r) => r.gender);
  const ik = (r) => `${cat(r.line)}·${r.item}`, items = by(gi, ik), litems = by(lgi, ik);
  const itemRows = [...items].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => ({ k, v, ly: litems.get(k) || 0 }));
  const moves = [...new Set([...items.keys(), ...litems.keys()])].map((k) => ({ k, v: items.get(k) || 0, ly: litems.get(k) || 0 })).filter((x) => !/기타·|ETC|^·/.test(x.k));
  const itemUp = moves.filter((x) => x.ly >= 2e6 && x.v - x.ly >= 2e6 && x.v / x.ly >= 1.5).sort((a, b) => (b.v - b.ly) - (a.v - a.ly))[0] || null;
  const itemDown = moves.filter((x) => x.ly >= 3e6 && x.ly - x.v >= 2e6 && x.v / x.ly <= 0.6).sort((a, b) => (b.ly - b.v) - (a.ly - a.v))[0] || null;
  // 시즌
  const season = [...by(mineP, (r) => r.season || '--')].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  // 회원·비회원
  const mr = sum(mem, 'member_receipts'), nr = sum(mem, 'nonmember_receipts');
  const memb = { maov: mr ? ms / mr : null, naov: nr ? ns / nr : null, newNet: sum(mem, 'new_member_net') };
  // 경쟁 브랜드 (백화점 동업계 자료의 이 점포)
  const comp = table(load, 'competitors.csv').filter((r) => r.store_code === code);
  let compInfo = null;
  if (comp.length) {
    const cm = comp.map((r) => r.month).sort().pop(), v = comp.filter((r) => r.month === cm);
    const b = [...by(v, (r) => r.brand)].map(([k, n]) => ({ k, n, l: v.filter((r) => r.brand === k).reduce((a, r) => a + (+r.ly_net || 0), 0) })).filter((x) => x.n > 0).sort((a, c) => c.n - a.n);
    const T = b.reduce((a, x) => a + x.n, 0), L = b.reduce((a, x) => a + x.l, 0);
    const tm = by(comp, (r) => r.month), om = by(comp.filter((r) => r.brand === '풋조이'), (r) => r.month);
    compInfo = { month: cm, zone: v[0].zone_store, group: v[0].group, T, L, brands: b, rank: b.findIndex((x) => x.k === '풋조이') + 1,
      trend: [...tm.keys()].sort().map((k) => ({ m: k, sh: tm.get(k) ? (om.get(k) || 0) / tm.get(k) : null })) };
  }
  // ── 순위 (같은 유통사 / 같은 유통 형태 / 전체) ──
  const lyBy = by(ly0(load, first, last), (r) => r.store_code), w7s = new Set(w1);
  const recBy = by(cur, (r) => r.store_code, (r) => +r.receipts || 0), salesBy = by(cur, (r) => r.store_code, (r) => +r.sales || 0);
  const memAll = table(load, 'member_daily.csv'), msBy = by(memAll, (r) => r.store_code, (r) => +r.member_sales || 0), nsBy = by(memAll, (r) => r.store_code, (r) => +r.nonmember_sales || 0);
  const w7By = by(cur.filter((r) => w7s.has(r.date)), (r) => r.store_code);
  const metric = (x) => { const c = x.store_code, l = lyBy.get(c) || 0, rc = recBy.get(c) || 0, t = (msBy.get(c) || 0) + (nsBy.get(c) || 0);
    return { net: x.net, yoy: l >= 1e6 ? x.net / l - 1 : null, w7: w7By.get(c) || 0, aov: rc ? (salesBy.get(c) || 0) / rc : null, mem: t ? (msBy.get(c) || 0) / t : null }; };
  const act = list.filter((x) => x.net > 0).map((x) => ({ ...x, mt: metric(x) })), me = act.find((x) => x.store_code === code);
  const tg = (x) => (x.type === '가두점' ? '대리점' : x.type);
  const scopes = (grp === tg(s) || grp === '기타' ? [] : [[grp, act.filter((x) => retailer(x) === grp)]]).concat([[`${tg(s)} 전체`, act.filter((x) => tg(x) === tg(s))], ['전체', act]]);
  const KEYS = [['net', '이번 달 순매출'], ['yoy', '전년 대비 신장률'], ['w7', '최근 7일 매출'], ['aov', '객단가'], ['mem', '회원 매출 비중']];
  const ranks = me ? KEYS.map(([k, label]) => ({ label, v: me.mt[k], k, by: scopes.map(([sn, pool]) => {
    const v = pool.filter((x) => x.mt[k] != null).sort((a, b) => b.mt[k] - a.mt[k]); const i = v.findIndex((x) => x.store_code === code);
    return { sn, rank: i >= 0 ? i + 1 : null, n: v.length }; }) })) : [];
  // 월별 유통사 내 순위
  const histAll = table(load, 'hist_store_daily.csv').filter((r) => r.date.slice(0, 4) === ym.slice(0, 4) && r.date.slice(0, 7) !== ym);
  const rankTrend = [];
  for (const mm of [...new Set(histAll.map((r) => r.date.slice(0, 7)))].sort().concat([ym])) {
    const rows = mm === ym ? cur : histAll.filter((r) => r.date.startsWith(mm)), tot = new Map(), info = new Map();
    for (const r of rows) { tot.set(r.store_code, (tot.get(r.store_code) || 0) + (+r.net || 0)); info.set(r.store_code, r); }
    if (!tot.get(code)) continue;
    const pool = [...tot].filter(([c, v]) => v > 0 && retailer(info.get(c)) === grp).sort((a, b) => b[1] - a[1]);
    rankTrend.push({ m: mm, rank: pool.findIndex(([c]) => c === code) + 1, n: pool.length });
  }
  return { code, ...s, first, last, dim, ym, net, tag, ranks, rankTrend, itemUp, itemDown, confirmed, qty, weeks, months, ytd, lyYtd, dowAvg, hours, stypes, gen, lgen, itemRows, season, memb, compInfo, sales, returns, receipts, lyNet, lyMonth, projected, s7, p7, l7, rank, peers: peers.length, grp,
    aov: receipts ? sales / receipts : null, rr: sales ? returns / sales : null, memberShare: ms + ns ? ms / (ms + ns) : null, newMembers,
    days: allDays.map((d) => ({ d, net: daily.get(d) || 0, ly: lyDaily.get(shift(d, -364)) })), best, cats: [...catMap].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]), missing, updated: meta && meta.uploaded_at };
}

const CSS = `:root{--bg:#f6f7f9;--panel:#fff;--fg:#17191c;--muted:#646b75;--line:#e3e6ea;--accent:#2f5fd0;--ly:#b5bcc6;--up:#138a52;--down:#c8372d;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#111317;--panel:#1a1d22;--fg:#eceef1;--muted:#9aa1ab;--line:#2b2f36;--accent:#6f97ff;--ly:#4a505a;--up:#3fc483;--down:#ff6b5e;color-scheme:dark}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--fg);font-family:"Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;font-size:15px;line-height:1.55}
main{max-width:860px;margin:0 auto;padding:28px max(16px,env(safe-area-inset-right)) 48px max(16px,env(safe-area-inset-left));display:flex;flex-direction:column;gap:22px}
h1{margin:0;font-size:24px;letter-spacing:-.02em}h2{margin:0 0 10px;font-size:17px}.muted{color:var(--muted);font-size:13px}
.lede{font-size:17px;margin:0}.lede b{font-variant-numeric:tabular-nums}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:2px}
.card .v{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}.card .s{font-size:12px;color:var(--muted)}
.up{color:var(--up)}.down{color:var(--down)}
section{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
.bars{display:flex;align-items:flex-end;gap:3px;height:150px;border-bottom:1px solid var(--line);position:relative}
.bar{flex:1;position:relative;height:100%;display:flex;align-items:flex-end}.bar i{display:block;width:100%;background:var(--accent);border-radius:2px 2px 0 0}
.bar.we i{opacity:.65}.bar b{position:absolute;left:-1px;right:-1px;border-top:2px solid var(--ly)}
.axis{display:flex;gap:3px;font-size:10px;color:var(--muted)}.axis span{flex:1;text-align:center}
.legend{display:flex;gap:14px;font-size:12px;color:var(--muted);margin-top:6px}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:7px 6px;border-bottom:1px solid var(--line);text-align:left}th{font-size:12px;color:var(--muted);font-weight:600}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.wrap{overflow-x:auto}ul{margin:0;padding-left:1.2em}li{margin:2px 0}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:22px}.two section{min-width:0}
.hb{display:flex;flex-direction:column;gap:6px}.hr{display:grid;grid-template-columns:44px 1fr auto;gap:8px;align-items:center;font-size:13px}.ht{height:10px;background:var(--line);border-radius:3px;overflow:hidden}.ht i{display:block;height:100%;background:var(--accent)}.hv{color:var(--muted);font-variant-numeric:tabular-nums;font-size:12px;white-space:nowrap}
tr.me td{font-weight:700}
.qc{border:1px solid var(--line);border-radius:10px;padding:12px;margin-top:10px;display:flex;flex-direction:column;gap:8px}.qc.done{opacity:.75}.qq{font-weight:600}.qa{color:var(--up);font-size:14px}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chips input{position:absolute;opacity:0;pointer-events:none}.chips span{display:inline-block;padding:6px 12px;border:1px solid var(--line);border-radius:999px;font-size:14px;cursor:pointer;background:var(--bg)}.chips input:checked+span{background:var(--accent);border-color:var(--accent);color:#fff}.chips input:focus-visible+span{outline:2px solid var(--accent)}
.qc input[name=message]{font:inherit;font-size:15px;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px}.qc button{align-self:flex-start;font:inherit;font-weight:600;color:#fff;background:var(--accent);border:0;border-radius:8px;padding:8px 16px;cursor:pointer}
.vbtn{display:inline-block;font-size:13px;font-weight:600;color:var(--accent);text-decoration:none;border:1px solid var(--accent);border-radius:999px;padding:5px 12px}
.vf{display:flex;flex-direction:column;gap:10px}.vf label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted)}
.vf select,.vf textarea,.vf input{font:inherit;font-size:15px;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px}
.vf button{align-self:flex-start;font:inherit;font-weight:600;color:#fff;background:var(--accent);border:0;border-radius:8px;padding:10px 18px;cursor:pointer}
.ok{color:var(--up);font-weight:600}.bad{color:var(--down);font-weight:600}
.vl{list-style:none;padding:0;display:flex;flex-direction:column;gap:10px}.vi{border:1px solid var(--line);border-radius:10px;padding:10px 12px}.vh{font-size:12px;color:var(--muted)}.vm{margin-top:4px;white-space:pre-wrap}
.vr{margin-top:6px;padding:6px 10px;background:var(--bg);border-radius:8px;font-size:14px}.vs{margin-left:4px;padding:1px 8px;border-radius:999px;border:1px solid var(--line);font-size:11px}.vs.done{color:var(--up);border-color:var(--up)}.vs.new{color:var(--accent);border-color:var(--accent)}
.rks{display:flex;flex-wrap:wrap;gap:6px}.rk{display:flex;flex-direction:column;align-items:center;min-width:54px;padding:6px 4px;border:1px solid var(--line);border-radius:8px;font-variant-numeric:tabular-nums}.rk small{font-size:11px;color:var(--muted)}`;

const vbars = (rows) => { const mx = Math.max(1, ...rows.map((x) => Math.max(x.v, x.ly || 0)));
  return `<div class="bars">${rows.map((x) => `<div class="bar${x.we ? ' we' : ''}" title="${esc(x.t)}"><i style="height:${Math.max(0, x.v / mx * 100).toFixed(1)}%"></i>${x.ly ? `<b style="bottom:${(x.ly / mx * 100).toFixed(1)}%"></b>` : ''}</div>`).join('')}</div><div class="axis">${rows.map((x) => `<span>${esc(x.a)}</span>`).join('')}</div>`; };
const hbars = (rows) => { const mx = Math.max(1, ...rows.map((x) => x.v));
  return `<div class="hb">${rows.map((x) => `<div class="hr"><span class="hn">${esc(x.k)}</span><span class="ht"><i style="width:${Math.max(0, x.v / mx * 100).toFixed(1)}%"></i></span><span class="hv">${esc(x.t)}</span></div>`).join('')}</div>`; };
const LEG = '<div class="legend"><span><i style="background:var(--accent)"></i>올해</span><span><i style="background:var(--ly)"></i>작년</span></div>';
function more(r) {
  const g = (a, b) => (b > 0 ? a / b - 1 : null), out = [];
  const ytdY = g(r.ytd, r.lyYtd);
  out.push(`<section><h2>월별 추이 (올해 vs 작년)</h2><p class="muted" style="margin:0 0 8px">올해 누계 ${esc(won(r.ytd))} · 작년 같은 기간 ${esc(won(r.lyYtd))} · <b class="${tone(ytdY)}">${signed(ytdY)}</b>. 이번 달 막대는 ${esc(md(r.last))}까지, 회색 선은 작년 같은 기간입니다.</p>
${vbars(r.months.map((x) => ({ v: x.net, ly: x.ly, a: `${+x.m.slice(5)}월`, t: `${+x.m.slice(5)}월 ${won(x.net)} · 작년 ${won(x.ly)} · ${signed(g(x.net, x.ly))}` })))}${LEG}</section>`);
  out.push(`<section><h2>주별 매출</h2><div class="wrap"><table><thead><tr><th>주</th><th class="n">순매출</th><th class="n">작년 같은 요일</th><th class="n">전년 대비</th></tr></thead><tbody>${r.weeks.map((w) => { const y = g(w.net, w.ly); return `<tr><td>${esc(md(w.from))} ~ ${esc(md(w.to))}</td><td class="n">${esc(won(w.net))}</td><td class="n">${esc(won(w.ly))}</td><td class="n ${tone(y)}">${signed(y)}</td></tr>`; }).join('')}</tbody></table></div></section>`);
  const bestH = r.hours.slice().sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => `${h}시`).join(', ');
  out.push(`<div class="two"><section><h2>요일별 하루 평균</h2>${hbars(r.dowAvg.map((x) => ({ k: x.k, v: x.v, t: `${won(x.v)} (${x.n}일)` })))}</section>
<section><h2>시간대별 매출</h2><p class="muted" style="margin:0 0 8px">많이 파는 시간: ${esc(bestH || '—')}</p>${hbars(r.hours.map(([h, v]) => ({ k: `${h}시`, v, t: `${won(v)} · ${pct(r.net ? v / r.net : null)}` })))}</section></div>`);
  out.push(`<section><h2>아이템별 매출 상위 10</h2><div class="wrap"><table><thead><tr><th>카테고리·아이템</th><th class="n">순매출</th><th class="n">비중</th><th class="n">작년 같은 기간</th><th class="n">전년 대비</th></tr></thead><tbody>${r.itemRows.map((x) => { const y = g(x.v, x.ly); return `<tr><td>${esc(x.k)}</td><td class="n">${esc(won(x.v))}</td><td class="n">${pct(r.net ? x.v / r.net : null)}</td><td class="n">${x.ly ? esc(won(x.ly)) : '—'}</td><td class="n ${tone(y)}">${x.ly ? signed(y) : '신규'}</td></tr>`; }).join('')}</tbody></table></div></section>`);
  const gT = [...r.gen.values()].reduce((a, b) => a + Math.max(0, b), 0), lT = [...r.lgen.values()].reduce((a, b) => a + Math.max(0, b), 0);
  const genL = ['남성', '여성'].map((k) => { const sh = gT ? (r.gen.get(k) || 0) / gT : null, lsh = lT ? (r.lgen.get(k) || 0) / lT : null; return `<li><b>${k}</b> ${esc(won(r.gen.get(k) || 0))} · ${pct(sh)}${lsh != null ? ` (작년 ${pct(lsh)})` : ''}</li>`; }).join('');
  const disc = r.tag ? 1 - r.net / r.tag : null;
  out.push(`<div class="two"><section><h2>성별 · 시즌</h2><ul>${genL}</ul><p class="muted" style="margin:10px 0 4px">시즌(상품 년도) 비중</p><ul>${r.season.map(([k, v]) => `<li>${esc(k)} ${pct(r.net ? v / r.net : null)} · ${esc(won(v))}</li>`).join('')}</ul></section>
<section><h2>판매 형태 · 할인</h2><p class="muted" style="margin:0 0 8px">평균 할인율 ${pct(disc)} (TAG가 대비) · 확정금액 ${esc(won(r.confirmed))} · 판매 수량 ${r.qty.toLocaleString('ko-KR')}개</p><ul>${r.stypes.map(([k, v]) => `<li>${esc(k)} ${pct(r.net ? v / r.net : null)} · ${esc(won(v))}</li>`).join('')}</ul></section></div>`);
  out.push(`<section><h2>회원 · 비회원</h2><ul><li>회원 매출 비중 ${pct(r.memberShare)} · 회원 객단가 ${esc(won(r.memb.maov))} · 비회원 객단가 ${esc(won(r.memb.naov))}</li><li>신규 가입 ${r.newMembers.toLocaleString('ko-KR')}명 · 신규 가입 고객 매출 ${esc(won(r.memb.newNet))}</li></ul></section>`);
  const c = r.compInfo;
  if (c) {
    const o = c.brands.find((x) => x.k === '풋조이'), sh = o && c.T ? o.n / c.T : null, lsh = o && c.L ? o.l / c.L : null;
    out.push(`<section><h2>경쟁 브랜드 (${esc(c.group)} ${esc(c.zone)} · ${+c.month.slice(5)}월)</h2><p class="muted" style="margin:0 0 8px">백화점 동업계 매출 자료 기준입니다. 풋조이 <b>${c.rank ? `${c.brands.length}개 브랜드 중 ${c.rank}위` : '자료 없음'}</b> · 점유율 ${pct(sh)}${lsh != null ? ` (작년 ${pct(lsh)})` : ''}</p>
<div class="wrap"><table><thead><tr><th class="n">순위</th><th>브랜드</th><th class="n">매출</th><th class="n">점유율</th><th class="n">전년 대비</th></tr></thead><tbody>${c.brands.slice(0, 10).concat(c.rank > 10 ? [o] : []).map((x) => { const y = g(x.n, x.l); return `<tr${x.k === '풋조이' ? ' class="me"' : ''}><td class="n">${c.brands.indexOf(x) + 1}</td><td>${esc(x.k)}</td><td class="n">${esc(won(x.n))}</td><td class="n">${pct(c.T ? x.n / c.T : null)}</td><td class="n ${tone(y)}">${x.l ? signed(y) : '—'}</td></tr>`; }).join('')}</tbody></table></div>
<p class="muted" style="margin:10px 0 4px">풋조이 점유율 월별: ${c.trend.map((x) => `${+x.m.slice(5)}월 ${pct(x.sh)}`).join(' · ')}</p></section>`);
  }
  return out.join('\n');
}

// ── 오늘의 질문: 마지막 마감일 숫자에 맞춰 매장마다 자동으로 (최대 3개) ──
const A = {
  up: ['단체·큰 구매 고객', '행사 효과', '신상품 반응', '날씨·유동 인구', '직원 추천 판매', '기타'],
  down: ['휴무·단축 영업', '방문객 감소', '재고·사이즈 부족', '경쟁사 행사', '인력 부족', '기타'],
  itemUp: ['신상품 디자인', '가격·행사', '진열 위치', '날씨', '직원 추천', '기타'],
  itemDown: ['재고 부족', '시즌 영향', '가격', '진열 위치', '경쟁사', '기타'],
  miss: ['재고 없음', '사이즈 없음', '진열 안 됨', '고객 반응 없음', '이미 팔렸음(자료 늦음)', '기타'],
  ret: ['사이즈', '하자·품질', '단순 변심', '교환 대기', '기타'],
  comp: ['할인 행사', '사은품', '신상품', '매장 확장·이동', '잘 모름'],
  any: ['다운·아우터', '니트·스웨터', '팬츠', '골프화', '장갑·용품', '기타'],
};
const itemName = (k) => k.replace('·', ' ');
function questions(r) {
  const q = [], d = r.days[r.days.length - 1], md2 = `${md(d.d)}(${dow(d.d)})`, g = (a, b) => (b > 0 ? a / b - 1 : null);
  const yd = g(d.net, d.ly), w = g(r.s7, r.l7);
  if (d.net <= 0 && (d.ly || 0) > 0) q.push({ key: 'day', cat: '인력·운영', q: `${md2} 매출이 없었어요 (작년 같은 요일 ${won(d.ly)}). 어떤 사정이 있었나요?`, a: A.down });
  else if (yd != null && d.ly >= 5e5 && yd >= 0.5) q.push({ key: 'day', cat: '고객 반응', q: `${md2} 매출은 ${won(d.net)}, 작년 같은 요일 대비 ${signed(yd)}예요. 무엇이 잘됐나요?`, a: A.up });
  else if (yd != null && d.ly >= 5e5 && yd <= -0.4) q.push({ key: 'day', cat: '고객 반응', q: `${md2} 매출은 ${won(d.net)}, 작년 같은 요일 대비 ${signed(yd)}예요. 이유가 있었나요?`, a: A.down });
  if (w != null && r.l7 >= 2e6 && w <= -0.2) q.push({ key: 'week', cat: '고객 반응', q: `최근 7일 매출이 작년 같은 요일보다 ${signed(w)}예요. 가장 큰 이유는 무엇인가요?`, a: A.down });
  else if (w != null && r.l7 >= 2e6 && w >= 0.25) q.push({ key: 'week', cat: '고객 반응', q: `최근 7일 매출이 작년 같은 요일보다 ${signed(w)}예요. 잘된 방법을 다른 매장과 나눠 주세요.`, a: A.up });
  if (r.itemDown) q.push({ key: 'itemDown', cat: '상품·재고', q: `${itemName(r.itemDown.k)} 매출이 작년 같은 기간보다 ${signed(g(r.itemDown.v, r.itemDown.ly))}예요 (${won(r.itemDown.ly)} → ${won(r.itemDown.v)}). 이유는?`, a: A.itemDown });
  if (r.itemUp) q.push({ key: 'itemUp', cat: '상품·재고', q: `${itemName(r.itemUp.k)} 매출이 작년 같은 기간보다 ${signed(g(r.itemUp.v, r.itemUp.ly))}예요 (${won(r.itemUp.ly)} → ${won(r.itemUp.v)}). 잘 팔리는 이유는?`, a: A.itemUp });
  if (r.missing.length >= 3) q.push({ key: 'miss', cat: '상품·재고', q: `다른 매장 베스트인 ${r.missing.slice(0, 2).join(', ')} 등 ${r.missing.length}개가 이번 달 아직 안 팔렸어요. 매장에 있나요?`, a: A.miss });
  if (r.rr >= 0.25 && r.returns >= 1e6) q.push({ key: 'ret', cat: '상품·재고', q: `이번 달 반품률이 ${pct(r.rr)}예요 (반품 ${won(r.returns)}). 주된 반품 사유는?`, a: A.ret });
  const c = r.compInfo;
  if (c && c.L) {
    const gain = c.brands.filter((x) => x.k !== '풋조이').map((x) => ({ k: x.k, pp: x.n / c.T - x.l / c.L })).sort((a, b) => b.pp - a.pp)[0];
    if (gain && gain.pp >= 0.03) q.push({ key: 'comp', cat: '경쟁 브랜드', q: `${+c.month.slice(5)}월 이 점포에서 ${gain.k} 점유율이 ${(gain.pp * 100).toFixed(1)}%p 올랐어요. 요즘 ${gain.k}는 어떤 행사를 하나요?`, a: A.comp });
  }
  q.push({ key: 'any', cat: '고객 반응', q: '이번 주 고객 반응이 가장 좋은 상품군은 무엇이고, 이유는 무엇인가요?', a: A.any });
  return q.slice(0, 3).map((x) => ({ ...x, qdate: d.d }));
}

function voice(fb) {
  const when = (t) => new Date(t).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const items = fb.list.slice().reverse().slice(0, 10).map((x) => `<li class="vi"><div class="vh"><b>${esc(x.category)}</b> · ${esc(when(x.at))}${x.name ? ' · ' + esc(x.name) : ''} <span class="vs ${esc(x.status)}">${esc(fb.status[x.status] || '')}</span></div>${x.question ? `<div class="vh">Q. ${esc(x.question)}</div>` : ''}<div class="vm">${esc(x.message)}</div>${x.reply ? `<div class="vr"><b>본사 답변</b> ${esc(x.reply)}</div>` : ''}</li>`).join('');
  const qs = fb.questions || [], done = new Map(fb.list.filter((x) => x.qkey).map((x) => [`${x.qdate}|${x.qkey}`, x]));
  const qcards = qs.map((x, i) => {
    const a = done.get(`${x.qdate}|${x.key}`);
    if (a) return `<div class="qc done"><div class="qq">${esc(x.q)}</div><div class="qa">✓ 답변함: ${esc(a.choice || '')}${a.text ? ' · ' + esc(a.text) : ''}</div></div>`;
    return `<form method="post" action="${esc(fb.action)}" class="qc"><input type="hidden" name="qkey" value="${esc(x.key)}"><input type="hidden" name="qdate" value="${esc(x.qdate)}"><input type="hidden" name="question" value="${esc(x.q)}"><input type="hidden" name="category" value="${esc(x.cat)}">
<div class="qq"><b>Q${i + 1}.</b> ${esc(x.q)}</div><div class="chips">${x.a.map((c, j) => `<label><input type="radio" name="choice" value="${esc(c)}"${j === 0 ? '' : ''}><span>${esc(c)}</span></label>`).join('')}</div>
<input name="message" maxlength="500" placeholder="한 줄 덧붙이기 (선택)"><button type="submit">답하기</button></form>`;
  }).join('');
  const qsec = qs.length ? `<section id="today-q"><h2>오늘의 질문 <span class="muted" style="font-weight:400">· ${esc(md(qs[0].qdate))} 마감 기준</span></h2><p class="muted" style="margin:0 0 10px">${esc(md(qs[0].qdate))} 마감 매출을 보고 드리는 질문입니다. 맞는 답을 하나 골라 주세요.</p>${fb.sent === 'ok' ? '<p class="ok">답변이 등록되었습니다.</p>' : fb.sent === 'err' ? '<p class="bad">답을 하나 고른 뒤 다시 눌러 주세요.</p>' : ''}${qcards}</section>` : '';
  return `${qsec}${items ? `<section id="voice"><h2>지난 답변과 본사 답변</h2><ul class="vl">${items}</ul></section>` : ''}`;
}

function rankSec(r) {
  if (!r.ranks.length) return '';
  const fmt = (k, v) => (k === 'yoy' ? signed(v) : k === 'mem' ? pct(v) : won(v));
  const head = r.ranks[0].by.map((b) => `<th class="n">${esc(b.sn)} (${b.n}개)</th>`).join('');
  const rows = r.ranks.map((x) => `<tr><td>${esc(x.label)}</td><td class="n">${esc(fmt(x.k, x.v))}</td>${x.by.map((b) => `<td class="n">${b.rank ? `<b class="${b.rank <= Math.ceil(b.n / 4) ? 'up' : b.rank > b.n - Math.ceil(b.n / 4) ? 'down' : ''}">${b.rank}위</b> / ${b.n}` : '—'}</td>`).join('')}</tr>`).join('');
  const tr = r.rankTrend.map((t) => `<span class="rk"><small>${+t.m.slice(5)}월</small><b>${t.rank}위</b><small>/ ${t.n}</small></span>`).join('');
  const n = r.ranks[0].by[0];
  return `<section><h2>순위 · ${r.ranks[0].by.slice(0, 2).map((b) => `${esc(b.sn)} ${b.n}개 중 ${b.rank}위`).join(' · ')}</h2><p class="muted" style="margin:0 0 8px">이번 달 매출이 있는 FJ 매장끼리 비교합니다. 높을수록 1위이고, 상위 1/4은 초록, 하위 1/4은 빨강입니다. 전년 대비는 작년 같은 기간 매출이 100만원 이상인 매장만 셉니다.</p>
<div class="wrap"><table><thead><tr><th>기준</th><th class="n">우리 매장</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
${tr ? `<p class="muted" style="margin:12px 0 6px">월별 ${esc(n.sn)} 안 순위 (순매출)</p><div class="rks">${tr}</div>` : ''}</section>`;
}

function page(r, fb = { list: [], cats: [], status: {}, sent: '', action: '' }) {
  const yoy = r.lyNet > 0 ? r.net / r.lyNet - 1 : null, w7 = r.p7 > 0 ? r.s7 / r.p7 - 1 : null, l7 = r.l7 > 0 ? r.s7 / r.l7 - 1 : null;
  const mx = Math.max(1, ...r.days.map((x) => Math.max(x.net, x.ly || 0)));
  const bars = r.days.map((x) => { const w = [0, 6].includes(new Date(x.d + 'T00:00:00Z').getUTCDay()); return `<div class="bar${w ? ' we' : ''}" title="${esc(md(x.d))}(${dow(x.d)}) ${esc(won(x.net))}${x.ly != null ? ' · 작년 같은 요일 ' + esc(won(x.ly)) : ''}"><i style="height:${Math.max(0, x.net / mx * 100).toFixed(1)}%"></i>${x.ly ? `<b style="bottom:${(x.ly / mx * 100).toFixed(1)}%"></b>` : ''}</div>`; }).join('');
  const axis = r.days.map((x) => `<span>${+x.d.slice(8)}</span>`).join('');
  const dtab = r.days.slice().reverse().map((x) => { const g = x.ly > 0 ? x.net / x.ly - 1 : null; return `<tr><td>${esc(md(x.d))} (${dow(x.d)})</td><td class="n">${esc(won(x.net))}</td><td class="n">${x.ly == null ? '—' : esc(won(x.ly))}</td><td class="n ${tone(g)}">${signed(g)}</td></tr>`; }).join('');
  const bt = r.best.map((p, i) => `<tr><td class="n">${i + 1}</td><td>${esc(p.name.replace(/^KR\s*/, ''))}</td><td>${esc(p.cat)}</td><td class="n">${p.qty}</td><td class="n">${esc(won(p.net))}</td></tr>`).join('');
  const catT = r.net > 0 ? r.cats.map(([c, v]) => `${esc(c)} ${pct(v / r.net)}`).join(' · ') : '';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>${esc(r.store)} ${+r.ym.slice(5)}월 실적</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"><style>${CSS}</style></head><body><main>
<div><h1>${esc(r.store)}</h1><div class="muted">${esc(r.ym.slice(0, 4))}년 ${+r.ym.slice(5)}월 1일 ~ ${esc(md(r.last))}(${dow(r.last)}) 실적${r.updated ? ' · 자료 갱신 ' + esc(new Date(r.updated).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })) : ''}</div></div>
<p style="margin:0"><a class="vbtn" href="#today-q">오늘의 질문 답하기 ↓</a></p>
<p class="lede">이번 달 순매출은 <b>${esc(won(r.net))}</b>이고, 작년 같은 기간 대비 <b class="${tone(yoy)}">${signed(yoy)}</b>입니다. 지금 추세라면 ${+r.ym.slice(5)}월 마감은 약 <b>${esc(won(r.projected))}</b>${r.lyMonth > 0 ? ` (작년 ${+r.ym.slice(5)}월 전체 ${esc(won(r.lyMonth))})` : ''}입니다.${r.ranks.length ? ' 순매출 순위는 ' + r.ranks[0].by.map((b) => `${esc(b.sn)} ${b.n}개 매장 중 <b>${b.rank}위</b>`).join(', ') + '입니다.' : ''}</p>
<div class="kpis">
${r.ranks.length ? r.ranks[0].by.slice(0, 2).map((b) => `<div class="card"><span class="muted">${esc(b.sn)} 순위</span><span class="v">${b.rank}위 <small style="font-size:14px;font-weight:500">/ ${b.n}개</small></span><span class="s">이번 달 순매출 기준</span></div>`).join('') : ''}
<div class="card"><span class="muted">순매출</span><span class="v">${esc(won(r.net))}</span><span class="s">작년 같은 기간 ${esc(won(r.lyNet))}</span></div>
<div class="card"><span class="muted">최근 7일</span><span class="v">${esc(won(r.s7))}</span><span class="s">전주 대비 <b class="${tone(w7)}">${signed(w7)}</b> · 작년 같은 요일 <b class="${tone(l7)}">${signed(l7)}</b></span></div>
<div class="card"><span class="muted">마감 예상</span><span class="v">${esc(won(r.projected))}</span><span class="s">남은 날은 이번 달 같은 요일 평균</span></div>
<div class="card"><span class="muted">객단가</span><span class="v">${esc(won(r.aov))}</span><span class="s">영수증 ${r.receipts.toLocaleString('ko-KR')}건</span></div>
<div class="card"><span class="muted">반품률</span><span class="v">${pct(r.rr)}</span><span class="s">반품 ${esc(won(r.returns))}</span></div>
<div class="card"><span class="muted">회원 매출 비중</span><span class="v">${pct(r.memberShare)}</span><span class="s">신규 가입 ${r.newMembers.toLocaleString('ko-KR')}명</span></div>
</div>
${voice(fb)}
${rankSec(r)}
<section><h2>일별 매출</h2><div class="bars">${bars}</div><div class="axis">${axis}</div>
<div class="legend"><span><i style="background:var(--accent)"></i>올해</span><span><i style="background:var(--ly)"></i>작년 같은 요일</span><span>옅은 막대 = 주말</span></div></section>
${more(r)}
<section><h2>상품 베스트 10</h2>${catT ? `<p class="muted" style="margin:0 0 8px">카테고리 비중: ${catT}</p>` : ''}<div class="wrap"><table><thead><tr><th class="n">순위</th><th>상품</th><th>카테고리</th><th class="n">수량</th><th class="n">순매출</th></tr></thead><tbody>${bt || '<tr><td colspan="5">판매 상품이 없습니다.</td></tr>'}</tbody></table></div></section>
${r.missing.length ? `<section><h2>확인해 볼 상품</h2><p class="muted" style="margin:0 0 8px">같은 유통 형태 매장들의 이번 달 베스트 15 중 우리 매장에서 아직 안 팔린 상품입니다. 재고와 진열을 확인해 주세요.</p><ul>${r.missing.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></section>` : ''}
<section><h2>일별 실적표</h2><div class="wrap"><table><thead><tr><th>날짜</th><th class="n">순매출</th><th class="n">작년 같은 요일</th><th class="n">전년 대비</th></tr></thead><tbody>${dtab}</tbody></table></div></section>
<p class="muted">순매출 = 판매금액 − 반품금액 (ERP 판매정보현황 기준). 이 링크는 이 매장 전용입니다. 다른 사람에게 전달하지 마세요.</p>
</main></body></html>`;
}

function linksPage(rows, base, managers) {
  const order = ['백화점', '아울렛', '대리점', '기타'];
  const grpOf = (s) => (s.type === '가두점' ? '대리점' : order.includes(s.type) ? s.type : '기타');
  rows.sort((a, b) => order.indexOf(grpOf(a)) - order.indexOf(grpOf(b)) || retailer(a).localeCompare(retailer(b), 'ko') || b.net - a.net);
  const mgrs = [...new Set(rows.map((r) => managers.get(r.store_code)).filter(Boolean))].sort();
  const tr = rows.map((r) => `<tr data-m="${esc(managers.get(r.store_code) || '')}"><td>${esc(grpOf(r))}</td><td>${esc(r.store)}</td><td>${esc(managers.get(r.store_code) || '')}</td><td class="u"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a></td><td><button type="button" data-u="${esc(r.url)}" data-n="${esc(r.store)}">복사</button></td></tr>`).join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><title>매장 공유 링크</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"><style>${CSS}
td.u{max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}td.u a{color:var(--accent)}button{font:inherit;font-size:13px;border:1px solid var(--line);background:var(--panel);color:var(--fg);border-radius:8px;padding:5px 10px;cursor:pointer}
.bar2{display:flex;gap:10px;flex-wrap:wrap;align-items:center}select{font:inherit;padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--fg)}.danger{color:var(--down)}</style></head><body><main>
<div><h1>매장 공유 링크</h1><p class="muted">매장마다 그 매장 실적만 보이는 링크입니다. 비밀번호 없이 열리고, 판매 자료를 올릴 때마다 내용이 바뀝니다. 다른 매장 이름과 담당자 이름은 보이지 않습니다.</p></div>
<div class="bar2"><label>담당자 <select id="m"><option value="">전체</option>${mgrs.map((m) => `<option>${esc(m)}</option>`).join('')}</select></label>
<button type="button" id="all">보이는 링크 모두 복사 (매장명 + 링크)</button><a href="/">대시보드로 돌아가기</a></div>
<div class="wrap"><table><thead><tr><th>형태</th><th>매장</th><th>담당자</th><th>링크</th><th></th></tr></thead><tbody>${tr}</tbody></table></div>
<section><h2>링크가 새어 나갔을 때</h2><p class="muted" style="margin:0 0 10px">아래 버튼을 누르면 지금까지 보낸 링크가 모두 막히고 새 링크가 만들어집니다. 새 링크를 다시 보내야 합니다.</p>
<form method="post" action="/links/rotate" onsubmit="return confirm('지금까지 보낸 매장 링크가 모두 막힙니다. 계속할까요?')"><button type="submit" class="danger">모든 링크 새로 만들기</button></form></section>
<script>
const sel=document.getElementById('m');sel.onchange=()=>{document.querySelectorAll('tbody tr').forEach(t=>{t.hidden=!!sel.value&&t.dataset.m!==sel.value;});};
const copy=(t,b)=>navigator.clipboard.writeText(t).then(()=>{const o=b.textContent;b.textContent='복사됨';setTimeout(()=>b.textContent=o,1200);});
document.querySelectorAll('button[data-u]').forEach(b=>b.onclick=()=>copy(b.dataset.n+' '+b.dataset.u,b));
document.getElementById('all').onclick=(e)=>copy([...document.querySelectorAll('tbody tr:not([hidden]) button[data-u]')].map(b=>b.dataset.n+' '+b.dataset.u).join('\\n'),e.target);
</script></main></body></html>`;
}

module.exports = { questions, getSecret, rotateSecret, sign, verify, report, page, storeList, linksPage, table };
