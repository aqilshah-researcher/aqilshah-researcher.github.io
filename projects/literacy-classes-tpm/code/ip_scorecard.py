"""
Literacy classes third-party monitoring: implementing partner scorecard
=======================================================================
Author : Aqil Shah Ayaz
Data   : SAFE SAMPLE DATA (simulated KoBo class observations and learner assessment)

1. Class compliance score = share of 6 checklist items met (facilitator present and
   trained, kits, register, village literacy committee active, safe venue).
2. Attendance rate on the visit day = present / enrolled.
3. Learner assessment: letters, words, sentences, numbers (0-10 each).
4. One scorecard row per implementing partner, ranked, with ghost-class counts,
   which is the format donors use to decide on follow-up spot checks.
"""
from pathlib import Path
import pandas as pd

DATA = Path(__file__).resolve().parent.parent / "data"
c = pd.read_csv(DATA / "class_observations.csv")
l = pd.read_csv(DATA / "learner_assessment.csv")

checks = ["facilitator_present", "facilitator_trained", "learning_kits_available", "register_up_to_date", "vlc_active", "safe_venue"]
live = c[c.class_exists == 1].copy()
live["compliance"] = live[checks].mean(axis=1) * 100
live["attendance"] = 100 * live.present_on_visit / live.enrolled
l["learner_score"] = l[["letters", "words", "sentences", "numbers"]].mean(axis=1) * 10

card = (live.groupby("implementing_partner").agg(classes=("class_id", "count"), compliance=("compliance", "mean"), attendance=("attendance", "mean"))
        .join(l.groupby("implementing_partner").learner_score.mean())
        .join(c[c.class_exists == 0].groupby("implementing_partner").size().rename("ghost_classes")).fillna({"ghost_classes": 0}))
card["overall"] = card[["compliance", "attendance", "learner_score"]].mean(axis=1)
card = card.sort_values("overall", ascending=False).round(1)
print(card.to_string())
card.reset_index().to_csv(DATA / "ip_scorecard.csv", index=False)
