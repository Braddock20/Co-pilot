// ai/test-loader.mjs — registers an ESM loader hook to replace @google/genai
// with a stub. Used only for local smoke testing, not in production.
//
// Run: node --import=./ai/test-loader.mjs ./ai/smoke-test-loop.js

import { register } from 'node:module';

register('./fake-loader-impl.mjs', import.meta.url);
