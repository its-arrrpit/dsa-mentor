import pandas as pd
import json
import re

df = pd.read_csv("leetcode_dataset.csv")

df = df[['title', 'description', 'difficulty', 'related_topics']].dropna()

print(f"Total problems: {len(df)}")

problems = []
for i, row in df.iterrows():
    desc = re.sub(r'\s+', ' ', str(row['description'])).strip()[:300]
    
    topics = str(row['related_topics'])
    
    problems.append({
        "id": f"lc-{i}-{row['title'].lower().replace(' ', '-')[:30]}",
        "text": f"{row['title']} ({row['difficulty']})\nTopics: {topics}\n{desc}"
    })

with open('kaggle_problems.json', 'w') as f:
    json.dump(problems, f, indent=2)

print(f"Saved {len(problems)} problems to kaggle_problems.json")
print("\nSample entry:")
print(json.dumps(problems[3], indent=2))