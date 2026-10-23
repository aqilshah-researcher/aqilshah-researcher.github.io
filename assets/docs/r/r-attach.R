# R for data analysis · Editing data · Lesson 5
# attach(): type column names with ease
# Attach a dataset so RStudio suggests its column names, and understand the masking messages.
# Aqil Shah Ayaz · aqilshah-researcher.github.io

# Attaching a dataset: it eases selecting column names
attach(Dataset)
attach(Demographic)

# Now RStudio suggests column names as you type
Demographic_1 <- Dataset %>% select(`Province Name`, `Sex of household head`,
                                    `Marital Status of household head`)

# When you are done
detach(Demographic)
