/** @jsxImportSource @opentui/solid */

/**
 * Shared GLM quota sidebar panel, consumed by both host entrypoints:
 *   V1 (`src/v1/index.tsx`)  — registers via `api.slots.register`, passes
 *     `api.kv` wrapped by `src/v1/kv.ts`
 *   V2 (`src/v2/index.tsx`) — registers via `context.ui.slot`, passes a
 *     `storage.store`-backed adapter (`src/v2/kv.ts`)
 *
 * The hosts differ only in how they supply theme tokens and persistent
 * storage, so the rendering, quota fetching and auto-refresh timer live here.
 */

import type { JSX } from "@opentui/solid";
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui";
import {
  createMemo,
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  Show,
  For,
} from "solid-js";
import { PLUGIN_VERSION } from "../_version";

import { getCredentials } from "../utils/auth";
import { fetchAllQuota } from "../api/client";
import {
  SHARED_RECORD_KEY,
  hashToken,
  isClaimActive,
  normalizeRecord,
  coordinateFetch,
  type SharedQuotaRecord,
} from "../utils/shared-record";
import {
  fetchProviderQuota,
  EXTERNAL_RECORD_POLL_MS,
  EXTERNAL_FAILURE_BACKOFF_MS,
  type ExternalQuotaRecord,
  type QuotaRpcClient,
} from "../utils/provider-quota";
import { parseQuotaData, type ParsedQuota } from "../utils/quota-parser";
import { getPlatformName } from "../api/platforms";
import {
  formatNumber,
  formatPercentage,
  formatResetCountdown,
  formatResetClock,
  formatClockShort,
} from "../utils/format";
import { visualWidth, truncateVisual } from "./widgets";
import { buildPalette, dimColor, quotaColor, type ThemePalette } from "./theme";
import { QuotaBar, parseBarPercent } from "./quota-block";
import { getTranslations, type Translations } from "./i18n";

// ---------------------------------------------------------------------------
// Constants shared by the host entrypoints
// ---------------------------------------------------------------------------

export const KV = "glm_quota_panel";
export const DEFAULT_REFRESH_INTERVAL_MIN = 5; // minutes
export const MIN_REFRESH_INTERVAL_MIN = 1;
export const MAX_REFRESH_INTERVAL_MIN = 1440; // 24h

// Cross-session refresh coordination (src/utils/shared-record.ts): the
// freshness window is the refresh interval minus a small slack so each
// timer tick still triggers exactly one global fetch per interval.
const FRESH_WINDOW_SLACK_MS = 10_000;
const MIN_FRESH_WINDOW_MS = 15_000;

/** Initial language: `GLM_VISTATUS_LANG=zh|en` env override, else locale. */
export function detectLangZH(): boolean {
  const debug =
    typeof process !== "undefined" ? process.env?.GLM_VISTATUS_LANG : undefined;
  if (debug) return debug === "zh";
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.startsWith("zh");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Host-neutral contracts
// ---------------------------------------------------------------------------

/** Synchronous key/value view over the host's persistent store. */
export interface KvAdapter {
  get<Value = unknown>(key: string, fallback?: Value): Value;
  set(key: string, value: unknown): void | Promise<void>;
  /**
   * Read-mutate-write with a compare-and-set style callback. V2 runs it
   * inside the host's file lock, so concurrent sessions serialize and the
   * shared-record claim is atomic; V1's adapter is a best-effort naive RMW
   * against the local view — there the claim stays advisory and the
   * pre-claim jitter is what staggers sessions.
   */
  update<R>(
    key: string,
    fn: (current: unknown) => { next: unknown; result: R },
  ): R | Promise<R>;
  /** True once reads are meaningful. V2's Solid store is always ready. */
  readonly ready: boolean;
}

/** Reactive settings shared by the panel and the command flows. */
export interface PanelSignals {
  langZH: () => boolean;
  setLangZH: (v: boolean) => void;
  borderVisible: () => boolean;
  setBorderVisible: (v: boolean) => void;
  refreshIntervalMin: () => number;
  setRefreshIntervalMin: (v: number) => void;
  forceRefresh: () => number;
  setForceRefresh: (v: number) => void;
  providerFilter: () => boolean;
  setProviderFilter: (v: boolean) => void;
  matchedProviders: () => readonly string[];
  setMatchedProviders: (v: readonly string[]) => void;
  externalRecord?: () => ExternalQuotaRecord | null;
}

/**
 * Probe the host RPC channel for the selected provider's quota snapshot.
 * Component-scope helper (needs a Solid owner for the effect + onCleanup):
 * re-probes on a provider switch and every EXTERNAL_RECORD_POLL_MS; after
 * a failed probe (no such RPC, provider offline) THAT provider backs off
 * for EXTERNAL_FAILURE_BACKOFF_MS while others keep probing. A stale
 * in-flight response is discarded via an epoch guard, and a provider
 * switch resets the probe immediately. The V2 gate owns the single
 * instance and passes it down through `signals`.
 */
export function createExternalRecordTrack(
  currentProvider: () => string | undefined,
  client: QuotaRpcClient | undefined,
): () => ExternalQuotaRecord | null {
  const [record, setRecord] = createSignal<ExternalQuotaRecord | null>(null);
  let epoch = 0;
  // Per-provider backoff state: only the id that failed is skipped until
  // its window expires, so switching providers probes immediately.
  let failFor: string | null = null;
  let failAt = 0;
  const probe = async () => {
    const id = currentProvider()?.trim().toLowerCase();
    if (!id) {
      epoch++;
      setRecord(null);
      return;
    }
    if (failFor === id && Date.now() - failAt < EXTERNAL_FAILURE_BACKOFF_MS) {
      return;
    }
    const seq = ++epoch;
    const rec = await fetchProviderQuota(client, id);
    if (seq !== epoch) return; // provider switched mid-flight
    if (rec === null) {
      failFor = id;
      failAt = Date.now();
    }
    setRecord(rec);
  };
  createEffect(() => {
    currentProvider();
    void probe();
  });
  const timer = setInterval(() => void probe(), EXTERNAL_RECORD_POLL_MS);
  onCleanup(() => clearInterval(timer));
  return record;
}

// ---------------------------------------------------------------------------
// Panel component
// ---------------------------------------------------------------------------

const MIN_PANEL_WIDTH = 20;
const DEFAULT_PANEL_WIDTH = 30;

// Layout measurement constants (visual columns)
const HEADER_PREFIX = 2; // "▼ " or "▶ "

export function GlmQuotaPanel(props: {
  theme: TuiThemeCurrent;
  kv: KvAdapter;
  signals: PanelSignals;
}): JSX.Element {
  const [panelWidth, setPanelWidth] = createSignal(DEFAULT_PANEL_WIDTH);
  const [quotaData, setQuotaData] = createSignal<ParsedQuota | null>(null);
  const [platformName, setPlatformName] = createSignal<string>("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [lastUpdate, setLastUpdate] = createSignal<Date | null>(null);
  const [open, setOpen] = createSignal(true);
  let boxEl: any;

  const { langZH, borderVisible } = props.signals;
  const t = createMemo<Translations>(() => getTranslations(langZH()));
  const pal = createMemo<ThemePalette>(() => buildPalette(props.theme));

  // ── Refresh logic ──
  //
  // Every TUI session runs this panel, so a naive per-session timer would
  // fire the GLM Monitor API once per session per interval. Sessions share
  // one record in the host KV (src/utils/shared-record.ts): a fresh record
  // is applied with no network request, and stale data elects a single
  // fetcher — atomically on V2 (locked read-modify-write), best-effort on
  // V1 where the claim is advisory and the jitter does the staggering. The
  // V2 store is live-synced, so the adopt effect below pulls new records
  // from other sessions reactively.

  /** Newest record ts seen for the current account (applied or merely read). */
  let knownTs = 0;
  /** Token hash of the record currently backing the panel (adoption filter). */
  let knownTokenHash: string | null = null;
  /** Record state currently applied (de-dupes redundant signal writes). */
  let appliedTs = 0;
  let appliedTokenHash: string | null = null;

  const applyRecord = (rec: SharedQuotaRecord) => {
    knownTs = Math.max(knownTs, rec.ts);
    knownTokenHash = rec.tokenHash;
    if (rec.ts <= appliedTs && appliedTokenHash === rec.tokenHash) return;
    appliedTs = rec.ts;
    appliedTokenHash = rec.tokenHash;
    if (rec.ok && rec.result) {
      setQuotaData(parseQuotaData(rec.result.quotaData, rec.result.modelData));
      setLastUpdate(new Date(rec.ts));
      setError(null);
    } else {
      setError(rec.error || t().error);
    }
  };

  const readShared = (): SharedQuotaRecord | null =>
    normalizeRecord(props.kv.get<unknown>(`${KV}.${SHARED_RECORD_KEY}`));

  async function refresh(force = false) {
    setLoading(true);
    setError(null);
    try {
      const creds = getCredentials();
      if (!creds) {
        setError(t().noCred);
        return;
      }

      setPlatformName(getPlatformName(creds.platform));
      const tokenHash = hashToken(creds.token);

      // Forced refresh (/glm-refresh) bypasses the freshness window but
      // still goes through the claim, so concurrent forces collapse too.
      const windowMs = force
        ? 0
        : Math.max(
            props.signals.refreshIntervalMin() * 60_000 - FRESH_WINDOW_SLACK_MS,
            MIN_FRESH_WINDOW_MS,
          );

      // Stale-but-usable data keeps the panel populated while revalidating;
      // a stale failure record surfaces its error.
      const cached = readShared();
      const mine = cached && cached.tokenHash === tokenHash ? cached : null;
      if (mine) knownTs = Math.max(knownTs, mine.ts);
      if (mine && mine.ts > appliedTs) {
        if (mine.ok) applyRecord(mine);
        else setError(mine.error || t().error);
      }

      const outcome = await coordinateFetch({
        tokenHash,
        windowMs,
        read: readShared,
        claim: (id) => {
          const claimTs = Date.now();
          return Promise.resolve(
            props.kv.update<boolean>(
              `${KV}.${SHARED_RECORD_KEY}`,
              (current: unknown) => {
                const rec = normalizeRecord(current);
                if (rec && isClaimActive(rec.claim) && rec.claim!.id !== id) {
                  return { next: rec, result: false };
                }
                const base: SharedQuotaRecord = rec ?? {
                  v: 1,
                  tokenHash,
                  ts: 0,
                  ok: true,
                };
                return {
                  next: { ...base, claim: { id, ts: claimTs } },
                  result: true,
                };
              },
            ),
          );
        },
        publish: (rec) => {
          // Bump before the write: the store update may reach the adopt
          // effect (below) before publish resolves.
          knownTs = Math.max(knownTs, rec.ts);
          return props.kv.set(`${KV}.${SHARED_RECORD_KEY}`, rec);
        },
        fetch: () => fetchAllQuota(creds.token, creds.platform),
        fetchError: t().error,
      });

      if (outcome.action === "stale") {
        // Claim holder never published (crash / very slow network): keep
        // whatever the panel already shows.
        if (!quotaData() && !error()) setError(t().error);
        return;
      }
      applyRecord(outcome.record);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // ── Adopt records published by other sessions (live-synced on V2) ───
  // V2's storage store is reactive, so this effect re-runs when another
  // session publishes; on V1 it evaluates once and the next tick adopts.
  createEffect(() => {
    const rec = normalizeRecord(
      props.kv.get<unknown>(`${KV}.${SHARED_RECORD_KEY}`),
    );
    if (!rec || rec.ts <= knownTs) return;
    if (!knownTokenHash || rec.tokenHash !== knownTokenHash) return;
    // A claim write is not publishable data; wait for the holder's record.
    if (isClaimActive(rec.claim)) return;
    // Idle sessions keep showing good stale data on failure records; the
    // next tick's refresh will surface the error properly.
    if (rec.ok || !quotaData()) applyRecord(rec);
  });

  let refreshTimer: ReturnType<typeof setInterval> | undefined;

  onMount(() => {
    setPanelWidth(DEFAULT_PANEL_WIDTH);

    // Restore fold state from kv
    try {
      if (props.kv.ready) {
        setOpen(Boolean(props.kv.get(`${KV}.open`, true)));
      } else {
        // Poll kv.ready with a timeout
        let tries = 0;
        const poll = () => {
          if (!props.kv.ready) {
            if (++tries > 100) {
              setOpen(Boolean(props.kv.get(`${KV}.open`, true)));
              return;
            }
            setTimeout(poll, 10);
            return;
          }
          setOpen(Boolean(props.kv.get(`${KV}.open`, true)));
        };
        poll();
      }
    } catch {}

    // Adopt records published by other sessions happens reactively in the
    // effect above (V2 live-synced store); nothing to register here.

    // First fetch
    refresh();
  });

  onCleanup(() => {
    if (refreshTimer) clearInterval(refreshTimer);
  });

  // ── Auto-refresh timer; rescheduled when the interval changes ──
  createEffect(() => {
    const minutes = props.signals.refreshIntervalMin();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => refresh(), minutes * 60 * 1000);
  });

  // ── React to manual force-refresh signal ──
  createEffect(() => {
    const tick = props.signals.forceRefresh();
    if (tick > 0) refresh(true);
  });

  // ── Persist fold state ──
  const persistFold = (key: string, val: boolean) => {
    try {
      props.kv.set(`${KV}.${key}`, val);
    } catch {}
  };

  // ── Layout helpers ──
  const gutter = createMemo(() => (borderVisible() ? 6 : 0));
  const sep = createMemo(() =>
    "\u2500".repeat(Math.max(1, panelWidth() - gutter())),
  );

  // ── Labeled value line: accent label + bright value, right-aligned ──
  const labeledValue = (label: string, value: string): JSX.Element => {
    const gauge = panelWidth() - gutter();
    const gap = Math.max(1, gauge - visualWidth(label) - visualWidth(value));
    return (
      <text>
        <span style={{ fg: pal().info }}>{label}</span>
        <span style={{ fg: pal().accent }}>{" ".repeat(gap) + value}</span>
      </text>
    );
  };

  // ── External provider record (V2 data protocol; V1 → always null) ────
  // Non-null → the panel switches its data source: header shows the
  // provider's label, GLM-specific lines are suppressed and the record's
  // groups render through the same QuotaBar base.
  const extRec = createMemo(() => props.signals.externalRecord?.() ?? null);

  // ── Folded header percentage (5h usage; first group for external) ──
  const foldedPctValue = createMemo(() => {
    const e = extRec();
    if (e) return parseBarPercent(e.groups[0]?.bar ?? "") ?? 0;
    return quotaData()?.fiveHour?.percentage ?? 0;
  });
  const foldedPct = createMemo(() => {
    const e = extRec();
    if (e) {
      const pct = parseBarPercent(e.groups[0]?.bar ?? "");
      return pct === null ? "" : formatPercentage(pct);
    }
    const d = quotaData();
    if (!d?.fiveHour) return "";
    return formatPercentage(d.fiveHour.percentage);
  });

  // Header text/clock switch with the data source ("GLM 额度" vs "<label> 额度").
  const headerTitle = createMemo(() => {
    const e = extRec();
    return e ? `${e.label} ${t().quotaSuffix}` : t().title;
  });
  const headerClock = createMemo<Date | null>(() => {
    const e = extRec();
    if (e) return new Date(e.ts);
    return lastUpdate();
  });

  // Resync panel width after border toggle
  createEffect(() => {
    borderVisible();
    if (boxEl && typeof boxEl.width === "number" && boxEl.width > 0) {
      const w = Math.max(MIN_PANEL_WIDTH, boxEl.width);
      setPanelWidth((prev) => (prev === w ? prev : w));
    }
  });

  // ── Render a quota block via the neutral QuotaBar base ──
  //
  // Maps the GLM payload onto the { title, bar, resetTime? } contract:
  // `bar` is "xx/yy" when the API provides a total, else the bare "nn%";
  // the reset line is composed display-ready (i18n stays with the caller).
  function renderQuotaBlock(
    label: string,
    percentage: number,
    used: number | null,
    total: number | null,
    resetTime: number | null,
  ): JSX.Element {
    const bar =
      used !== null && total !== null
        ? formatNumber(used) + "/" + formatNumber(total)
        : formatPercentage(percentage);
    let reset: string | null = null;
    if (resetTime !== null) {
      const countdown = formatResetCountdown(resetTime);
      const clock = formatResetClock(resetTime);
      reset =
        t().resetsIn + ": " + countdown + (clock ? " (" + clock + ")" : "");
    }
    return (
      <QuotaBar
        title={label}
        bar={bar}
        resetTime={reset}
        width={panelWidth() - gutter()}
        palette={pal()}
      />
    );
  }

  return (
    <box
      border={borderVisible()}
      {...(borderVisible() ? { borderColor: pal().border } : {})}
      paddingTop={0}
      paddingBottom={0}
      paddingLeft={borderVisible() ? 2 : 0}
      paddingRight={borderVisible() ? 2 : 0}
      flexDirection="column"
      gap={0}
      ref={boxEl}
      onSizeChange={() => {
        const w = boxEl
          ? Math.max(MIN_PANEL_WIDTH, boxEl.width ?? 0)
          : DEFAULT_PANEL_WIDTH;
        setPanelWidth((prev) => (prev === w ? prev : w));
      }}
    >
      {/* Collapsible header */}
      <text
        onMouseUp={() =>
          setOpen((o) => {
            const n = !o;
            persistFold("open", n);
            return n;
          })
        }
      >
        <span style={{ fg: pal().muted }}>
          {open() ? "\u25bc " : "\u25b6 "}
        </span>
        <span style={{ fg: pal().primary }}>
          <b>{headerTitle()}</b>
          <Show when={open()}>
            <span style={{ fg: dimColor(pal().muted, 0.6) }}>
              {" "}
              v{PLUGIN_VERSION}
            </span>
          </Show>
        </span>
        {/* Expanded: show last update time right-aligned */}
        <Show when={open() && headerClock()}>
          <span style={{ fg: dimColor(pal().muted, 0.7) }}>
            {" ".repeat(
              Math.max(
                1,
                panelWidth() -
                  gutter() -
                  HEADER_PREFIX -
                  visualWidth(headerTitle()) -
                  visualWidth(" v" + PLUGIN_VERSION) -
                  visualWidth(formatClockShort(headerClock()!)),
              ),
            ) + formatClockShort(headerClock()!)}
          </span>
        </Show>
        {/* Folded: show 5h usage percentage */}
        <Show when={!open() && foldedPct()}>
          <span>
            {" ".repeat(
              Math.max(
                1,
                panelWidth() -
                  gutter() -
                  HEADER_PREFIX -
                  visualWidth(headerTitle()) -
                  visualWidth(foldedPct() + " " + t().collapsed),
              ),
            )}
          </span>
          <span style={{ fg: quotaColor(foldedPctValue(), pal()) }}>
            {foldedPct()} {t().collapsed}
          </span>
        </Show>
      </text>

      <Show when={open()}>
        {/* Separator */}
        <text fg={pal().muted}>{sep()}</text>

        {/* External provider record: data source follows the selected
            provider. Groups render through the same QuotaBar base; title
            and resetTime are display-ready (the writer owns i18n). */}
        <Show when={extRec()}>
          <For each={extRec()!.groups}>
            {(g) => (
              <QuotaBar
                title={g.title}
                bar={g.bar}
                resetTime={g.resetTime ?? null}
                width={panelWidth() - gutter()}
                palette={pal()}
              />
            )}
          </For>
        </Show>

        {/* Platform info */}
        <Show when={!extRec() && platformName()}>
          {labeledValue(t().platform + ":", platformName())}
        </Show>

        {/* Plan level */}
        <Show when={!extRec() && quotaData()?.level}>
          {labeledValue(t().plan + ":", quotaData()!.level!)}
        </Show>

        {/* Loading state */}
        <Show when={!extRec() && loading() && !quotaData() && !error()}>
          <text>
            <span style={{ fg: pal().muted }}>{"> "}</span>
            <span style={{ fg: pal().muted }}>{t().refreshing}</span>
          </text>
        </Show>

        {/* Error state */}
        <Show when={!extRec() && error()}>
          <text>
            <span style={{ fg: pal().error }}>{"\u26a0 " + t().error}</span>
          </text>
          <Show when={error() === t().noCred}>
            <text fg={pal().muted}>{"  " + t().noCredHint}</text>
          </Show>
          <Show when={error() !== t().noCred}>
            <text fg={pal().muted}>
              {"  " + truncateVisual(error()!, panelWidth() - gutter() - 2)}
            </text>
          </Show>
        </Show>

        {/* No data (not loading, not error, no quota) */}
        <Show when={!extRec() && !loading() && !error() && !quotaData()}>
          <text>
            <span style={{ fg: pal().muted }}>{"> "}</span>
            <span style={{ fg: pal().muted }}>{t().noData}</span>
          </text>
        </Show>

        {/* Quota data */}
        <Show when={!extRec() && quotaData()}>
          {/* 5h Token (z.ai) / 5h Quota (bigmodel.cn credit window) */}
          <Show when={quotaData()!.fiveHour}>
            {(() => {
              const q = quotaData()!.fiveHour!;
              const used =
                q.total !== null
                  ? Math.round((q.total * q.percentage) / 100)
                  : null;
              return renderQuotaBlock(
                q.credit ? t().token5hCredit : t().token5h,
                q.percentage,
                used,
                q.total,
                q.nextResetTime,
              );
            })()}
          </Show>

          {/* Weekly */}
          <Show when={quotaData()!.weekly}>
            {(() => {
              const q = quotaData()!.weekly!;
              const used =
                q.total !== null
                  ? Math.round((q.total * q.percentage) / 100)
                  : null;
              return renderQuotaBlock(
                t().weekly,
                q.percentage,
                used,
                q.total,
                q.nextResetTime,
              );
            })()}
          </Show>

          {/* MCP (no reset line) */}
          <Show when={quotaData()!.mcp}>
            {(() => {
              const mcp = quotaData()!.mcp!;
              return renderQuotaBlock(
                t().mcp,
                mcp.percentage,
                mcp.current,
                mcp.total,
                null,
              );
            })()}
          </Show>
        </Show>
      </Show>
    </box>
  );
}
