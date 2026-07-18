// ai/fix.js — called when the build fails
// Reads the build error log, feeds it back to Gemini, lets it fix the code,
// re-runs gradle. Loops up to FIX_MAX_ATTEMPTS times.

import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const FIX_MAX_ATTEMPTS = 3;

function log(...args) { console.log('[fix]', ...args); }

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
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' });

  // Read current MainActivity so the model has context
  let mainActivity = '';
  try {
    mainActivity = await fs.readFile('app/src/main/java/com/example/app/MainActivity.java', 'utf8');
  } catch {}

  const prompt = `The Android build failed. Here is the error output:

\`\`\`
${buildError.slice(-5000)}
\`\`\`

Here is the current MainActivity.java:

\`\`\`java
${mainActivity}
\`\`\`

List the files in the project so you know what's there: run \`find app/src/main -type f\` (you can imagine the output — focus on Java and XML files).

Output a JSON object describing the fixes. Format:

\`\`\`json
{
  "edits": [
    { "filepath": "app/src/main/java/com/example/app/MainActivity.java", "old_string": "exact text to replace", "new_string": "replacement" }
  ],
  "writes": [
    { "filepath": "path/to/new.xml", "content": "<full file content>" }
  ],
  "explanation": "Why this fixes the build"
}
\`\`\`

Only output the JSON. No prose before or after. Be surgical — only fix what's broken. Don't rewrite files that don't need changes.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    log('Could not extract JSON from Gemini response');
    return null;
  }
  return JSON.parse(match[0]);
}

async function applyFixes(plan) {
  if (!plan) return false;

  for (const edit of (plan.edits || [])) {
    try {
      const current = await fs.readFile(edit.filepath, 'utf8');
      if (!current.includes(edit.old_string)) {
        log(`  ! old_string not found in ${edit.filepath}, skipping edit`);
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
