# R for data analysis · Editing data · Lesson 3
# Check counts with table() and remove rows safely
# Count values with table(), remove a row, and learn why the comma inside [ ] matters so much.
# Aqil Shah Ayaz · aqilshah-researcher.github.io

# Count the values in one column
table(Demographic$`Sex of household head`)

# Remove the first row (note the comma!)
Demographic <- Demographic[-1, ]

# Without the comma, R removes a COLUMN instead
# Demographic <- Demographic[-1]   # careful!

# Remove a specific row
Demographic <- Demographic[-112, ]
