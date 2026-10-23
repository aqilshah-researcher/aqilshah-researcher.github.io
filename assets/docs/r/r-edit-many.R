# R for data analysis · Editing data · Lesson 4
# Change one cell, or many cells at once
# Replace values with [row, column] <- value, for a single cell or a whole range of rows.
# Aqil Shah Ayaz · aqilshah-researcher.github.io

# Change one cell: row 115, column 2
Demographic[115, 2] <- "Male"

# Change many cells: rows 1 to 200, column 2
Demographic[1:200, 2] <- "Female"

# Check the result
table(Demographic$`Sex of household head`)

# Undo by setting them back
Demographic[1:352, 2] <- "Male"
