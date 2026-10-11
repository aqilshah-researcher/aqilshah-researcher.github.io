"""
Women's advocacy network: change in agency and advocacy outcomes
================================================================
Author : Aqil Shah Ayaz
Data   : SAFE SAMPLE DATA (simulated member survey and action log)

1. Builds an agency index (mean of four 1-5 items) at baseline and endline.
2. Tests the change with a Wilcoxon signed-rank test (ordinal, paired data).
3. Checks whether more cluster sessions go with larger gains (Spearman).
4. Summarizes advocacy actions by type and outcome, as in outcome harvesting.
"""
from pathlib import Path
import pandas as pd
from scipy import stats

DATA = Path(__file__).resolve().parent.parent / "data"
m = pd.read_csv(DATA / "member_survey.csv")
a = pd.read_csv(DATA / "advocacy_actions.csv")

items = ["confidence", "voice_in_decisions", "network_support", "advocacy_skills"]
m["agency_baseline"] = m[[f"{i}_baseline" for i in items]].mean(axis=1)
m["agency_endline"] = m[[f"{i}_endline" for i in items]].mean(axis=1)
m["agency_change"] = m.agency_endline - m.agency_baseline

w = stats.wilcoxon(m.agency_endline, m.agency_baseline)
print(f"Agency index {m.agency_baseline.mean():.2f} -> {m.agency_endline.mean():.2f} (Wilcoxon p = {w.pvalue:.4f})")
rho, p = stats.spearmanr(m.cluster_sessions_attended, m.agency_change)
print(f"More sessions, larger gain? Spearman rho = {rho:.2f}, p = {p:.4f}")
print("\nMean change by sector and hub:")
print(m.pivot_table(index="sector", columns="hub", values="agency_change", aggfunc="mean").round(2))

print("\nAdvocacy actions by outcome (%):")
print((pd.crosstab(a.action_type, a.outcome, normalize="index") * 100).round(1))
m.round(3).to_csv(DATA / "member_agency_index.csv", index=False)
