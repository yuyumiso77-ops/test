// FJ 매출 현황 대시보드 서버: public/ 폴더를 서비스합니다.
// 처음 접속하면 비밀번호 화면이 나오고, 맞는 비밀번호를 넣어야 대시보드와 데이터가 열립니다.
// 비밀번호는 DASHBOARD_PASSWORD 환경 변수로 바꿀 수 있습니다 (없으면 기본값 사용).
// /upload 화면이나 POST /api/upload로 판매정보현황 엑셀을 올리면 합계 CSV를 새로 만들어 대시보드가 바뀝니다.
//   - 합계 파일은 DATA_DIR(없으면 Railway Volume 경로 RAILWAY_VOLUME_MOUNT_PATH)에 저장합니다.
//   - 자동 전송용으로 UPLOAD_KEY 환경 변수를 넣으면, X-Upload-Key 헤더에 그 값을 보낸 요청은 로그인 없이 올릴 수 있습니다.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { aggregate } = require('./aggregate');
const ExcelJS = require('exceljs');
const { parseCompetitors, HEAD: COMP_HEAD } = require('./competitors');

const root = path.join(__dirname, 'public');
const port = Number(process.env.PORT) || 3000;
const password = process.env.DASHBOARD_PASSWORD || '2428';
const token = crypto.createHash('sha256').update('fj-dashboard:' + password).digest('hex');
const uploadKey = process.env.UPLOAD_KEY || '';
const volumeDir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || '';
const dataDir = volumeDir || path.join(__dirname, 'uploaded'); // Volume이 없으면 재배포 때 지워지는 임시 폴더
const MAX_UPLOAD = 60 * 1024 * 1024;
let uploading = false;
const COOKIE = 'fj_auth';
const MAX_AGE = 60 * 60 * 24 * 30; // 30일 동안 로그인 유지

const types = {
  '.html': 'text/html; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// 같은 주소에서 비밀번호를 계속 틀리면 잠시 막습니다 (10분에 10번).
const failures = new Map();
const WINDOW = 10 * 60 * 1000, LIMIT = 10;
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}
function blocked(ip) {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.since > WINDOW) { failures.delete(ip); return false; }
  return f.count >= LIMIT;
}
function recordFailure(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.since > WINDOW) failures.set(ip, { count: 1, since: Date.now() });
  else f.count += 1;
}

function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function loggedIn(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return !!m && same(m[1], token);
}
function isHttps(req) {
  return (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function loginPage(message) {
  const msg = message ? `<p class="msg" role="alert">${message}</p>` : '';
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>FJ 매출 현황</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>
:root { --bg: #f6f7f9; --panel: #ffffff; --fg: #17191c; --muted: #646b75; --line: #e3e6ea; --accent: #2f5fd0; --bad: #c8372d; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg: #111317; --panel: #1a1d22; --fg: #eceef1; --muted: #9aa1ab; --line: #2b2f36; --accent: #6f97ff; --bad: #ff6b5e; color-scheme: dark; } }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { background: var(--bg); color: var(--fg); font-family: "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif; display: grid; place-items: center; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
form { width: 100%; max-width: 340px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 28px 24px; display: flex; flex-direction: column; gap: 14px; }
h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
p { margin: 0; color: var(--muted); font-size: 14px; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--muted); }
input { font: inherit; font-size: 18px; letter-spacing: 0.2em; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button { font: inherit; font-size: 15px; font-weight: 600; color: #fff; background: var(--accent); border: 0; border-radius: 8px; padding: 11px; cursor: pointer; }
.msg { color: var(--bad); }
</style>
</head>
<body>
<form method="post" action="/login">
  <h1>FJ 매출 현황</h1>
  <p>팀원 전용 페이지입니다. 비밀번호를 입력해 주세요.</p>
  ${msg}
  <label for="password">비밀번호
    <input id="password" name="password" type="password" inputmode="numeric" autocomplete="current-password" autofocus required>
  </label>
  <button type="submit">들어가기</button>
</form>
</body>
</html>`;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function handleLogin(req, res) {
  const ip = clientIp(req);
  if (blocked(ip)) return send(res, 429, loginPage('비밀번호를 여러 번 틀렸습니다. 10분 뒤에 다시 시도해 주세요.'));
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 2048) req.destroy();
  });
  req.on('end', () => {
    const given = new URLSearchParams(body).get('password') || '';
    if (!same(given, password)) {
      recordFailure(ip);
      return send(res, 401, loginPage('비밀번호가 맞지 않습니다. 다시 입력해 주세요.'));
    }
    failures.delete(ip);
    const cookie = `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${isHttps(req) ? '; Secure' : ''}`;
    res.writeHead(303, { 'Set-Cookie': cookie, Location: '/', 'Cache-Control': 'no-store' });
    res.end();
  });
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readMeta() {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8')); } catch { return null; }
}

// CSV 읽기/쓰기 (따옴표 처리 포함)
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return { head, rows: body.filter((r) => r.length === head.length) };
}
function toCsv(head, rows) {
  const esc = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
  return [head.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n') + '\n';
}
// 지금 쓰는 자료 파일 (올린 것이 있으면 그것, 없으면 저장소 기본 자료)
function currentFile(name) {
  const up = path.join(dataDir, name);
  if (fs.existsSync(up)) return up;
  const base = path.join(root, 'data', name);
  return fs.existsSync(base) ? base : null;
}
// 이번 달 자료(srcName)를 한 달 합계로 바꿔 월별 기록(destName)에 붙입니다. 같은 달 줄이 있으면 바꿉니다.
function appendMonthly(stage, srcName, destName, month, toRows) {
  const src = currentFile(srcName);
  if (!src) return;
  const add = toRows(parseCsv(fs.readFileSync(src, 'utf8')));
  const destFile = currentFile(destName);
  const dest = destFile ? parseCsv(fs.readFileSync(destFile, 'utf8')) : { head: add.head, rows: [] };
  const order = dest.head.map((h) => add.head.indexOf(h));
  const keep = dest.rows.filter((r) => r[0] !== month);
  fs.writeFileSync(path.join(stage, destName), toCsv(dest.head, keep.concat(add.rows.map((r) => order.map((i) => (i >= 0 ? r[i] : ''))))));
}
// 새 자료가 다른 달이면, 지금 달 자료를 월별 기록(hist_store_daily, month_item)에 붙여 둡니다
function rollMonth(stage, newFirst) {
  const sdFile = currentFile('store_daily.csv');
  if (!sdFile) return null;
  const sd = parseCsv(fs.readFileSync(sdFile, 'utf8'));
  const di = sd.head.indexOf('date');
  const oldMonth = sd.rows.length ? sd.rows[0][di].slice(0, 7) : '';
  if (!oldMonth || oldMonth === newFirst.slice(0, 7)) return null;
  const histFile = currentFile('hist_store_daily.csv');
  const hist = histFile ? parseCsv(fs.readFileSync(histFile, 'utf8')) : { head: sd.head, rows: [] };
  const hdi = hist.head.indexOf('date');
  const keep = hist.rows.filter((r) => r[hdi].slice(0, 7) !== oldMonth);
  const order = hist.head.map((h) => sd.head.indexOf(h));
  fs.writeFileSync(path.join(stage, 'hist_store_daily.csv'), toCsv(hist.head, keep.concat(sd.rows.map((r) => order.map((i) => r[i])))));
  const giFile = currentFile('gender_item_daily.csv'), miFile = currentFile('month_item.csv');
  if (giFile) {
    const gi = parseCsv(fs.readFileSync(giFile, 'utf8'));
    const types = new Map(sd.rows.map((r) => [r[sd.head.indexOf('store_code')], r[sd.head.indexOf('type')]]));
    const ix = (h) => gi.head.indexOf(h);
    const agg = new Map();
    for (const r of gi.rows) {
      const k = [oldMonth, r[ix('store_code')], r[ix('gender')], r[ix('item')], r[ix('line')]].join('\u0001');
      const o = agg.get(k) || { net: 0, qty: 0 };
      o.net += Number(r[ix('net')]) || 0; o.qty += Number(r[ix('qty')]) || 0; agg.set(k, o);
    }
    const head = ['month', 'store_code', 'type', 'gender', 'item', 'line', 'net', 'qty'];
    const mi = miFile ? parseCsv(fs.readFileSync(miFile, 'utf8')) : { head, rows: [] };
    const rows = mi.rows.filter((r) => r[0] !== oldMonth);
    for (const [k, o] of agg) { const [m, code, g, item, line] = k.split('\u0001'); rows.push([m, code, types.get(code) || '기타', g, item, line, String(o.net), String(o.qty)]); }
    fs.writeFileSync(path.join(stage, 'month_item.csv'), toCsv(head, rows));
  }
  const typeOf = new Map(sd.rows.map((r) => [r[sd.head.indexOf('store_code')], r[sd.head.indexOf('type')]]));
  // 회원: 매장별 한 달 합계
  appendMonthly(stage, 'member_daily.csv', 'month_member.csv', oldMonth, (src) => {
    const cols = ['member_net', 'nonmember_net', 'member_sales', 'nonmember_sales', 'member_receipts', 'nonmember_receipts', 'new_members', 'new_member_net'];
    const by = new Map();
    for (const r of src.rows) { const code = r[src.head.indexOf('store_code')]; const o = by.get(code) || cols.map(() => 0); cols.forEach((c, i) => { o[i] += Number(r[src.head.indexOf(c)]) || 0; }); by.set(code, o); }
    return { head: ['month', 'store_code', 'type', ...cols], rows: [...by].map(([code, o]) => [oldMonth, code, typeOf.get(code) || '기타', ...o.map(String)]) };
  });
  // 판매형태: 매장·판매형태 합계 (원래 한 달 합계)
  appendMonthly(stage, 'saletype_store.csv', 'month_saletype.csv', oldMonth, (src) => ({
    head: ['month', 'store_code', 'type', ...src.head.slice(1)],
    rows: src.rows.map((r) => [oldMonth, r[0], typeOf.get(r[0]) || '기타', ...r.slice(1)]) }));
  // 상품: 유통 형태별 상위 60개
  appendMonthly(stage, 'product_store.csv', 'month_product.csv', oldMonth, (src) => {
    const ix = (h) => src.head.indexOf(h);
    const by = new Map();
    for (const r of src.rows) {
      const t = typeOf.get(r[ix('store_code')]) || '기타', k = t + '\u0001' + r[ix('product_code')];
      const o = by.get(k) || { t, code: r[ix('product_code')], name: r[ix('product_name')], line: r[ix('line')], item: r[ix('item')], season: r[ix('season')], qty: 0, net: 0 };
      o.qty += Number(r[ix('qty')]) || 0; o.net += Number(r[ix('net')]) || 0; by.set(k, o);
    }
    const rows = [];
    for (const t of new Set([...by.values()].map((o) => o.t))) {
      [...by.values()].filter((o) => o.t === t).sort((a, b) => b.net - a.net).slice(0, 60)
        .forEach((o) => rows.push([oldMonth, t, o.code, o.name, o.line, o.item, o.season, String(o.qty), String(o.net)]));
    }
    return { head: ['month', 'type', 'product_code', 'product_name', 'line', 'item', 'season', 'qty', 'net'], rows };
  });
  // 상품별 많이 판 매장 상위 10개 (위 상품 상위 목록에 든 상품만)
  const storeName = new Map(sd.rows.map((r) => [r[sd.head.indexOf('store_code')], r[sd.head.indexOf('store')]]));
  appendMonthly(stage, 'product_store.csv', 'month_product_store.csv', oldMonth, (src) => {
    const ix = (h) => src.head.indexOf(h);
    const tot = new Map(), per = new Map();
    for (const r of src.rows) {
      const pc = r[ix('product_code')], sc = r[ix('store_code')], t = typeOf.get(sc) || '기타';
      const k = t + '\u0001' + pc; tot.set(k, (tot.get(k) || 0) + (Number(r[ix('net')]) || 0));
      const k2 = pc + '\u0001' + sc; const o = per.get(k2) || { pc, sc, qty: 0, net: 0 };
      o.qty += Number(r[ix('qty')]) || 0; o.net += Number(r[ix('net')]) || 0; per.set(k2, o);
    }
    const keep = new Set();
    for (const t of new Set([...tot.keys()].map((k) => k.split('\u0001')[0]))) {
      [...tot].filter(([k]) => k.startsWith(t + '\u0001')).sort((a, b) => b[1] - a[1]).slice(0, 60).forEach(([k]) => keep.add(k.split('\u0001')[1]));
    }
    const byP = new Map();
    for (const o of per.values()) if (keep.has(o.pc) && o.net > 0) { if (!byP.has(o.pc)) byP.set(o.pc, []); byP.get(o.pc).push(o); }
    const rows = [];
    for (const [pc, list] of byP) list.sort((a, b) => b.net - a.net).slice(0, 10).forEach((o, i) => rows.push([oldMonth, pc, o.sc, storeName.get(o.sc) || o.sc, String(o.qty), String(o.net), String(i + 1)]));
    return { head: ['month', 'product_code', 'store_code', 'store', 'qty', 'net', 'rank'], rows };
  });
  return oldMonth;
}

// 담당자 파일: 매장코드·매장명·유통사·담당자 열이 있는 엑셀 → managers.csv (저장소가 아니라 저장 공간에만 둡니다)
const MANAGER_HEAD = ['store_code', 'store_name', 'channel', 'manager'];
async function parseManagers(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const cell = (c) => { const v = c && c.value; if (v == null) return ''; if (typeof v === 'object') return String(v.text ?? v.result ?? (v.richText ? v.richText.map((t) => t.text).join('') : '')).trim(); return String(v).trim(); };
  for (const ws of wb.worksheets) {
    let hdr = 0, col = null;
    for (let i = 1; i <= Math.min(ws.rowCount, 20) && !col; i++) {
      const vals = []; ws.getRow(i).eachCell({ includeEmpty: true }, (c, n) => { vals[n] = cell(c).replace(/\s/g, ''); });
      const f = (re) => vals.findIndex((v) => v && re.test(v));
      const code = f(/^매장코드$/), mgr = f(/^담당자$/);
      if (code > 0 && mgr > 0) { hdr = i; col = { code, mgr, name: f(/^매장명$/), ch: f(/^(유통사|유통|채널|유통형태)$/) }; }
    }
    if (!col) continue;
    const rows = [];
    for (let i = hdr + 1; i <= ws.rowCount; i++) {
      const r = ws.getRow(i), g = (n) => (n > 0 ? cell(r.getCell(n)) : '');
      const code = g(col.code), mgr = g(col.mgr);
      if (code && mgr) rows.push([code, g(col.name), g(col.ch), mgr]);
    }
    if (rows.length) return rows;
  }
  throw new Error('담당자 파일에서 "매장코드"와 "담당자" 열을 찾지 못했습니다.');
}

function handleUpload(req, res, by, kind = 'sales') {
  if (uploading) return json(res, 409, { ok: false, message: '다른 자료를 처리하는 중입니다. 1분 뒤에 다시 올려 주세요.' });
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_UPLOAD) return json(res, 413, { ok: false, message: '파일이 너무 큽니다 (60MB까지).' });
  uploading = true;
  const tmp = path.join(os.tmpdir(), `upload-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.xlsx`);
  const out = fs.createWriteStream(tmp);
  let size = 0, failed = false;
  const done = (status, body) => { uploading = false; fs.rm(tmp, { force: true }, () => {}); json(res, status, body); };
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_UPLOAD && !failed) { failed = true; req.destroy(); out.destroy(); done(413, { ok: false, message: '파일이 너무 큽니다 (60MB까지).' }); }
  });
  req.pipe(out);
  out.on('error', () => { if (!failed) { failed = true; done(500, { ok: false, message: '파일을 받는 중 문제가 생겼습니다. 다시 올려 주세요.' }); } });
  out.on('finish', async () => {
    if (failed) return;
    if (!size) return done(400, { ok: false, message: '파일이 비어 있습니다.' });
    try {
      if (kind === 'managers') {
        const rows = await parseManagers(tmp);
        fs.mkdirSync(dataDir, { recursive: true });
        const t = path.join(dataDir, `.managers-${Date.now()}.csv`);
        fs.writeFileSync(t, toCsv(MANAGER_HEAD, rows)); fs.renameSync(t, path.join(dataDir, 'managers.csv'));
        const mgrs = new Set(rows.map((r) => r[3]));
        console.log(`담당자 자료 갱신: 매장 ${rows.length}곳, 담당자 ${mgrs.size}명 (${by})`);
        return done(200, { ok: true, kind, stores: rows.length, managers: mgrs.size, persistent: !!volumeDir });
      }
      if (kind === 'competitors') {
        // 우리 매장 목록(매장코드 맞추기용)
        const stores = new Map();
        for (const f of ['hist_store_daily.csv', 'store_daily.csv']) {
          const p = currentFile(f); if (!p) continue;
          const t = parseCsv(fs.readFileSync(p, 'utf8')), ix = (h) => t.head.indexOf(h);
          for (const r of t.rows) stores.set(r[ix('store_code')], { store_code: r[ix('store_code')], store: r[ix('store')], type: r[ix('type')] });
        }
        const add = await parseCompetitors(tmp, [...stores.values()]);
        // 새 파일에 든 (월, 유통사)는 바꾸고, 나머지 달은 그대로 둡니다
        const keys = new Set(add.map((r) => r[0] + '|' + r[1]));
        const dest = path.join(dataDir, 'competitors.csv');
        const old = fs.existsSync(dest) ? parseCsv(fs.readFileSync(dest, 'utf8')).rows.filter((r) => !keys.has(r[0] + '|' + r[1])) : [];
        fs.mkdirSync(dataDir, { recursive: true });
        const t = path.join(dataDir, `.competitors-${Date.now()}.csv`);
        fs.writeFileSync(t, toCsv(COMP_HEAD, old.concat(add))); fs.renameSync(t, dest);
        const months = [...new Set(add.map((r) => r[0]))].sort(), groups = [...new Set(add.map((r) => r[1]))];
        console.log(`경쟁 브랜드 자료 갱신: ${groups.join('·')} ${months[0]}~${months[months.length - 1]}, ${add.length}줄 (${by})`);
        return done(200, { ok: true, kind, rows: add.length, groups, months, matched: new Set(add.filter((r) => r[3]).map((r) => r[3])).size, persistent: !!volumeDir });
      }
      const { files, meta } = await aggregate(tmp);
      fs.mkdirSync(dataDir, { recursive: true });
      const stage = fs.mkdtempSync(path.join(dataDir, '.incoming-'));
      for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(stage, name), body);
      const rolled = rollMonth(stage, meta.first);
      const name = decodeURIComponent(String(req.headers['x-file-name'] || '')).slice(0, 200);
      const full = { ...meta, uploaded_at: new Date().toISOString(), file_name: name, by, persistent: !!volumeDir, rolled_month: rolled };
      fs.writeFileSync(path.join(stage, 'meta.json'), JSON.stringify(full));
      for (const f of fs.readdirSync(stage)) fs.renameSync(path.join(stage, f), path.join(dataDir, f));
      fs.rmSync(stage, { recursive: true, force: true });
      console.log(`자료 갱신: ${meta.first}~${meta.last}, ${meta.rows}줄 (${by})${rolled ? `, ${rolled} 자료를 월별 기록에 추가` : ''}`);
      done(200, { ok: true, ...full });
    } catch (e) {
      console.error('자료 처리 실패:', e.message);
      done(422, { ok: false, message: e.message || '엑셀을 읽지 못했습니다.' });
    }
  });
}

function uploadPage() {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>자료 올리기 · FJ 매출 현황</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>
:root { --bg: #f6f7f9; --panel: #ffffff; --fg: #17191c; --muted: #646b75; --line: #e3e6ea; --accent: #2f5fd0; --ok: #138a52; --bad: #c8372d; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg: #111317; --panel: #1a1d22; --fg: #eceef1; --muted: #9aa1ab; --line: #2b2f36; --accent: #6f97ff; --ok: #3fc483; --bad: #ff6b5e; color-scheme: dark; } }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--fg); font-family: "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif; font-size: 15px; line-height: 1.55; }
main { max-width: 640px; margin: 0 auto; padding-block: 40px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: flex; flex-direction: column; gap: 18px; }
h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }
p { margin: 0; }
.muted { color: var(--muted); font-size: 14px; }
.drop { border: 2px dashed var(--line); border-radius: 12px; background: var(--panel); padding: 36px 20px; text-align: center; cursor: pointer; display: flex; flex-direction: column; gap: 8px; align-items: center; }
.drop.over { border-color: var(--accent); }
.drop:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
.drop b { font-size: 16px; }
button { font: inherit; font-weight: 600; color: #fff; background: var(--accent); border: 0; border-radius: 8px; padding: 11px 18px; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
.box { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; display: flex; flex-direction: column; gap: 6px; }
.ok { color: var(--ok); font-weight: 600; } .bad { color: var(--bad); font-weight: 600; }
a { color: var(--accent); }
ol { margin: 0; padding-left: 1.3em; }
</style>
</head>
<body>
<main>
  <h1>자료 올리기</h1>
  <p class="muted">ERP에서 내려받은 <b>판매정보현황 엑셀(이번 달 1일부터 어제까지)</b>을 올리면 대시보드가 바로 바뀝니다. 고객번호 같은 원본 값은 저장하지 않고 합계만 남깁니다.</p>
  <div class="box" id="current"><span class="muted">지금 대시보드 자료</span><span id="current-text">확인하는 중…</span></div>
  <label class="drop" id="drop" for="file">
    <b id="drop-title">엑셀 파일을 여기로 끌어다 놓거나 눌러서 고르세요</b>
    <span class="muted" id="drop-sub">.xlsx 파일 하나</span>
    <input id="file" type="file" accept=".xlsx" hidden>
  </label>
  <button id="send" type="button" disabled>올리고 대시보드 갱신</button>
  <div class="box" id="result" hidden></div>
  <h1 style="font-size:19px;margin-top:14px">담당자 파일</h1>
  <p class="muted"><b>매장코드 · 매장명 · 유통사 · 담당자</b> 열이 있는 엑셀을 올리면 대시보드의 담당자별 실적이 채워집니다. 담당자가 바뀔 때만 다시 올리면 됩니다.</p>
  <div class="box"><span class="muted">지금 담당자 자료</span><span id="mgr-current">확인하는 중…</span></div>
  <label class="drop" for="mfile"><b id="mdrop-title">담당자 엑셀 고르기</b><span class="muted" id="mdrop-sub">.xlsx 파일 하나</span><input id="mfile" type="file" accept=".xlsx" hidden></label>
  <button id="msend" type="button" disabled>담당자 자료 올리기</button>
  <div class="box" id="mresult" hidden></div>
  <h1 style="font-size:19px;margin-top:14px">경쟁 브랜드 파일</h1>
  <p class="muted">백화점 <b>동업계 매출 현황 엑셀</b>(롯데 Data_lotte, 현대 Data_hyundai 시트)을 올리면 경쟁 브랜드 동향 탭이 채워집니다. 파일에 든 달·유통사만 바뀌고, 다른 달은 그대로 남습니다.</p>
  <div class="box"><span class="muted">지금 경쟁 브랜드 자료</span><span id="c-current">확인하는 중…</span></div>
  <label class="drop" for="cfile"><b id="cdrop-title">동업계 매출 엑셀 고르기</b><span class="muted" id="cdrop-sub">.xlsx 파일 하나 (롯데·현대 따로면 하나씩 올리세요)</span><input id="cfile" type="file" accept=".xlsx" hidden></label>
  <button id="csend" type="button" disabled>경쟁 브랜드 자료 올리기</button>
  <div class="box" id="cresult" hidden></div>
  <p class="muted"><a href="/">대시보드로 돌아가기</a> · <a href="/logout">로그아웃</a></p>
</main>
<script>
const $ = (id) => document.getElementById(id);
let picked = null;
const fmt = (m) => m ? m.first + ' ~ ' + m.last + ' · ' + m.rows.toLocaleString('ko-KR') + '줄 · 매장 ' + m.stores + '곳 · 순매출 ' + (m.net / 1e8).toFixed(2) + '억원' : '';
function showCurrent() {
  fetch('/data/meta.json', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((m) => {
    $('current-text').textContent = m && m.last ? fmt(m) + ' (올린 시각 ' + new Date(m.uploaded_at).toLocaleString('ko-KR') + ')' : '아직 올린 자료가 없습니다. 저장소에 들어 있는 기본 자료를 보여 주고 있습니다.';
  }).catch(() => { $('current-text').textContent = '확인하지 못했습니다.'; });
}
function pick(f) {
  if (!f) return;
  if (!/\\.xlsx$/i.test(f.name)) { $('drop-sub').textContent = '.xlsx 파일만 올릴 수 있습니다.'; return; }
  picked = f;
  $('drop-title').textContent = f.name;
  $('drop-sub').textContent = (f.size / 1024 / 1024).toFixed(1) + 'MB · 다른 파일을 고르려면 다시 누르세요';
  $('send').disabled = false;
}
$('file').addEventListener('change', (e) => pick(e.target.files[0]));
const drop = $('drop');
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => pick(e.dataTransfer.files[0]));
$('send').addEventListener('click', async () => {
  if (!picked) return;
  $('send').disabled = true; $('send').textContent = '처리하는 중… (30초쯤 걸립니다)';
  const box = $('result'); box.hidden = true;
  try {
    const r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(picked.name) }, body: picked });
    const d = await r.json().catch(() => ({ ok: false, message: '서버 응답을 읽지 못했습니다.' }));
    box.replaceChildren();
    const head = document.createElement('span'); head.className = d.ok ? 'ok' : 'bad';
    head.textContent = d.ok ? '대시보드를 갱신했습니다.' : '올리지 못했습니다.';
    const body = document.createElement('span');
    body.textContent = d.ok ? fmt(d) : (d.message || '다시 시도해 주세요.');
    box.append(head, body);
    if (d.ok && d.rolled_month) { const w = document.createElement('span'); w.className = 'muted'; w.textContent = '새 달 자료라서 ' + d.rolled_month + ' 자료를 월별 기록에 옮겨 두었습니다.'; box.appendChild(w); }
    if (d.ok && !d.persistent) { const w = document.createElement('span'); w.className = 'muted'; w.textContent = '주의: 저장 공간(Volume)이 연결되지 않아, 사이트가 다시 배포되면 이 자료가 사라집니다.'; box.appendChild(w); }
    if (d.ok) { const a = document.createElement('a'); a.href = '/'; a.textContent = '대시보드 보기'; box.appendChild(a); }
    box.hidden = false;
    showCurrent();
  } catch (e) {
    box.textContent = '연결이 끊겼습니다. 다시 올려 주세요.'; box.hidden = false;
  }
  $('send').textContent = '올리고 대시보드 갱신'; $('send').disabled = false;
});
showCurrent();
let mpicked = null;
function showMgr() {
  fetch('/data/managers.csv', { cache: 'no-store' }).then((r) => r.text()).then((t) => {
    const rows = t.trim().split('\n').slice(1).filter(Boolean);
    const m = new Set(rows.map((l) => l.split(',').pop()));
    $('mgr-current').textContent = rows.length ? '매장 ' + rows.length + '곳 · 담당자 ' + m.size + '명' : '아직 올린 담당자 자료가 없습니다.';
  }).catch(() => { $('mgr-current').textContent = '확인하지 못했습니다.'; });
}
$('mfile').addEventListener('change', (e) => {
  const f = e.target.files[0]; if (!f) return;
  if (!/\.xlsx$/i.test(f.name)) { $('mdrop-sub').textContent = '.xlsx 파일만 올릴 수 있습니다.'; return; }
  mpicked = f; $('mdrop-title').textContent = f.name; $('mdrop-sub').textContent = '다른 파일을 고르려면 다시 누르세요'; $('msend').disabled = false;
});
$('msend').addEventListener('click', async () => {
  if (!mpicked) return;
  $('msend').disabled = true;
  const box = $('mresult'); box.replaceChildren();
  try {
    const r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Kind': 'managers', 'X-File-Name': encodeURIComponent(mpicked.name) }, body: mpicked });
    const d = await r.json().catch(() => ({ ok: false, message: '서버 응답을 읽지 못했습니다.' }));
    const head = document.createElement('span'); head.className = d.ok ? 'ok' : 'bad';
    head.textContent = d.ok ? '담당자 자료를 올렸습니다. 매장 ' + d.stores + '곳 · 담당자 ' + d.managers + '명' : (d.message || '올리지 못했습니다.');
    box.appendChild(head);
    if (d.ok && !d.persistent) { const w = document.createElement('span'); w.className = 'muted'; w.textContent = '주의: 저장 공간(Volume)이 연결되지 않아, 사이트가 다시 배포되면 담당자 자료도 사라집니다.'; box.appendChild(w); }
  } catch (e) { box.textContent = '연결이 끊겼습니다. 다시 올려 주세요.'; }
  box.hidden = false; $('msend').disabled = false; showMgr();
});
showMgr();
let cpicked = null;
function showComp() {
  fetch('/data/competitors.csv', { cache: 'no-store' }).then((r) => r.text()).then((t) => {
    const rows = t.trim().split('\n').slice(1).filter(Boolean), ms = [...new Set(rows.map((l) => l.slice(0, 7)))].sort();
    const g = [...new Set(rows.map((l) => l.split(',')[1]))].join('·');
    $('c-current').textContent = rows.length ? g + ' · ' + ms[0] + ' ~ ' + ms[ms.length - 1] + ' · ' + rows.length.toLocaleString('ko-KR') + '줄' : '아직 올린 경쟁 브랜드 자료가 없습니다.';
  }).catch(() => { $('c-current').textContent = '확인하지 못했습니다.'; });
}
$('cfile').addEventListener('change', (e) => {
  const f = e.target.files[0]; if (!f) return;
  if (!/\.xlsx$/i.test(f.name)) { $('cdrop-sub').textContent = '.xlsx 파일만 올릴 수 있습니다.'; return; }
  cpicked = f; $('cdrop-title').textContent = f.name; $('cdrop-sub').textContent = '다른 파일을 고르려면 다시 누르세요'; $('csend').disabled = false;
});
$('csend').addEventListener('click', async () => {
  if (!cpicked) return;
  $('csend').disabled = true; $('csend').textContent = '처리하는 중…';
  const box = $('cresult'); box.replaceChildren();
  try {
    const r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Kind': 'competitors', 'X-File-Name': encodeURIComponent(cpicked.name) }, body: cpicked });
    const d = await r.json().catch(() => ({ ok: false, message: '서버 응답을 읽지 못했습니다.' }));
    const head = document.createElement('span'); head.className = d.ok ? 'ok' : 'bad';
    head.textContent = d.ok ? '경쟁 브랜드 자료를 올렸습니다. ' + d.groups.join('·') + ' ' + d.months[0] + ' ~ ' + d.months[d.months.length - 1] + ' · 우리 매장과 맞춘 점포 ' + d.matched + '곳' : (d.message || '올리지 못했습니다.');
    box.appendChild(head);
    if (d.ok && !d.persistent) { const w = document.createElement('span'); w.className = 'muted'; w.textContent = '주의: 저장 공간(Volume)이 연결되지 않아, 다시 배포되면 이 자료가 사라집니다.'; box.appendChild(w); }
  } catch (e) { box.textContent = '연결이 끊겼습니다. 다시 올려 주세요.'; }
  box.hidden = false; $('csend').disabled = false; $('csend').textContent = '경쟁 브랜드 자료 올리기'; showComp();
});
showComp();
</script>
</body>
</html>`;
}

http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }

  if (pathname === '/login') {
    if (req.method === 'POST') return handleLogin(req, res);
    if (loggedIn(req)) { res.writeHead(303, { Location: '/' }); return res.end(); }
    return send(res, 200, loginPage(''));
  }
  if (pathname === '/logout') {
    res.writeHead(303, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`, Location: '/login' });
    return res.end();
  }
  if (pathname === '/api/upload' && req.method === 'POST' && uploadKey && req.headers['x-upload-key']) {
    if (!same(req.headers['x-upload-key'], uploadKey)) return json(res, 401, { ok: false, message: '업로드 키가 맞지 않습니다.' });
    return handleUpload(req, res, 'api', (['managers', 'competitors'].includes(req.headers['x-kind']) ? req.headers['x-kind'] : 'sales'));
  }
  if (!loggedIn(req)) {
    if (pathname === '/' || pathname === '/upload' || pathname.endsWith('.html')) { res.writeHead(303, { Location: '/login' }); return res.end(); }
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('비밀번호가 필요합니다.');
  }

  if (pathname === '/upload') return send(res, 200, uploadPage());
  if (pathname === '/api/upload') {
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    return handleUpload(req, res, 'web', (['managers', 'competitors'].includes(req.headers['x-kind']) ? req.headers['x-kind'] : 'sales'));
  }
  // 올린 자료가 있으면 그것을, 없으면 저장소에 든 기본 자료를 보여 줍니다
  if (/^\/data\/[a-z_]+\.(csv|json)$/.test(pathname)) {
    const up = path.join(dataDir, path.basename(pathname));
    if (fs.existsSync(up)) {
      res.writeHead(200, { 'Content-Type': types[path.extname(up)], 'Cache-Control': 'no-cache' });
      return fs.createReadStream(up).pipe(res);
    }
    if (pathname === '/data/meta.json') return json(res, 200, null);
    // 담당자 자료는 저장소에 두지 않으므로, 올리지 않았으면 빈 표를 보냅니다
    if (pathname === '/data/managers.csv') return send(res, 200, MANAGER_HEAD.join(',') + '\n', { 'Content-Type': 'text/csv; charset=utf-8' });
    if (pathname === '/data/competitors.csv') return send(res, 200, COMP_HEAD.join(',') + '\n', { 'Content-Type': 'text/csv; charset=utf-8' });
  }

  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.normalize(path.join(root, pathname));
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('페이지를 찾을 수 없습니다.');
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  });
}).listen(port, '0.0.0.0', () => console.log(`대시보드 실행 중: 포트 ${port}`));
