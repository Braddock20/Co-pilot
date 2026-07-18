// ai/agent.js — main agent loop (v2, supercharged)
// Uses @google/genai (the new SDK, replacing the deprecated @google/generative-ai)
//
// Changes from v1:
//   - Default model upgraded to gemini-3.5-flash (much smarter than -lite)
//   - Two-pass review: the agent is expected to call `review_code` before `finish`
//   - `review_code` is a real tool that does a separate, focused review pass with
//     a stronger review prompt — it actually reads the code and returns a JSON
//     list of issues. The agent must address them.

import { GoogleGenAI } from '@google/genai';
import fs from 'fs/promises';
import path from 'path';
import { TOOLS, executeTool } from './tools.js';
import { SYSTEM_PROMPT, REVIEW_PROMPT } from './prompt.js';

const MAX_ITERATIONS = 30;  // bumped from 20 to allow pass 1 + review + fixes
// Default to gemini-3.5-flash — 5 RPM free tier, much higher quality than -lite.
// Override with GEMINI_MODEL env var if you want to use a different model.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
// Review pass can use the same model by default, or a smarter one if set.
const REVIEW_MODEL = process.env.GEMINI_REVIEW_MODEL || MODEL;

function log(...args) { console.log('[agent]', ...args); }

// Sleep helper for rate-limit backoff
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Call a Gemini function with retry on 429 (rate limit)
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

// Collect a snapshot of every file the agent has created or modified.
// This is what the review pass reads.
async function collectProjectSnapshot() {
  const snapshot = {};

  // Walk the project, skipping build / cache / generated dirs
  const SKIP = new Set(['node_modules', '.gradle', 'build', '.git', '.idea']);
  async function walk(dir, prefix = '') {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else {
        try {
          const stat = await fs.stat(full);
          // Skip huge files (deps, gradle wrapper jar, etc.)
          if (stat.size > 50_000) continue;
          const content = await fs.readFile(full, 'utf8');
          snapshot[rel] = content;
        } catch {}
      }
    }
  }

  // Only snapshot the parts of the project that matter for review
  const FOCUS_DIRS = ['app/src/main', 'app/build.gradle', 'build.gradle', 'settings.gradle'];
  for (const target of FOCUS_DIRS) {
    try {
      const stat = await fs.stat(target);
      if (stat.isDirectory()) {
        await walk(target, target);
      } else {
        snapshot[target] = await fs.readFile(target, 'utf8');
      }
    } catch {}
  }
  return snapshot;
}

// The review pass. Reads the current state of the project, asks the model to
// find bugs/missing wires/etc, returns a structured list of issues for the
// agent to address.
async function runReviewPass(apiKey, originalUserPrompt) {
  const ai = new GoogleGenAI({ apiKey });
  const snapshot = await collectProjectSnapshot();

  // Truncate individual files to keep the prompt under control
  const MAX_FILE_CHARS = 4000;
  const fileList = Object.entries(snapshot)
    .filter(([p]) => /\.(java|xml|gradle|kts)$/.test(p))
    .map(([p, content]) => {
      const truncated = content.length > MAX_FILE_CHARS
        ? content.slice(0, MAX_FILE_CHARS) + `\n...[truncated, ${content.length} chars total]`
        : content;
      return `=== ${p} ===\n${truncated}`;
    })
    .join('\n\n');

  const reviewRequest = `User's original request: "${originalUserPrompt}"

Here is the current state of the project. Find EVERY issue that would make this app not work or look bad:

${fileList}

Return your findings as a JSON object (no markdown fences, no prose). Be specific and ruthless. If the code is good, return an empty issues array.

{
  "issues": [
    {
      "severity": "critical" | "major" | "minor",
      "file": "relative/path/to/file",
      "description": "What is wrong, exactly",
      "fix": "The exact change to make (or a description if the fix is large)"
    }
  ],
  "summary": "One-line overall assessment"
}

Focus on these classes of bugs (in priority order):
1. Buttons in layouts that don't have setOnClickListener calls in Java
2. Layouts that are referenced (R.layout.X) but don't exist as files
3. Layouts that exist but aren't referenced (orphan files)
4. findViewById calls for IDs that don't exist in any layout
5. Logic bugs: off-by-one, wrong operator, missing state update, infinite loops
6. Hardcoded user-facing strings that should be in strings.xml
7. Raw Android widgets (Button, EditText) where Material versions should be used
8. Hardcoded colors where theme attributes should be used
9. Resources referenced but not defined (colors, drawables, dimens)
10. Anything in the user's original request that isn't implemented

Be specific: cite the file, the line area, and what the fix is. Don't pad with non-issues.`;

  const response = await withRetry(
    () => ai.models.generateContent({
      model: REVIEW_MODEL,
      contents: reviewRequest,
      config: { systemInstruction: REVIEW_PROMPT, temperature: 0.1 },
    }),
    'review generateContent'
  );

  const text = response.text || '';

  // Try to extract JSON
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    log('Review returned no parseable JSON. Raw:', text.slice(0, 500));
    return { issues: [], summary: 'Review pass produced no parseable output.', raw: text };
  }
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    log('Review JSON parse failed:', e.message);
    return { issues: [], summary: 'Review pass JSON could not be parsed.', raw: text };
  }
}

async function main() {
  const userPrompt = process.env.USER_PROMPT;
  if (!userPrompt) {
    console.error('USER_PROMPT env var is required');
    process.exit(1);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY env var is required');
    process.exit(1);
  }

  log('Starting agent. Model:', MODEL, '| Review model:', REVIEW_MODEL);
  log('Prompt:', userPrompt);

  const ai = new GoogleGenAI({ apiKey });

  const config = {
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: TOOLS }],
    temperature: 0.2,
  };

  const chat = ai.chats.create({ model: MODEL, config });

  let response = await withRetry(
    () => chat.sendMessage({ message: userPrompt }),
    'initial sendMessage'
  );

  let iteration = 0;
  let totalIn = 0;
  let totalOut = 0;

  const recordUsage = (resp) => {
    const usage = resp.usageMetadata;
    if (usage) {
      totalIn += usage.promptTokenCount || 0;
      totalOut += usage.candidatesTokenCount || 0;
    }
  };
  recordUsage(response);

  // Track how many times the agent has called review_code. Allow multiple rounds
  // of review → fix → review, but cap it so the agent can't loop forever.
  const MAX_REVIEW_ROUNDS = 3;
  let reviewRounds = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    log(`--- iteration ${iteration} ---`);

    const candidate = response.candidates?.[0];
    if (!candidate) {
      log('No candidate in response, stopping');
      break;
    }

    const parts = candidate.content?.parts || [];

    for (const part of parts) {
      if (part.text) log('model says:', part.text);
    }

    let functionCalls = response.functionCalls || [];
    if (functionCalls.length === 0) {
      functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
    }

    if (functionCalls.length === 0) {
      log('No more function calls. Agent finished.');
      break;
    }

    const responseParts = [];
    for (const fc of functionCalls) {
      const name = fc.name;
      const args = fc.args || {};
      log(`tool call: ${name}(${JSON.stringify(args).slice(0, 200)})`);

      let output;
      try {
        output = await executeTool(name, args);
      } catch (err) {
        log(`tool ${name} threw:`, err.message);
        output = { error: err.message };
      }

      if (name === 'finish') {
        log('FINISH called by agent');
        const summaryText = args.summary || String(output);
        await fs.writeFile('ai-summary.md', `# AI Build Summary\n\n${summaryText}\n\n_Iterations: ${iteration}, review rounds: ${reviewRounds}, tokens in: ${totalIn}, out: ${totalOut}_`);
        responseParts.push({ functionResponse: { name, response: { result: 'Acknowledged. Build will now run.' } } });
        response = await withRetry(
          () => chat.sendMessage({ message: responseParts }),
          'sendMessage (finish branch)'
        );
        recordUsage(response);
        iteration = MAX_ITERATIONS;
        break;
      }

      if (name === 'review_code') {
        reviewRounds++;
        log(`Review pass ${reviewRounds}/${MAX_REVIEW_ROUNDS} starting...`);
        if (reviewRounds > MAX_REVIEW_ROUNDS) {
          output = {
            summary: 'Max review rounds reached. Proceed to finish or fix remaining issues manually.',
            issues: [],
            note: 'You have used all your review rounds. Call finish with the current state, even if issues remain.',
          };
        } else {
          try {
            const review = await runReviewPass(apiKey, userPrompt);
            const issueCount = (review.issues || []).length;
            log(`Review pass ${reviewRounds} found ${issueCount} issues. Summary: ${review.summary}`);
            output = {
              summary: review.summary || '(no summary)',
              issues: review.issues || [],
              round: reviewRounds,
              max_rounds: MAX_REVIEW_ROUNDS,
            };
            // Persist the review log for debugging
            await fs.writeFile(`ai-review-${reviewRounds}.json`, JSON.stringify(review, null, 2));
          } catch (err) {
            log('Review pass failed:', err.message);
            output = { summary: 'Review pass failed', issues: [], error: err.message };
          }
        }
      }

      let responsePayload = output;
      if (typeof output === 'string' && output.length > 20_000) {
        responsePayload = output.slice(0, 20_000) + `\n...[truncated]`;
      } else if (typeof output === 'object') {
        responsePayload = JSON.stringify(output);
      }

      responseParts.push({ functionResponse: { name, response: { result: String(responsePayload) } } });
    }

    if (iteration >= MAX_ITERATIONS) break;

    response = await withRetry(
      () => chat.sendMessage({ message: responseParts }),
      'sendMessage (loop)'
    );
    recordUsage(response);
  }

  if (iteration >= MAX_ITERATIONS) {
    log(`Hit iteration limit. Total in/out tokens: ${totalIn}/${totalOut}`);
  }

  try {
    await fs.access('ai-summary.md');
  } catch {
    const lastText = (response.candidates?.[0]?.content?.parts || [])
      .filter((p) => p.text)
      .map((p) => p.text)
      .join('\n');
    await fs.writeFile('ai-summary.md', `# AI Build Summary\n\n${lastText || '(no summary produced)'}\n\n_Iterations: ${iteration}, review rounds: ${reviewRounds}, tokens in: ${totalIn}, out: ${totalOut}_`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
