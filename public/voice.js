// 오늘의 질문 답변 → 전일 매장 현황 (Railway 사이트 전용)
// '오늘 현장 점검' 탭 맨 위에 마지막 마감일 기준 답변을 모아 보여 줍니다. 하나하나 처리할 필요는 없고, 답변이 필요하면 아래 '매장별 답변'에서 남길 수 있습니다.
(() => {
  let items = [], mgr = new Map(), box, tbObs;
  const $ = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
  const short = (n) => n.replace(/백화점|프리미엄|아울렛|\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
  const won = (v) => (v == null || !isFinite(v) ? '—' : Math.abs(v) >= 1e8 ? (v / 1e8).toFixed(2) + '억' : Math.round(v / 1e4).toLocaleString('ko-KR') + '만');
  const signed = (v) => (v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(0) + '%');
  const shift = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  // 답하는 날(마감 다음 날) 요일별 질문 묶음: 월 = 주간·주말 동향, 금 = 주말 매출 방안, 그 밖 = 전일 매출 추이
  // 열마다 [질문 키들, 카드 제목, 표 열 이름]
  const SETS = { 1: { t: '주간·주말 동향', q: [[['wkend'], '주말 동향', '주말'], [['week'], '주간 동향', '주간'], [['focus'], '이번 주 집중할 일', '이번 주 집중']] },
    5: { t: '주말 매출 방안', q: [[['focusChk'], '이번 주 집중 실천', '집중 실천'], [['plan'], '주말 준비', '주말 준비'], [['risk', 'hope'], '주말 걸림돌·기대 상품', '걸림돌·기대']] },
    d: { t: '전일 매출 추이', q: [[['day'], '어제 상황', '어제 상황'], [['conv'], '방문 대비 구매', '구매율'], [['ret1', 'shoe', 'item', 'lost'], '반품·골프화·상품·놓친 판매', '상품·골프화·반품']] } };
  const CONV = { '구매율 80% 이상': 0.85, '구매율 약 50%': 0.5, '구매율 약 33%': 0.33, '구매율 25% 이하': 0.2 };
  const setOf = (last) => SETS[new Date(Date.parse(shift(last, 1) + 'T00:00:00Z')).getUTCDay()] || SETS.d;

  function load() {
    return Promise.all([
      fetch('/api/feedback', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { items: [] })),
      fetch('data/managers.csv', { cache: 'no-cache' }).then((r) => (r.ok ? r.text() : '')),
    ]).then(([f, m]) => {
      items = f.items || [];
      mgr = new Map(m.trim().split('\n').slice(1).map((l) => l.split(',')).filter((v) => v[0]).map((v) => [v[0], v[v.length - 1]]));
      render();
    }).catch(() => {});
  }

  function render() {
    if (!box) return;
    const dd = window.dash, sd = dd && dd.data('store_daily'), lyd = dd && dd.data('ly_store_daily');
    if (!sd || sd.status !== 'ok' || !sd.data.length) return;
    const m = dd.params().mgr || '', last = sd.data.reduce((a, r) => (r.date > a ? r.date : a), '');
    const net = new Map(), ly = new Map(), names = new Map();
    sd.data.forEach((r) => {
      const ty = dd.params().type || '';
      if (/사용중지|폐점/.test(r.store) || !mgr.has(r.store_code) || (m && mgr.get(r.store_code) !== m) || (ty && r.type !== ty)) return;
      names.set(r.store_code, r.store);
      if (r.date === last) net.set(r.store_code, (net.get(r.store_code) || 0) + (+r.net || 0));
    });
    const S = setOf(last), Q = S.q, wkend = S === SETS[1], from = wkend ? shift(last, -1) : last;
    // 월요일은 주말(토·일) 매출, 그 밖은 전일 매출
    if (wkend) { net.clear(); sd.data.forEach((r) => { if (names.has(r.store_code) && r.date >= from && r.date <= last) net.set(r.store_code, (net.get(r.store_code) || 0) + (+r.net || 0)); }); }
    const lyFrom = shift(from, -364), lyTo = shift(last, -364);
    if (lyd && lyd.status === 'ok') lyd.data.forEach((r) => { if (r.date >= lyFrom && r.date <= lyTo) ly.set(r.store_code, (ly.get(r.store_code) || 0) + (+r.net || 0)); });
    const ans = items.filter((x) => x.qdate === last && names.has(x.store_code));
    const by = new Map(); ans.forEach((x) => { const o = by.get(x.store_code) || {}; o[x.qkey] = x; by.set(x.store_code, o); });
    const pick = (a, keys) => keys.map((k) => a[k]).find(Boolean);
    const cv = ans.filter((x) => x.qkey === 'conv' && CONV[x.choice] != null).map((x) => CONV[x.choice]).sort((a, b) => a - b);
    const md = `${+last.slice(5, 7)}/${+last.slice(8)}`;
    box.sum.textContent = `${md} 마감 기준 · ${S.t} · ${m ? m + ' 담당 · ' : ''}${by.size} / ${names.size}개 매장 답변` + (cv.length ? ` · 추정 구매율 중간값 약 ${Math.round(cv[Math.floor(cv.length / 2)] * 100)}% (${cv.length}곳)` : '');
    box.hr.replaceChildren(...['담당자', '매장', wkend ? '주말 매출' : '어제 매출', '작년 같은 요일 대비', ...Q.map((x) => x[2]), '한 줄 메모'].map((t, i) => $('th', i === 2 || i === 3 ? 'n' : '', t)));
    // 자동 요약: 담당자별 답변율, 구매율 낮은 매장, 재고·사이즈 부족 매장(+베스트 미판매), 경쟁사 언급 매장
    const ins = [], nm = (c) => short(names.get(c) || c), uniq = (a) => [...new Set(a)];
    const mg = new Map(); names.forEach((_, c) => { const k = mgr.get(c) || '담당 없음', o = mg.get(k) || [0, 0]; o[1]++; if (by.has(c)) o[0]++; mg.set(k, o); });
    if (!m && mg.size > 1) ins.push(['담당자별 답변', [...mg].map(([k, [a, n]]) => `${k} ${a}/${n}`).join(' · ')]);
    const low = uniq(ans.filter((x) => x.qkey === 'conv' && CONV[x.choice] != null && CONV[x.choice] <= 0.33).map((x) => x.store_code));
    if (low.length) ins.push(['구매율 낮음 (33% 이하)', `${low.length}곳 · ${low.slice(0, 10).map(nm).join(', ')}${low.length > 10 ? ' 등' : ''} — 들어온 고객을 놓치는 매장: 응대·사이즈 구성 점검`]);
    const STOCK = ['재고·사이즈 부족', '사이즈·컬러 없음', '재고 부족', '재고 없음', '사이즈 없음', '재고·사이즈', '의류 사이즈·컬러 없음', '골프화 사이즈·발볼 없음', '사이즈·발볼 결품', '사이즈·컬러 결품', '인기 사이즈 결품', '이월 물량 부족'];
    const stock = uniq(ans.filter((x) => STOCK.includes(x.choice)).map((x) => x.store_code));
    if (stock.length) {
      const ps = dd.data('product_store'), typ = new Map(sd.data.map((r) => [r.store_code, r.type])), miss = new Map();
      if (ps && ps.status === 'ok') {
        const top = new Map();
        for (const r of ps.data) { const t = typ.get(r.store_code), mm = top.get(t) || new Map(); mm.set(r.product_code, { n: (mm.get(r.product_code) || { n: 0 }).n + (+r.net || 0), name: r.product_name }); top.set(t, mm); }
        const sold = new Map(); ps.data.forEach((r) => { if (+r.qty > 0) { const s2 = sold.get(r.store_code) || new Set(); s2.add(r.product_code); sold.set(r.store_code, s2); } });
        stock.forEach((c) => { const t = [...(top.get(typ.get(c)) || new Map())].sort((a, b) => b[1].n - a[1].n).slice(0, 15).filter(([pc]) => !(sold.get(c) || new Set()).has(pc)); miss.set(c, t.slice(0, 2).map(([, o]) => o.name.replace(/^KR\s*/, ''))); });
      }
      ins.push(['재고·사이즈 부족', stock.slice(0, 8).map((c) => nm(c) + ((miss.get(c) || []).length ? ` (안 팔린 베스트: ${miss.get(c).join(', ')})` : '')).join(' · ') + (stock.length > 8 ? ' 등' : '') + ' — 물류 확인']);
    }
    const comp = uniq(ans.filter((x) => /경쟁사/.test(x.choice || '')).map((x) => x.store_code));
    if (comp.length) ins.push(['경쟁사 영향', `${comp.length}곳 · ${comp.slice(0, 10).map(nm).join(', ')} — 메모에서 브랜드·조건 확인`]);
    const wait = [...names.keys()].filter((c) => !by.has(c));
    if (by.size && wait.length) ins.push(['아직 안 한 매장', `${wait.length}곳 · ${wait.slice(0, 12).map(nm).join(', ')}${wait.length > 12 ? ' 등' : ''}`]);
    box.ins.replaceChildren(...ins.map(([h, t]) => { const li = $('li'); li.append($('b', '', h + ': '), document.createTextNode(t)); return li; }));
    box.ins.hidden = !ins.length;
    // 질문별 답 분포
    box.dist.replaceChildren(...Q.map(([ks, label]) => {
      const cnt = new Map(); ans.filter((x) => ks.includes(x.qkey)).forEach((x) => cnt.set(x.choice || '기타', (cnt.get(x.choice || '기타') || 0) + 1));
      const tot = [...cnt.values()].reduce((a, b) => a + b, 0), card = $('div', 'fd-card');
      card.append($('div', 'fd-h', `${label} · ${tot}곳`));
      if (!tot) card.append($('div', 'fd-none', '아직 답이 없습니다.'));
      [...cnt].sort((a, b) => b[1] - a[1]).forEach(([c, n]) => {
        const row = $('div', 'fd-row'), bar = $('span', 'fd-bar'), fill = $('i');
        fill.style.width = (n / tot * 100).toFixed(0) + '%'; bar.append(fill);
        row.append($('span', 'fd-c', c), bar, $('span', 'fd-n', `${n}곳`)); card.append(row);
      });
      return card;
    }));
    // 매장별 한 줄
    const rows = [...names].map(([code, name]) => ({ code, name, m: mgr.get(code), net: net.get(code) || 0, ly: ly.get(code), a: by.get(code) || {} }))
      .sort((a, b) => (Object.keys(b.a).length > 0) - (Object.keys(a.a).length > 0) || (a.m || '').localeCompare(b.m || '') || b.net - a.net);
    const tb = box.tb; tb.replaceChildren();
    rows.forEach((r) => {
      const tr = $('tr'); const y = r.ly > 0 ? r.net / r.ly - 1 : null;
      const td = (t, c) => $('td', c || '', t);
      const memo = Q.map(([ks]) => { const x = pick(r.a, ks); return x && x.text; }).filter(Boolean).join(' / ');
      tr.append(td(r.m || ''), td(short(r.name)), td(won(r.net), 'n'), td(signed(y), 'n ' + (y == null ? '' : y >= 0 ? 'fj-up' : 'fj-down')),
        ...Q.map(([ks]) => { const x = pick(r.a, ks); return td(x ? x.choice : '—'); }), td(memo, 'fd-memo'));
      if (!Object.keys(r.a).length) tr.className = 'fd-wait';
      tb.append(tr);
    });
    // 답변 남기기 (선택): 최근 답변 30건
    const recent = items.filter((x) => names.has(x.store_code)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
    box.list.replaceChildren(...recent.map((x) => {
      const li = $('li', 'fv-item');
      li.append($('div', 'fv-h', `${short(x.store)} · ${x.qdate ? x.qdate.slice(5).replace('-', '/') + ' 마감' : ''} · ${x.question || ''}`), $('div', 'fv-m', x.message));
      const ta = $('textarea', 'fv-ta'); ta.rows = 1; ta.maxLength = 1000; ta.placeholder = '필요할 때만 답변 (매장 링크에 보입니다)'; ta.value = x.reply || '';
      const bar = $('div', 'fv-bar');
      const b1 = $('button', '', '답변 저장'); b1.type = 'button'; b1.onclick = () => post(x.id, { reply: ta.value }, b1);
      const b2 = $('button', 'fv-del', '삭제'); b2.type = 'button'; b2.onclick = () => { if (confirm(`${x.store}의 이 답변을 지울까요?`)) post(x.id, { delete: true }, b2); };
      bar.append(b1, b2); li.append(ta, bar); return li;
    }));
    box.more.hidden = !recent.length;
    mark();
  }

  function post(id, body, btn) {
    btn.disabled = true;
    fetch('/api/feedback/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json()).then((d) => { if (d.ok) { const i = items.findIndex((x) => x.id === id); if (d.deleted) items.splice(i, 1); else items[i] = d.item; render(); } else btn.disabled = false; })
      .catch(() => { btn.disabled = false; alert('저장하지 못했습니다.'); });
  }

  // 점검 매장 표에 어제 답 표시
  function mark() {
    const tb = document.querySelector('#visit-table tbody');
    if (!tb) return;
    if (!tbObs) { tbObs = new MutationObserver(() => { tbObs.disconnect(); mark(); tbObs.observe(tb, { childList: true }); }); tbObs.observe(tb, { childList: true }); }
    const last = items.reduce((a, x) => (x.qdate > a ? x.qdate : a), '');
    tb.querySelectorAll('tr[data-key]').forEach((tr) => {
      tr.querySelectorAll('.fv-tag').forEach((e) => e.remove());
      const v = items.filter((x) => x.store_code === tr.dataset.key && x.qdate === last);
      if (!v.length || !tr.children[2]) return;
      tr.children[2].appendChild($('div', 'fv-tag', '매장 답: ' + v.map((x) => x.choice).join(' · ')));
    });
  }

  function mount() {
    const tab = document.getElementById('tab-visit');
    if (!tab || box) return;
    const sec = $('section', 'fj-section'); sec.id = 'voice-section';
    const title = $('div', 'fj-sec-title');
    title.append($('h2', '', '매장 현황 (오늘의 질문)'), $('span', 'fj-label', '매장 링크의 오늘의 질문에 매장이 답한 내용을 모았습니다. 월요일은 주말·주간 동향과 이번 주 집중할 일, 화~목은 어제를 구매 고객 수·객단가로 나눈 상황과 방문 대비 구매(추정 구매율), 금요일은 월요일에 고른 일의 실천과 주말 준비를 묻습니다. 하나하나 처리하지 않아도 되고, 맨 위 담당자 필터가 적용됩니다.'));
    const sum = $('p', 'fd-sum'), insl = $('ul', 'fd-ins'), dist = $('div', 'fd-grid');
    const wrap = $('div', 'fj-tablewrap tall'), table = $('table', 'fj-table'), th = $('thead'), hr = $('tr');
    th.append(hr); const tb = $('tbody'); table.append(th, tb); wrap.append(table);
    const more = $('details', 'fd-more'); more.append($('summary', '', '매장별 답변 보기 · 필요할 때만 답변 남기기'));
    const list = $('ul', 'fv-list'); more.append(list);
    sec.append(title, sum, insl, dist, wrap, more);
    tab.insertBefore(sec, tab.firstElementChild);
    box = { sum, ins: insl, dist, tb, list, more, hr };
    const st = document.createElement('style');
    st.textContent = `.fd-sum{margin:0;font-weight:600}.fd-ins{margin:0;padding-left:1.2em;display:flex;flex-direction:column;gap:4px;font-size:14px}
.fd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.fd-card{border:1px solid var(--color-border-line);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.fd-h{font-weight:600;font-size:14px}.fd-none{font-size:13px;color:var(--color-fg-muted)}
.fd-row{display:grid;grid-template-columns:110px 1fr 40px;gap:8px;align-items:center;font-size:13px}.fd-bar{height:8px;background:var(--cds-chart-grid,#e3e6ea);border-radius:3px;overflow:hidden}.fd-bar i{display:block;height:100%;background:var(--c1,#2f5fd0)}.fd-n{text-align:right;color:var(--color-fg-muted)}
tr.fd-wait td{color:var(--color-fg-muted)}td.fd-memo{font-size:12px;max-width:260px}
.fd-more summary{cursor:pointer;font-size:14px;color:var(--color-fg-muted)}
.fv-list{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}
.fv-item{border:1px solid var(--color-border-line);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:4px}
.fv-h{font-size:12px;color:var(--color-fg-muted)}.fv-m{font-size:14px}
.fv-ta{font:inherit;font-size:13px;width:100%;box-sizing:border-box;padding:4px 8px;border:1px solid var(--color-border-line);border-radius:8px;background:transparent;color:inherit;resize:vertical}
.fv-bar{display:flex;gap:8px}.fv-bar button{font:inherit;font-size:12px;padding:3px 10px;border-radius:8px;border:1px solid var(--color-border-line);background:transparent;color:inherit;cursor:pointer}.fv-bar .fv-del{margin-left:auto;color:var(--color-bad,#c8372d)}
.fv-tag{margin-top:4px;font-size:12px;color:var(--c1,#2f5fd0)}`;
    document.head.appendChild(st);
    if (window.dash && dash.onData) dash.onData(() => render());
    load();
    setInterval(load, 60000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
