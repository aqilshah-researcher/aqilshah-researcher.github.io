# R for data analysis · R basics · Lesson 5
# Calling functions: sort, sum, length, mean, median
# Use R's built-in functions to sort and summarize a list of numbers.
# Aqil Shah Ayaz · aqilshah-researcher.github.io

x <- c(1,5,3,5,6,4,3,65,3,3,4,6,8,5433,45)
sort(x)     # smallest to largest
sum(x)      # 5594
length(x)   # 15 values
mean(x)     # 372.93
median(x)   # 5
mode(x)     # "numeric": mode() tells the type, not the most common value
