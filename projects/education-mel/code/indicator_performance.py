"""
Education MEL system: indicator performance and data quality
============================================================
Author : Aqil Shah Ayaz
Data   : SAFE SAMPLE DATA (simulated quarterly indicator tracker)

1. Achievement = actual / target for the latest quarter (outputs are cumulative;
   outcomes are percentages).
2. Traffic-light status: on track >= 90%, watch 75-89%, off track < 75%.
3. Data quality: counts DQA flags by province and type, so the MEL team knows
   where to follow up before the quarterly report.
"""
from pathlib import Path
import pandas as pd

DATA = Path(__file__).resolve().parent.parent / "data"
df = pd.read_csv(DATA / "indicator_tracker.csv")
latest = df.quarter.max()
cur = df[df.quarter == latest].groupby(["indicator", "indicator_name", "type"]).agg(target=("target", "sum"), actual=("actual", "sum"), n=("province", "count")).reset_index()
outc = cur.type == "Outcome"
cur.loc[outc, ["target", "actual"]] = cur.loc[outc, ["target", "actual"]].div(cur.loc[outc, "n"], axis=0)
cur["achievement_pct"] = (100 * cur.actual / cur.target).round(1)
cur["status"] = pd.cut(cur.achievement_pct, [-1, 74.9, 89.9, 1e9], labels=["Off track", "Watch", "On track"])
print(f"Indicator performance, {latest}:")
print(cur[["indicator", "indicator_name", "target", "actual", "achievement_pct", "status"]].round(1).to_string(index=False))

flags = df[df.dqa_flag.fillna("") != ""]
print(f"\nDQA flags: {len(flags)} of {len(df)} records ({len(flags)/len(df):.1%})")
print(pd.crosstab(flags.province, flags.dqa_flag))
cur.to_csv(DATA / "latest_quarter_performance.csv", index=False)
