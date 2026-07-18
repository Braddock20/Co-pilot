// ai/fake-genai.mjs — stub for @google/genai used by smoke tests.
// Not part of the production agent — this file is only loaded by test-loader.mjs.

let callCount = 0;

class FakeChat {
  sendMessage = async () => {
    callCount++;
    if (callCount === 1) {
      return {
        candidates: [{
          content: { parts: [
            { functionCall: { name: 'write_file', args: {
              filepath: 'app/src/main/java/com/example/app/MainActivity.java',
              content: 'package com.example.app;\nimport android.os.Bundle;\npublic class MainActivity extends androidx.appcompat.app.AppCompatActivity { protected void onCreate(Bundle s) { super.onCreate(s); setContentView(new android.widget.TextView(this)); } }',
            }}},
            { functionCall: { name: 'review_code', args: {} } },
          ]},
        }],
        functionCalls: [
          { name: 'write_file', args: {
            filepath: 'app/src/main/java/com/example/app/MainActivity.java',
            content: 'package com.example.app;\nimport android.os.Bundle;\npublic class MainActivity extends androidx.appcompat.app.AppCompatActivity { protected void onCreate(Bundle s) { super.onCreate(s); setContentView(new android.widget.TextView(this)); } }',
          }},
          { name: 'review_code', args: {} },
        ],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      };
    }
    return {
      candidates: [{
        content: { parts: [
          { functionCall: { name: 'finish', args: { summary: 'smoke test complete' } } },
        ]},
      }],
      functionCalls: [
        { name: 'finish', args: { summary: 'smoke test complete' } },
      ],
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 },
    };
  };
}

class FakeModels {
  generateContent = async () => ({
    text: JSON.stringify({
      issues: [
        {
          severity: 'critical',
          file: 'app/src/main/java/com/example/app/MainActivity.java',
          description: 'Uses setContentView(new TextView()) — not a layout file. Should be setContentView(R.layout.activity_main).',
          fix: 'Replace TextView with R.layout.activity_main',
        },
      ],
      summary: 'Found 1 critical issue: layout not used.',
    }),
  });
}

class FakeChats {
  create = () => new FakeChat();
}

export class GoogleGenAI {
  constructor() {}
  chats = new FakeChats();
  models = new FakeModels();
}
