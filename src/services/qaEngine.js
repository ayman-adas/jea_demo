'use strict';

/**
 * qaEngine.js
 * High-level orchestration for JEA AI Q&A.
 * Combines tfidfIndex search with threshold handling (50% / 0.50).
 */

const tfidfIndex = require('./tfidfIndex');

// Cosine similarity threshold (50% confidence)
const CONFIDENCE_THRESHOLD = 0.50;

/**
 * Initialize the Q&A Engine (indexes files)
 */
async function initQaEngine() {
  await tfidfIndex.initialize();
}

/**
 * Clean source names to look nicer in messages
 * @param {string} filename 
 * @returns {string}
 */
function formatSource(filename) {
  if (!filename) return '';
  return filename
    .replace(/_/g, ' ')
    .replace('.pdf', '')
    .replace('.md', '');
}

/**
 * Process a user question and check similarity scores.
 * @param {string} question - The user query
 * @param {string} lang - 'ar' or 'en'
 * @returns {Promise<{ canAnswer: boolean, score: number, answer: string|null, source: string|null, suggestTicket: boolean }>}
 */
async function getAnswer(question, lang = 'ar') {
  if (!tfidfIndex.isReady()) {
    await initQaEngine();
  }

  const results = tfidfIndex.search(question, 1);
  if (results.length === 0) {
    return {
      canAnswer: false,
      score: 0,
      answer: null,
      source: null,
      suggestTicket: true
    };
  }

  const bestMatch = results[0];
  const scorePercentage = Math.round(bestMatch.score * 100);

  console.log(`[QA Engine] Query: "${question}" | Best Match Score: ${scorePercentage}% | Source: ${bestMatch.chunk.source}`);

  if (bestMatch.score >= CONFIDENCE_THRESHOLD) {
    // We found a matching document chunk
    let answerText = bestMatch.chunk.content;
    const cleanSource = formatSource(bestMatch.chunk.source);

    // Format final response with citation
    let formattedAnswer = '';
    if (lang === 'ar') {
      formattedAnswer = `${answerText}\n\n📖 *المصدر:* ${cleanSource} (درجة الثقة: ${scorePercentage}%)`;
    } else {
      formattedAnswer = `${answerText}\n\n📖 *Source:* ${cleanSource} (Confidence: ${scorePercentage}%)`;
    }

    return {
      canAnswer: true,
      score: bestMatch.score,
      answer: formattedAnswer,
      source: bestMatch.chunk.source,
      suggestTicket: false
    };
  }

  // Under threshold
  return {
    canAnswer: false,
    score: bestMatch.score,
    answer: null,
    source: bestMatch.chunk.source,
    suggestTicket: true
  };
}

module.exports = {
  initQaEngine,
  getAnswer
};
