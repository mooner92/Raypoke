/**
 * `analyze_image` and `analyze_scene` tools — Claude Vision over URL/base64.
 */
import { z } from 'zod';
import { completeWithImage, complete } from '../utils/claude.js';
import { searchEventsCore } from './events.js';
import { guard, textResult, type ToolDefinition } from './helpers.js';

/** Parsed representation of an incoming image source. */
interface ParsedImage {
  url?: string;
  base64?: string;
}

/**
 * Determines whether an image source is a URL or base64 payload and strips any
 * `data:image/...;base64,` prefix from base64 inputs.
 *
 * @param imageSource - The raw `image_source` argument.
 * @returns A {@link ParsedImage} carrying either a URL or cleaned base64.
 */
export function parseImageSource(imageSource: string): ParsedImage {
  if (imageSource.startsWith('http')) {
    return { url: imageSource };
  }
  const base64 = imageSource.replace(/^data:image\/\w+;base64,/, '');
  return { base64 };
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
  const parsed = parseImageSource(args.image_source);
  const locationHint = args.location ? `\n현재 위치: ${args.location}` : '';
  const question = `${args.question}${locationHint}\n이미지에 텍스트(포스터, 간판, 메뉴판)가 있으면 반드시 추출해서 언급하세요.`;

  const answer = await completeWithImage({ ...parsed, question, maxTokens: 1024 });
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
  const parsed = parseImageSource(args.image_source);
  const locationHint = args.location ? `현재 위치: ${args.location}.` : '';

  const sceneAnswer = await completeWithImage({
    ...parsed,
    question: `${locationHint} 이 장면에서 사람들이 왜 모여있는지, 어떤 행사나 장소인지 분석해주세요.`,
    system: SCENE_SYSTEM_PROMPT,
    maxTokens: 1024,
  });

  // If we have a location, look up live events and let Claude merge the context.
  if (args.location) {
    const eventInfo = await searchEventsCore({ location: args.location });
    const merged = await complete({
      prompt: `장면 분석 결과: "${sceneAnswer}"\n\n${args.location} 주변 행사 정보:\n${eventInfo}\n\n위 두 정보를 종합해 사용자에게 3문장 이내로 답변하세요. 행사가 맞다면 입장료/예매 정보를 포함하세요.`,
      maxTokens: 512,
    });
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
