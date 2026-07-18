// ai/fake-loader-impl.mjs — loader hook implementation. Resolves @google/genai
// to our local stub.

import { pathToFileURL } from 'node:url';
import { resolve as pathResolve } from 'node:path';

const FAKE_URL = pathToFileURL(pathResolve('./ai/fake-genai.mjs')).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@google/genai') {
    return { url: FAKE_URL, shortCircuit: true, format: 'module' };
  }
  return nextResolve(specifier, context);
}
