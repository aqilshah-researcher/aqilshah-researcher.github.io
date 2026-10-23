# R for data analysis · Working with data · Lesson 2
# Remove columns and rows
# Drop columns with a minus sign in select(), and drop rows by their number.
# Aqil Shah Ayaz · aqilshah-researcher.github.io

# Remove one column
demographic <- demographic %>% select(-`0.2 District Name`)

# Remove two columns
demographic <- demographic %>% select(-`0.2 District Name`, -`0.11 Sex of household head`)

# Remove one row (row 135)
demographic <- demographic[-135, ]

# Remove several rows
demographic <- demographic[-c(131, 132, 133, 134), ]
