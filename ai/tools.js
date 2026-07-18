// ai/tools.js — tool definitions + implementations
// These are the actions the agent can take. Keep the list small and safe.

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ---- Tool schemas (what Gemini sees) ----
export const TOOLS = [
  {
    name: 'list_files',
    description: 'List files in a directory of the project. Use "." for the project root. Returns relative paths.',
    parameters: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'Directory to list, relative to project root. Use "." for root.',
        },
      },
      required: ['directory'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file. Returns the file content as a string.',
    parameters: {
      type: 'object',
      properties: {
        filepath: {
          type: 'string',
          description: 'Path to the file, relative to project root.',
        },
      },
      required: ['filepath'],
    },
  },
  {
    name: 'write_file',
    description: 'Create a new file or completely overwrite an existing file with the given content.',
    parameters: {
      type: 'object',
      properties: {
        filepath: {
          type: 'string',
          description: 'Path to the file, relative to project root.',
        },
        content: {
          type: 'string',
          description: 'The full content of the file.',
        },
      },
      required: ['filepath', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Find and replace a unique string in a file. Use this for surgical edits instead of rewriting whole files.',
    parameters: {
      type: 'object',
      properties: {
        filepath: {
          type: 'string',
          description: 'Path to the file, relative to project root.',
        },
        old_string: {
          type: 'string',
          description: 'The exact string to find. Must be unique in the file.',
        },
        new_string: {
          type: 'string',
          description: 'The replacement string.',
        },
      },
      required: ['filepath', 'old_string', 'new_string'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a shell command. Allowed: gradle (./gradlew), ls, cat, grep, find, head, tail, wc, echo, mkdir. NOT allowed: rm -rf, curl, wget, anything destructive.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute. Must start with one of the allowed prefixes.',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'finish',
    description: 'Call this when you are done making changes. The build will run automatically after this.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'A short summary of what you built, for the user.',
        },
      },
      required: ['summary'],
    },
  },
];

// ---- Allowlist for shell commands ----
const ALLOWED_COMMAND_PREFIXES = [
  './gradlew ',
  './gradlew',
  'gradle ',
  'gradle',
  'ls',
  'cat ',
  'cat',
  'grep ',
  'grep',
  'find ',
  'find',
  'head ',
  'head',
  'tail ',
  'tail',
  'wc ',
  'wc',
  'echo ',
  'echo',
  'mkdir ',
  'mkdir',
  'pwd',
  'tree ',
  'tree',
];

const BLOCKED_PATTERNS = [
  /rm\s+-rf?\s+\//,      // rm -rf /
  /rm\s+-rf?\s+~/,      // rm -rf ~
  /:\(\)\{.*\}/,         // fork bomb
  /\bcurl\b/,            // curl
  /\bwget\b/,            // wget
  /\bdd\b/,              // dd
  /\bchmod\s+777/,       // chmod 777
  />\s*\/dev\/sd/,       // write to disk device
  /\bsudo\b/,            // sudo
  /\bshutdown\b/,        // shutdown
  /\breboot\b/,          // reboot
];

function isCommandAllowed(command) {
  const trimmed = command.trim();
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { allowed: false, reason: `Blocked pattern: ${pattern}` };
    }
  }
  for (const prefix of ALLOWED_COMMAND_PREFIXES) {
    if (trimmed === prefix.trim() || trimmed.startsWith(prefix)) {
      return { allowed: true };
    }
  }
  return { allowed: false, reason: `Command does not start with an allowed prefix. Allowed: ${ALLOWED_COMMAND_PREFIXES.join(', ')}` };
}

// ---- Tool implementations ----

async function listFiles({ directory }) {
  const target = path.resolve(directory || '.');
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries
    .filter((e) => !e.name.startsWith('.') || e.name === '.gitignore')
    .filter((e) => e.name !== 'node_modules' && e.name !== 'build' && e.name !== '.gradle')
    .map((e) => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`)
    .join('\n');
}

async function readFile({ filepath }) {
  const target = path.resolve(filepath);
  // Refuse to read huge files to protect the context window
  const stat = await fs.stat(target);
  if (stat.size > 50_000) {
    return `Error: file is ${stat.size} bytes, refusing to read (>50KB). Read a portion with head/grep instead.`;
  }
  return await fs.readFile(target, 'utf8');
}

async function writeFile({ filepath, content }) {
  const target = path.resolve(filepath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
  return `Wrote ${content.length} bytes to ${filepath}`;
}

async function editFile({ filepath, old_string, new_string }) {
  const target = path.resolve(filepath);
  const current = await fs.readFile(target, 'utf8');
  const occurrences = current.split(old_string).length - 1;
  if (occurrences === 0) {
    return `Error: old_string not found in ${filepath}. Read the file first to see the current content.`;
  }
  if (occurrences > 1) {
    return `Error: old_string matches ${occurrences} places in ${filepath}. Make it more specific.`;
  }
  await fs.writeFile(target, current.replace(old_string, new_string), 'utf8');
  return `Edited ${filepath}`;
}

async function runCommand({ command }) {
  const check = isCommandAllowed(command);
  if (!check.allowed) {
    return `Error: ${check.reason}`;
  }
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: 5 * 60 * 1000,       // 5 min
    });
    let out = '';
    if (stdout) out += stdout;
    if (stderr) out += `\n[stderr]\n${stderr}`;
    // Truncate huge output
    if (out.length > 20_000) {
      out = out.slice(0, 20_000) + `\n...[truncated, ${out.length - 20000} more chars]`;
    }
    return out || '(no output)';
  } catch (err) {
    return `Error (exit ${err.code}): ${err.stdout || ''}\n${err.stderr || err.message}`;
  }
}

function finish({ summary }) {
  // We don't actually need to do anything here, the loop will see no tool calls
  // and exit. We just print the summary for the log.
  console.log('[agent] FINISH:', summary);
  return `Finished: ${summary}`;
}

export async function executeTool(name, args) {
  switch (name) {
    case 'list_files': return await listFiles(args);
    case 'read_file': return await readFile(args);
    case 'write_file': return await writeFile(args);
    case 'edit_file': return await editFile(args);
    case 'run_command': return await runCommand(args);
    case 'finish': return finish(args);
    default: return `Error: unknown tool ${name}`;
  }
}
