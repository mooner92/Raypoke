/**
 * `navigate` tool — walking/transit directions and nearby-place guidance.
 *
 * Uses Gemini's Google Search grounding for live route/transit context,
 * summarized for voice output.
 */
import { z } from 'zod';
import { searchWithGemini } from '../utils/gemini.js';
import { guard, textResult, type ToolDefinition } from './helpers.js';

const inputSchema = {
  destination: z.string().min(1).describe('목적지 (예: "서울역", "광화문 광장")'),
  origin: z.string().optional().describe('출발지 (생략 시 현재 위치 기준 안내)'),
  mode: z.string().optional().describe('이동 수단 (도보/대중교통/자동차, 기본: 대중교통)'),
};

interface NavigateArgs {
  destination: string;
  origin?: string;
  mode?: string;
}

async function run(args: NavigateArgs) {
  const mode = args.mode ?? '대중교통';
  const route = args.origin ? `${args.origin}에서 ${args.destination}까지` : `${args.destination}까지`;

  const summary = await searchWithGemini(
    `${route} ${mode}(으)로 가는 방법과 예상 소요시간을 검색해 3문장 이내로 안내하세요.`,
  );
  return textResult(summary);
}

export const navigateTool: ToolDefinition<NavigateArgs> = {
  name: 'navigate',
  description: '목적지까지의 길안내 정보를 제공합니다. 이동 수단별 경로와 소요시간을 안내합니다.',
  inputSchema,
  handler: guard('navigate', run),
};
