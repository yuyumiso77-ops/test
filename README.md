# FJ 매출 현황 대시보드

판매정보현황 엑셀을 합산해 매장·일자·상품별 매출을 보여주는 대시보드입니다. Railway 같은 Node 호스팅에 그대로 올려 실행할 수 있습니다.

현재 데이터: 2026년 11월 1–21일, 91개 매장, POS 판매 31,605줄 (순매출 46.53억원, 확정금액 38.20억원, 수량 24,789개).

## 화면 구성

- 필터: 유통 형태(백화점/아울렛/가두점/기타), 매장. 매장 순위표의 줄을 누르면 그 매장만 봅니다.
- 핵심 지표: 순매출, 확정금액, 판매 수량, 객단가, 반품, 평균 할인율
- 일별 매출(주말 구분), 매장별 순위, 유통 형태별·판매 형태별, 라인별·아이템별, 상품 상위 20, 시간대별 매출

## 실행

```bash
npm start
```

외부 패키지가 없어서 Node 18 이상이면 바로 실행됩니다. 포트는 `PORT` 환경 변수(기본 3000)를 따릅니다.
`DASHBOARD_PASSWORD` 환경 변수를 넣으면 접속할 때 비밀번호를 묻습니다 (아이디는 아무거나).

## 데이터 갱신

1. ERP에서 판매정보현황 엑셀을 내려받습니다.
2. 합산 스크립트로 CSV를 만듭니다 (pandas, openpyxl 필요).

```bash
python3 -c "import pandas as pd; df=pd.read_excel('판매정보현황.xlsx', dtype=str); df[df['판매일자'].notna()].to_pickle('sales.pkl')"
```

```bash
python3 scripts/aggregate_sales.py sales.pkl public/data
```

3. 바뀐 `public/data/*.csv`를 커밋하면 다시 배포됩니다.

원본 엑셀(고객번호 포함)은 저장소에 올리지 마세요. `.gitignore`가 `.xlsx` 파일을 제외합니다.

## 파일

| 경로 | 내용 |
|---|---|
| `server.js` | `public/` 폴더를 서비스하는 작은 Node 서버 (선택적 비밀번호) |
| `public/index.html` | 대시보드 페이지 |
| `public/vendor/d3.min.js` | 차트 라이브러리 d3 v7.9.0 (ISC 라이선스) |
| `public/data/store_daily.csv` | 매장·일자별: 판매, 반품, 순매출, 확정금액, 수량, TAG가 합계, 영수증 수 |
| `public/data/product_store.csv` | 매장·상품코드별: 라인, 아이템, 성별, 수량, 순매출, 확정금액 |
| `public/data/saletype_store.csv` | 매장·판매형태별: 순매출, 수량, TAG가 합계 |
| `public/data/hour_store.csv` | 매장·시간대별: 순매출, 영수증 수 |
| `scripts/aggregate_sales.py` | 엑셀 데이터를 위 CSV로 합산하는 스크립트 |
| `claude-artifact/index.html` | claude.ai 대시보드 버전의 페이지 코드 (claude.ai 안에서만 동작) |

## 계산 방식

- 순매출 = 판매금액 합계 (반품은 음수로 들어 있어 자동으로 빠짐)
- 객단가 = 판매 줄의 판매금액 ÷ 판매 영수증 수 (영수증 = 일자·매장·판매번호)
- 평균 할인율 = 1 − 순매출 ÷ (TAG가 × 수량)
- 유통 형태 = 매장코드 첫 글자: C 백화점, D 아울렛, B 가두점, A 기타
