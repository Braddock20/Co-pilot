# Android AI Builder 🤖📱⚡

A GitHub-hosted agent that takes a description of an Android app, writes **real, working, polished** code using Gemini, reviews it, builds it, auto-fixes build errors, and hands you back an APK.

> **v2 (supercharged)**: Material 3 starter project, two-pass review, smarter default model, hard rules against the bugs v1 used to ship.

## How it works

```
You: "a tip calculator that takes a bill amount and tip percentage"
        ↓
GitHub Action triggers
        ↓
PASS 1 — Gemini agent builds the app
   • Reads starter project (Material 3 + ConstraintLayout)
   • Writes Java + XML following strict quality rules
        ↓
PASS 2 — Self-review (review_code tool)
   • Separate, critical review pass looks for:
     - Buttons that aren't wired to click listeners
     - Hardcoded strings that should be in strings.xml
     - Raw Android widgets where Material versions should be used
     - Logic bugs, missing resources, etc.
   • Agent fixes every critical/major issue
        ↓
./gradlew assembleDebug
        ↓
If it fails → Gemini reads the error, patches the code, retries (up to 3x)
        ↓
You download the APK from the Actions artifacts
```

## What changed in v2 (supercharged)

| Area | v1 (lite) | v2 (supercharged) |
|------|-----------|-------------------|
| Default model | `gemini-3.1-flash-lite` | `gemini-3.5-flash` (5 RPM free tier, much smarter) |
| Starter project | `setContentView(new TextView)` | Material 3 theme, ConstraintLayout, activity_main.xml, proper colors, dark mode, launcher icon |
| Material Components | AppCompat only | AppCompat + Material 1.11 + ConstraintLayout + RecyclerView |
| Buttons | Often dead (no listener) | Hard rule: every button must be wired with `setOnClickListener` |
| Strings | Hardcoded everywhere | Hard rule: all user-facing strings in `strings.xml` |
| Code review | None | Mandatory two-pass review via `review_code` tool (up to 3 rounds) |
| System prompt | ~2.5 KB, loose | ~11 KB, with examples, anti-patterns, hard rules |
| ViewBinding | Off | On (agent can opt in) |
| Launcher icon | None | Adaptive icon (vector, no PNG needed) |
| Iterations | 20 | 30 (room for review fixes) |

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

You'll also be able to pick the model:
- `gemini-3.5-flash` (default, recommended — best balance of quality and free-tier quota)
- `gemini-3.1-flash-lite` (fastest, lowest quality, highest quota)
- `gemini-3.1-pro-preview` (best quality, slowest, lowest quota)
- `gemini-flash-latest` (alias to whatever Google currently calls "flash latest")

Example prompts to try:
- `a counter app with a big +1 button, a -1 button, and a reset button`
- `a tip calculator that takes a bill amount and tip percentage, shows the result`
- `a hello world app that displays the current time, updated every second`
- `a simple todo list where you can add items via a TextInput and a button, and remove by tapping`
- `a unit converter that converts between cm, inches, feet, and meters`

## Hard rules the agent follows

These are baked into the system prompt — every build will follow them:

1. **Every button in a layout is wired with `setOnClickListener` in Java.** No dead buttons.
2. **No `android:onClick` in XML.** Always Java listeners.
3. **Material components over raw Android widgets.** `MaterialButton` over `Button`, `TextInputLayout` over `EditText`, etc.
4. **ConstraintLayout, not nested LinearLayouts.**
5. **All user-facing strings in `strings.xml`.** No hardcoded English.
6. **Theme attributes for colors (`?attr/colorPrimary`), not hardcoded `#FF0000`.**
7. **One file at a time, plan before writing.**
8. **Don't touch Gradle files** unless genuinely needed (deps are pre-installed).
9. **Two-pass review is mandatory** before declaring done.

## What the agent can do

- Read, write, and edit files in the project
- Run gradle, ls, cat, grep, find
- ~30 iterations per build, then auto-fix loop adds up to 3 more rounds
- Self-review up to 3 times (catches its own bugs before build)

## What the agent cannot do

- Network access
- Destructive commands (`rm -rf`, `curl`, etc.)
- Modify Gradle config freely (it'll usually leave it alone)
- Loop forever (capped at ~33 total iterations including fixes)

## Files

- `ai/agent.js` — main agent loop (Gemini + tool calls + two-pass review)
- `ai/tools.js` — tool definitions + sandboxed command runner
- `ai/prompt.js` — system prompt (build) + review prompt (critique)
- `ai/fix.js` — auto-fix loop when build fails
- `app/` — starter Android project (Java, Material 3, minSdk 24)
- `app/src/main/res/values/themes.xml` — Material 3 DayNight theme
- `app/src/main/res/values/colors.xml` — Material 3 color palette
- `app/src/main/res/layout/activity_main.xml` — starter ConstraintLayout
- `.github/workflows/ai-build.yml` — the CI workflow

## Cost & limits

- **Free tier (`gemini-3.5-flash`)**: 5 RPM, 250K tokens/min. More than enough for a personal tool.
- **Pro preview**: 2 RPM free. Worth it for tricky builds.
- Each build = 1 agent run (~30 calls) + 0-3 review passes (~1 call each) + 0-3 fix iterations (1 call each). Well within free tier for personal use.

## Limitations

- Java only (no Kotlin support yet — would be a small change)
- No image assets — the agent can write vector drawables but not generate PNGs
- No release signing — APK is debug-signed, installable for testing only
- No Play Store upload

## Local development

To test the agent loop without burning API quota, there's a smoke test that stubs Gemini:

```bash
npm install
npm run smoke-test
```

This runs the agent loop with a fake Gemini client, exercises the `write_file` → `review_code` → `finish` flow, and verifies the summary + review log get written. Good for catching regressions in the tool dispatch.

## Future ideas

- Kotlin support
- Web UI that POSTs to the workflow
- Release signing with a managed keystore
- App icon generation (AI-generated icons)
- Auto-publish to internal testing track on Play
- Multi-screen apps (Navigation Component)
