/**
 * Thin wrapper around the Anthropic SDK with retry, image support, and the
 * shared voice-optimized system prompt used across all tools.
 */
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from '../config.js';
import type { ImageMediaType } from '../types/index.js';
import { ExternalApiError, describeError } from './errors.js';
import { logger } from './logger.js';

/**
 * Shared system prompt applied to every Claude response. Tuned for Ray-Ban
 * Meta voice output: concise, Korean, information-first.
 */
export const SYSTEM_PROMPT = `당신은 Ray-Ban Meta 스마트 글래스 사용자를 위한 AI 어시스턴트입니다.
응답 규칙:
1. 반드시 3문장 이내로 답변 (음성 출력 최적화)
2. 핵심 정보 우선 제시
3. 한국어로 답변 (다른 언어로 질문받아도)
4. 이미지에 텍스트가 있으면 반드시 내용을 언급
5. 행사/장소 정보는 "이름, 시간, 가격" 순서로 제시
6. URL은 "인터파크에서 예매 가능해요" 처럼 플랫폼명으로 표현`;

let client: Anthropic | null = null;

/** Lazily construct (and cache) the Anthropic client. */
function getClient(): Anthropic {
  if (!client) {
    const config = loadConfig();
    client = new Anthropic({ apiKey: config.anthropicApiKey });
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
      logger.error('Operation failed after retry', {
        label,
        error: describeError(secondError),
      });
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

/** Concatenate the text blocks of a Claude message response. */
function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

export interface CompleteOptions {
  /** The user prompt. */
  prompt: string;
  /** Optional system prompt override; defaults to {@link SYSTEM_PROMPT}. */
  system?: string;
  /** Maximum output tokens (defaults to 512 for cost control). */
  maxTokens?: number;
}

/**
 * Sends a text-only completion request to Claude.
 *
 * @param options - The completion options.
 * @returns The assistant's text response.
 * @throws {ExternalApiError} When the Anthropic API call fails.
 */
export async function complete(options: CompleteOptions): Promise<string> {
  const { prompt, system = SYSTEM_PROMPT, maxTokens = 512 } = options;
  const config = loadConfig();

  try {
    const message = await withRetry(
      () =>
        getClient().messages.create({
          model: config.claudeModel,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: prompt }],
        }),
      'claude.complete',
    );
    return extractText(message);
  } catch (error) {
    throw new ExternalApiError('anthropic', describeError(error));
  }
}

export interface CompleteWithImageOptions {
  /** The question to ask about the image. */
  question: string;
  /** Image as an `https://` URL. Mutually exclusive with {@link base64}. */
  url?: string;
  /** Image as a raw base64 string (no data URI prefix). */
  base64?: string;
  /** Media type for base64 images; auto-detected when omitted. */
  mediaType?: ImageMediaType;
  /** Optional system prompt override; defaults to {@link SYSTEM_PROMPT}. */
  system?: string;
  /** Maximum output tokens (defaults to 1024 for image analysis). */
  maxTokens?: number;
}

/**
 * Sends an image + question to Claude Vision.
 *
 * @param options - The image completion options.
 * @returns The assistant's text response.
 * @throws {ExternalApiError} When the Anthropic API call fails.
 */
export async function completeWithImage(options: CompleteWithImageOptions): Promise<string> {
  const { question, url, base64, mediaType, system = SYSTEM_PROMPT, maxTokens = 1024 } = options;
  const config = loadConfig();

  const imageBlock: Anthropic.ImageBlockParam = url
    ? { type: 'image', source: { type: 'url', url } }
    : {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType ?? detectMediaType(base64 ?? ''),
          data: base64 ?? '',
        },
      };

  try {
    const message = await withRetry(
      () =>
        getClient().messages.create({
          model: config.claudeModel,
          max_tokens: maxTokens,
          system,
          messages: [
            {
              role: 'user',
              content: [imageBlock, { type: 'text', text: question }],
            },
          ],
        }),
      'claude.completeWithImage',
    );
    return extractText(message);
  } catch (error) {
    throw new ExternalApiError('anthropic', describeError(error));
  }
}

/**
 * Lightweight connectivity probe for the /health endpoint.
 *
 * @returns `true` if a minimal request succeeds, `false` otherwise.
 */
export async function pingAnthropic(): Promise<boolean> {
  const config = loadConfig();
  try {
    await getClient().messages.create({
      model: config.claudeModel,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return true;
  } catch (error) {
    logger.warn('Anthropic health check failed', { error: describeError(error) });
    return false;
  }
}
