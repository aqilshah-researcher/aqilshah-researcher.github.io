"""
TPM site-visit tracker: cleaning and validation pipeline
=========================================================
Author : Aqil Shah Ayaz
Data   : SAFE SAMPLE DATA (simulated). No client records are used.

What it does
------------
1. Reads the raw tracker export (the kind of file that arrives every month
   from field teams and partners).
2. Standardizes province names, status labels and mixed date formats.
3. Removes duplicate site visits.
4. Runs validation rules and writes a QA log that the field team can act on.
5. Writes a clean, analysis-ready table for Power BI, Tableau and SQL.

Run
---
    python clean_tpm.py ../data/raw/tpm_raw_export.csv ../data/tpm_site_visits_clean.csv
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
DIM_PROVINCE = HERE.parent / "data" / "dim_province.csv"

# Spellings seen in real field exports, mapped to one standard name
PROVINCE_ALIASES = {
    "saripul": "Sar-e Pol", "sar-e-pul": "Sar-e Pol", "sar-e pol": "Sar-e Pol",
    "paktya": "Paktia", "konar": "Kunar", "hilmand": "Helmand",
    "nangrahar": "Nangarhar", "hirat": "Herat", "maidan wardak": "Wardak",
}
STATUS_ALIASES = {
    "completed": "Completed", "complete": "Completed",
    "postponed by ip": "IP Postponed", "ip postponed": "IP Postponed",
    "ip canceled": "IP Canceled", "tpm canceled": "TPM Canceled",
}
VALID_STATUS = {"Completed", "IP Postponed", "IP Canceled", "TPM Canceled"}
VALID_FLAGS = {"No flag", "Yellow", "Red"}


def standardize_province(s: pd.Series, valid: set[str]) -> pd.Series:
    key = s.astype(str).str.strip().str.lower()
    mapped = key.map(PROVINCE_ALIASES)
    title = s.astype(str).str.strip()
    out = mapped.fillna(title)
    # fall back to a case-insensitive match against the official list
    lookup = {v.lower(): v for v in valid}
    return out.map(lambda x: lookup.get(x.lower(), x))


def parse_mixed_dates(s: pd.Series) -> pd.Series:
    """Field exports mix ISO, day/month/year and 'Mon dd, yyyy' formats."""
    out = pd.to_datetime(s, format="%Y-%m-%d", errors="coerce")
    for fmt in ("%d/%m/%Y", "%b %d, %Y"):
        miss = out.isna()
        out[miss] = pd.to_datetime(s[miss], format=fmt, errors="coerce")
    return out


def validate(df: pd.DataFrame, valid_prov: set[str]) -> pd.DataFrame:
    """Return one row per rule violation, for the field team to fix."""
    rules = {
        "unknown_province": ~df["province"].isin(valid_prov),
        "unknown_status": ~df["status"].isin(VALID_STATUS),
        "missing_planned_date": df["planned_date"].isna(),
        "completed_without_monitoring_date": (df["status"] == "Completed") & df["monitoring_date"].isna(),
        "monitoring_before_planned": df["monitoring_date"] < df["planned_date"],
        "flag_without_category": df["flag"].isin({"Yellow", "Red"}) & df["flag_category"].isna(),
        "late_submission_over_10_days": df["days_to_submit"] > 10,
    }
    issues = [
        df.loc[mask, ["visit_id"]].assign(rule=name)
        for name, mask in rules.items() if mask.any()
    ]
    return pd.concat(issues, ignore_index=True) if issues else pd.DataFrame(columns=["visit_id", "rule"])


def main(raw_path: str, out_path: str) -> None:
    dim = pd.read_csv(DIM_PROVINCE)
    valid_prov = set(dim["province"])

    df = pd.read_csv(raw_path)
    n_raw = len(df)

    df["province"] = standardize_province(df["province"], valid_prov)
    df["status"] = df["status"].astype(str).str.strip().str.lower().map(STATUS_ALIASES).fillna(df["status"])
    df["planned_date"] = parse_mixed_dates(df["planned_date"].astype(str))
    df["monitoring_date"] = pd.to_datetime(df["monitoring_date"], errors="coerce")
    df["flag"] = df["flag"].fillna("No flag")

    df = df.drop_duplicates(subset="visit_id", keep="first")
    # region always comes from the official province table, never from the raw file
    df = df.drop(columns="region").merge(dim[["province", "region"]], on="province", how="left")

    qa = validate(df, valid_prov)

    df = df.sort_values("planned_date")
    cols = ["visit_id", "planned_date", "monitoring_date", "region", "province", "technical_office",
            "award_code", "intervention_type", "implementing_partner", "status", "validation_status",
            "flag", "flag_category", "days_to_submit", "monitor_gender"]
    df[cols].to_csv(out_path, index=False, date_format="%Y-%m-%d")
    qa_path = Path(out_path).with_name("qa_log.csv")
    qa.to_csv(qa_path, index=False)

    print(f"raw rows           : {n_raw:,}")
    print(f"duplicates removed : {n_raw - len(df):,}")
    print(f"clean rows         : {len(df):,}")
    print("QA issues by rule  :")
    print(qa["rule"].value_counts().to_string() if len(qa) else "  none")


if __name__ == "__main__":
    raw = sys.argv[1] if len(sys.argv) > 1 else str(HERE.parent / "data" / "raw" / "tpm_raw_export.csv")
    out = sys.argv[2] if len(sys.argv) > 2 else str(HERE.parent / "data" / "tpm_site_visits_clean.csv")
    main(raw, out)
