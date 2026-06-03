/**
 * Wrapper around the Google Gemini SDK (`@google/genai`, `gemini-2.5-flash`).
 *
 * Gemini is the single AI provider for the whole server: web search grounding,
 * translation, directions, price/event lookups, image analysis, and direct Q&A.
 */
import { GoogleGenAI, createPartFromBase64, createUserContent } from '@google/genai';
import { loadConfig } from '../config.js';
import type { ImageMediaType } from '../types/index.js';
import { ExternalApiError, describeError } from './errors.js';
import { logger } from './logger.js';

/** Gemini model used for all Gemini-backed tools. */
const GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * Shared system prompt applied to every response. Tuned for Ray-Ban Meta voice
 * output: concise, Korean, information-first.
 */
export const SYSTEM_PROMPT = `당신은 Ray-Ban Meta 스마트 글래스 사용자를 위한 AI 어시스턴트입니다.
응답 규칙:
1. 반드시 3문장 이내로 답변 (음성 출력 최적화)
2. 핵심 정보 우선 제시
3. 한국어로 답변 (다른 언어로 질문받아도)
4. 이미지에 텍스트가 있으면 반드시 내용을 언급
5. 행사/장소 정보는 "이름, 시간, 가격" 순서로 제시
6. URL은 "인터파크에서 예매 가능해요" 처럼 플랫폼명으로 표현`;

let client: GoogleGenAI | null = null;

/** Lazily construct (and cache) the Gemini client. */
function getClient(): GoogleGenAI {
  if (!client) {
    const config = loadConfig();
    client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }
  return client;
}

/** Pause execution for the given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs an async operation with a single retry on failure (exponential backoff).
 *
 * @param operation - The async operation to attempt.
 * @param label - A label used for logging.
 * @returns The operation result.
 * @throws The last encountered error if both attempts fail.
 */
export async function withRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
  try {
    return await operation();
  } catch (firstError) {
    logger.warn('Operation failed, retrying once', { label, error: describeError(firstError) });
    await sleep(500);
    try {
      return await operation();
    } catch (secondError) {
      logger.error('Operation failed after retry', { label, error: describeError(secondError) });
      throw secondError;
    }
  }
}

/** Detect the image media type from the leading bytes of a base64 string. */
export function detectMediaType(base64: string): ImageMediaType {
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBOR')) return 'image/png';
  if (base64.startsWith('R0lGO')) return 'image/gif';
  if (base64.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
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

export interface AnalyzeImageOptions {
  /** Raw base64-encoded image bytes (no data URI prefix). */
  base64: string;
  /** The image media type. */
  mediaType: ImageMediaType;
  /** The question to ask about the image. */
  question: string;
  /** Optional system prompt override; defaults to {@link SYSTEM_PROMPT}. */
  system?: string;
}

/**
 * Analyzes an image with Gemini Vision. The image must be provided as base64
 * (Gemini cannot fetch arbitrary URLs — callers download remote images first).
 *
 * @param options - The image and question.
 * @returns The model's text response.
 * @throws {ExternalApiError} When the Gemini API call fails.
 */
export async function analyzeImageWithGemini(options: AnalyzeImageOptions): Promise<string> {
  const { base64, mediaType, question, system = SYSTEM_PROMPT } = options;

  try {
    const response = await withRetry(
      () =>
        getClient().models.generateContent({
          model: GEMINI_MODEL,
          contents: createUserContent([createPartFromBase64(base64, mediaType), question]),
          config: { systemInstruction: system },
        }),
      'gemini.vision',
    );
    return (response.text ?? '').trim();
  } catch (error) {
    throw new ExternalApiError('gemini', describeError(error));
  }
}

/**
 * Lightweight connectivity probe for the /health endpoint.
 *
 * @returns `true` if a Gemini API key is configured.
 */
export async function pingGemini(): Promise<boolean> {
  return !!process.env.GEMINI_API_KEY;
}
