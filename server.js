// 브랜드 매출 현황 대시보드: public/ 폴더를 그대로 서비스하는 작은 서버 (외부 패키지 없음)
// DASHBOARD_PASSWORD 환경 변수를 넣으면 브라우저 로그인 창으로 비밀번호를 묻습니다.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, 'public');
const port = Number(process.env.PORT) || 3000;
const password = process.env.DASHBOARD_PASSWORD || '';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function authorized(req) {
  if (!password) return true;
  const [scheme, value] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Basic' || !value) return false;
  const decoded = Buffer.from(value, 'base64').toString('utf8');
  const given = Buffer.from(decoded.slice(decoded.indexOf(':') + 1));
  const expected = Buffer.from(password);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

http.createServer((req, res) => {
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Brand Sales", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('비밀번호가 필요합니다.');
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    return res.end();
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
}).listen(port, '0.0.0.0', () => console.log(`대시보드 실행 중: 포트 ${port}${password ? ' (비밀번호 사용)' : ''}`));
