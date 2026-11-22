# 브랜드 매출 현황 대시보드

팀원과 브랜드 매출을 공유하는 대시보드의 소스입니다.
실행 중인 페이지는 claude.ai 아티팩트(Data 타입)로 올라가 있습니다.

> **주의:** `data/` 폴더의 CSV는 예시 데이터이고 실제 매출이 아닙니다.
> 이 저장소는 공개(public) 저장소이므로 실제 매출 파일은 여기에 올리지 마세요.

## 화면 구성

- 요약 문장과 핵심 지표: 이번 달 누적, 올해 누적, 최근 하루, 이번 달 주문 수 (전년 동기·전주 대비)
- 매출 추이: 연·월·일 단위 전환, 월별에서는 전년 같은 달 비교
- 매장별 매출: 매장별 추이 선 차트와 요약 표
- 채널별·상품별 매출: 이번 달 / 올해 누적 / 최근 12개월
- 매장 선택 필터: 페이지 전체에 적용

## 파일

| 경로 | 내용 |
|---|---|
| `index.html` | 대시보드 페이지. claude.ai Data 아티팩트의 `dash` API(`dash.calc`, `dash.draw`, `dash.data`)와 d3 v7을 사용하므로 브라우저에서 단독으로 열면 동작하지 않습니다. |
| `data/daily_sales.csv` | 예시 일별 매출: `date, store, channel, orders, qty, revenue` |
| `data/product_monthly.csv` | 예시 월별 상품 매출: `month, store, channel, product, qty, revenue` |
| `scripts/generate_sample_data.py` | 예시 데이터를 만드는 스크립트 (`python3 generate_sample_data.py`, numpy 필요) |

## 실제 데이터로 바꾸기

위 CSV와 같은 열(이름은 달라도 됨)을 가진 엑셀/CSV 파일을 대시보드에 올리면 같은 링크에서 실제 숫자로 바뀝니다.
판매 1건 또는 하루치가 한 줄인 원본 데이터가 가장 좋습니다.
