# R for data analysis · Working with data · Lesson 7
# Combine tables with bind_cols() and bind_rows()
# Join tables side by side, or stack them one under another.
# Aqil Shah Ayaz · aqilshah-researcher.github.io

Main_Question <- Dataset %>% select('3. Did you receive 50 KG UREA?',
                                    '4. If not, how many KGs did you receive?',
                                    '10. How was the physical quality of the wheat seed received?')

# Combining data frames: column-wise (same number of rows)
demographic <- bind_cols(demographic, Main_Question)

# Combining data frames: row-wise (stacks rows)
demographic <- bind_rows(demographic, Initial_Information)
