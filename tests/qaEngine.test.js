const { initQaEngine, getAnswer } = require('../src/services/qaEngine');
const tfidfIndex = require('../src/services/tfidfIndex');

describe('AI QA Engine Service', () => {
  beforeAll(async () => {
    // Build knowledge base index (reads files from directory and tokenizes them)
    await initQaEngine();
  });

  it('should verify TF-IDF index is ready', () => {
    expect(tfidfIndex.isReady()).toBe(true);
  });

  it('should answer questions from the guide with high confidence (score >= 0.20)', async () => {
    const res = await getAnswer('ما هي الوثائق المطلوبة لإصدار شهادة العضوية', 'ar');
    expect(res.canAnswer).toBe(true);
    expect(res.score).toBeGreaterThanOrEqual(0.20);
    expect(res.answer).toBeDefined();
    expect(res.source).toBeDefined();
  });

  it('should reject general trivia or unrelated questions with low confidence (score < 0.20)', async () => {
    const res = await getAnswer('ما هي عاصمة الأردن', 'ar');
    expect(res.canAnswer).toBe(false);
    expect(res.score).toBeLessThan(0.20);
    expect(res.answer).toBeNull();
  });
});
