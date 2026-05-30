/**
 * `translate` tool — translates text (e.g. extracted from menus/signs) via Gemini.
 */
import { z } from 'zod';
import { askGemini } from '../utils/gemini.js';
import { guard, textResult, type ToolDefinition } from './helpers.js';

const inputSchema = {
  text: z.string().min(1).describe('번역할 텍스트'),
  target_lang: z.string().optional().describe('목표 언어 (기본: Korean)'),
  source_lang: z.string().optional().describe('원본 언어 (기본: 자동 감지)'),
};

interface TranslateArgs {
  text: string;
  target_lang?: string;
  source_lang?: string;
}

/** Translation uses a dedicated system prompt to avoid the 3-sentence cap. */
const TRANSLATE_SYSTEM_PROMPT = `당신은 정확한 번역가입니다. 입력된 텍스트를 목표 언어로 자연스럽게 번역하세요.
번역 결과만 출력하고 부연 설명은 하지 마세요. 메뉴판/간판처럼 항목이 여러 개면 항목별로 줄을 나눠 번역하세요.`;

async function run(args: TranslateArgs) {
  const target = args.target_lang ?? 'Korean';
  const source = args.source_lang ? `원본 언어: ${args.source_lang}.` : '원본 언어는 자동 감지하세요.';

  const translated = await askGemini(
    `${source}\n목표 언어: ${target}.\n\n다음 텍스트를 번역하세요:\n${args.text}`,
    TRANSLATE_SYSTEM_PROMPT,
  );
  return textResult(translated);
}

export const translateTool: ToolDefinition<TranslateArgs> = {
  name: 'translate',
  description:
    '텍스트를 번역합니다. 이미지에서 추출한 텍스트(메뉴판, 간판 등)를 한국어로 번역할 때 유용합니다.',
  inputSchema,
  handler: guard('translate', run),
};
