/**
 * DSH 花费 — Host half.
 *
 * Registers one client-visible session projection (`deepseekCost`) that folds
 * provider-reported token usage into an estimated DeepSeek API cost in CNY.
 *
 * The fold is deterministic and price-independent: state keeps token buckets
 * per tariff window (peak / off-peak) and the last usage sample so a streamed
 * attempt that settles twice replaces its own sample instead of double
 * counting. Prices are applied by `wire.view` at publish time, so editing the
 * price table never invalidates a checkpointed state.
 *
 * Data source: `assistant/message` (and `assistant/attempt` when it carries a
 * usage record) plus the route from `request/header`. Pricing uses the
 * official DeepSeek list prices in CNY per 1M tokens and the official peak
 * windows (Beijing time, Monday–Friday 09:00–12:00 and 14:00–18:00).
 *
 * @module dsh-cost-meter
 */

import { readFileSync } from 'node:fs';

/** Display currency; the official CNY list is the default source. */
const CURRENCY = 'CNY';

/**
 * Official DeepSeek API list prices in CNY per 1M tokens (api-docs.deepseek.com,
 * 2026-10-30). Peak windows are twice the off-peak price. `config.prices` on the
 * loader row replaces this whole table when supplied.
 */
const DEFAULT_PRICES = {
  'deepseek-flash': {
    peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
    offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  },
  'deepseek-v4-pro': {
    peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
    offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
  },
};

/** Model whose prices are used when the session route is unknown or unlisted. */
const FALLBACK_MODEL = 'deepseek-flash';

/** Editable price table beside this module; read at activation and after a plugin reload. */
const PRICE_FILE = new URL('./prices.json', import.meta.url);

const MILLION = 1000000;

/**
 * Accept a non-negative finite token count.
 * @param {unknown} value - raw usage field.
 * @returns {number} a whole token count, zero for anything unusable.
 */
function tokenCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * Empty bucket record; the four provider billing categories.
 * @returns {{uncachedInputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number}} buckets.
 */
function zeroBuckets() {
  return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

/**
 * Map one provider usage record onto billing buckets.
 * @param {unknown} usage - `assistant/message` / `assistant/attempt` usage.
 * @returns {{uncachedInputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number}|undefined} buckets, or undefined when the record bills nothing.
 */
function bucketsOf(usage) {
  if (typeof usage !== 'object' || usage === null) return undefined;
  const buckets = {
    uncachedInputTokens: tokenCount(usage.inputTokens),
    outputTokens: tokenCount(usage.outputTokens),
    cacheReadTokens: tokenCount(usage.cacheReadTokens),
    cacheWriteTokens: tokenCount(usage.cacheWriteTokens),
  };
  const total = buckets.uncachedInputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens;
  return total === 0 ? undefined : buckets;
}

/**
 * Whether two bucket records bill the same tokens.
 * @param {{uncachedInputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number}} left - first record.
 * @param {{uncachedInputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number}} right - second record.
 * @returns {boolean} equality.
 */
function bucketsEqual(left, right) {
  return left.uncachedInputTokens === right.uncachedInputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens;
}

/**
 * Add two bucket records.
 * @param {{uncachedInputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number}} left - first record.
 * @param {{uncachedInputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number}} right - second record.
 * @returns {{uncachedInputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number}} sum.
 */
function addBuckets(left, right) {
  return {
    uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
  };
}

/**
 * Subtract one bucket record from another, clamped at zero.
 * @param {{uncachedInputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number}} left - minuend.
 * @param {{uncachedInputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number}} right - subtrahend.
 * @returns {{uncachedInputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number}} difference.
 */
function subtractBuckets(left, right) {
  return {
    uncachedInputTokens: Math.max(0, left.uncachedInputTokens - right.uncachedInputTokens),
    outputTokens: Math.max(0, left.outputTokens - right.outputTokens),
    cacheReadTokens: Math.max(0, left.cacheReadTokens - right.cacheReadTokens),
    cacheWriteTokens: Math.max(0, left.cacheWriteTokens - right.cacheWriteTokens),
  };
}

/**
 * Whether one event time falls in the peak tariff window.
 * Peak is Beijing time Monday–Friday 09:00–12:00 and 14:00–18:00, which is
 * 01:00–04:00 and 06:00–10:00 UTC. Chinese public holidays are not resolved
 * offline, so those days price as peak here.
 * @param {unknown} time - event envelope time in epoch milliseconds.
 * @returns {boolean} true for the peak tariff.
 */
function isPeakTime(time) {
  if (typeof time !== 'number' || !Number.isFinite(time)) return false;
  const date = new Date(time);
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = date.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

/**
 * Extract the route from a `request/header` payload.
 * @param {unknown} event - a session event.
 * @returns {string|null} `provider/model`, or null when the header is unusable.
 */
function routeOf(event) {
  const config = event && typeof event === 'object' && event.data && typeof event.data === 'object'
    ? event.data.header && typeof event.data.header === 'object' ? event.data.header.config : undefined
    : undefined;
  if (!config || typeof config !== 'object') return null;
  const model = typeof config.model === 'string' && config.model !== '' ? config.model : null;
  if (model === null) return null;
  const provider = typeof config.provider === 'string' && config.provider !== '' ? config.provider : 'unknown';
  return `${provider}/${model}`;
}

/**
 * Model name of a stored route.
 * @param {string|null} route - `provider/model`.
 * @returns {string} the model segment, or ''.
 */
function modelOfRoute(route) {
  if (typeof route !== 'string' || route === '') return '';
  const index = route.lastIndexOf('/');
  return index === -1 ? route : route.slice(index + 1);
}

/**
 * Sanitize one tariff price record.
 * @param {unknown} value - candidate record.
 * @returns {{cacheHit: number, cacheMiss: number, output: number}|undefined} sanitized record.
 */
function priceRecord(value) {
  if (typeof value !== 'object' || value === null) return undefined;
  const read = (field) => (typeof value[field] === 'number' && Number.isFinite(value[field]) && value[field] >= 0 ? value[field] : undefined);
  const cacheHit = read('cacheHit');
  const cacheMiss = read('cacheMiss');
  const output = read('output');
  if (cacheHit === undefined || cacheMiss === undefined || output === undefined) return undefined;
  return { cacheHit, cacheMiss, output };
}

/**
 * Sanitize a full price table supplied through the loader row's `config.prices`.
 * @param {unknown} value - candidate table.
 * @returns {Record<string, {peak: object, offPeak: object}>|undefined} sanitized table, or undefined to keep defaults.
 */
function priceTable(value) {
  if (typeof value !== 'object' || value === null) return undefined;
  const table = {};
  let accepted = 0;
  for (const [model, entry] of Object.entries(value)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const peak = priceRecord(entry.peak);
    const offPeak = priceRecord(entry.offPeak);
    if (peak === undefined || offPeak === undefined) continue;
    table[model] = { peak, offPeak };
    accepted += 1;
  }
  return accepted === 0 ? undefined : table;
}

/**
 * Read the editable price table beside this module.
 * The file is the durable source of truth for prices; `DEFAULT_PRICES` is the
 * fallback when the file is missing or malformed. A plugin reload re-reads it,
 * and the token-only projection state needs no migration when it changes.
 * @returns {{models: Record<string, {peak: object, offPeak: object}>, updatedAt: string|undefined, checkedAt: string|undefined, source: string|undefined}|undefined} parsed table and metadata.
 */
function loadPriceFile() {
  try {
    const parsed = JSON.parse(readFileSync(PRICE_FILE, 'utf8'));
    const models = priceTable(parsed && typeof parsed === 'object' ? parsed.models : undefined);
    if (models === undefined) return undefined;
    return {
      models,
      updatedAt: parsed && typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
      checkedAt: parsed && typeof parsed.checkedAt === 'string' ? parsed.checkedAt : undefined,
      source: parsed && typeof parsed.source === 'string' ? parsed.source : undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * Resolve the tariff prices for one route.
 * @param {string|null} route - stored `provider/model`.
 * @param {Record<string, {peak: object, offPeak: object}>|undefined} overrides - row-supplied table.
 * @returns {{model: string, known: boolean, peak: object, offPeak: object}} resolved prices.
 */
function resolvePrices(route, overrides) {
  const model = modelOfRoute(route);
  const table = overrides !== undefined ? overrides : DEFAULT_PRICES;
  const listed = table[model];
  if (listed !== undefined) return { model, known: true, peak: listed.peak, offPeak: listed.offPeak };
  const fallback = DEFAULT_PRICES[FALLBACK_MODEL];
  return { model: model === '' ? FALLBACK_MODEL : model, known: false, peak: fallback.peak, offPeak: fallback.offPeak };
}

/**
 * Cost of one bucket record under one tariff.
 * Cache-write tokens are not billed separately by DeepSeek; price them as
 * uncached input so an unusual provider record is never under-reported.
 * @param {{uncachedInputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number}} buckets - token buckets.
 * @param {{cacheHit: number, cacheMiss: number, output: number}} price - CNY per 1M tokens.
 * @returns {number} CNY.
 */
function costOf(buckets, price) {
  const inputMiss = buckets.uncachedInputTokens + buckets.cacheWriteTokens;
  return (buckets.cacheReadTokens * price.cacheHit + inputMiss * price.cacheMiss + buckets.outputTokens * price.output) / MILLION;
}

/**
 * Round a CNY amount to six decimals so the JSON view stays compact.
 * @param {number} value - amount.
 * @returns {number} rounded amount.
 */
function round6(value) {
  return Math.round(value * 1000000) / 1000000;
}

/**
 * Build the client-visible view from host state.
 * @param {{route: string|null, peak: object, offPeak: object}} state - projection state.
 * @param {Record<string, {peak: object, offPeak: object}>|undefined} overrides - row-supplied price table.
 * @param {string|undefined} updatedAt - date the price table last changed (YYYY-MM-DD), if known.
 * @param {string|undefined} checkedAt - date the table was last verified against the official page (YYYY-MM-DD), if known.
 * @returns {object} client view.
 */
function viewOf(state, overrides, updatedAt, checkedAt) {
  const resolved = resolvePrices(state.route, overrides);
  const peakCost = costOf(state.peak, resolved.peak);
  const offPeakCost = costOf(state.offPeak, resolved.offPeak);
  return {
    currency: CURRENCY,
    model: resolved.model,
    modelKnown: resolved.known,
    totalCost: round6(peakCost + offPeakCost),
    peakCost: round6(peakCost),
    offPeakCost: round6(offPeakCost),
    tokens: addBuckets(state.peak, state.offPeak),
    peakTokens: state.peak,
    offPeakTokens: state.offPeak,
    prices: { peak: resolved.peak, offPeak: resolved.offPeak },
    priceUpdatedAt: typeof updatedAt === 'string' ? updatedAt : null,
    priceCheckedAt: typeof checkedAt === 'string' ? checkedAt : null,
  };
}

/**
 * The projection unit. Exported for its unit contract and for tests.
 * @param {Record<string, {peak: object, offPeak: object}>|undefined} overrides - row-supplied price table.
 * @param {string|undefined} updatedAt - date the price table last changed (YYYY-MM-DD), if known.
 * @param {string|undefined} checkedAt - date the table was last verified against the official page (YYYY-MM-DD), if known.
 * @returns {object} projection definition.
 */
function costProjection(overrides, updatedAt, checkedAt) {
  /**
   * Pure fold: token buckets per tariff plus the last sample for replacement.
   * @param {{route: string|null, peak: object, offPeak: object, last: object|null}} state - previous state.
   * @param {object} event - committed session event.
   * @returns {object} next state, or the same reference when the event is ignored.
   */
  const apply = (state, event) => {
    if (event.type === 'request/header') {
      const route = routeOf(event);
      if (route === null || route === state.route) return state;
      return { ...state, route };
    }
    if (event.type === 'llm/retry-started') {
      const last = state.last;
      if (last === null || last.turn !== event.data.turn || last.step !== event.data.step) return state;
      return { ...state, last: null };
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return state;
    const buckets = bucketsOf(event.data.usage);
    if (buckets === undefined) return state;
    const turn = typeof event.data.turn === 'number' ? event.data.turn : -1;
    const step = typeof event.data.step === 'number' ? event.data.step : -1;
    const peak = isPeakTime(event.time);
    const tariff = peak ? 'peak' : 'offPeak';
    const last = state.last;
    const replaces = last !== null && last.turn === turn && last.step === step;
    if (replaces && last.tariff === tariff && bucketsEqual(last.buckets, buckets)) return state;
    let peakBuckets = state.peak;
    let offPeakBuckets = state.offPeak;
    if (replaces) {
      if (last.tariff === 'peak') peakBuckets = subtractBuckets(peakBuckets, last.buckets);
      else offPeakBuckets = subtractBuckets(offPeakBuckets, last.buckets);
    }
    if (tariff === 'peak') peakBuckets = addBuckets(peakBuckets, buckets);
    else offPeakBuckets = addBuckets(offPeakBuckets, buckets);
    return {
      route: state.route,
      peak: peakBuckets,
      offPeak: offPeakBuckets,
      last: { turn, step, tariff, buckets },
    };
  };

  return {
    key: 'deepseekCost',
    stateVersion: 1,
    // The projection registry only requires a Standard-Schema-shaped `parse`;
    // state is JSON by construction and the fold guards every input field.
    stateSchema: { parse: (value) => value },
    init: () => ({ route: null, peak: zeroBuckets(), offPeak: zeroBuckets(), last: null }),
    apply,
    wire: {
      viewSchema: { parse: (value) => value },
      view: (state) => viewOf(state, overrides, updatedAt, checkedAt),
    },
  };
}

/** Required Host services: only the session-projection registry. */
export const inject = ['sessionProjections'];

/**
 * Register the `deepseekCost` projection on the loaded profile.
 * Price precedence: the row's `config.prices` table, then `prices.json` beside
 * this module, then the built-in `DEFAULT_PRICES` fallback.
 * @param {object} ctx - Host plugin context.
 * @param {object|undefined} config - loader row config; optional `prices` table.
 */
export function apply(ctx, config) {
  const file = loadPriceFile();
  const overrides = priceTable(config && typeof config === 'object' ? config.prices : undefined) ?? (file && file.models);
  ctx.sessionProjections.register(costProjection(overrides, file && file.updatedAt, file && file.checkedAt));
}

export { costProjection, viewOf, isPeakTime, loadPriceFile, DEFAULT_PRICES };
