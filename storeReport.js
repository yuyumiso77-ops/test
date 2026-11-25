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
  return { code, ...s, first, last, dim, ym, net, sales, returns, receipts, lyNet, lyMonth, projected, s7, p7, l7, rank, peers: peers.length, grp,
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
.wrap{overflow-x:auto}ul{margin:0;padding-left:1.2em}`;

function page(r) {
  const yoy = r.lyNet > 0 ? r.net / r.lyNet - 1 : null, w7 = r.p7 > 0 ? r.s7 / r.p7 - 1 : null, l7 = r.l7 > 0 ? r.s7 / r.l7 - 1 : null;
  const mx = Math.max(1, ...r.days.map((x) => Math.max(x.net, x.ly || 0)));
  const bars = r.days.map((x) => { const w = [0, 6].includes(new Date(x.d + 'T00:00:00Z').getUTCDay()); return `<div class="bar${w ? ' we' : ''}" title="${esc(md(x.d))}(${dow(x.d)}) ${esc(won(x.net))}${x.ly != null ? ' · 작년 같은 요일 ' + esc(won(x.ly)) : ''}"><i style="height:${Math.max(0, x.net / mx * 100).toFixed(1)}%"></i>${x.ly ? `<b style="bottom:${(x.ly / mx * 100).toFixed(1)}%"></b>` : ''}</div>`; }).join('');
  const axis = r.days.map((x) => `<span>${+x.d.slice(8)}</span>`).join('');
  const dtab = r.days.slice().reverse().map((x) => { const g = x.ly > 0 ? x.net / x.ly - 1 : null; return `<tr><td>${esc(md(x.d))} (${dow(x.d)})</td><td class="n">${esc(won(x.net))}</td><td class="n">${x.ly == null ? '—' : esc(won(x.ly))}</td><td class="n ${tone(g)}">${signed(g)}</td></tr>`; }).join('');
  const bt = r.best.map((p, i) => `<tr><td class="n">${i + 1}</td><td>${esc(p.name.replace(/^KR\s*/, ''))}</td><td>${esc(p.cat)}</td><td class="n">${p.qty}</td><td class="n">${esc(won(p.net))}</td></tr>`).join('');
  const catT = r.net > 0 ? r.cats.map(([c, v]) => `${esc(c)} ${pct(v / r.net)}`).join(' · ') : '';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow">
<title>${esc(r.store)} ${+r.ym.slice(5)}월 실적</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"><style>${CSS}</style></head><body><main>
<div><h1>${esc(r.store)}</h1><div class="muted">${esc(r.ym.slice(0, 4))}년 ${+r.ym.slice(5)}월 1일 ~ ${esc(md(r.last))}(${dow(r.last)}) 실적${r.updated ? ' · 자료 갱신 ' + esc(new Date(r.updated).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })) : ''}</div></div>
<p class="lede">이번 달 순매출은 <b>${esc(won(r.net))}</b>이고, 작년 같은 기간 대비 <b class="${tone(yoy)}">${signed(yoy)}</b>입니다. 지금 추세라면 ${+r.ym.slice(5)}월 마감은 약 <b>${esc(won(r.projected))}</b>${r.lyMonth > 0 ? ` (작년 ${+r.ym.slice(5)}월 전체 ${esc(won(r.lyMonth))})` : ''}입니다.${r.rank ? ` ${esc(r.grp)} ${r.peers}개 매장 중 <b>${r.rank}위</b>입니다.` : ''}</p>
<div class="kpis">
<div class="card"><span class="muted">순매출</span><span class="v">${esc(won(r.net))}</span><span class="s">작년 같은 기간 ${esc(won(r.lyNet))}</span></div>
<div class="card"><span class="muted">최근 7일</span><span class="v">${esc(won(r.s7))}</span><span class="s">전주 대비 <b class="${tone(w7)}">${signed(w7)}</b> · 작년 같은 요일 <b class="${tone(l7)}">${signed(l7)}</b></span></div>
<div class="card"><span class="muted">마감 예상</span><span class="v">${esc(won(r.projected))}</span><span class="s">남은 날은 이번 달 같은 요일 평균</span></div>
<div class="card"><span class="muted">객단가</span><span class="v">${esc(won(r.aov))}</span><span class="s">영수증 ${r.receipts.toLocaleString('ko-KR')}건</span></div>
<div class="card"><span class="muted">반품률</span><span class="v">${pct(r.rr)}</span><span class="s">반품 ${esc(won(r.returns))}</span></div>
<div class="card"><span class="muted">회원 매출 비중</span><span class="v">${pct(r.memberShare)}</span><span class="s">신규 가입 ${r.newMembers.toLocaleString('ko-KR')}명</span></div>
</div>
<section><h2>일별 매출</h2><div class="bars">${bars}</div><div class="axis">${axis}</div>
<div class="legend"><span><i style="background:var(--accent)"></i>올해</span><span><i style="background:var(--ly)"></i>작년 같은 요일</span><span>옅은 막대 = 주말</span></div></section>
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
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>매장 공유 링크</title>
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

module.exports = { getSecret, rotateSecret, sign, verify, report, page, storeList, linksPage, table };
