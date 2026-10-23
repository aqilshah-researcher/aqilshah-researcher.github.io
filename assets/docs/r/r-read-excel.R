# R for data analysis · Getting ready · Lesson 4
# Open an Excel file and inspect it
# Load an Excel sheet with read_excel(), then look at it with head, str, summary and colnames.
# Aqil Shah Ayaz · aqilshah-researcher.github.io

library(readxl)

# Opening an Excel file
Dataset <- read_excel("Clean_Dataset.xlsx")

# Inspecting the dataset
head(Dataset)       # first 6 rows
str(Dataset)        # structure: column types
unique(Dataset)     # unique rows
summary(Dataset)    # min, max, mean for numbers
colnames(Dataset)   # all column names
print(Dataset)      # print the table
