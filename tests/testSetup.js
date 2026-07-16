// Mock ES module dependencies of natural to prevent Jest compilation errors
jest.mock('afinn-165', () => {
  return { afinn165: {} };
}, { virtual: true });

jest.mock('sentiword', () => {
  return {};
}, { virtual: true });

jest.mock('uuid', () => {
  return {
    v1: () => 'mocked-uuid-v1',
    v3: () => 'mocked-uuid-v3',
    v4: () => 'mocked-uuid-v4',
    v5: () => 'mocked-uuid-v5',
    NIL: '00000000-0000-0000-0000-000000000000'
  };
}, { virtual: true });

jest.mock('pdf-parse', () => {
  class MockPDFParse {
    constructor() {}
    async load() {}
    async getText() {
      return {
        text: 'إصدار شهاده عضوية. برنامج أمان يوفر تغطية صحية لعام 2026. الوثائق المطلوبة لإصدار شهادة العضوية هي الهوية والشهادة.'
      };
    }
  }
  return {
    PDFParse: MockPDFParse
  };
});

const { sequelize } = require('../src/models');

beforeAll(async () => {
  // Synchronize database schema for SQLite in-memory DB before tests run
  await sequelize.sync({ force: true });
});

afterAll(async () => {
  // Close the database connection to avoid open handles
  await sequelize.close();
});
