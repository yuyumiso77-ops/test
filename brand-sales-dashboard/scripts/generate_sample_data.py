import numpy as np, csv, datetime as dt, math
rng=np.random.default_rng(42)
start=dt.date(2025,1,1); end=dt.date(2026,11,21)
combos=[("강남점","오프라인"),("성수점","오프라인"),("부산 서면점","오프라인"),("대구 동성로점","오프라인"),
        ("온라인","자사몰"),("온라인","쿠팡"),("온라인","스마트스토어"),("온라인","무신사")]
base={"강남점":1.0,"성수점":1.15,"부산 서면점":0.75,"대구 동성로점":0.55,"자사몰":0.9,"쿠팡":1.1,"스마트스토어":0.7,"무신사":0.85}
# product: price, base daily qty per unit, season curve (month->mult)
P=[("시그니처 맨투맨",59000,3.0,{1:1.3,2:1.2,3:1.1,4:.8,5:.5,6:.3,7:.3,8:.4,9:.9,10:1.3,11:1.4,12:1.4}),
   ("베이직 반팔티",29000,4.0,{1:.3,2:.3,3:.6,4:1.0,5:1.5,6:1.9,7:2.0,8:1.8,9:1.0,10:.5,11:.3,12:.3}),
   ("와이드 데님 팬츠",69000,2.2,{m:1.0 for m in range(1,13)}),
   ("울 블렌드 코트",189000,.6,{1:1.4,2:.8,3:.3,4:.1,5:.05,6:.05,7:.05,8:.1,9:.5,10:1.4,11:2.0,12:1.8}),
   ("캔버스 토트백",39000,2.0,{m:1.0 for m in range(1,13)}),
   ("니트 비니",25000,1.5,{1:1.6,2:1.2,3:.5,4:.1,5:.05,6:.05,7:.05,8:.1,9:.5,10:1.3,11:2.0,12:2.2}),
   ("린넨 셔츠",49000,1.5,{1:.1,2:.2,3:.6,4:1.2,5:1.8,6:2.0,7:1.9,8:1.5,9:.7,10:.2,11:.1,12:.1}),
   ("패딩 베스트",99000,.9,{1:1.2,2:.9,3:.5,4:.2,5:.05,6:.05,7:.05,8:.1,9:.6,10:1.4,11:1.8,12:1.6})]
daily=[]; monthly={}
d=start
while d<=end:
    t=(d-start).days/365
    growth=1+0.16*t
    for store,ch in combos:
        k=base[store if ch=="오프라인" else ch]
        if ch=="오프라인": wk=[.8,.8,.85,.9,1.1,1.6,1.5][d.weekday()]
        else: wk=[1.1,1.05,1.0,1.0,.95,.9,1.0][d.weekday()]
        ev=1.0
        if d.month==11 and d.day==11 and ch!="오프라인": ev=3.0
        if ch=="무신사" and d.month in (6,12) and d.day<=7: ev*=1.8
        if ch=="쿠팡": k*= (1+0.12*t)  # faster growth
        tq=0; tr=0; orders=0
        for name,price,bq,sea in P:
            lam=bq*sea[d.month]*k*wk*ev*growth*0.55
            q=int(rng.poisson(lam))
            disc=0.85 if (ev>1.5) else 1.0
            r=q*price*disc
            tq+=q; tr+=r
            key=(f"{d.year}-{d.month:02d}",store,ch,name)
            m=monthly.setdefault(key,[0,0]); m[0]+=q; m[1]+=r
        orders=int(round(tq/ rng.uniform(1.3,1.7))) if tq else 0
        daily.append((d.isoformat(),store,ch,orders,tq,int(tr)))
    d+=dt.timedelta(days=1)
with open("daily_sales.csv","w",newline="") as f:
    w=csv.writer(f); w.writerow(["date","store","channel","orders","qty","revenue"]); w.writerows(daily)
with open("product_monthly.csv","w",newline="") as f:
    w=csv.writer(f); w.writerow(["month","store","channel","product","qty","revenue"])
    for k,v in sorted(monthly.items()): w.writerow([*k,v[0],int(v[1])])
