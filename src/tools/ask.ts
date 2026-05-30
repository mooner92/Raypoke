/**
 * `ask_claude` tool — direct access to Claude for reasoning, explanation, analysis.
 */
import { z } from 'zod';
import { complete } from '../utils/claude.js';
import { guard, textResult, type ToolDefinition } from './helpers.js';

const inputSchema = {
  prompt: z.string().min(1).describe('질문 내용'),
  system: z.string().optional().describe('시스템 프롬프트 (선택)'),
};

interface AskClaudeArgs {
  prompt: string;
  system?: string;
}

async function run(args: AskClaudeArgs) {
  const answer = await complete({
    prompt: args.prompt,
    ...(args.system ? { system: args.system } : {}),
    maxTokens: 1024,
  });
  return textResult(answer);
}

export const askClaudeTool: ToolDefinition<AskClaudeArgs> = {
  name: 'ask_claude',
  description: '복잡한 질문, 설명, 분석, 추론이 필요할 때 Claude AI에게 직접 질문합니다.',
  inputSchema,
  handler: guard('ask_claude', run),
};
