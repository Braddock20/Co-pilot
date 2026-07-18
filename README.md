# Android AI Builder 🤖📱

A GitHub-hosted agent that takes a description of an Android app, writes the code using Gemini, builds it, auto-fixes build errors, and hands you back an APK.

## How it works

```
You: "a counter app with a big +1 button"
        ↓
GitHub Action triggers
        ↓
Gemini agent explores the project, writes Java + XML
        ↓
./gradlew assembleDebug
        ↓
If it fails → Gemini reads the error, patches the code, retries (up to 3x)
        ↓
You download the APK from the Actions artifacts
```

## Setup

### 1. Push this repo to GitHub

```bash
unzip android-ai-builder.zip
cd android-ai-builder
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin git@github.com:YOURUSER/android-ai-builder.git
git push -u origin main
```

### 2. Add your Gemini API key as a secret

1. Get a key from https://aistudio.google.com/apikey
2. Repo → Settings → Secrets and variables → Actions → New secret
3. Name: `GEMINI_API_KEY`, Value: your key

### 3. Trigger a build

Go to the **Actions** tab → **AI Build** → **Run workflow** → type your prompt.

Example prompts to try:
- `a counter app with a big +1 button and a reset button`
- `a tip calculator that takes a bill amount and tip percentage`
- `a hello world app that displays the current time, updated every second`
- `a simple todo list where you can add items via an EditText and a button`

## What the agent can do

- Read, write, and edit files in the project
- Run gradle, ls, cat, grep, find
- ~20 iterations per build, then auto-fix loop adds up to 3 more rounds

## What the agent cannot do

- Network access
- Destructive commands (`rm -rf`, `curl`, etc.)
- Modify Gradle config freely (it'll usually leave it alone)
- Loop forever (capped at ~26 total iterations)

## Files

- `ai/agent.js` — main agent loop (Gemini + tool calls)
- `ai/tools.js` — tool definitions + sandboxed command runner
- `ai/prompt.js` — system prompt
- `ai/fix.js` — auto-fix loop when build fails
- `app/` — starter Android project (Java, AppCompat, minSdk 24)
- `.github/workflows/ai-build.yml` — the CI workflow

## Cost

Gemini 2.0 Flash free tier is generous. For personal use you should stay well under any limits. Set `GEMINI_MODEL` to `gemini-1.5-pro` if you want higher quality (slower, costs more).

## Limitations

- Java only (no Kotlin support yet — would be a small change)
- No image assets — the agent can write XML but not generate PNGs
- No release signing — APK is debug-signed, installable for testing only
- No Play Store upload

## Future ideas

- Kotlin support
- Web UI that POSTs to the workflow
- Release signing with a managed keystore
- App icon generation
- Auto-publish to internal testing track on Play
