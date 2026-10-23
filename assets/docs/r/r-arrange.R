# R for data analysis · Working with data · Lesson 4
# Sort rows with arrange()
# Order your table by one column, A to Z or Z to A, with arrange() and desc().
# Aqil Shah Ayaz · aqilshah-researcher.github.io

# Arranging rows: ascending (A to Z)
demographic <- demographic %>% arrange(Province)
demographic <- demographic %>% arrange(Gender)

# Descending (Z to A)
demographic <- demographic %>% arrange(desc(Gender))
