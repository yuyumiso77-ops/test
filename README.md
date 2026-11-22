# 브랜드 매출 현황 대시보드

팀원과 브랜드 매출을 공유하는 대시보드입니다. Railway 같은 Node 호스팅에 그대로 올려 실행할 수 있습니다.

> **주의:** `public/data/`의 CSV는 예시 데이터이고 실제 매출이 아닙니다.
> 이 저장소는 공개(public) 저장소입니다. 실제 매출 파일을 넣으려면 저장소를 비공개로 바꾼 뒤 넣으세요.

## 화면 구성

- 요약 문장과 핵심 지표: 이번 달 누적, 올해 누적, 최근 하루, 이번 달 주문 수 (전년 동기·전주 대비)
- 매출 추이: 연·월·일 단위 전환, 월별에서는 전년 같은 달 비교
- 매장별 매출: 매장별 추이 선 차트와 요약 표
- 채널별·상품별 매출: 이번 달 / 올해 누적 / 최근 12개월
- 매장 선택: 페이지 전체에 적용

## 실행

```bash
npm start
```

외부 패키지가 없어서 `npm install` 없이 Node 18 이상이면 바로 실행됩니다. 포트는 `PORT` 환경 변수(기본 3000)를 따릅니다.

### 비밀번호 걸기

환경 변수 `DASHBOARD_PASSWORD`를 넣으면 접속할 때 브라우저 로그인 창이 뜹니다. 아이디는 아무거나, 비밀번호는 이 값을 입력합니다.
Railway에서는 서비스의 **Variables** 탭에서 추가합니다.

## 파일

| 경로 | 내용 |
|---|---|
| `server.js` | `public/` 폴더를 서비스하는 작은 Node 서버 (선택적으로 비밀번호 확인) |
| `public/index.html` | 대시보드 페이지 |
| `public/vendor/d3.min.js` | 차트 라이브러리 d3 v7.9.0 (ISC 라이선스, `d3-LICENSE.txt`) |
| `public/data/daily_sales.csv` | 일별 매출: `date, store, channel, orders, qty, revenue` |
| `public/data/product_monthly.csv` | 월별 상품 매출: `month, store, channel, product, qty, revenue` |
| `scripts/generate_sample_data.py` | 예시 데이터를 만든 스크립트 (numpy 필요) |
| `claude-artifact/index.html` | claude.ai 대시보드 버전의 페이지 코드 (claude.ai 안에서만 동작) |

## 실제 데이터로 바꾸기

`public/data/`의 두 CSV를 같은 열 이름을 가진 실제 파일로 바꾸고 커밋하면 다시 배포되면서 숫자가 바뀝니다.
- 날짜는 `2026-11-21`, 월은 `2026-11` 형식입니다.
- 금액과 수량은 쉼표 없이 숫자만 넣습니다.
- 온라인 판매는 `store` 열에 `온라인`, `channel` 열에 판매처 이름을 넣습니다. 오프라인 매장은 `channel`을 `오프라인`으로 씁니다.
