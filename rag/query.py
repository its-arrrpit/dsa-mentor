
import os
from sentence_transformers import SentenceTransformer
from flask import Flask, request, jsonify
from flask_cors import CORS
import chromadb

app = Flask(__name__)
CORS(app)

print("Loading embedding model...")
model = SentenceTransformer('all-MiniLM-L6-v2')

print("Connecting to ChromaDB...")
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dsa_db")
client = chromadb.PersistentClient(path=DB_PATH)
collection = client.get_collection("dsa_knowledge")

print("RAG server ready!")

@app.route('/retrieve', methods=['POST'])
def retrieve():
    data = request.json
    query = f"{data.get('title', '')} {data.get('description', '')} {data.get('code', '')}"
    
    query_vector = model.encode(query).tolist()
    
    results = collection.query(
        query_embeddings=[query_vector],
        n_results=3
    )
    
    context = "\n\n".join(results['documents'][0])
    return jsonify({ "context": context })

if __name__ == '__main__':
    app.run(port=5000)