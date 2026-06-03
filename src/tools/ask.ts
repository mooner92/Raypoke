/**
 * `ask_ai` tool — direct access to Gemini for reasoning, explanation, analysis.
 */
import { z } from 'zod';
import { askGemini } from '../utils/gemini.js';
import { guard, textResult, type ToolDefinition } from './helpers.js';

const inputSchema = {
  prompt: z.string().min(1).describe('질문 내용'),
  system: z.string().optional().describe('시스템 프롬프트 (선택)'),
};

interface AskAiArgs {
  prompt: string;
  system?: string;
}

async function run(args: AskAiArgs) {
  const answer = await askGemini(args.prompt, args.system);
  return textResult(answer);
}

export const askAiTool: ToolDefinition<AskAiArgs> = {
  name: 'ask_ai',
  description: '복잡한 질문, 설명, 분석, 추론이 필요할 때 AI에게 직접 질문합니다.',
  inputSchema,
  handler: guard('ask_ai', run),
};
