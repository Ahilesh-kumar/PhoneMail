import pandas as pd

# Create a Series
s = pd.Series([100, 200, 300, 400], index=['a', 'b', 'c', 'd'])

# Access the first element
print(s.iloc[0])
