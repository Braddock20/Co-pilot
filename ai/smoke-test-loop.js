// ai/smoke-test-loop.js — actually runs the agent loop with a stubbed Gemini.
// Uses a Node.js loader hook to override the @google/genai import.
//
// Run with: node --import ./ai/test-loader.mjs ai/smoke-test-loop.js
// OR:      node --loader=./ai/test-loader.mjs ai/smoke-test-loop.js  (deprecated)

import fs from 'fs/promises';

process.env.USER_PROMPT = 'build a hello world app';
process.env.GEMINI_API_KEY = 'fake-key-for-testing';
process.env.GEMINI_MODEL = 'gemini-3.5-flash';

// Dynamic import so the loader hook runs first
const { pathToFileURL } = await import('url');
const agentUrl = pathToFileURL('./ai/agent.js').href;
await import(agentUrl);

await new Promise((r) => setTimeout(r, 500));

try {
  const summary = await fs.readFile('ai-summary.md', 'utf8');
  console.log('=== ai-summary.md ===');
  console.log(summary);
  if (!summary.includes('smoke test complete')) {
    console.error('FAIL: summary did not contain expected text');
    process.exit(1);
  }
  console.log('\n✓ Agent loop ran end-to-end with stubbed Gemini');
} catch (e) {
  console.error('FAIL: ai-summary.md was not written:', e.message);
  process.exit(1);
}

try {
  const review = JSON.parse(await fs.readFile('ai-review-1.json', 'utf8'));
  console.log('\n=== ai-review-1.json (truncated) ===');
  console.log('Summary:', review.summary);
  console.log('Issues found:', (review.issues || []).length);
  if (review.issues && review.issues[0]) {
    console.log('First issue:', review.issues[0].description);
  }
  console.log('\n✓ Review pass ran and logged output');
} catch (e) {
  console.error('FAIL: review log not written:', e.message);
  process.exit(1);
}

console.log('\n=== ALL SMOKE TESTS PASSED ===');
process.exit(0);
