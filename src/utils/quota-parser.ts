/**
 * Quota data parsing — extracts structured quota info from API responses.
 * Source: opencode-glm-quota/src/index.ts:175-252 (processQuotaLimit + getTokenLimitInfo)
 * Source: opencode-glm-quota/src/utils/token-limits.ts
 */

const TOKEN_LIMIT_TYPE = "TOKENS_LIMIT";
const CREDIT_LIMIT_TYPE = "CREDIT_LIMIT";
const TIME_LIMIT_TYPE = "TIME_LIMIT";
const DEFAULT_TOKEN_LIMIT = 4000000;

export interface QuotaItem {
  percentage: number;
  nextResetTime: number | null;
  total: number | null;
  /** True when the window comes from a CREDIT_LIMIT entry (bigmodel.cn domestic API). */
  credit?: boolean;
}

export interface McpQuotaItem {
  percentage: number;
  current: number | null;
  total: number | null;
  details: Array<{ modelCode: string; usage: number }>;
}

export interface ParsedQuota {
  level: string | null;
  fiveHour: QuotaItem | null;
  weekly: QuotaItem | null;
  mcp: McpQuotaItem | null;
  tokenUsed: number | null;
  tokenLimit: number;
}

interface RawLimitItem {
  type?: unknown;
  unit?: unknown;
  number?: unknown;
  percentage?: unknown;
  currentValue?: unknown;
  total?: unknown;
  usage?: unknown;
  nextResetTime?: unknown;
  usageDetails?: unknown;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

/**
 * A limit item counts as a rolling usage window when its type is either
 * TOKENS_LIMIT (z.ai international) or CREDIT_LIMIT (bigmodel.cn domestic).
 * Both share the same shape (unit / number / percentage / nextResetTime);
 * only the type tag differs.
 */
function isTokenWindowType(type: unknown): boolean {
  return type === TOKEN_LIMIT_TYPE || type === CREDIT_LIMIT_TYPE;
}

/**
 * Determine if a limit item represents the 5-hour token window.
 * unit=3, number=5 → 5h Token / 5h Quota
 */
function isFiveHourTokenLimit(limit: RawLimitItem): boolean {
  const unit = asFiniteNumber(limit.unit);
  const number = asFiniteNumber(limit.number);
  if (isTokenWindowType(limit.type) && unit === 3 && number === 5)
    return true;
  return false;
}

/**
 * Determine if a limit item represents the weekly token window.
 * unit=6, number=1 → Weekly Token
 */
function isWeeklyTokenLimit(limit: RawLimitItem): boolean {
  const unit = asFiniteNumber(limit.unit);
  const number = asFiniteNumber(limit.number);
  if (isTokenWindowType(limit.type) && unit === 6 && number === 1)
    return true;
  return false;
}

/**
 * Parse quota limit response + model-usage response into structured data.
 * Uses graceful degradation: missing data → null, not throw.
 */
/** Unwrap the API response envelope { code, data, success } → data payload. */
function unwrapData(
  response: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!response) return null;
  const data = response.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return response;
}

export function parseQuotaData(
  quotaResponse: Record<string, unknown> | null,
  modelResponse: Record<string, unknown> | null,
): ParsedQuota {
  const result: ParsedQuota = {
    level: null,
    fiveHour: null,
    weekly: null,
    mcp: null,
    tokenUsed: null,
    tokenLimit: DEFAULT_TOKEN_LIMIT,
  };

  const quota = unwrapData(quotaResponse);
  if (!quota) return result;

  // Extract plan level
  const level = quota.level;
  if (typeof level === "string") {
    result.level = level.charAt(0).toUpperCase() + level.slice(1).toLowerCase();
  }

  // Extract limits array
  const limitsRaw = quota.limits;
  if (!Array.isArray(limitsRaw)) return result;

  const limits = limitsRaw as RawLimitItem[];

  let tokenLimit = DEFAULT_TOKEN_LIMIT;
  let hasFiveHourMatch = false;

  for (const limit of limits) {
    // Usage windows (type = TOKENS_LIMIT on z.ai, CREDIT_LIMIT on bigmodel.cn)
    if (isTokenWindowType(limit.type)) {
      const percentage = asFiniteNumber(limit.percentage) ?? 0;
      const nextResetTime = asFiniteNumber(limit.nextResetTime);
      const total = asFiniteNumber(limit.total);

      if (isFiveHourTokenLimit(limit)) {
        result.fiveHour = {
          percentage,
          nextResetTime,
          total,
          credit: limit.type === CREDIT_LIMIT_TYPE,
        };
        if (total && total > 0) tokenLimit = total;
        hasFiveHourMatch = true;
      } else if (isWeeklyTokenLimit(limit)) {
        result.weekly = { percentage, nextResetTime, total };
        if (total && total > 0 && !hasFiveHourMatch) tokenLimit = total;
      }
    }

    // MCP time limit (type = TIME_LIMIT)
    if (limit.type === TIME_LIMIT_TYPE) {
      const percentage = asFiniteNumber(limit.percentage) ?? 0;
      const current = asFiniteNumber(limit.currentValue);
      const total = asFiniteNumber(limit.usage);
      const detailsRaw = Array.isArray(limit.usageDetails)
        ? (limit.usageDetails as Array<Record<string, unknown>>)
        : [];
      const details = detailsRaw
        .map((d) => ({
          modelCode: String(d.modelCode ?? d.model_code ?? "?"),
          usage: asFiniteNumber(d.usage) ?? 0,
        }))
        .filter((d) => d.modelCode !== "?");

      result.mcp = { percentage, current, total, details };
    }
  }

  // If no 5h match found, try the first usage window as fallback
  if (!result.fiveHour) {
    for (const limit of limits) {
      if (isTokenWindowType(limit.type)) {
        const percentage = asFiniteNumber(limit.percentage) ?? 0;
        const nextResetTime = asFiniteNumber(limit.nextResetTime);
        const total = asFiniteNumber(limit.total);
        result.fiveHour = {
          percentage,
          nextResetTime,
          total,
          credit: limit.type === CREDIT_LIMIT_TYPE,
        };
        if (total && total > 0) tokenLimit = total;
        break;
      }
    }
  }

  result.tokenLimit = tokenLimit;

  // Extract token usage from model-usage response
  const model = unwrapData(modelResponse);
  if (model) {
    const totalUsage = model.totalUsage as Record<string, unknown> | undefined;
    const tokenCount = asFiniteNumber(totalUsage?.totalTokensUsage);
    if (tokenCount !== null) {
      result.tokenUsed = tokenCount;
    }
  }

  return result;
}
