// FJ 매출 현황 대시보드 서버: public/ 폴더를 서비스합니다 (외부 패키지 없음).
// 처음 접속하면 비밀번호 화면이 나오고, 맞는 비밀번호를 넣어야 대시보드와 데이터가 열립니다.
// 비밀번호는 DASHBOARD_PASSWORD 환경 변수로 바꿀 수 있습니다 (없으면 기본값 사용).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, 'public');
const port = Number(process.env.PORT) || 3000;
const password = process.env.DASHBOARD_PASSWORD || '2428';
const token = crypto.createHash('sha256').update('fj-dashboard:' + password).digest('hex');
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
  if (!loggedIn(req)) {
    if (pathname === '/' || pathname.endsWith('.html')) { res.writeHead(303, { Location: '/login' }); return res.end(); }
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('비밀번호가 필요합니다.');
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
