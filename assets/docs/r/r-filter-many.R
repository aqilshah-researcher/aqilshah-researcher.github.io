# R for data analysis · Working with data · Lesson 6
# Filter with several conditions
# Combine conditions in one filter() to find exactly the rows you are looking for.
# Aqil Shah Ayaz · aqilshah-researcher.github.io

# Complex filter: all conditions must be TRUE
DeepFilter <- demographic %>% filter(Gender == "Male",
                                     Province == "Badakhshan",
                                     Marital_Status == "Single")
View(DeepFilter)
