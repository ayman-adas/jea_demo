'use strict';

/**
 * knowledgeBase.js
 * Parses Markdown and PDF files from jea_services_info/ into
 * overlapping text chunks ready for TF-IDF indexing.
 */

const fs = require('node:fs');
const path = require('node:path');

const KB_DIR = path.join(__dirname, '..', '..', 'jea_services_info');

// Chunk size and overlap (in words)
const CHUNK_SIZE = 200;
const CHUNK_OVERLAP = 40;

/**
 * Split a long text into overlapping chunks.
 * @param {string} text
 * @param {string} source  filename for reference
 * @returns {{ id: string, source: string, content: string }[]}
 */
function splitIntoChunks(text, source) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let i = 0;
  let chunkIdx = 0;

  while (i < words.length) {
    const slice = words.slice(i, i + CHUNK_SIZE).join(' ');
    if (slice.trim().length > 20) { // skip tiny fragments
      chunks.push({
        id: `${source}_chunk_${chunkIdx++}`,
        source,
        content: slice.trim()
      });
    }
    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks;
}

/**
 * Read a Markdown file and return its plain text (strips MD syntax).
 * @param {string} filePath
 * @returns {string}
 */
function readMarkdown(filePath) {
  let text = fs.readFileSync(filePath, 'utf8');
  // Strip markdown symbols: headers, bold, italic, links, code blocks
  text = text
    .replace(/```[\s\S]*?```/g, '')      // code blocks
    .replace(/`[^`]+`/g, '')             // inline code
    .replace(/!\[.*?\]\(.*?\)/g, '')     // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → text
    .replace(/#{1,6}\s/g, '')            // headers
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1') // bold/italic
    .replace(/>\s/g, '')                 // blockquotes
    .replace(/\n{3,}/g, '\n\n');         // extra blank lines
  return text.trim();
}

/**
 * Read a PDF file and return its plain text.
 * Falls back gracefully if pdf-parse is not available or file is corrupt.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function readPdf(filePath) {
  try {
    const pdf = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    
    // Instantiate PDFParse class constructor with the buffer passed in data option
    const instance = new pdf.PDFParse({ data: buffer });
    await instance.load();
    const result = await instance.getText();
    return result?.text || '';
  } catch (err) {
    console.warn(`[KnowledgeBase] Could not parse PDF ${path.basename(filePath)}: ${err.message}`);
    return '';
  }
}

/**
 * Build and return all knowledge base chunks from MD + PDF files.
 * @returns {Promise<{ id: string, source: string, content: string }[]>}
 */
async function buildKnowledgeBase() {
  const allChunks = [];

  if (!fs.existsSync(KB_DIR)) {
    console.warn('[KnowledgeBase] jea_services_info/ directory not found.');
    return allChunks;
  }

  const files = fs.readdirSync(KB_DIR);

  for (const file of files) {
    const filePath = path.join(KB_DIR, file);
    const ext = path.extname(file).toLowerCase();
    let text = '';

    if (ext === '.md') {
      text = readMarkdown(filePath);
    } else if (ext === '.pdf') {
      text = await readPdf(filePath); // eslint-disable-line no-await-in-loop
    } else {
      continue; // skip other file types
    }

    if (text.trim().length < 30) continue;

    const chunks = splitIntoChunks(text, file);
    allChunks.push(...chunks);
    console.log(`[KnowledgeBase] Loaded ${chunks.length} chunks from: ${file}`);
  }

  console.log(`[KnowledgeBase] Total chunks: ${allChunks.length}`);
  return allChunks;
}

module.exports = { buildKnowledgeBase };
