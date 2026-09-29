// Price sources that can be called straight from the browser (they send
// Access-Control-Allow-Origin), so no CORS extension is needed. Robinhood is
// the exception: it needs either a CORS extension or the proxy in /proxy.

export interface PriceQuote {
  price: number;
  source: string;
}

// Shapes of third-party responses are not guaranteed, so parsers access them defensively
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

interface PriceSource {
  name: string;
  url: string;
  body?: unknown; // sent as a JSON POST when present
  parse: (data: Json) => PriceQuote | null;
}

// Coinbase Exchange public WebSocket: pushes every BTC-USD trade in real time
export const COINBASE_WS_URL = 'wss://ws-feed.exchange.coinbase.com';
export const COINBASE_WS_SUBSCRIBE = JSON.stringify({
  type: 'subscribe',
  product_ids: ['BTC-USD'],
  channels: ['ticker'],
});

export const ROBINHOOD_MSTR_URL =
  'https://bonfire.robinhood.com/instruments/8249abab-d19e-449d-bd80-1c18e24f491c/detail-page-live-updating-data/?display_span=day&hide_extended_hours=false';

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value.replace(/[$,]/g, ''));
  return NaN;
}

function quote(price: unknown, source: string): PriceQuote | null {
  const n = toNumber(price);
  return Number.isFinite(n) && n > 0 ? { price: n, source } : null;
}

async function getJson(url: string, body?: unknown, timeoutMs = 8000): Promise<Json> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // GETs carry no custom headers, so the browser sends them without a CORS preflight
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      ...(body !== undefined && {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Try each source in order and return the first valid quote
async function fetchFirst(sources: PriceSource[]): Promise<PriceQuote> {
  const errors: string[] = [];
  for (const source of sources) {
    try {
      const result = source.parse(await getJson(source.url, source.body));
      if (result) return result;
      errors.push(`${source.name}: unexpected response`);
    } catch (error) {
      errors.push(`${source.name}: ${error instanceof Error ? error.message : String(error)}`);
      // A TypeError means the browser blocked the request (CORS) or the network failed
      if (source.url === ROBINHOOD_MSTR_URL && error instanceof TypeError) robinhoodDirectBlocked = true;
    }
  }
  throw new Error(errors.join('; '));
}

const BTC_SOURCES: PriceSource[] = [
  {
    name: 'Coinbase',
    url: 'https://api.exchange.coinbase.com/products/BTC-USD/ticker',
    parse: (d) => quote(d?.price, 'Coinbase'),
  },
  {
    name: 'Kraken',
    url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
    parse: (d) => {
      const pair = d?.result ? Object.values(d.result)[0] as { c?: string[] } : undefined;
      return quote(pair?.c?.[0], 'Kraken');
    },
  },
  {
    name: 'Binance',
    url: 'https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT',
    parse: (d) => quote(d?.price, 'Binance (USDT)'),
  },
];

// Robinhood's own detail-page price, including its 24 Hour Market. The session
// label ("Pre-market", "After-hours", ...) comes from the same payload.
function parseRobinhood(d: Json): PriceQuote | null {
  const display = d?.chart_section?.default_display;
  const session = display?.secondary_value?.description?.value;
  const label = typeof session === 'string' && session ? `Robinhood · ${session.toLowerCase()}` : 'Robinhood';
  return quote(display?.price_chart_data?.dollar_value?.amount, label);
}

// CNBC's quote service is real-time (NASDAQ last sale) and includes
// pre-market / after-hours trades in ExtendedMktQuote.
function parseCnbc(d: Json): PriceQuote | null {
  const q = d?.FormattedQuoteResult?.FormattedQuote?.[0];
  if (!q) return null;
  const ext = q.ExtendedMktQuote;
  if (ext?.last && q.curmktstatus !== 'REG_MKT') {
    return quote(ext.last, ext.type === 'PRE_MKT' ? 'CNBC · pre-market' : 'CNBC · after-hours');
  }
  return quote(q.last, 'CNBC');
}

const CNBC_SOURCE: PriceSource = {
  name: 'CNBC',
  url: 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=MSTR&requestMethod=itv&noform=0&partnerId=2&fund=1&exthrs=1&output=json&events=1',
  parse: parseCnbc,
};

// Hyperliquid's MSTR perpetual trades 24/7 and tracks the stock closely, so it
// fills the overnight / weekend gap when Robinhood is not reachable.
const HYPERLIQUID_SOURCE: PriceSource = {
  name: 'Hyperliquid',
  url: 'https://api.hyperliquid.xyz/info',
  body: { type: 'allMids', dex: 'xyz' },
  parse: (d) => quote(d?.['xyz:MSTR'], 'Hyperliquid · 24/7 perp'),
};

let robinhoodDirectBlocked = false;

// Pre-market through after-hours: Mon-Fri, 04:00-20:00 New York time
function isUsExtendedSession(now = new Date()): boolean {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(now).map((p) => [p.type, p.value])
  );
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 4 * 60 && minutes < 20 * 60;
}

export function fetchBtcPrice(): Promise<PriceQuote> {
  return fetchFirst(BTC_SOURCES);
}

export function fetchMstrQuote(robinhoodProxyUrl?: string): Promise<PriceQuote> {
  const sources: PriceSource[] = [];
  const proxyUrl = robinhoodProxyUrl?.trim();
  if (proxyUrl) {
    sources.push({ name: 'Robinhood proxy', url: proxyUrl, parse: parseRobinhood });
  }
  if (!robinhoodDirectBlocked) {
    sources.push({ name: 'Robinhood', url: ROBINHOOD_MSTR_URL, parse: parseRobinhood });
  }
  sources.push(...(isUsExtendedSession() ? [CNBC_SOURCE, HYPERLIQUID_SOURCE] : [HYPERLIQUID_SOURCE, CNBC_SOURCE]));
  return fetchFirst(sources);
}

// USD -> EUR rate
export async function fetchEurRate(): Promise<number> {
  const data = await getJson('https://api.coinbase.com/v2/exchange-rates?currency=USD');
  const rate = toNumber(data?.data?.rates?.EUR);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('unexpected response');
  return rate;
}
