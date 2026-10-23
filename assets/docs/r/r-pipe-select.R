# R for data analysis · Working with data · Lesson 1
# The pipe and select(): build a smaller table
# Use the pipe %>% and select() to keep only the columns you need.
# Aqil Shah Ayaz · aqilshah-researcher.github.io

library(dplyr)

# Pipe shortcut: Ctrl + Shift + M  (Mac: Cmd + Shift + M)
demographic <- Dataset %>% select('0.1 Province Name', '0.2 District Name',
                                  '0.11 Sex of household head',
                                  '0.12 Marital Status of household head',
                                  'HH Size')
View(demographic)
