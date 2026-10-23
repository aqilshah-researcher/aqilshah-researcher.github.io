# R for data analysis · Working with data · Lesson 3
# Rename columns, two ways
# Give columns short, clear names with names() or with rename().
# Aqil Shah Ayaz · aqilshah-researcher.github.io

# Way 1: replace all names, in order
names(demographic) <- c('Province', 'District', 'Gender', 'Marital_Status', 'HH_Size')

# Way 2: rename(new name = old name)
demographic <- demographic %>% rename("Province" = '0.1 Province Name',
                                      "District" = '0.2 District Name',
                                      "Gender" = '0.11 Sex of household head',
                                      "Marital_Status" = '0.12 Marital Status of household head',
                                      "HH_Size" = 'HH Size')
