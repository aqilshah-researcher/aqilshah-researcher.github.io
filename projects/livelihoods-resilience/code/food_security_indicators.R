# =====================================================================
# Livelihoods & resilience evaluation: food security indicators in R
# Author : Aqil Shah Ayaz
# Data   : SAFE SAMPLE DATA (simulated household survey, 3 rounds)
#
# Computes the three standard WFP / FAO food security indicators:
#   FCS    Food Consumption Score   (weighted days of 8 food groups, 7-day recall)
#   rCSI   Reduced Coping Strategies Index (5 weighted strategies, 7-day recall)
#   MDD-W  Minimum Dietary Diversity for Women (>= 5 of 10 food groups)
# then tests change between baseline and endline.
#
# Run:  Rscript food_security_indicators.R
# Uses base R only, so it runs on any R install with no packages.
# =====================================================================

args <- commandArgs(trailingOnly = TRUE)
in_file  <- if (length(args) >= 1) args[1] else "../data/household_survey_raw.csv"
out_file <- if (length(args) >= 2) args[2] else "../data/household_indicators_R.csv"

hh <- read.csv(in_file, stringsAsFactors = FALSE)

# ---- 1. Food Consumption Score -------------------------------------
fcs_weights <- c(cereals = 2, pulses = 3, vegetables = 1, fruit = 1,
                 meat_fish = 4, dairy = 4, sugar = 0.5, oil = 0.5)
fcs_cols <- paste0("fcs_", names(fcs_weights), "_days")
stopifnot(all(fcs_cols %in% names(hh)))
hh$fcs <- as.vector(as.matrix(hh[, fcs_cols]) %*% fcs_weights)
hh$fcs_group <- cut(hh$fcs, breaks = c(-Inf, 21, 35, Inf),
                    labels = c("Poor", "Borderline", "Acceptable"))

# ---- 2. Reduced Coping Strategies Index ----------------------------
rcsi_weights <- c(less_preferred_food = 1, borrow_food = 2, limit_portions = 1,
                  adult_restrict = 3, reduce_meals = 1)
rcsi_cols <- paste0("rcsi_", names(rcsi_weights), "_days")
hh$rcsi <- as.vector(as.matrix(hh[, rcsi_cols]) %*% rcsi_weights)
hh$rcsi_group <- cut(hh$rcsi, breaks = c(-Inf, 3, 18, Inf),
                     labels = c("Low (0-3)", "Medium (4-18)", "High (19+)"))

# ---- 3. MDD-W (only households with a woman aged 15-49) -------------
mdd_cols <- grep("^mdd_", names(hh), value = TRUE)
hh$mdd_score <- rowSums(hh[, mdd_cols])
hh$mdd_w_met <- as.integer(hh$mdd_score >= 5)
hh$mdd_score[hh$woman_15_49_in_hh == 0] <- NA
hh$mdd_w_met[hh$woman_15_49_in_hh == 0] <- NA

# ---- 4. Summary table by round --------------------------------------
pct <- function(x) round(100 * mean(x, na.rm = TRUE), 1)
rounds <- c("Baseline", "Midline", "Endline")
summary_tbl <- do.call(rbind, lapply(rounds, function(r) {
  d <- hh[hh$round == r, ]
  data.frame(round = r, n = nrow(d),
             mean_fcs = round(mean(d$fcs), 1),
             pct_fcs_acceptable = pct(d$fcs_group == "Acceptable"),
             mean_rcsi = round(mean(d$rcsi), 1),
             pct_rcsi_high = pct(d$rcsi_group == "High (19+)"),
             pct_mddw_met = pct(d$mdd_w_met))
}))
print(summary_tbl, row.names = FALSE)

# ---- 5. Did things change? Baseline vs endline ----------------------
# Independent samples (different households each round)
base <- hh[hh$round == "Baseline", ]
endl <- hh[hh$round == "Endline", ]

t_fcs <- t.test(endl$fcs, base$fcs)                    # Welch t-test
acc   <- table(factor(hh$round[hh$round %in% c("Baseline", "Endline")]),
               hh$fcs_group[hh$round %in% c("Baseline", "Endline")] == "Acceptable")
chi   <- chisq.test(acc)

cat(sprintf("\nFCS mean change: %+.1f points (Welch t = %.2f, p = %.4f)\n",
            mean(endl$fcs) - mean(base$fcs), t_fcs$statistic, t_fcs$p.value))
cat(sprintf("Acceptable FCS share, chi-square = %.2f, p = %.4f\n",
            chi$statistic, chi$p.value))

# ---- 6. Who is left behind? Endline FCS by sex of household head ----
cat("\nEndline: % acceptable FCS by sex of household head\n")
print(tapply(endl$fcs_group == "Acceptable", endl$hh_head_sex, pct))

# Logistic regression: odds of acceptable FCS at endline
endl$acceptable <- as.integer(endl$fcs_group == "Acceptable")
fit <- glm(acceptable ~ hh_head_sex + province + intervention + hh_size,
           data = endl, family = binomial())
or <- exp(cbind(OR = coef(fit), confint.default(fit)))
cat("\nOdds ratios (endline, acceptable FCS)\n")
print(round(or, 2))

# ---- 7. Save the indicator file for Power BI / Tableau --------------
keep <- c("hh_id", "round", "province", "intervention", "hh_head_sex", "hh_size",
          "fcs", "fcs_group", "rcsi", "rcsi_group", "mdd_score", "mdd_w_met",
          "income_increased", "benefit_will_last")
write.csv(hh[, keep], out_file, row.names = FALSE, na = "")
cat("\nSaved:", out_file, "\n")
