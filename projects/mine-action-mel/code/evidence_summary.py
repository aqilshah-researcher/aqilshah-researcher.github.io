"""
Mine action MEL visit: outputs and evidence matrix
==================================================
Author : Aqil Shah Ayaz
Data   : SAFE SAMPLE DATA (simulated outputs, consultation log and coded evidence)

1. Totals clearance and risk-education outputs, with risk education by sex and age.
2. Profiles who was consulted (KII / FGD, stakeholder group, women's participation).
3. Turns coded interview evidence into a theme x evaluation-criterion matrix and
   lists criteria where evidence is thin, to guide the next monitoring visit.
"""
from pathlib import Path
import pandas as pd

DATA = Path(__file__).resolve().parent.parent / "data"
out = pd.read_csv(DATA / "monthly_outputs.csv")
log = pd.read_csv(DATA / "consultation_log.csv")
ev = pd.read_csv(DATA / "evidence_matrix.csv")

print(f"Area cleared: {out.area_cleared_m2.sum()/1e6:.2f} km2 · items destroyed: {out.items_destroyed.sum():,}")
eore = out[["eore_girls", "eore_boys", "eore_women", "eore_men"]].sum()
print("Risk education reach:", eore.to_dict(), f"· female share {(eore.eore_girls + eore.eore_women) / eore.sum():.0%}")

log["participants"] = log.participants_female + log.participants_male
print("\nConsultations:")
print(log.groupby(["method", "stakeholder_group"]).agg(sessions=("consultation_id", "count"), people=("participants", "sum")))

matrix = ev.pivot(index="theme", columns="criterion", values="coded_references")
print("\nCoded references (theme x criterion):")
print(matrix)
gaps = ev.groupby("criterion").coded_references.sum().sort_values()
print("\nThinnest evidence by criterion:", gaps.head(2).to_dict())
