/**
 * `price_search` tool — online price comparison via Gemini's Google Search
 * grounding. Handles "이거 인터넷에서 얼마야?" style questions.
 */
import { z } from 'zod';
import { searchWithGemini } from '../utils/gemini.js';
import { guard, textResult, type ToolDefinition } from './helpers.js';

const inputSchema = {
  item: z.string().min(1).describe('가격을 알고 싶은 상품명 (예: "에어팟 프로 2세대")'),
  options: z.string().optional().describe('옵션/조건 (예: "정품", "256GB", "중고 제외")'),
};

interface PriceSearchArgs {
  item: string;
  options?: string;
}

async function run(args: PriceSearchArgs) {
  const options = args.options ? ` (조건: ${args.options})` : '';
  const summary = await searchWithGemini(
    `"${args.item}"${options}의 온라인 최저가를 검색하세요. ` +
      `최저가, 판매처, 구매 링크를 3문장 이내로 알려주고 판매처는 플랫폼명(쿠팡/네이버쇼핑 등)으로 표현하세요.`,
  );
  return textResult(summary);
}

export const priceSearchTool: ToolDefinition<PriceSearchArgs> = {
  name: 'price_search',
  description:
    '상품의 인터넷 최저가를 검색합니다. "이거 인터넷에서 얼마야?" 같은 질문에 최저가, 판매처, 링크로 답합니다.',
  inputSchema,
  handler: guard('price_search', run),
};
