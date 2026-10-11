"""
Teacher training needs assessment: scoring and validating candidate topics
==========================================================================
Author : Aqil Shah Ayaz
Data   : SAFE SAMPLE DATA (simulated KII scores)

Each key informant scored every candidate topic for their group on relevance
and urgency (1 to 5). A topic is validated when it ranks inside the quota for
its group (36 teacher, 18 principal, 18 supervisor topics) on a weighted score,
and respondents broadly agree on it (standard deviation of relevance below 1.2).
"""
from pathlib import Path
import pandas as pd

DATA = Path(__file__).resolve().parent.parent / "data"
QUOTA = {"Teacher": 36, "Principal": 18, "Academic supervisor": 18}
W_RELEVANCE, W_URGENCY, MAX_SD = 0.6, 0.4, 1.2

topics = pd.read_csv(DATA / "candidate_topics.csv")
scores = pd.read_csv(DATA / "kii_topic_scores.csv")

agg = (scores.groupby("topic_id")
       .agg(respondents=("respondent", "nunique"), relevance=("relevance", "mean"),
            urgency=("urgency", "mean"), relevance_sd=("relevance", "std"),
            share_rating_4plus=("relevance", lambda s: (s >= 4).mean()))
       .reset_index())
agg["weighted_score"] = W_RELEVANCE * agg.relevance + W_URGENCY * agg.urgency
df = topics.merge(agg, on="topic_id")
df["agreement_ok"] = df.relevance_sd < MAX_SD
df["rank_in_group"] = (df[df.agreement_ok].groupby("group")["weighted_score"]
                       .rank(ascending=False, method="first"))
df["validated"] = df.apply(lambda r: int(r.agreement_ok and r.rank_in_group <= QUOTA[r.group]), axis=1)

print(df.groupby("group").agg(candidates=("topic_id", "count"), validated=("validated", "sum")))
print("\nValidated topics by domain:")
print(df[df.validated == 1].groupby(["group", "domain"]).size().to_string())
df.round(3).to_csv(DATA / "topics_scored.csv", index=False)
