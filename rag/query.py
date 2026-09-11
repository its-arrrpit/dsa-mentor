
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
    data = request.get_json(silent=True) or {}
    title = data.get('title', '').strip()
    desc = data.get('description', '').strip()
    
    # Clean description: keep first 350 chars to avoid exceeding all-MiniLM-L6-v2 token limit
    clean_desc = desc[:350].replace('\r', ' ').replace('\n', ' ')
    query = f"{title}. {clean_desc}".strip()
    if not query:
        return jsonify({ "context": "" })

    query_vector = model.encode(query).tolist()

    # Prefer pure patterns collection to avoid noise from raw problem dumps
    try:
        patterns_col = client.get_collection("dsa_patterns")
        results = patterns_col.query(
            query_embeddings=[query_vector],
            n_results=2
        )
    except Exception:
        knowledge_col = client.get_collection("dsa_knowledge")
        try:
            results = knowledge_col.query(
                query_embeddings=[query_vector],
                where={"type": "pattern"},
                n_results=2
            )
        except Exception:
            results = knowledge_col.query(
                query_embeddings=[query_vector],
                n_results=2
            )

    docs = results.get('documents', [[]])[0] if results else []
    dists = results.get('distances', [[]])[0] if results else []

    # Strict distance threshold (< 1.25): only return genuinely relevant patterns
    relevant_docs = [doc for doc, dist in zip(docs, dists) if dist < 1.25]
    context = "\n\n".join(relevant_docs)
    return jsonify({ "context": context })

if __name__ == '__main__':
    app.run(port=5000)