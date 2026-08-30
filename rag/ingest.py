from sentence_transformers import SentenceTransformer
import chromadb
import json

print("Loading embedding model...")
model = SentenceTransformer('all-MiniLM-L6-v2')

print("Connecting to ChromaDB...")
client = chromadb.PersistentClient(path="./dsa_db")

try:
    client.delete_collection("dsa_knowledge")
    print("Old collection deleted.")
except:
    pass

collection = client.get_or_create_collection("dsa_knowledge")

with open('patterns.json') as f:
    patterns = json.load(f)
print(f"Patterns loaded: {len(patterns)}")

with open('kaggle_problems.json') as f:
    kaggle = json.load(f)
print(f"Kaggle problems loaded: {len(kaggle)}")

all_entries = patterns + kaggle
print(f"\nTotal entries to ingest: {len(all_entries)}")
print("This will take 3-5 minutes, please wait...\n")

batch_size = 50
for i in range(0, len(all_entries), batch_size):
    batch = all_entries[i:i+batch_size]
    
    ids = [e['id'] for e in batch]
    texts = [e['text'] for e in batch]
    embeddings = [model.encode(t).tolist() for t in texts]
    metadatas = [{"id": e['id']} for e in batch]
    
    collection.add(
        ids=ids,
        embeddings=embeddings,
        documents=texts,
        metadatas=metadatas
    )
    
    print(f"  âœ“ Ingested {min(i+batch_size, len(all_entries))}/{len(all_entries)}")

print(f"\nDone! {len(all_entries)} entries stored in ChromaDB.")