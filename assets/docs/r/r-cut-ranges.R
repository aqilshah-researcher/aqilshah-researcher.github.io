# R for data analysis · Cleaning and recoding · Lesson 2
# Group numbers into ranges with cut()
# Turn household size into groups like 1 to 5 and 5 to 10, then count them with cross_cases().
# Aqil Shah Ayaz · aqilshah-researcher.github.io

library(expss)

# Make ranges from a number column
demographic <- demographic %>% mutate(HH_Size = cut(HH_Size,
                       breaks = c(1, 5, 10, 15, 20, Inf),
                       labels = c("1 to 5", "5 to 10", "10 to 15",
                                  "15 to 20", "More than 20")))

# Frequency table
cross_cases(demographic, cell_vars = HH_Size)
