-- =====================================================================
-- TPM site-visit tracker: star schema and analysis queries
-- Author : Aqil Shah Ayaz
-- Data   : SAFE SAMPLE DATA (simulated)
-- Dialect: ANSI SQL, tested on SQLite. Runs on PostgreSQL / SQL Server
--          with small date-function changes (noted inline).
-- =====================================================================

-- ---------- 1. Schema -------------------------------------------------
CREATE TABLE IF NOT EXISTS dim_province (
    province    VARCHAR(40) PRIMARY KEY,
    region      VARCHAR(20) NOT NULL,
    lat         DECIMAL(6,3),
    lon         DECIMAL(6,3)
);

CREATE TABLE IF NOT EXISTS fact_site_visit (
    visit_id              VARCHAR(12) PRIMARY KEY,
    planned_date          DATE        NOT NULL,
    monitoring_date       DATE,
    province              VARCHAR(40) NOT NULL REFERENCES dim_province(province),
    technical_office      VARCHAR(40) NOT NULL,
    award_code            VARCHAR(12) NOT NULL,
    intervention_type     VARCHAR(60),
    implementing_partner  VARCHAR(10),
    status                VARCHAR(20) NOT NULL
        CHECK (status IN ('Completed','IP Postponed','IP Canceled','TPM Canceled')),
    validation_status     VARCHAR(20),
    flag                  VARCHAR(10) CHECK (flag IN ('No flag','Yellow','Red')),
    flag_category         VARCHAR(60),
    days_to_submit        INTEGER,
    monitor_gender        VARCHAR(10)
);

-- ---------- 2. Headline KPIs (same logic as the Power BI DAX measures)
SELECT
    COUNT(*)                                                     AS planned_visits,
    SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END)        AS completed,
    ROUND(100.0 * SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct_completed,
    SUM(CASE WHEN flag = 'Red' THEN 1 ELSE 0 END)                AS red_flags,
    ROUND(100.0 * SUM(CASE WHEN flag IN ('Yellow','Red') THEN 1 ELSE 0 END)
          / NULLIF(SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END), 0), 1) AS pct_visits_flagged
FROM fact_site_visit;

-- ---------- 3. Completion and cancellation by region ------------------
SELECT  p.region,
        COUNT(*) AS planned,
        ROUND(100.0 * AVG(CASE WHEN f.status = 'Completed'    THEN 1.0 ELSE 0 END), 1) AS pct_completed,
        ROUND(100.0 * AVG(CASE WHEN f.status = 'IP Postponed' THEN 1.0 ELSE 0 END), 1) AS pct_ip_postponed,
        ROUND(100.0 * AVG(CASE WHEN f.status = 'IP Canceled'  THEN 1.0 ELSE 0 END), 1) AS pct_ip_canceled
FROM fact_site_visit f
JOIN dim_province p ON p.province = f.province
GROUP BY p.region
ORDER BY pct_completed;

-- ---------- 4. Flag rate by technical office (where do problems sit?) -
SELECT  technical_office,
        SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN flag = 'Yellow' THEN 1 ELSE 0 END)      AS yellow,
        SUM(CASE WHEN flag = 'Red'    THEN 1 ELSE 0 END)      AS red,
        ROUND(100.0 * SUM(CASE WHEN flag <> 'No flag' AND status = 'Completed' THEN 1 ELSE 0 END)
              / NULLIF(SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END), 0), 1) AS flag_rate_pct
FROM fact_site_visit
GROUP BY technical_office
ORDER BY flag_rate_pct DESC;

-- ---------- 5. Monthly trend with a 3-month rolling average -----------
-- SQLite: strftime('%Y-%m', d). PostgreSQL: to_char(d,'YYYY-MM'). SQL Server: FORMAT(d,'yyyy-MM').
WITH monthly AS (
    SELECT strftime('%Y-%m', planned_date) AS month,
           SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed
    FROM fact_site_visit
    GROUP BY 1
)
SELECT month,
       completed,
       ROUND(AVG(completed) OVER (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 1) AS rolling_3m
FROM monthly
ORDER BY month;

-- ---------- 6. Provinces whose red-flag rate is above the national rate
WITH prov AS (
    SELECT province,
           SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN flag = 'Red' THEN 1 ELSE 0 END)         AS red
    FROM fact_site_visit
    GROUP BY province
), nat AS (
    SELECT 1.0 * SUM(red) / SUM(completed) AS rate FROM prov
)
SELECT p.province, p.completed, p.red,
       ROUND(100.0 * p.red / p.completed, 1) AS red_rate_pct,
       ROUND(100.0 * n.rate, 1)              AS national_pct
FROM prov p CROSS JOIN nat n
WHERE p.completed >= 40 AND 1.0 * p.red / p.completed > n.rate
ORDER BY red_rate_pct DESC;

-- ---------- 7. Partners with repeated red flags (follow-up list) -------
SELECT implementing_partner, award_code,
       COUNT(*) AS red_flags,
       GROUP_CONCAT(DISTINCT flag_category) AS issues   -- PostgreSQL: STRING_AGG(DISTINCT flag_category, ', ')
FROM fact_site_visit
WHERE flag = 'Red'
GROUP BY implementing_partner, award_code
HAVING COUNT(*) >= 3
ORDER BY red_flags DESC;

-- ---------- 8. Reporting timeliness: share of reports in 5 days or less
SELECT technical_office,
       ROUND(AVG(days_to_submit), 1) AS avg_days,
       ROUND(100.0 * AVG(CASE WHEN days_to_submit <= 5 THEN 1.0 ELSE 0 END), 1) AS pct_on_time
FROM fact_site_visit
WHERE status = 'Completed'
GROUP BY technical_office
ORDER BY pct_on_time;
