// 판매정보현황 엑셀을 대시보드용 합계 CSV로 바꿉니다 (scripts/*.py와 같은 규칙).
// 고객번호 같은 원본 값은 내보내지 않고, 매장·일자·상품 단위 합계만 만듭니다.
const ExcelJS = require('exceljs');

const TYPES = { C: '백화점', D: '아울렛', B: '가두점', A: '기타' };

function text(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return text(v.result);
    return '';
  }
  return String(v);
}
function num(v) {
  const n = Number(text(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function dateText(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = text(v).trim();
  const m = s.match(/^(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
}

// 엑셀 첫 시트를 읽어 판매 줄 배열을 돌려줍니다.
async function readRows(file) {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(file, { sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', worksheets: 'emit' });
  for await (const sheet of reader) {
    let header = null;
    const rows = [];
    for await (const row of sheet) {
      const vals = row.values; // 1부터 시작
      if (!header) { header = vals.map((v) => text(v).trim()); continue; }
      const r = {};
      header.forEach((h, i) => { if (h) r[h] = vals[i]; });
      rows.push(r);
    }
    return { header: header || [], rows };
  }
  return { header: [], rows: [] };
}

const NEED = ['판매일자', '판매시간', '판매번호', '매장코드', '매장명', '상품코드', '상품명', '판매구분', '판매형태', '고객번호',
  'TAG가', '판매수량', '판매금액', '확정금액', '년도', '라인', '성별', '아이템', '시즌'];

function csv(columns, rows) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}
function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function bump(map, key, init) { let o = map.get(key); if (!o) { o = init(); map.set(key, o); } return o; }

async function aggregate(file) {
  let header, raw;
  try { ({ header, rows: raw } = await readRows(file)); } catch (e) {
    throw new Error('엑셀(.xlsx) 파일을 읽지 못했습니다. ERP에서 내려받은 판매정보현황 엑셀이 맞는지 확인해 주세요.');
  }
  const missing = NEED.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`엑셀에 이 열이 없습니다: ${missing.join(', ')}. 판매정보현황 엑셀이 맞는지 확인해 주세요.`);

  const rows = [];
  for (const r of raw) {
    const date = dateText(r['판매일자']);
    if (!date) continue; // 합계 줄 등
    const storeCode = text(r['매장코드']).trim();
    const sale = text(r['판매구분']).trim() === '판매';
    const qty = num(r['판매수량']), amt = num(r['판매금액']);
    const cust = text(r['고객번호']).trim();
    const genderRaw = text(r['성별']).trim();
    rows.push({
      date, storeCode, sale, qty, amt,
      confirmed: num(r['확정금액']), tag: num(r['TAG가']) * qty,
      store: text(r['매장명']).replace(/^FJ\s+/, '').trim(),
      type: TYPES[storeCode.charAt(0)] || '기타',
      receipt: date + storeCode + text(r['판매번호']).trim(),
      time: text(r['판매시간']).trim(),
      hour: text(r['판매시간']).trim().slice(0, 2),
      saleType: text(r['판매형태']).trim(),
      productCode: text(r['상품코드']).trim(),
      productName: text(r['상품명']).trim(),
      line: text(r['라인']).trim() || '기타',
      item: text(r['아이템']).trim() || '기타',
      genderRaw,
      gender: genderRaw === 'Man' ? '남성' : genderRaw === 'Woman' ? '여성' : '구분 없음',
      year: text(r['년도']).trim(), season: text(r['시즌']).trim(),
      cust, member: cust !== '',
    });
  }
  if (!rows.length) throw new Error('판매 줄을 하나도 찾지 못했습니다. 판매일자 열을 확인해 주세요.');

  const out = {};
  const dates = rows.map((r) => r.date).sort();
  const first = dates[0], last = dates[dates.length - 1];

  // store_daily
  {
    const m = new Map();
    for (const r of rows) {
      const o = bump(m, [r.date, r.storeCode, r.store, r.type].join('\u0001'), () => ({ date: r.date, store_code: r.storeCode, store: r.store, type: r.type,
        sales: 0, returns: 0, net: 0, confirmed: 0, qty: 0, return_qty: 0, tag: 0, rec: new Set() }));
      if (r.sale) { o.sales += r.amt; o.rec.add(r.receipt); } else { o.returns -= r.amt; o.return_qty -= r.qty; }
      o.net += r.amt; o.confirmed += r.confirmed; o.qty += r.qty; o.tag += r.tag;
    }
    const list = [...m.values()].map((o) => ({ ...o, receipts: o.rec.size }))
      .sort((a, b) => cmp(a.date, b.date) || cmp(a.store_code, b.store_code) || cmp(a.store, b.store));
    out['store_daily.csv'] = csv(['date', 'store_code', 'store', 'type', 'sales', 'returns', 'net', 'confirmed', 'qty', 'return_qty', 'tag', 'receipts'], list);
  }

  // product_store (상품명은 가장 많이 쓰인 이름, 시즌 = 년도 끝 두 자리 + FW/SS/ALL)
  {
    const names = new Map(), seasons = new Map();
    for (const r of rows) {
      const c = bump(names, r.productCode, () => new Map());
      c.set(r.productName, (c.get(r.productName) || 0) + 1);
      if (!seasons.has(r.productCode)) {
        const tag = /Fall|Winter/.test(r.season) ? 'FW' : /Spring|Summer/.test(r.season) ? 'SS' : 'ALL';
        const yy = r.year.slice(-2);
        seasons.set(r.productCode, (/^\d\d$/.test(yy) ? yy : '--') + tag); // 년도가 없으면 --
      }
    }
    const nameOf = (code) => [...names.get(code)].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0][0];
    const m = new Map();
    for (const r of rows) {
      const o = bump(m, [r.storeCode, r.line, r.item, r.genderRaw, r.productCode].join('\u0001'), () => ({ store_code: r.storeCode, line: r.line, item: r.item,
        gender: r.genderRaw, product_code: r.productCode, qty: 0, net: 0, confirmed: 0 }));
      o.qty += r.qty; o.net += r.amt; o.confirmed += r.confirmed;
    }
    const list = [...m.values()].map((o) => ({ ...o, product_name: nameOf(o.product_code), season: seasons.get(o.product_code) }))
      .sort((a, b) => cmp(a.store_code, b.store_code) || cmp(a.line, b.line) || cmp(a.item, b.item) || cmp(a.gender, b.gender) || cmp(a.product_code, b.product_code));
    out['product_store.csv'] = csv(['store_code', 'line', 'item', 'gender', 'product_code', 'product_name', 'season', 'qty', 'net', 'confirmed'], list);
  }

  // saletype_store
  {
    const m = new Map();
    for (const r of rows) {
      const o = bump(m, r.storeCode + '\u0001' + r.saleType, () => ({ store_code: r.storeCode, sale_type: r.saleType, net: 0, qty: 0, tag: 0 }));
      o.net += r.amt; o.qty += r.qty; o.tag += r.tag;
    }
    const list = [...m.values()].sort((a, b) => cmp(a.store_code, b.store_code) || cmp(a.sale_type, b.sale_type));
    out['saletype_store.csv'] = csv(['store_code', 'sale_type', 'net', 'qty', 'tag'], list);
  }

  // hour_store
  {
    const m = new Map();
    for (const r of rows) {
      const o = bump(m, r.storeCode + '\u0001' + r.hour, () => ({ store_code: r.storeCode, hour: r.hour, net: 0, rec: new Set() }));
      o.net += r.amt; if (r.sale) o.rec.add(r.receipt);
    }
    const list = [...m.values()].map((o) => ({ ...o, receipts: o.rec.size })).sort((a, b) => cmp(a.store_code, b.store_code) || cmp(a.hour, b.hour));
    out['hour_store.csv'] = csv(['store_code', 'hour', 'net', 'receipts'], list);
  }

  // member_daily (신규 가입 = 자료 마지막 달 번호 F+YYYYMM, 처음 구매한 날·매장에 한 번)
  {
    const recMember = new Map();
    for (const r of rows) if (r.member) recMember.set(r.receipt, true);
    const month = last.slice(0, 7).replace('-', '');
    const isNew = (c) => new RegExp(`^F${month}\\d+$`).test(c);
    const firstSeen = new Map();
    [...rows].filter((r) => isNew(r.cust)).sort((a, b) => cmp(a.date, b.date) || cmp(a.time, b.time))
      .forEach((r) => { if (!firstSeen.has(r.cust)) firstSeen.set(r.cust, r.date + '\u0001' + r.storeCode); });
    const m = new Map();
    const z = (r) => ({ date: r.date, store_code: r.storeCode, member_net: 0, nonmember_net: 0, member_sales: 0, nonmember_sales: 0,
      mrec: new Set(), nrec: new Set(), new_members: 0, new_member_net: 0 });
    for (const r of rows) {
      const o = bump(m, r.date + '\u0001' + r.storeCode, () => z(r));
      if (r.member) o.member_net += r.amt; else o.nonmember_net += r.amt;
      if (r.sale) {
        if (recMember.get(r.receipt)) { o.member_sales += r.amt; o.mrec.add(r.receipt); } else { o.nonmember_sales += r.amt; o.nrec.add(r.receipt); }
      }
      if (isNew(r.cust)) o.new_member_net += r.amt;
    }
    for (const v of firstSeen.values()) { const o = m.get(v); if (o) o.new_members += 1; }
    const list = [...m.values()].map((o) => ({ ...o, member_receipts: o.mrec.size, nonmember_receipts: o.nrec.size }))
      .sort((a, b) => cmp(a.date, b.date) || cmp(a.store_code, b.store_code));
    out['member_daily.csv'] = csv(['date', 'store_code', 'member_net', 'nonmember_net', 'member_sales', 'nonmember_sales', 'member_receipts', 'nonmember_receipts', 'new_members', 'new_member_net'], list);
  }

  // gender_daily, gender_item_daily
  {
    const g = new Map(), gi = new Map();
    for (const r of rows) {
      const o = bump(g, [r.date, r.storeCode, r.gender].join('\u0001'), () => ({ date: r.date, store_code: r.storeCode, gender: r.gender, net: 0, qty: 0 }));
      o.net += r.amt; o.qty += r.qty;
      const p = bump(gi, [r.date, r.storeCode, r.gender, r.item, r.line].join('\u0001'), () => ({ date: r.date, store_code: r.storeCode, gender: r.gender, item: r.item, line: r.line, net: 0, qty: 0 }));
      p.net += r.amt; p.qty += r.qty;
    }
    out['gender_daily.csv'] = csv(['date', 'store_code', 'gender', 'net', 'qty'],
      [...g.values()].sort((a, b) => cmp(a.date, b.date) || cmp(a.store_code, b.store_code) || cmp(a.gender, b.gender)));
    out['gender_item_daily.csv'] = csv(['date', 'store_code', 'gender', 'item', 'line', 'net', 'qty'],
      [...gi.values()].sort((a, b) => cmp(a.date, b.date) || cmp(a.store_code, b.store_code) || cmp(a.gender, b.gender) || cmp(a.item, b.item) || cmp(a.line, b.line)));
  }

  const net = rows.reduce((s, r) => s + r.amt, 0);
  const meta = { first, last, rows: rows.length, stores: new Set(rows.map((r) => r.storeCode)).size, net };
  return { files: out, meta };
}

module.exports = { aggregate };

if (require.main === module) {
  // 명령줄: node aggregate.js 판매정보현황.xlsx 출력폴더
  const fs = require('fs'), path = require('path');
  aggregate(process.argv[2]).then(({ files, meta }) => {
    const dir = process.argv[3] || '.';
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
    console.log(JSON.stringify(meta));
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
