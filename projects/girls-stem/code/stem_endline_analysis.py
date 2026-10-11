"""
Girls in STEM endline evaluation: learning gains and attitudes
==============================================================
Author : Aqil Shah Ayaz
Data   : SAFE SAMPLE DATA (simulated student and parent surveys)

Questions answered
------------------
1. Did science marks improve between baseline and endline?      (paired t-test)
2. Did science-club members gain more than non-members?          (difference in gains, Welch t-test, effect size)
3. Does the club effect hold after controlling for grade/school? (OLS with school fixed effects)
4. How do students feel about STEM careers?                      (Likert top-2-box)
"""
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats
import statsmodels.formula.api as smf

DATA = Path(__file__).resolve().parent.parent / "data"
st = pd.read_csv(DATA / "student_survey.csv")
pa = pd.read_csv(DATA / "parent_survey.csv")

st["gain"] = st["science_mark_endline"] - st["science_mark_baseline"]

# 1. Overall change (same students measured twice -> paired test)
t, p = stats.ttest_rel(st["science_mark_endline"], st["science_mark_baseline"])
print(f"Mean science mark: {st.science_mark_baseline.mean():.1f} -> {st.science_mark_endline.mean():.1f} "
      f"(paired t = {t:.2f}, p = {p:.4f})")

# 2. Club members vs non-members
club, non = st.loc[st.science_club_member == 1, "gain"], st.loc[st.science_club_member == 0, "gain"]
t2, p2 = stats.ttest_ind(club, non, equal_var=False)
pooled_sd = np.sqrt((club.var(ddof=1) + non.var(ddof=1)) / 2)
d = (club.mean() - non.mean()) / pooled_sd
print(f"Average gain: club {club.mean():.1f} pts vs non-club {non.mean():.1f} pts "
      f"(Welch t = {t2:.2f}, p = {p2:.4f}, Cohen's d = {d:.2f})")

# 3. Regression with school fixed effects
model = smf.ols("gain ~ science_club_member + C(grade) + C(school)", data=st).fit(cov_type="HC1")
b = model.params["science_club_member"]; lo, hi = model.conf_int().loc["science_club_member"]
print(f"Club effect after controls: {b:.1f} pts (95% CI {lo:.1f} to {hi:.1f})")

# 4. Attitudes: share answering 4 or 5 on a 5-point scale
likert = ["enjoys_science", "understands_lessons", "wants_stem_career",
          "family_supports_stem", "community_supports_stem"]
top2 = (st[likert] >= 4).groupby(st.science_club_member).mean().T.mul(100).round(1)
top2.columns = ["Non-members %", "Club members %"]
print("\nAgree or strongly agree (top-2-box):")
print(top2.to_string())

print(f"\nParents who want their daughter in a STEM field: {pa.wants_daughter_in_stem.mean():.0%}")

# Tidy outputs for the dashboard
top2.reset_index(names="item").to_csv(DATA / "attitudes_top2box.csv", index=False)
(st.groupby(["district", "school", "science_club_member"])
   .agg(students=("student_id", "count"), mean_gain=("gain", "mean"))
   .round(2).reset_index()
   .to_csv(DATA / "gain_by_school.csv", index=False))
