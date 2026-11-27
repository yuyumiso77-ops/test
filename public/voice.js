// 매장 현장 목소리 (Railway 사이트 전용): '오늘 현장 점검' 탭 맨 위에 목록을 넣고, 확인·조치 완료·답변을 저장합니다.
(() => {
  let items = [], status = {}, mgr = new Map(), filter = 'open', box, tbObs;
  const $ = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
  const when = (t) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const recent = (x) => Date.now() - Date.parse(x.at) < 14 * 864e5;

  function load() {
    return Promise.all([
      fetch('/api/feedback', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { items: [], status: {} })),
      fetch('data/managers.csv', { cache: 'no-cache' }).then((r) => (r.ok ? r.text() : '')),
    ]).then(([f, m]) => {
      items = f.items || []; status = f.status || {};
      mgr = new Map(m.trim().split('\n').slice(1).map((l) => l.split(',')).filter((v) => v[0]).map((v) => [v[0], v[v.length - 1]]));
      render();
    }).catch(() => {});
  }

  function save(id, body, btn) {
    btn.disabled = true;
    fetch('/api/feedback/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json()).then((d) => { if (d.ok) { const i = items.findIndex((x) => x.id === id); items[i] = d.item; render(); } else btn.disabled = false; })
      .catch(() => { btn.disabled = false; alert('저장하지 못했습니다. 다시 시도해 주세요.'); });
  }

  function render() {
    if (!box) return;
    const m = (window.dash && dash.params().mgr) || '';
    const mine = items.filter((x) => !m || mgr.get(x.store_code) === m);
    const list = mine.filter((x) => (filter === 'open' ? x.status !== 'done' : filter === 'done' ? x.status === 'done' : true)).sort((a, b) => b.at.localeCompare(a.at));
    const nNew = mine.filter((x) => x.status === 'new').length;
    box.sum.textContent = mine.length ? `${m ? m + ' 담당 · ' : ''}전체 ${mine.length}건 · 새 글 ${nNew}건 · 확인 ${mine.filter((x) => x.status === 'seen').length}건 · 조치 완료 ${mine.filter((x) => x.status === 'done').length}건` : '아직 매장에서 보낸 현장 목소리가 없습니다. 매장 공유 링크 맨 아래 "현장 목소리"에서 보낼 수 있습니다.';
    box.list.replaceChildren(...list.slice(0, 60).map((x) => {
      const li = $('li', 'fv-item fv-' + x.status);
      const h = $('div', 'fv-h');
      h.append($('b', '', x.store), document.createTextNode(` · ${mgr.get(x.store_code) || '담당 없음'} · ${x.category} · ${when(x.at)}${x.name ? ' · ' + x.name : ''} `), $('span', 'fv-st', status[x.status] || x.status));
      const msg = $('div', 'fv-m', x.message);
      const ta = $('textarea', 'fv-ta'); ta.rows = 2; ta.maxLength = 1000; ta.placeholder = '매장에 남길 답변 (매장 링크에 보입니다)'; ta.value = x.reply || '';
      const bar = $('div', 'fv-bar');
      const b1 = $('button', '', '답변 저장'); b1.type = 'button'; b1.onclick = () => save(x.id, { reply: ta.value }, b1);
      const b2 = $('button', '', x.status === 'new' ? '확인' : '확인으로'); b2.type = 'button'; b2.onclick = () => save(x.id, { status: 'seen' }, b2);
      const b3 = $('button', '', '조치 완료'); b3.type = 'button'; b3.onclick = () => save(x.id, { status: 'done' }, b3);
      bar.append(b1, ...(x.status !== 'seen' ? [b2] : []), ...(x.status !== 'done' ? [b3] : []));
      if (x.reply_at) bar.append($('span', 'fv-note', '답변 ' + when(x.reply_at)));
      li.append(h, msg, ta, bar);
      return li;
    }));
    if (!list.length && mine.length) box.list.replaceChildren($('li', 'fv-empty', '이 조건에 맞는 글이 없습니다.'));
    // 탭 이름 옆 새 글 수
    const tab = document.querySelector('[data-tab="tab-visit"]');
    if (tab) { let b = tab.querySelector('.fv-badge'); if (!b) { b = $('span', 'fv-badge'); tab.appendChild(b); } b.textContent = nNew ? String(items.filter((x) => x.status === 'new').length) : ''; b.hidden = !items.some((x) => x.status === 'new'); }
    mark();
  }

  // 점검 매장 표에 최근 2주 현장 목소리 표시
  function mark() {
    const tb = document.querySelector('#visit-table tbody');
    if (!tb) return;
    if (!tbObs) { tbObs = new MutationObserver(() => { tbObs.disconnect(); mark(); tbObs.observe(tb, { childList: true }); }); tbObs.observe(tb, { childList: true }); }
    tb.querySelectorAll('tr[data-key]').forEach((tr) => {
      tr.querySelectorAll('.fv-tag').forEach((e) => e.remove());
      const v = items.filter((x) => x.store_code === tr.dataset.key && recent(x)).sort((a, b) => b.at.localeCompare(a.at));
      if (!v.length || !tr.children[2]) return;
      const t = $('div', 'fv-tag', `현장 목소리 ${v.length}건 · ${v[0].category}: ${v[0].message.slice(0, 40)}${v[0].message.length > 40 ? '…' : ''}`);
      t.title = v.map((x) => `[${x.category}] ${x.message}`).join('\n');
      tr.children[2].appendChild(t);
    });
  }

  function mount() {
    const tab = document.getElementById('tab-visit');
    if (!tab || box) return;
    const sec = $('section', 'fj-section'); sec.id = 'voice-section';
    const title = $('div', 'fj-sec-title');
    title.append($('h2', '', '매장 현장 목소리'), $('span', 'fj-label', '매장 공유 링크에서 매장이 보낸 의견입니다. 답변을 저장하면 그 매장 링크에 보이고, 처리하면 "조치 완료"로 바꿔 주세요. 맨 위 담당자 필터가 적용됩니다.'));
    const ctl = $('div', 'fj-controls');
    const lab = $('label', 'fj-ctl'); lab.append($('span', 'fj-label', '보기'));
    const sel = $('select', 'dash-select');
    [['open', '처리 전 (새 글·확인)'], ['all', '전체'], ['done', '조치 완료']].forEach(([v, t]) => sel.append(new Option(t, v)));
    sel.onchange = () => { filter = sel.value; render(); };
    lab.append(sel); ctl.append(lab);
    const sum = $('p', 'fj-label'), list = $('ul', 'fv-list');
    sec.append(title, ctl, sum, list);
    tab.insertBefore(sec, tab.firstElementChild);
    box = { sum, list };
    const st = document.createElement('style');
    st.textContent = `.fv-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.fv-item{border:1px solid var(--color-border-line);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;background:var(--color-panel,transparent)}
.fv-item.fv-new{border-left:4px solid var(--c1,#2f5fd0)}.fv-item.fv-done{opacity:.7}
.fv-h{font-size:13px;color:var(--color-fg-muted)}.fv-h b{color:var(--color-fg)}.fv-m{white-space:pre-wrap}
.fv-st{display:inline-block;padding:0 8px;border:1px solid var(--color-border-line);border-radius:999px;font-size:11px}
.fv-ta{font:inherit;font-size:14px;width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid var(--color-border-line);border-radius:8px;background:transparent;color:inherit;resize:vertical}
.fv-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.fv-bar button{font:inherit;font-size:13px;padding:5px 12px;border-radius:8px;border:1px solid var(--color-border-line);background:transparent;color:inherit;cursor:pointer}
.fv-note{font-size:12px;color:var(--color-fg-muted)}.fv-empty{color:var(--color-fg-muted);font-size:14px}
.fv-tag{margin-top:4px;font-size:12px;color:var(--c1,#2f5fd0)}
.fv-badge{display:inline-block;min-width:18px;margin-left:6px;padding:0 6px;border-radius:999px;background:var(--color-bad,#c8372d);color:#fff;font-size:11px;line-height:18px;text-align:center}`;
    document.head.appendChild(st);
    if (window.dash && dash.onData) dash.onData(() => render());
    load();
    setInterval(load, 60000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
