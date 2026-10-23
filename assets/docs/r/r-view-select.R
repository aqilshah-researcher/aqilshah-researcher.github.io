# R for data analysis · Editing data · Lesson 1
# A new dataset: load, view and select
# Start a new project script, load a fresh dataset, view it, and select the columns you need.
# Aqil Shah Ayaz · aqilshah-researcher.github.io

setwd("/Users/yourname/Desktop/R Teaching/6. Session Six")
library(readxl)
library(tidyverse)
library(dplyr)

Dataset <- read_excel("Dataset.xlsx")

# To view a dataset
View(Dataset)

# Select columns to create a data frame
Demographic <- Dataset %>% select("Province Name", "Sex of household head",
                                  "Marital Status of household head")
