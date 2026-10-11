"""
Workplace safety (OSH) assessment: before / after training
==========================================================
Author : Aqil Shah Ayaz
Data   : SAFE SAMPLE DATA (simulated observation checklist, 24 small businesses x 14 items)

The same businesses were observed before and after an occupational safety
and health training, so each checklist item is a paired yes/no outcome.
McNemar's exact test is the right test for that design.
"""
from pathlib import Path

import pandas as pd
from scipy.stats import binomtest

DATA = Path(__file__).resolve().parent.parent / "data"
df = pd.read_csv(DATA / "osh_checklist_long.csv")

wide = df.pivot_table(index=["sme_id", "check_item", "category"], columns="phase",
                      values="compliant").reset_index()
wide.columns.name = None
wide = wide.rename(columns={"Before training": "before", "After training": "after"})

rows = []
for (item, cat), g in wide.groupby(["check_item", "category"]):
    improved = int(((g.before == 0) & (g.after == 1)).sum())
    worsened = int(((g.before == 1) & (g.after == 0)).sum())
    n_disc = improved + worsened
    p = binomtest(improved, n_disc, 0.5).pvalue if n_disc else 1.0   # exact McNemar
    rows.append({"check_item": item, "category": cat,
                 "pct_before": round(100 * g.before.mean(), 1),
                 "pct_after": round(100 * g.after.mean(), 1),
                 "change_pts": round(100 * (g.after.mean() - g.before.mean()), 1),
                 "businesses_improved": improved, "mcnemar_p": round(p, 4)})
res = pd.DataFrame(rows).sort_values("change_pts", ascending=False)
print(res.to_string(index=False))

score = df.groupby(["sme_id", "sector", "phase"]).compliant.mean().mul(100).round(1).unstack()
print(f"\nAverage compliance score: {score['Before training'].mean():.0f}% -> {score['After training'].mean():.0f}%")

res.to_csv(DATA / "osh_item_summary.csv", index=False)
score.reset_index().to_csv(DATA / "osh_sme_scores.csv", index=False)
