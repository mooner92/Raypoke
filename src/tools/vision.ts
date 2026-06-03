/**
 * `analyze_image` and `analyze_scene` tools — Gemini Vision over URL/base64.
 *
 * Gemini cannot fetch arbitrary image URLs, so any `http(s)` source (including
 * the short-lived, auth-gated Meta/Facebook/Instagram CDN URLs that Ray-Ban Meta
 * glasses send) is downloaded here and forwarded to Gemini as base64 bytes.
 */
import axios from 'axios';
import { z } from 'zod';
import { analyzeImageWithGemini, askGemini, detectMediaType } from '../utils/gemini.js';
import { logger } from '../utils/logger.js';
import { ExternalApiError, describeError } from '../utils/errors.js';
import type { ImageMediaType } from '../types/index.js';
import { searchEventsCore } from './events.js';
import { guard, textResult, type ToolDefinition } from './helpers.js';

/** An image resolved to base64 bytes ready for Gemini Vision. */
interface PreparedImage {
  base64: string;
  mediaType: ImageMediaType;
}

/**
 * Downloads an image and returns it as base64 with a detected media type.
 * A browser-like User-Agent is sent so picky CDNs (Meta/FB/Instagram) serve us.
 *
 * @param url - The image URL to fetch.
 * @returns The base64-encoded bytes and the resolved media type.
 * @throws When the HTTP request fails or times out (10s).
 */
async function downloadImageAsBase64(url: string): Promise<PreparedImage> {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 10000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
    },
  });

  const base64 = Buffer.from(response.data).toString('base64');
  const contentType = String(response.headers['content-type'] ?? 'image/jpeg');
  const mediaType: ImageMediaType = contentType.includes('png')
    ? 'image/png'
    : contentType.includes('gif')
      ? 'image/gif'
      : contentType.includes('webp')
        ? 'image/webp'
        : 'image/jpeg';

  return { base64, mediaType };
}

/**
 * Resolves a raw `image_source` into base64 bytes for Gemini Vision.
 *
 * - `http(s)` URLs are downloaded and converted to base64.
 * - Anything else is treated as base64 (the `data:` prefix is stripped).
 *
 * @param imageSource - The raw `image_source` argument.
 * @returns A {@link PreparedImage}.
 * @throws {ExternalApiError} When a remote image cannot be downloaded.
 */
async function prepareImageSource(imageSource: string): Promise<PreparedImage> {
  if (imageSource.startsWith('http')) {
    try {
      logger.info('Downloading image for Gemini Vision', { url: imageSource });
      return await downloadImageAsBase64(imageSource);
    } catch (error) {
      logger.warn('Image download failed', { url: imageSource, error: describeError(error) });
      throw new ExternalApiError(
        'image_download',
        describeError(error),
        '이미지를 불러오지 못했어요. 잠시 후 다시 시도해주세요.',
      );
    }
  }

  const base64 = imageSource.replace(/^data:image\/\w+;base64,/, '');
  return { base64, mediaType: detectMediaType(base64) };
}

// ── analyze_image ────────────────────────────────────────────────────────────

const analyzeImageSchema = {
  image_source: z.string().min(1).describe('https:// URL 또는 base64 문자열'),
  question: z.string().min(1).describe('이미지에 대한 질문'),
  location: z.string().optional().describe('현재 위치 (제공 시 더 정확한 답변)'),
};

interface AnalyzeImageArgs {
  image_source: string;
  question: string;
  location?: string;
}

async function runAnalyzeImage(args: AnalyzeImageArgs) {
  const prepared = await prepareImageSource(args.image_source);
  const locationHint = args.location ? `\n현재 위치: ${args.location}` : '';
  const question = `${args.question}${locationHint}\n이미지에 텍스트(포스터, 간판, 메뉴판)가 있으면 반드시 추출해서 언급하세요.`;

  const answer = await analyzeImageWithGemini({ ...prepared, question });
  return textResult(answer);
}

export const analyzeImageTool: ToolDefinition<AnalyzeImageArgs> = {
  name: 'analyze_image',
  description:
    '이미지를 분석합니다. URL 또는 base64를 받아 텍스트 추출, 장소 식별, 사물/사람 인식을 수행합니다.',
  inputSchema: analyzeImageSchema,
  handler: guard('analyze_image', runAnalyzeImage),
};

// ── analyze_scene ──────────────────────────────────────────────────────────────

const analyzeSceneSchema = {
  image_source: z.string().min(1).describe('https:// URL 또는 base64 문자열'),
  location: z.string().optional().describe('GPS 위치 (있으면 이벤트 검색 결합)'),
};

interface AnalyzeSceneArgs {
  image_source: string;
  location?: string;
}

const SCENE_SYSTEM_PROMPT = `당신은 Ray-Ban Meta 스마트 글래스 사용자를 위한 장면 분석 어시스턴트입니다.
사용자가 보고 있는 장면을 분석해 "사람들이 왜 모여있는지", 행사 여부, 장소 특성을 파악하세요.
응답 규칙:
1. 반드시 3문장 이내, 한국어, 음성 출력 최적화
2. 행사로 보이면 행사명/종류를 추정해서 언급
3. 이미지에 텍스트가 있으면 반드시 내용을 언급`;

/**
 * Analyzes a scene and, when a location is provided and an event is detected,
 * augments the answer with live event/ticket information.
 */
async function runAnalyzeScene(args: AnalyzeSceneArgs) {
  const prepared = await prepareImageSource(args.image_source);
  const locationHint = args.location ? `현재 위치: ${args.location}.` : '';

  const sceneAnswer = await analyzeImageWithGemini({
    ...prepared,
    question: `${locationHint} 이 장면에서 사람들이 왜 모여있는지, 어떤 행사나 장소인지 분석해주세요.`,
    system: SCENE_SYSTEM_PROMPT,
  });

  // If we have a location, look up live events and let Gemini merge the context.
  if (args.location) {
    const eventInfo = await searchEventsCore({ location: args.location });
    const merged = await askGemini(
      `장면 분석 결과: "${sceneAnswer}"\n\n${args.location} 주변 행사 정보:\n${eventInfo}\n\n위 두 정보를 종합해 사용자에게 3문장 이내로 답변하세요. 행사가 맞다면 입장료/예매 정보를 포함하세요.`,
    );
    return textResult(merged);
  }

  return textResult(sceneAnswer);
}

export const analyzeSceneTool: ToolDefinition<AnalyzeSceneArgs> = {
  name: 'analyze_scene',
  description:
    '주변 장면을 종합 분석합니다. 사람이 모여있는 이유, 행사 여부, 장소 특성을 파악합니다.',
  inputSchema: analyzeSceneSchema,
  handler: guard('analyze_scene', runAnalyzeScene),
};
