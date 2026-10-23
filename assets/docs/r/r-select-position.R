# R for data analysis · Editing data · Lesson 2
# Select columns by position with [ , ]
# Pick columns by their number with square brackets, and use ranges like 6:10.
# Aqil Shah Ayaz · aqilshah-researcher.github.io

# [rows, columns]: empty rows = all rows
Demographic_1 <- Dataset[, c(2, 3, 4)]

# A colon makes a range: 6:10 means 6, 7, 8, 9, 10
Main <- Dataset[, c(2, 3, 6:10)]

View(Main)

# Count values in a column
table(Demographic$`Sex of household head`)
