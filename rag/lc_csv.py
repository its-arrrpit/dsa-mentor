import pandas as pd
df = pd.read_csv(r"C:\Users\arpit\OneDrive\Documents\HTML\DSAExtension\rag\leetcode_dataset.csv")
print(df.columns.tolist())
print(df.head(2))