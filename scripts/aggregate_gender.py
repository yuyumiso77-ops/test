# 매장·일자·성별(엑셀 성별 열: Man / Woman / 빈칸)과 매장·일자·성별·아이템으로 순매출과 수량을 합산합니다.
import sys, pandas as pd
df = pd.read_pickle(sys.argv[1]); out = sys.argv[2]
for c in ['판매금액', '판매수량']: df[c] = pd.to_numeric(df[c]).fillna(0)
df['gender'] = df['성별'].fillna('').map({'Man': '남성', 'Woman': '여성'}).fillna('구분 없음')
g = df.groupby(['판매일자', '매장코드', 'gender']).agg(net=('판매금액', 'sum'), qty=('판매수량', 'sum')).reset_index()
g.columns = ['date', 'store_code', 'gender', 'net', 'qty']
g.sort_values(['date', 'store_code', 'gender']).to_csv(f'{out}/gender_daily.csv', index=False)
print(len(g), g.groupby('gender').net.sum().to_dict(), g.net.sum())

# 아이템까지 나눈 합산 (아이템별 주별·전주 대비 비교용)
for c, v in [('라인', '기타'), ('아이템', '기타')]: df[c] = df[c].fillna(v)
gi = df.groupby(['판매일자', '매장코드', 'gender', '아이템', '라인']).agg(net=('판매금액', 'sum'), qty=('판매수량', 'sum')).reset_index()
gi.columns = ['date', 'store_code', 'gender', 'item', 'line', 'net', 'qty']
gi.sort_values(['date', 'store_code', 'gender', 'item']).to_csv(f'{out}/gender_item_daily.csv', index=False)
print(len(gi), gi.net.sum())
