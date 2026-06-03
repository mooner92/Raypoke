/**
 * Custom error classes and helpers for user-friendly (Korean) error messages.
 */

/** Base class for all PokeBOT errors. Carries a user-facing Korean message. */
export class PokeBotError extends Error {
  /** Message safe to surface to the end user via voice/iMessage. */
  public readonly userMessage: string;

  constructor(message: string, userMessage: string) {
    super(message);
    this.name = new.target.name;
    this.userMessage = userMessage;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Raised when an external API (Gemini, image download) fails. */
export class ExternalApiError extends PokeBotError {
  constructor(
    public readonly service: string,
    message: string,
    userMessage = '검색 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.',
  ) {
    super(`[${service}] ${message}`, userMessage);
  }
}

/** Raised when tool input fails validation. */
export class ValidationError extends PokeBotError {
  constructor(message: string, userMessage = '요청 형식이 올바르지 않아요. 다시 시도해주세요.') {
    super(message, userMessage);
  }
}

/** Raised when configuration is missing or invalid. */
export class ConfigError extends PokeBotError {
  constructor(message: string) {
    super(message, '서버 설정에 문제가 있어요. 관리자에게 문의해주세요.');
  }
}

/**
 * Extracts a safe, user-facing Korean message from any thrown value.
 *
 * @param error - The caught value (may be any type).
 * @returns A Korean message appropriate for voice output.
 */
export function toUserMessage(error: unknown): string {
  if (error instanceof PokeBotError) {
    return error.userMessage;
  }
  return '처리 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.';
}

/**
 * Returns a developer-facing description for logging.
 *
 * @param error - The caught value (may be any type).
 * @returns A descriptive string for logs.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}
