// 백화점 동업계(경쟁 브랜드) 매출 엑셀 → 월·점포·브랜드별 합계
// 읽는 시트: 롯데 "Data_lotte"(원 단위, 총매출·대비실적), 현대 "Data_hyundai"(천원 단위, 매출액·신장률)
// 결과 열: month, group(롯데/현대), zone_store(엑셀의 점포명), store_code(우리 매장코드, 못 찾으면 빈칸), brand, channel(오프라인/온라인), net, ly_net
const ExcelJS = require('exceljs');

const HEAD = ['month', 'group', 'zone_store', 'store_code', 'brand', 'channel', 'net', 'ly_net'];

const txt = (c) => {
  const v = c && c.value;
  if (v == null) return '';
  if (typeof v === 'object') return String(v.text ?? v.result ?? (v.richText ? v.richText.map((t) => t.text).join('') : '')).trim();
  return String(v).trim();
};
const num = (c) => {
  const v = c && c.value;
  const x = typeof v === 'object' && v ? v.result : v;
  const n = typeof x === 'number' ? x : Number(String(x ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const month = (s) => {
  const m = String(s).match(/(\d{2,4})\s*년\s*(\d{1,2})\s*월/);
  if (!m) return '';
  const y = m[1].length === 2 ? '20' + m[1] : m[1];
  return `${y}-${String(m[2]).padStart(2, '0')}`;
};

// 브랜드 이름을 롯데·현대 사이에서 맞춤
const ALIAS = { 피엑스지: 'PXG', 아페쎄골프: 'A.P.C.골프', 마스터바니에디션: '마스터바니', 엠유스포츠: 'MU스포츠', 링스지엔씨: '링스', 왁: '왁(WAAC)', 보그너골프: '보그너', 나이키골프레알: '나이키골프', 던롭디오네골프: '던롭', 캘러웨이CGK: '캘러웨이', 팬텀행사: '팬텀', 팬텀아울렛: '팬텀', 말본: '말본골프' };
function brand(b) {
  const k = b.replace(/[\s_&()]/g, '');
  if (ALIAS[k]) return ALIAS[k];
  if (/^왁/.test(k)) return '왁(WAAC)';
  return k.replace(/WAAC/, '');
}

// 엑셀 점포명 → 우리 매장코드 (롯데/현대, 아울렛 여부, 지점 이름으로 맞춤)
function storeMatcher(stores) {
  const tokOurs = (n) => n.replace(/\(.*?\)/g, '').replace(/롯데백화점|롯데프리미엄\s*아울렛|롯데아울렛|현대백화점|현대프리미엄\s*아울렛|현대커넥트|\s/g, '').replace(/아울렛$/, '').replace(/점$/, '');
  const list = stores.filter((s) => /롯데|현대/.test(s.store) && !/사용중지|폐점/.test(s.store))
    .map((s) => ({ ...s, group: /롯데/.test(s.store) ? '롯데' : '현대', outlet: s.type === '아울렛', tok: tokOurs(s.store) }));
  const ZT = { 스페이스원: 'Space1', 무역센터: '무역', 더현대대구: '대구', 더현대서울: '더현대서울', 인천: '인천터미널', 타임빌라스수원: '수원' };
  return (group, zone) => {
    const outlet = /아울렛|롯데몰|팩토리|스페이스원|커넥트/.test(zone);
    let t = zone.replace(/\s/g, '').replace(/점$/, '');
    t = ZT[t] || t.replace(/^(팩토리아울렛|아울렛|롯데몰|타임빌라스|커넥트현대)/, '').replace(/아울렛$/, '').replace(/점$/, '');
    const hit = list.find((s) => s.group === group && s.outlet === outlet && s.tok === t);
    return hit ? hit.store_code : '';
  };
}

async function parseCompetitors(file, stores) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const match = storeMatcher(stores);
  const acc = new Map();
  const add = (m, group, zone, b, ch, net, ly) => {
    if (!m || !zone || !b) return;
    const k = [m, group, zone, b, ch].join('\u0001');
    const o = acc.get(k) || { m, group, zone, b, ch, net: 0, ly: 0 };
    o.net += net; o.ly += ly; acc.set(k, o);
  };
  for (const ws of wb.worksheets) {
    const rowTxt = (i) => { const a = []; ws.getRow(i).eachCell({ includeEmpty: true }, (c, n) => { a[n] = txt(c).replace(/\s/g, ''); }); return a; };
    const find = (a, re) => a.findIndex((v) => v && re.test(v));
    let done = false;
    // 롯데: 1행에 자점·브랜드·총매출·대비실적, 2행에 백화점/온라인/모바일/합계
    for (let i = 1; i <= Math.min(ws.rowCount, 6) && !done; i++) {
      const a = rowTxt(i);
      const cStore = find(a, /^자점$/), cBrand = find(a, /^브랜드$/), cGross = find(a, /^총매출$/), cLy = find(a, /^대비실적$/), cMon = find(a, /^구분$/);
      if (cStore > 0 && cBrand > 0 && cGross > 0 && cLy > 0 && cMon > 0) {
        for (let r = i + 2; r <= ws.rowCount; r++) {
          const row = ws.getRow(r), g = (n) => row.getCell(n);
          const m = month(txt(g(cMon))), zone = txt(g(cStore + 1)), b = brand(txt(g(cBrand + 1)));
          add(m, '롯데', zone, b, '오프라인', num(g(cGross)), num(g(cLy)));
          add(m, '롯데', zone, b, '온라인', num(g(cGross + 1)) + num(g(cGross + 2)), num(g(cLy + 1)) + num(g(cLy + 2)));
        }
        done = true;
      }
      // 현대: 구분·브랜드·영업점·채널·매출액·신장률 (천원)
      const hMon = find(a, /^구분$/), hBrand = find(a, /^브랜드$/), hZone = find(a, /^영업점$/), hCh = find(a, /^채널$/), hAmt = find(a, /^매출액$/), hG = find(a, /^신장률$/);
      if (!done && hMon > 0 && hBrand > 0 && hZone > 0 && hCh > 0 && hAmt > 0) {
        for (let r = i + 1; r <= ws.rowCount; r++) {
          const row = ws.getRow(r), g = (n) => row.getCell(n);
          const m = month(txt(g(hMon))); if (!m) continue;
          const net = num(g(hAmt)) * 1000, gr = hG > 0 ? num(g(hG)) : NaN;
          const ly = Number.isFinite(gr) && gr > -100 && txt(g(hG)) !== '' ? net / (1 + gr / 100) : 0;
          add(m, '현대', txt(g(hZone)).replace(/\s+/g, ' ').replace(/^본 점$/, '본점'), brand(txt(g(hBrand))), /^오프라인/.test(txt(g(hCh))) ? '오프라인' : '온라인', net, ly);
        }
        done = true;
      }
    }
  }
  const rows = [];
  for (const o of acc.values()) {
    if (!o.net && !o.ly) continue;
    rows.push([o.m, o.group, o.zone, match(o.group, o.zone), o.b, o.ch, String(Math.round(o.net)), String(Math.round(o.ly))]);
  }
  if (!rows.length) throw new Error('경쟁 브랜드 파일에서 롯데(Data_lotte)나 현대(Data_hyundai) 형식의 자료를 찾지 못했습니다.');
  return rows;
}

module.exports = { parseCompetitors, HEAD };

if (require.main === module) {
  // node competitors.js out.csv stores.csv file1.xlsx [file2.xlsx ...]
  const fs = require('fs');
  const [out, storeCsv, ...files] = process.argv.slice(2);
  const lines = fs.readFileSync(storeCsv, 'utf8').trim().split('\n'), h = lines[0].split(',');
  const stores = lines.slice(1).map((l) => { const v = l.split(','); return { store_code: v[h.indexOf('store_code')], store: v[h.indexOf('store')], type: v[h.indexOf('type')] }; });
  (async () => {
    const all = [];
    for (const f of files) all.push(...await parseCompetitors(f, stores));
    const q = (s) => (/[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
    fs.writeFileSync(out, [HEAD.join(','), ...all.map((r) => r.map(q).join(','))].join('\n') + '\n');
    console.log('rows', all.length);
  })();
}
