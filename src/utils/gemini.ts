/**
 * Thin wrapper around the Google Gemini SDK (`@google/genai`, `gemini-2.5-flash`).
 *
 * Backs the simple workloads: web search grounding, translation, directions,
 * and price/event lookups. Image analysis and complex reasoning stay on Claude
 * (see `claude.ts`).
 */
import { GoogleGenAI } from '@google/genai';
import { loadConfig } from '../config.js';
import { ExternalApiError, describeError } from './errors.js';
import { logger } from './logger.js';
import { SYSTEM_PROMPT, withRetry } from './claude.js';

/** Gemini model used for all Gemini-backed tools. */
const GEMINI_MODEL = 'gemini-2.5-flash';

let client: GoogleGenAI | null = null;

/** Lazily construct (and cache) the Gemini client. */
function getClient(): GoogleGenAI {
  if (!client) {
    const config = loadConfig();
    client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }
  return client;
}

/**
 * Asks Gemini a simple question (no web search).
 *
 * @param prompt - The user prompt.
 * @param systemPrompt - Optional system instruction; defaults to the shared
 *   voice-optimized prompt (3 sentences, Korean).
 * @returns The model's text response.
 * @throws {ExternalApiError} When the Gemini API call fails.
 */
export async function askGemini(prompt: string, systemPrompt?: string): Promise<string> {
  try {
    const response = await withRetry(
      () =>
        getClient().models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
          config: { systemInstruction: systemPrompt ?? SYSTEM_PROMPT },
        }),
      'gemini.ask',
    );
    return (response.text ?? '').trim();
  } catch (error) {
    throw new ExternalApiError('gemini', describeError(error));
  }
}

/**
 * Runs a real-time web search via Gemini's Google Search grounding and returns
 * a voice-optimized Korean summary that already incorporates live results.
 *
 * @param query - The search query (Korean or English).
 * @returns The grounded text response.
 * @throws {ExternalApiError} When the Gemini API call fails.
 */
export async function searchWithGemini(query: string): Promise<string> {
  logger.info('Gemini grounded search', { query });

  try {
    const response = await withRetry(
      () =>
        getClient().models.generateContent({
          model: GEMINI_MODEL,
          contents: query,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            tools: [{ googleSearch: {} }],
          },
        }),
      'gemini.search',
    );
    return (response.text ?? '').trim();
  } catch (error) {
    throw new ExternalApiError('gemini', describeError(error));
  }
}

/**
 * Lightweight connectivity probe for the /health endpoint.
 *
 * @returns `true` if a minimal request succeeds, `false` otherwise.
 */
export async function pingGemini(): Promise<boolean> {
  return !!process.env.GEMINI_API_KEY;
}
