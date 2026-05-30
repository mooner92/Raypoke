/**
 * `search_events` and `get_ticket_info` tools — location-based event discovery
 * with ticket pricing and booking links, powered by Gemini's Google Search
 * grounding.
 */
import { z } from 'zod';
import { searchWithGemini } from '../utils/gemini.js';
import { guard, textResult, type ToolDefinition } from './helpers.js';

/** Today's date as an ISO `YYYY-MM-DD` string. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── search_events ──────────────────────────────────────────────────────────────

const searchEventsSchema = {
  location: z.string().min(1).describe('위치명 (예: "광화문", "홍대", "Hongdae Seoul")'),
  date: z.string().optional().describe('ISO 날짜 (기본: 오늘)'),
  category: z.string().optional().describe('카테고리 필터 (공연/전시/축제/스포츠)'),
};

export interface SearchEventsArgs {
  location: string;
  date?: string;
  category?: string;
}

/**
 * Core event-search logic shared with `analyze_scene`. Uses Gemini grounded
 * search to find events, entry fees, and booking links in one pass.
 *
 * @param args - The search arguments.
 * @returns A 3-sentence Korean summary suitable for voice output.
 */
export async function searchEventsCore(args: SearchEventsArgs): Promise<string> {
  const date = args.date ?? today();
  const category = args.category ? ` ${args.category}` : '';

  return searchWithGemini(
    `${args.location}에서 ${date}에 열리는 행사${category}(축제/공연/전시)를 검색하세요. ` +
      `"이름, 시간, 가격" 순서로 3문장 이내 요약하고, 인터파크/YES24/네이버예약 등 예매 링크가 있으면 플랫폼명으로 언급하세요.`,
  );
}

async function runSearchEvents(args: SearchEventsArgs) {
  const summary = await searchEventsCore(args);
  return textResult(summary);
}

export const searchEventsTool: ToolDefinition<SearchEventsArgs> = {
  name: 'search_events',
  description:
    '특정 위치에서 오늘 열리는 행사, 축제, 공연, 전시를 검색합니다. 입장료와 예매 링크 포함.',
  inputSchema: searchEventsSchema,
  handler: guard('search_events', runSearchEvents),
};

// ── get_ticket_info ──────────────────────────────────────────────────────────────

const ticketInfoSchema = {
  event_name: z.string().min(1).describe('행사명'),
  platform: z.string().optional().describe('특정 예매처 지정 (기본: 전체 검색)'),
};

interface TicketInfoArgs {
  event_name: string;
  platform?: string;
}

async function runTicketInfo(args: TicketInfoArgs) {
  const platform = args.platform ? ` ${args.platform}에서` : '';
  const summary = await searchWithGemini(
    `"${args.event_name}"의 티켓 정보를${platform} 검색하세요. ` +
      `가격, 예매처, 잔여 좌석 여부를 3문장 이내로 요약하고 예매처는 플랫폼명으로 표현하세요.`,
  );
  return textResult(summary);
}

export const getTicketInfoTool: ToolDefinition<TicketInfoArgs> = {
  name: 'get_ticket_info',
  description: '행사명을 입력받아 티켓 가격, 예매처, 잔여 좌석 여부를 검색합니다.',
  inputSchema: ticketInfoSchema,
  handler: guard('get_ticket_info', runTicketInfo),
};
