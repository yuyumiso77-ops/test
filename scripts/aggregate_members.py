# 매장·일자별 회원/비회원 매출과 신규 가입 회원 수를 합산합니다 (고객번호 자체는 내보내지 않음).
import sys, pandas as pd, numpy as np
df = pd.read_pickle(sys.argv[1]); out = sys.argv[2]
df['판매금액'] = pd.to_numeric(df['판매금액']).fillna(0)
cust = df['고객번호'].fillna('').str.strip()
df['member'] = cust != ''
df['is_sale'] = df['판매구분'] == '판매'
# 고객번호 F + 가입연월(YYYYMM) + 일련번호 → 자료의 마지막 달에 만든 번호를 신규 가입으로 봅니다
month = df['판매일자'].max()[:7].replace('-', '')
df['new'] = cust.str.match(rf'^F{month}\d+$')
df['receipt'] = df['판매일자'] + df['매장코드'] + df['판매번호']
# 영수증 단위 회원 여부: 영수증 안에 고객번호가 하나라도 있으면 회원 영수증
rec_member = df.groupby('receipt')['member'].any()
df['rec_member'] = df['receipt'].map(rec_member)
sale = df[df['is_sale']]
# 신규 회원은 자료에서 처음 나온 날·매장에 한 번만 셉니다
newc = df[df['new']].assign(c=cust[df['new']]).sort_values(['판매일자', '판매시간']).drop_duplicates('c')
key = ['판매일자', '매장코드']
g = pd.DataFrame(index=pd.MultiIndex.from_frame(df[key].drop_duplicates()))
g['member_net'] = df[df['member']].groupby(key)['판매금액'].sum()
g['nonmember_net'] = df[~df['member']].groupby(key)['판매금액'].sum()
g['member_sales'] = sale[sale['rec_member']].groupby(key)['판매금액'].sum()
g['nonmember_sales'] = sale[~sale['rec_member']].groupby(key)['판매금액'].sum()
g['member_receipts'] = sale[sale['rec_member']].groupby(key)['receipt'].nunique()
g['nonmember_receipts'] = sale[~sale['rec_member']].groupby(key)['receipt'].nunique()
g['new_members'] = newc.groupby(key)['c'].nunique()
g['new_member_net'] = df[df['new']].groupby(key)['판매금액'].sum()
g = g.fillna(0).astype('int64').reset_index()
g.columns = ['date', 'store_code'] + list(g.columns[2:])
g.sort_values(['date', 'store_code']).to_csv(f'{out}/member_daily.csv', index=False)
print(len(g), g[['member_net','nonmember_net','member_receipts','nonmember_receipts','new_members','new_member_net']].sum().to_dict(), 'total', df['판매금액'].sum())
