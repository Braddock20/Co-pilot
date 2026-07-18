// ai/agent.js — main agent loop
// Reads USER_PROMPT from env, calls Gemini with tools, executes tool calls,
// loops until the model says it's done or we hit MAX_ITERATIONS.

import { GoogleGenerativeAI } from '@google/generative-ai';
import { TOOLS, executeTool } from './tools.js';
import { SYSTEM_PROMPT } from './prompt.js';

const MAX_ITERATIONS = 20;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

function log(...args) {
  console.log('[agent]', ...args);
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

  log('Starting agent for prompt:', userPrompt);
  log('Model:', MODEL);

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: TOOLS }],
  });

  const chat = model.startChat();
  let iteration = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Kick off with the user's request
  let result = await chat.sendMessage(userPrompt);
  totalInputTokens += result.response.usageMetadata?.promptTokenCount || 0;
  totalOutputTokens += result.response.usageMetadata?.candidatesTokenCount || 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    log(`--- iteration ${iteration} ---`);

    const candidate = result.response.candidates?.[0];
    if (!candidate) {
      log('No candidate in response, stopping');
      break;
    }

    const parts = candidate.content?.parts || [];

    // If the model wants to call tools
    const functionCalls = parts.filter((p) => p.functionCall);
    const textParts = parts.filter((p) => p.text).map((p) => p.text);

    for (const text of textParts) {
      log('model says:', text);
    }

    if (functionCalls.length === 0) {
      log('No more tool calls. Agent finished.');
      break;
    }

    // Execute each tool call and collect results
    const toolResults = [];
    for (const part of functionCalls) {
      const { name, args } = part.functionCall;
      log(`tool call: ${name}(${JSON.stringify(args).slice(0, 200)})`);

      try {
        const output = await executeTool(name, args);
        toolResults.push({
          functionResponse: {
            name,
            response: { result: output },
          },
        });
      } catch (err) {
        log(`tool ${name} threw:`, err.message);
        toolResults.push({
          functionResponse: {
            name,
            response: { error: err.message },
          },
        });
      }
    }

    // Send tool results back to the model
    result = await chat.sendMessage(toolResults);
    totalInputTokens += result.response.usageMetadata?.promptTokenCount || 0;
    totalOutputTokens += result.response.usageMetadata?.candidatesTokenCount || 0;
  }

  if (iteration >= MAX_ITERATIONS) {
    log(`Hit MAX_ITERATIONS (${MAX_ITERATIONS}). Stopping.`);
  }

  log(`Done. Iterations: ${iteration}, tokens in/out: ${totalInputTokens}/${totalOutputTokens}`);

  // Write a summary file the workflow can pick up
  const fs = await import('fs/promises');
  const lastText = (result.response.candidates?.[0]?.content?.parts || [])
    .filter((p) => p.text)
    .map((p) => p.text)
    .join('\n');
  await fs.writeFile('ai-summary.md', `# AI Build Summary\n\n${lastText}\n\n_Iterations: ${iteration}, tokens in: ${totalInputTokens}, out: ${totalOutputTokens}_`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
