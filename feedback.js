// 매장 현장 목소리: 매장 공유 링크에서 매장이 남긴 의견을 저장하고, 본사가 확인·답변합니다.
// 저장 위치: 저장 공간(dataDir)/feedback.jsonl — 저장소(GitHub)에는 두지 않습니다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CATS = ['상품·재고', '고객 반응', '경쟁 브랜드', '행사·판촉', '인력·운영', '매장 환경', '기타'];
const STATUS = { new: '새 글', seen: '확인', done: '조치 완료' };
const file = (dir) => path.join(dir, 'feedback.jsonl');

function readAll(dir) {
  try {
    return fs.readFileSync(file(dir), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
function writeAll(dir, list) {
  fs.mkdirSync(dir, { recursive: true });
  const t = file(dir) + '.tmp';
  fs.writeFileSync(t, list.map((x) => JSON.stringify(x)).join('\n') + (list.length ? '\n' : ''));
  fs.renameSync(t, file(dir));
}
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, n);

function add(dir, { store_code, store, category, message, name }) {
  const msg = clean(message, 1000);
  if (!msg) throw new Error('내용을 적어 주세요.');
  const item = { id: crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(), store_code, store, category: CATS.includes(category) ? category : '기타', message: msg, name: clean(name, 30), status: 'new', reply: '', reply_at: '' };
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(file(dir), JSON.stringify(item) + '\n');
  return item;
}
function update(dir, id, { status, reply }) {
  const list = readAll(dir), it = list.find((x) => x.id === id);
  if (!it) return null;
  if (status && STATUS[status]) it.status = status;
  if (reply !== undefined) { it.reply = clean(reply, 1000); it.reply_at = it.reply ? new Date().toISOString() : ''; if (it.reply && it.status === 'new') it.status = 'seen'; }
  writeAll(dir, list);
  return it;
}

// 요청 본문 읽기 (작은 폼·JSON만)
function readBody(req, max = 8192) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > max) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

// 같은 주소에서 너무 많이 보내지 않게 (1시간에 20건)
const hits = new Map();
function allowed(ip) {
  const now = Date.now(), v = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (v.length >= 20) { hits.set(ip, v); return false; }
  v.push(now); hits.set(ip, v); return true;
}

module.exports = { CATS, STATUS, readAll, add, update, readBody, allowed };
