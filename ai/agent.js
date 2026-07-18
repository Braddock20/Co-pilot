// ai/agent.js — main agent loop
// Uses @google/genai (the new SDK, replacing the deprecated @google/generative-ai)

import { GoogleGenAI } from '@google/genai';
import fs from 'fs/promises';
import { TOOLS, executeTool } from './tools.js';
import { SYSTEM_PROMPT } from './prompt.js';

const MAX_ITERATIONS = 20;
// Default to the lite model — much higher free-tier rate limit (15 RPM vs 5).
// Override with GEMINI_MODEL env var if you have a paid tier.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

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
      // Extract retry delay from error if present, else exponential backoff
      const match = (err.message || '').match(/retry in ([\d.]+)s/i);
      const waitSec = match ? Math.ceil(parseFloat(match[1])) + 1 : Math.min(60, 2 ** attempt);
      log(`${label} hit rate limit (attempt ${attempt}/${maxAttempts}), waiting ${waitSec}s...`);
      await sleep(waitSec * 1000);
    }
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

  log('Starting agent. Model:', MODEL);
  log('Prompt:', userPrompt);

  const ai = new GoogleGenAI({ apiKey });

  // Build the config with tools + system instruction
  const config = {
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: TOOLS }],
    temperature: 0.2,
  };

  const chat = ai.chats.create({ model: MODEL, config });

  // Kick off with the user's request
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

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    log(`--- iteration ${iteration} ---`);

    const candidate = response.candidates?.[0];
    if (!candidate) {
      log('No candidate in response, stopping');
      break;
    }

    const parts = candidate.content?.parts || [];

    // Log any text the model said
    for (const part of parts) {
      if (part.text) log('model says:', part.text);
    }

    // Collect function calls — prefer response.functionCalls (the new SDK's
    // normalized accessor). Only fall back to parts if it's empty.
    let functionCalls = response.functionCalls || [];
    if (functionCalls.length === 0) {
      functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
    }

    if (functionCalls.length === 0) {
      log('No more function calls. Agent finished.');
      break;
    }

    // Build the function response parts
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

      // If the model called `finish`, capture the summary and end the loop.
      if (name === 'finish') {
        log('FINISH called by agent');
        await fs.writeFile('ai-summary.md', `# AI Build Summary\n\n${output.summary || output}\n\n_Iterations: ${iteration}, tokens in: ${totalIn}, out: ${totalOut}_`);
        // Still send a response so the chat ends cleanly, but we'll break next.
        responseParts.push({ functionResponse: { name, response: { result: 'Acknowledged. Build will now run.' } } });
        response = await withRetry(
          () => chat.sendMessage({ message: responseParts }),
          'sendMessage (finish branch)'
        );
        recordUsage(response);
        // Exit after this iteration
        iteration = MAX_ITERATIONS;
        break;
      }

      // Truncate huge outputs to protect context
      let responsePayload = output;
      if (typeof output === 'string' && output.length > 20_000) {
        responsePayload = output.slice(0, 20_000) + `\n...[truncated]`;
      }

      responseParts.push({ functionResponse: { name, response: { result: String(responsePayload) } } });
    }

    if (iteration >= MAX_ITERATIONS) break;

    // Send all tool results back
    response = await withRetry(
      () => chat.sendMessage({ message: responseParts }),
      'sendMessage (loop)'
    );
    recordUsage(response);
  }

  if (iteration >= MAX_ITERATIONS) {
    log(`Hit iteration limit. Total in/out tokens: ${totalIn}/${totalOut}`);
  }

  // Write summary if we didn't already (e.g. agent didn't call finish)
  try {
    await fs.access('ai-summary.md');
  } catch {
    const lastText = (response.candidates?.[0]?.content?.parts || [])
      .filter((p) => p.text)
      .map((p) => p.text)
      .join('\n');
    await fs.writeFile('ai-summary.md', `# AI Build Summary\n\n${lastText || '(no summary produced)'}\n\n_Iterations: ${iteration}, tokens in: ${totalIn}, out: ${totalOut}_`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
