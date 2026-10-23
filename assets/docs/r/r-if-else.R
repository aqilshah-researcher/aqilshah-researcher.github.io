# R for data analysis · Cleaning and recoding · Lesson 1
# Recode labels to numbers with if_else()
# Turn Male and Female into 1 and 2, and back again, with mutate() and if_else().
# Aqil Shah Ayaz · aqilshah-researcher.github.io

# Converting a two-choice variable from label to value
demographic <- demographic %>% mutate(Gender = if_else(Gender == "Male", 1, 2))

# Converting from value back to label
demographic <- demographic %>% mutate(Gender = if_else(Gender == 1, "Male", "Female"))
