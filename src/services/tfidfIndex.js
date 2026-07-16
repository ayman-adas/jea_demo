'use strict';

/**
 * tfidfIndex.js
 * Builds a TF-IDF search index over knowledge base chunks.
 * Provides cosine similarity search with a 0.0–1.0 score.
 */

const natural = require('natural');
const { buildKnowledgeBase } = require('./knowledgeBase');

const TfIdf = natural.TfIdf;
const tokenizer = new natural.WordTokenizer();

let tfidf = null;       // TfIdf instance
let chunks = [];        // Raw chunk objects
let initialized = false;

/**
 * Arabic stop words (common words that add no semantic value).
 */
const ARABIC_STOP_WORDS = new Set([
  'في', 'من', 'إلى', 'على', 'عن', 'مع', 'هذا', 'هذه', 'ذلك', 'تلك',
  'هو', 'هي', 'هم', 'هن', 'أن', 'إن', 'كان', 'كانت', 'يكون', 'لا',
  'ما', 'لم', 'لن', 'قد', 'قال', 'أو', 'و', 'ف', 'ب', 'ل', 'ك',
  'ثم', 'حتى', 'إذا', 'التي', 'الذي', 'الذين', 'اللواتي', 'أي', 'كل',
  'بعض', 'غير', 'عند', 'حين', 'بين', 'وقد', 'وكان'
]);

/**
 * Normalize and tokenize text for both Arabic and English.
 * Removes diacritics, punctuation, and stop words.
 * @param {string} text
 * @returns {string} cleaned text
 */
function normalize(text) {
  if (!text) return '';

  let t = text
    // Remove Arabic diacritics (tashkeel)
    .replace(/[\u064B-\u065F\u0670]/g, '')
    // Normalize Arabic Alef forms
    .replace(/[أإآا]/g, 'ا')
    // Normalize Teh Marbuta
    .replace(/ة/g, 'ه')
    // Remove punctuation
    .replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~،؟؛]/g, ' ')
    // Lowercase English
    .toLowerCase()
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();

  // Remove stop words
  const tokens = t.split(' ').filter(w => w.length > 1 && !ARABIC_STOP_WORDS.has(w));
  return tokens.join(' ');
}

/**
 * Build the TF-IDF index from all knowledge base chunks.
 * Called once at startup. Idempotent.
 */
async function initialize() {
  if (initialized) return;

  console.log('[TfIdfIndex] Building knowledge base index...');
  chunks = await buildKnowledgeBase();

  tfidf = new TfIdf();
  for (const chunk of chunks) {
    tfidf.addDocument(normalize(chunk.content));
  }

  initialized = true;
  console.log(`[TfIdfIndex] Index built with ${chunks.length} chunks.`);
}

/**
 * Compute TF-IDF vector for a given document index.
 * @param {number} docIndex
 * @returns {Map<string, number>}
 */
function getDocVector(docIndex) {
  const vec = new Map();
  tfidf.listTerms(docIndex).forEach(({ term, tfidf: score }) => {
    vec.set(term, score);
  });
  return vec;
}

/**
 * Compute TF-IDF vector for a raw query string.
 * Uses a temporary document added to the index, then removed.
 * @param {string} query
 * @returns {Map<string, number>}
 */
function getQueryVector(query) {
  const normalizedQuery = normalize(query);
  const tempIdx = chunks.length; // position for temp doc
  tfidf.addDocument(normalizedQuery);

  const vec = new Map();
  tfidf.listTerms(tempIdx).forEach(({ term, tfidf: score }) => {
    vec.set(term, score);
  });

  // Remove temp document
  tfidf.documents.pop();
  return vec;
}

/**
 * Cosine similarity between two sparse vectors (as Maps).
 * @param {Map<string, number>} vecA
 * @param {Map<string, number>} vecB
 * @returns {number} 0.0 to 1.0
 */
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  vecA.forEach((valA, term) => {
    normA += valA * valA;
    if (vecB.has(term)) {
      dotProduct += valA * vecB.get(term);
    }
  });

  vecB.forEach(valB => { normB += valB * valB; });

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Search the knowledge base for the most relevant chunks.
 * @param {string} query   - user question (Arabic or English)
 * @param {number} topK    - number of results to return (default 3)
 * @returns {{ chunk: object, score: number }[]}  sorted by score desc
 */
function search(query, topK = 3) {
  if (!initialized || chunks.length === 0) {
    return [];
  }

  const queryVec = getQueryVector(query);
  const results = [];

  for (let i = 0; i < chunks.length; i++) {
    const docVec = getDocVector(i);
    const score = cosineSimilarity(queryVec, docVec);
    results.push({ chunk: chunks[i], score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

/**
 * Check whether the index is ready.
 * @returns {boolean}
 */
function isReady() {
  return initialized;
}

module.exports = { initialize, search, isReady };
