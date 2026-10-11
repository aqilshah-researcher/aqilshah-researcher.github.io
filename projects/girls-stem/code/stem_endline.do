* =====================================================================
* Girls in STEM endline: the same analysis in Stata
* Author : Aqil Shah Ayaz
* Data   : SAFE SAMPLE DATA (simulated)
* =====================================================================
clear all
set more off
import delimited "../data/student_survey.csv", varnames(1) clear

gen gain = science_mark_endline - science_mark_baseline
label define club 0 "Non-member" 1 "Club member"
label values science_club_member club

* 1. Baseline vs endline, same students (paired t-test)
ttest science_mark_endline == science_mark_baseline

* 2. Gain for club members vs non-members (Welch)
ttest gain, by(science_club_member) unequal
esize twosample gain, by(science_club_member) cohensd

* 3. Club effect with grade and school fixed effects, robust SEs
encode school, gen(school_id)
regress gain i.science_club_member i.grade i.school_id, vce(robust)

* 4. Attitudes: share agreeing (4 or 5) by club membership
foreach v of varlist enjoys_science understands_lessons wants_stem_career ///
                     family_supports_stem community_supports_stem {
    gen agree_`v' = `v' >= 4 if !missing(`v')
}
tabstat agree_*, by(science_club_member) stat(mean) format(%4.2f)
