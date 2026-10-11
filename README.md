# Aqil Shah Ayaz · Data Analyst & MEL Specialist

Portfolio site: **https://aqilshah-researcher.github.io/**

Data analyst and monitoring, evaluation and learning (MEL) specialist with 10+ years of experience building data systems and leading analysis for programs funded by USAID, the UN, the World Bank, FCDO, the EU and Sida.

## Dashboards and code

Every dashboard uses **simulated sample data**. Client reports and datasets stay confidential; the structure, indicators and methods follow real projects.

| Project | What it shows | Code |
|---|---|---|
| [TPM Site-Visit Tracker](https://aqilshah-researcher.github.io/projects/tpm-tracker/) | Third-party monitoring: completion, cancellations, red/yellow flags, reporting time | [Python ETL](projects/tpm-tracker/code/clean_tpm.py) · [SQL](projects/tpm-tracker/code/tpm_model.sql) · [DAX](projects/tpm-tracker/powerbi/measures.dax) |
| [Food Security & Resilience Evaluation](https://aqilshah-researcher.github.io/projects/livelihoods-resilience/) | FCS, rCSI and MDD-W across baseline, midline and endline | [R](projects/livelihoods-resilience/code/food_security_indicators.R) |
| [Radio-Based Literacy Assessment](https://aqilshah-researcher.github.io/projects/radio-literacy/) | Item analysis, KR-20 reliability, scores by province and sex | [Python](projects/radio-literacy/code/learning_assessment.py) · [SPSS](projects/radio-literacy/code/learning_assessment.sps) |
| [Girls in STEM Endline](https://aqilshah-researcher.github.io/projects/girls-stem/) | Learning gains, club vs non-club, attitudes | [Python](projects/girls-stem/code/stem_endline_analysis.py) · [Stata](projects/girls-stem/code/stem_endline.do) |
| [Workplace Safety Before/After](https://aqilshah-researcher.github.io/projects/workplace-safety/) | OSH checklist compliance with McNemar tests | [Python](projects/workplace-safety/code/osh_before_after.py) |

## Run the analysis

```bash
pip install pandas numpy scipy statsmodels
python projects/tpm-tracker/code/clean_tpm.py
python projects/radio-literacy/code/learning_assessment.py
python projects/girls-stem/code/stem_endline_analysis.py
python projects/workplace-safety/code/osh_before_after.py
cd projects/livelihoods-resilience/code && Rscript food_security_indicators.R
```

## Contact

aqilshah.researcher@gmail.com · [LinkedIn](https://www.linkedin.com/in/aqil-shah-ayaz/) · Rockville, Maryland
