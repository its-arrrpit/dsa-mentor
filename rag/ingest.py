from sentence_transformers import SentenceTransformer
import chromadb
import json
import os

print("Loading embedding model all-MiniLM-L6-v2...")
model = SentenceTransformer('all-MiniLM-L6-v2')

db_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dsa_db")
print(f"Connecting to ChromaDB at: {db_dir}")
client = chromadb.PersistentClient(path=db_dir)

# Reset pattern collection
try:
    client.delete_collection("dsa_patterns")
    print("Old dsa_patterns collection deleted.")
except Exception:
    pass

patterns_collection = client.get_or_create_collection("dsa_patterns")

patterns_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'patterns.json')
with open(patterns_file, 'r', encoding='utf-8') as f:
    patterns = json.load(f)

print(f"Ingesting {len(patterns)} curated DSA patterns...")

pattern_ids = [p['id'] for p in patterns]
pattern_texts = [p['text'] for p in patterns]
pattern_embeddings = [model.encode(t).tolist() for t in pattern_texts]
pattern_metadatas = [{"id": p['id'], "type": "pattern"} for p in patterns]

patterns_collection.add(
    ids=pattern_ids,
    embeddings=pattern_embeddings,
    documents=pattern_texts,
    metadatas=pattern_metadatas
)

print(f"\nDone! Successfully ingested {len(patterns)} curated patterns into ChromaDB.")
print("The model will now receive high-signal pattern guides instead of noisy problem statements.")