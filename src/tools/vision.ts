/**
 * `analyze_image` and `analyze_scene` tools — Gemini Vision over URL/base64.
 *
 * Gemini cannot fetch image URLs itself, so every `http(s)` source is downloaded
 * here and forwarded as base64 bytes. Ray-Ban Meta glasses send a Meta share
 * link (`media.meta.com/s/...`) which is actually an HTML viewer page, not the
 * image — we follow its `og:image` tag to the real signed `*.fbcdn.net` photo
 * (publicly fetchable; no Meta auth needed) and download that.
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

/** Detects an image type from the buffer's magic bytes (authoritative). */
function sniffImageType(buffer: Buffer): ImageMediaType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'image/gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** Maps a Content-Type header to a supported image media type (jpeg fallback). */
function mediaTypeFromContentType(contentType: string): ImageMediaType {
  if (contentType.includes('png')) return 'image/png';
  if (contentType.includes('gif')) return 'image/gif';
  if (contentType.includes('webp')) return 'image/webp';
  return 'image/jpeg';
}

const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';

/** Hosts we will follow an extracted share-page image URL to (SSRF guard). */
const ALLOWED_IMAGE_HOST_SUFFIXES = [
  'fbcdn.net',
  'media.meta.com',
  'cdninstagram.com',
  'facebook.com',
];

/** Minimal HTML-entity decode for URLs pulled out of meta tags. */
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * Extracts the primary image URL from a share/viewer HTML page.
 * Meta share links (`media.meta.com/s/...`) return an HTML page whose `og:image`
 * meta tag points at the real signed image on `*.fbcdn.net`.
 */
function extractImageUrlFromHtml(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1]);
  }
  return null;
}

/** Whether an extracted URL is an https URL on an allowed Meta/FB image host. */
function isAllowedImageHost(rawUrl: string): boolean {
  try {
    const { protocol, hostname } = new URL(rawUrl);
    return (
      protocol === 'https:' &&
      ALLOWED_IMAGE_HOST_SUFFIXES.some(
        (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
      )
    );
  } catch {
    return false;
  }
}

/** Fetches a URL as bytes with a browser-like User-Agent. */
async function fetchBinary(
  url: string,
): Promise<{ buffer: Buffer; contentType: string; status: number }> {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 10000,
    maxRedirects: 5,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,image/webp,image/apng,image/*,*/*;q=0.8',
    },
  });
  return {
    buffer: Buffer.from(response.data),
    contentType: String(response.headers['content-type'] ?? ''),
    status: response.status,
  };
}

/**
 * Downloads an image and returns it as base64 with a verified media type.
 *
 * Handles two shapes Ray-Ban Meta / Poke send:
 *   1. A direct image URL → returned as-is.
 *   2. A Meta share/viewer page (`media.meta.com/s/...`) that responds with
 *      HTML → the real image is extracted from the page's `og:image` tag and
 *      fetched (one hop, restricted to Meta/FB image hosts).
 *
 * The bytes are validated to actually be an image (magic bytes or `image/*`
 * Content-Type), so an expiry/login HTML page is never sent to Gemini as a
 * fake photo.
 *
 * @param url - The image or share-page URL to fetch.
 * @param depth - Internal recursion guard (share page → image is one hop).
 * @returns The base64-encoded bytes and the resolved media type.
 * @throws When the request fails, times out (10s), or no image can be resolved.
 */
async function downloadImageAsBase64(url: string, depth = 0): Promise<PreparedImage> {
  const { buffer, contentType, status } = await fetchBinary(url);
  const sniffed = sniffImageType(buffer);

  logger.info('Image fetch', { url, status, contentType, bytes: buffer.length, sniffed, depth });

  // Already an image → done.
  if (sniffed || contentType.startsWith('image/')) {
    return {
      base64: buffer.toString('base64'),
      mediaType: sniffed ?? mediaTypeFromContentType(contentType),
    };
  }

  // A share/viewer HTML page (e.g. media.meta.com/s/...): pull the real image
  // URL out of og:image and fetch it once.
  if (depth === 0 && contentType.includes('html')) {
    const resolved = extractImageUrlFromHtml(buffer.toString('utf8'));
    if (resolved && isAllowedImageHost(resolved)) {
      logger.info('Resolved image from share page og:image', { from: url, to: resolved });
      return downloadImageAsBase64(resolved, depth + 1);
    }
    throw new Error(
      `공유 페이지에서 이미지 URL을 찾지 못했습니다 (${url}, og:image ${resolved ? '비허용 호스트' : '없음'})`,
    );
  }

  const snippet = buffer.toString('utf8', 0, 200).replace(/\s+/g, ' ').trim();
  throw new Error(
    `응답이 이미지가 아닙니다 (content-type="${contentType || 'none'}", ${buffer.length} bytes): ${snippet}`,
  );
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
