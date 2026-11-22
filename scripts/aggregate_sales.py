import sys, pandas as pd, numpy as np
df = pd.read_pickle(sys.argv[1]); out = sys.argv[2]
for c in ['판매금액','확정금액','판매수량','TAG가']: df[c]=pd.to_numeric(df[c]).fillna(0)
types = {'C':'백화점','D':'아울렛','B':'가두점','A':'기타'}
df['type'] = df['매장코드'].str[0].map(types).fillna('기타')
df['store'] = df['매장명'].str.replace(r'^FJ\s+','',regex=True).str.strip()
df['is_sale'] = df['판매구분']=='판매'
df['sale_amt'] = np.where(df['is_sale'], df['판매금액'], 0)
df['ret_amt'] = np.where(~df['is_sale'], -df['판매금액'], 0)
df['ret_qty'] = np.where(~df['is_sale'], -df['판매수량'], 0)
df['tag_amt'] = df['TAG가']*df['판매수량']
df['receipt'] = np.where(df['is_sale'], df['판매일자']+df['매장코드']+df['판매번호'], None)
df['hour'] = df['판매시간'].str[:2]
key=['판매일자','매장코드','store','type']
sd = df.groupby(key).agg(sales=('sale_amt','sum'), returns=('ret_amt','sum'), net=('판매금액','sum'), confirmed=('확정금액','sum'),
    qty=('판매수량','sum'), return_qty=('ret_qty','sum'), tag=('tag_amt','sum'), receipts=('receipt','nunique')).reset_index()
sd.columns=['date','store_code','store','type','sales','returns','net','confirmed','qty','return_qty','tag','receipts']
sd.to_csv(f'{out}/store_daily.csv', index=False)
names = df.groupby('상품코드')['상품명'].agg(lambda s: s.str.strip().mode().iat[0])
# 시즌 = 년도 끝 두 자리 + FW(Fall/Winter) / SS(Spring/Summer) / ALL(Four Season, Seasonless). 예: 2026 + Men's Winter → 26FW
def season(row):
    y = str(row['년도'] or '')[-2:]
    s = str(row['시즌'] or '')
    tag = 'FW' if ('Fall' in s or 'Winter' in s) else 'SS' if ('Spring' in s or 'Summer' in s) else 'ALL'
    return y + tag
seasons = df.drop_duplicates('상품코드').set_index('상품코드').apply(season, axis=1)
# 라인·아이템·성별이 빈 줄도 빠지지 않게 채워 둡니다
for c, v in [('라인','기타'),('아이템','기타'),('성별','')]: df[c] = df[c].fillna(v)
ps = df.groupby(['매장코드','라인','아이템','성별','상품코드']).agg(qty=('판매수량','sum'), net=('판매금액','sum'), confirmed=('확정금액','sum')).reset_index()
ps['product_name'] = ps['상품코드'].map(names)
ps['season'] = ps['상품코드'].map(seasons)
ps.columns=['store_code','line','item','gender','product_code','qty','net','confirmed','product_name','season']
ps = ps[['store_code','line','item','gender','product_code','product_name','season','qty','net','confirmed']]
ps['gender']=ps['gender'].fillna('')
ps.to_csv(f'{out}/product_store.csv', index=False)
st = df.groupby(['매장코드','판매형태']).agg(net=('판매금액','sum'), qty=('판매수량','sum'), tag=('tag_amt','sum')).reset_index()
st.columns=['store_code','sale_type','net','qty','tag']; st.to_csv(f'{out}/saletype_store.csv', index=False)
hs = df.groupby(['매장코드','hour']).agg(net=('판매금액','sum'), receipts=('receipt','nunique')).reset_index()
hs.columns=['store_code','hour','net','receipts']; hs.to_csv(f'{out}/hour_store.csv', index=False)
print(len(sd),len(ps),len(st),len(hs))
print('net',sd.net.sum(),'confirmed',sd.confirmed.sum(),'qty',sd.qty.sum(),'sales',sd.sales.sum(),'returns',sd.returns.sum(),'receipts',sd.receipts.sum(),'tag',sd.tag.sum())
