// ai/agent.js — main agent loop
// Uses @google/genai (the new SDK, replacing the deprecated @google/generative-ai)

import { GoogleGenAI } from '@google/genai';
import fs from 'fs/promises';
import { TOOLS, executeTool } from './tools.js';
import { SYSTEM_PROMPT } from './prompt.js';

const MAX_ITERATIONS = 20;
// Current stable models (as of July 2026). Override with GEMINI_MODEL env var.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

function log(...args) { console.log('[agent]', ...args); }

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
  let response = await chat.sendMessage({ message: userPrompt });

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

    // Collect function calls
    const functionCalls = (response.functionCalls || []).concat(
      parts.filter((p) => p.functionCall).map((p) => p.functionCall)
    );

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
        response = await chat.sendMessage({ message: responseParts });
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
    response = await chat.sendMessage({ message: responseParts });
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
