// ai/fix.js — auto-fix loop when build fails
// Uses @google/genai (new SDK).

import { GoogleGenAI } from '@google/genai';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const FIX_MAX_ATTEMPTS = 3;

function log(...args) { console.log('[fix]', ...args); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, label = 'gemini call') {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.status || err.code;
      const isRateLimit = status === 429 || /RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(err.message || '');
      if (!isRateLimit || attempt === maxAttempts) throw err;
      const match = (err.message || '').match(/retry in ([\d.]+)s/i);
      const waitSec = match ? Math.ceil(parseFloat(match[1])) + 1 : Math.min(60, 2 ** attempt);
      log(`${label} hit rate limit (attempt ${attempt}/${maxAttempts}), waiting ${waitSec}s...`);
      await sleep(waitSec * 1000);
    }
  }
}

async function runBuild() {
  try {
    const { stdout, stderr } = await execAsync('./gradlew assembleDebug --no-daemon', {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 8 * 60 * 1000,
    });
    return { success: true, output: stdout + '\n' + stderr };
  } catch (err) {
    return { success: false, output: (err.stdout || '') + '\n' + (err.stderr || err.message) };
  }
}

async function askGeminiForFix(buildError) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

  // Read current MainActivity as context
  let mainActivity = '';
  try {
    mainActivity = await fs.readFile('app/src/main/java/com/example/app/MainActivity.java', 'utf8');
  } catch {}

  const prompt = `The Android build failed. Here is the error output:

\`\`\`
${buildError.slice(-5000)}
\`\`\`

Current MainActivity.java:

\`\`\`java
${mainActivity}
\`\`\`

Output ONLY a JSON object (no markdown fences, no prose) describing the surgical fixes:

{
  "edits": [
    { "filepath": "app/src/main/java/com/example/app/MainActivity.java", "old_string": "exact text to replace", "new_string": "replacement" }
  ],
  "writes": [
    { "filepath": "path/to/new.xml", "content": "<full file content>" }
  ],
  "explanation": "Why this fixes the build"
}

Rules:
- Only fix what's broken
- old_string must be unique in the file
- Don't rewrite files that don't need changes
- Java is in package com.example.app
- If you need a layout file, put it under app/src/main/res/layout/`;

  const response = await withRetry(
    () => ai.models.generateContent({ model, contents: prompt }),
    'fix generateContent'
  );
  const text = response.text || '';

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    log('Could not extract JSON from response');
    return null;
  }
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    log('JSON parse failed:', e.message);
    return null;
  }
}

async function applyFixes(plan) {
  if (!plan) return false;

  for (const edit of (plan.edits || [])) {
    try {
      const current = await fs.readFile(edit.filepath, 'utf8');
      if (!current.includes(edit.old_string)) {
        log(`  ! old_string not found in ${edit.filepath}, skipping`);
        continue;
      }
      await fs.writeFile(edit.filepath, current.replace(edit.old_string, edit.new_string), 'utf8');
      log(`  ~ edited ${edit.filepath}`);
    } catch (err) {
      log(`  ! edit failed on ${edit.filepath}: ${err.message}`);
    }
  }

  for (const write of (plan.writes || [])) {
    try {
      await fs.mkdir(write.filepath.split('/').slice(0, -1).join('/'), { recursive: true });
      await fs.writeFile(write.filepath, write.content, 'utf8');
      log(`  + wrote ${write.filepath}`);
    } catch (err) {
      log(`  ! write failed on ${write.filepath}: ${err.message}`);
    }
  }

  return true;
}

async function main() {
  log('Starting fix loop, max', FIX_MAX_ATTEMPTS, 'attempts');

  for (let i = 0; i < FIX_MAX_ATTEMPTS; i++) {
    log(`--- fix attempt ${i + 1}/${FIX_MAX_ATTEMPTS} ---`);
    log('Running build...');
    const result = await runBuild();
    if (result.success) {
      log('Build succeeded on attempt', i + 1);
      return;
    }
    log('Build failed. Output:');
    console.log(result.output.slice(-2000));

    log('Asking Gemini for a fix...');
    const plan = await askGeminiForFix(result.output);
    if (!plan) {
      log('No plan from Gemini, giving up');
      return;
    }
    log('Plan:', plan.explanation);
    await applyFixes(plan);
  }

  log(`Exhausted ${FIX_MAX_ATTEMPTS} fix attempts. Build still failing.`);
  process.exit(1);
}

main().catch((err) => {
  console.error('Fatal in fix loop:', err);
  process.exit(1);
});
