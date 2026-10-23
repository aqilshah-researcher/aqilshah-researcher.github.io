# R for data analysis · Working with data · Lesson 5
# Filter rows with filter()
# Keep only the rows you need, such as male-headed or female-headed households.
# Aqil Shah Ayaz · aqilshah-researcher.github.io

# Filtering a data frame
Male_Only_Demographic <- demographic %>% filter(Gender == "Male")
Female_Only_Demographic <- demographic %>% filter(Gender == "Female")

View(Male_Only_Demographic)
