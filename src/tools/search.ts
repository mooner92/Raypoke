/**
 * `web_search` tool — real-time web search via Gemini's Google Search grounding.
 */
import { z } from 'zod';
import { searchWithGemini } from '../utils/gemini.js';
import { guard, textResult, type ToolDefinition } from './helpers.js';

const inputSchema = {
  query: z.string().min(1).describe('검색어 (한국어/영어 모두 지원)'),
  count: z.number().int().min(1).max(10).optional().describe('결과 수 (기본 5, 최대 10)'),
};

interface WebSearchArgs {
  query: string;
  count?: number;
}

/**
 * Runs a grounded web search and returns a 3-sentence voice-optimized summary.
 * (Gemini grounding incorporates live results directly, so no separate summary
 * pass is needed; `count` hints at how much breadth to consider.)
 */
async function run(args: WebSearchArgs) {
  const breadth = args.count ?? 5;
  const summary = await searchWithGemini(
    `"${args.query}"에 대해 웹에서 검색해 핵심 정보를 3문장 이내로 알려주세요. 관련 출처가 명확하면 플랫폼명을 언급하세요. (최대 ${breadth}개 결과 참고)`,
  );
  return textResult(summary);
}

export const webSearchTool: ToolDefinition<WebSearchArgs> = {
  name: 'web_search',
  description:
    '웹에서 실시간 정보를 검색합니다. 뉴스, 날씨, 장소, 현재 행사 등 최신 정보가 필요할 때 사용하세요.',
  inputSchema,
  handler: guard('web_search', run),
};
