// Lesson 5.4 (optional): the same index, in a vector database.
//
// sqlite-vec adds vector search to SQLite, and SQLite is built into Node. The vectors
// come from the embedding cache, so nothing gets embedded again.
//
// Setup:  npm install sqlite-vec
// Run:    npx tsx m05-rag/vector-db.ts "a question about your course notes"

import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import * as sqliteVec from "sqlite-vec";
import { embed } from "../common/llm";
import { loadCorpus } from "../m04-embeddings/corpus";
import { buildIndex, QUERY_PREFIX, semanticSearch } from "../m04-embeddings/semantic";
import { splitBySize } from "./chunking";

const question = process.argv[2] ?? "What does the --no-memory flag prove?";
const K = 5;

const chunks = splitBySize(loadCorpus(), 800, 100);
const index = await buildIndex(chunks, "embeddings-800-100");
const dimensions = index[0].vector.length;

// SQLite stores vectors as raw bytes: 4 bytes (a 32-bit float) per number.
const asBytes = (vector: number[]) => new Uint8Array(new Float32Array(vector).buffer);

// A database file on disk: unlike Module 4's arrays, it survives restarts.
const db = new DatabaseSync(fileURLToPath(new URL("../.cache/notes.db", import.meta.url)), { allowExtension: true });
sqliteVec.load(db);

// Two tables: a normal one for the text, and a vec0 one for the vectors, linked by row number.
db.exec(`
  DROP TABLE IF EXISTS chunks;
  DROP TABLE IF EXISTS chunk_vectors;
  CREATE TABLE chunks (number INTEGER PRIMARY KEY, id TEXT, title TEXT, text TEXT);
  CREATE VIRTUAL TABLE chunk_vectors USING vec0(embedding float[${dimensions}] distance_metric=cosine);
`);

const insertChunk = db.prepare("INSERT INTO chunks (number, id, title, text) VALUES (?, ?, ?, ?)");
const insertVector = db.prepare("INSERT INTO chunk_vectors (rowid, embedding) VALUES (?, ?)");
db.exec("BEGIN");
index.forEach((chunk, i) => {
  const number = BigInt(i + 1); // vec0 needs whole-number row ids; a plain JS number would be sent as a float
  insertChunk.run(number, chunk.id, chunk.title, chunk.text);
  insertVector.run(number, asBytes(chunk.vector));
});
db.exec("COMMIT");
console.log(`Stored ${index.length} chunks with ${dimensions}-number vectors in .cache/notes.db\n`);

// The k-nearest-neighbour search runs inside the database, in SQL.
const [queryVector] = await embed([QUERY_PREFIX + question]);
let start = performance.now();
const rows = db
  .prepare(
    `WITH nearest AS (
       SELECT rowid, distance FROM chunk_vectors WHERE embedding MATCH ? AND k = ?
     )
     SELECT chunks.id, nearest.distance FROM nearest
     JOIN chunks ON chunks.number = nearest.rowid
     ORDER BY nearest.distance`,
  )
  .all(asBytes(queryVector), BigInt(K)) as { id: string; distance: number }[];
const databaseMs = performance.now() - start;

// The same search, done by hand as in Module 4.
start = performance.now();
const byHand = await semanticSearch(index, question, K);
const byHandMs = performance.now() - start; // includes embedding the question again

console.log(`Question: ${question}\n`);
console.log("sqlite-vec (cosine distance = 1 − similarity):");
rows.forEach((row, i) => console.log(`  ${i + 1}. ${(1 - row.distance).toFixed(3)}  ${row.id}`));
console.log(`  (${databaseMs.toFixed(1)} ms)\n`);
console.log("By hand, Module 4:");
byHand.forEach((hit, i) => console.log(`  ${i + 1}. ${hit.score.toFixed(3)}  ${hit.chunk.id}`));
console.log(`  (${byHandMs.toFixed(1)} ms, including embedding the question)`);
