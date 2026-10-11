"""
Radio-based literacy programme: learning assessment analysis
============================================================
Author : Aqil Shah Ayaz
Data   : SAFE SAMPLE DATA (simulated learner assessment, n = 390)

Steps
-----
1. Item analysis: percent correct (difficulty) and item-rest correlation
   (discrimination) for the 12 reading, writing and numeracy items.
2. Reliability of the full test (Cronbach's alpha / KR-20).
3. Domain scores by province and sex, with a chi-square test for
   differences in self-rated improvement.
4. Exports tidy tables that feed the Power BI report.
"""
from pathlib import Path

import pandas as pd
from scipy import stats

DATA = Path(__file__).resolve().parent.parent / "data"
df = pd.read_csv(DATA / "learner_assessment.csv")
items = pd.read_csv(DATA / "dim_items.csv")
cols = items["item"].tolist()

# 1. Item analysis
total = df[cols].sum(axis=1)
rows = []
for c in cols:
    rest = total - df[c]
    rows.append({"item": c, "pct_correct": round(100 * df[c].mean(), 1),
                 "item_rest_r": round(df[c].corr(rest), 2)})
item_stats = items.merge(pd.DataFrame(rows), on="item")
print(item_stats.to_string(index=False))

# 2. KR-20 reliability (Cronbach's alpha for 0/1 items)
k = len(cols)
alpha = k / (k - 1) * (1 - df[cols].var(ddof=1).sum() / total.var(ddof=1))
print(f"\nKR-20 reliability: {alpha:.2f}  (0.70+ is acceptable for a programme test)")

# 3. Domain scores
for dom in items["domain"].unique():
    dcols = items.loc[items.domain == dom, "item"]
    df[f"{dom.lower()}_pct"] = 100 * df[dcols].mean(axis=1)
domain_cols = [c for c in df.columns if c.endswith("_pct")]
by_prov = df.groupby(["province", "sex"])[domain_cols].mean().round(1).reset_index()
print("\nDomain scores by province and sex (% correct):")
print(by_prov.to_string(index=False))

ct = pd.crosstab(df.province, df.self_rated_improvement)
chi2, p, dof, _ = stats.chi2_contingency(ct)
print(f"\nSelf-rated improvement differs by province: chi-square = {chi2:.1f}, df = {dof}, p = {p:.4f}")

# 4. Exports for the dashboard
item_stats.to_csv(DATA / "item_statistics.csv", index=False)
by_prov.to_csv(DATA / "domain_scores_by_province_sex.csv", index=False)
