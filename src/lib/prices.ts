// Price sources that can be called straight from the browser (they send
// Access-Control-Allow-Origin), so no CORS extension or proxy is needed.

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
  parse: (data: Json) => PriceQuote | null;
}

// Coinbase Exchange public WebSocket: pushes every BTC-USD trade in real time
export const COINBASE_WS_URL = 'wss://ws-feed.exchange.coinbase.com';
export const COINBASE_WS_SUBSCRIBE = JSON.stringify({
  type: 'subscribe',
  product_ids: ['BTC-USD'],
  channels: ['ticker'],
});

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value.replace(/[$,]/g, ''));
  return NaN;
}

function quote(price: unknown, source: string): PriceQuote | null {
  const n = toNumber(price);
  return Number.isFinite(n) && n > 0 ? { price: n, source } : null;
}

async function getJson(url: string, timeoutMs = 8000): Promise<Json> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // No custom headers, so the browser sends a simple request (no CORS preflight)
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
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
      const result = source.parse(await getJson(source.url));
      if (result) return result;
      errors.push(`${source.name}: unexpected response`);
    } catch (error) {
      errors.push(`${source.name}: ${error instanceof Error ? error.message : String(error)}`);
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

// Robinhood does not send CORS headers; this only works with a CORS extension
function parseRobinhood(d: Json): PriceQuote | null {
  const regularTime = Date.parse(d?.venue_last_trade_time ?? '');
  const extendedTime = Date.parse(d?.venue_last_non_reg_trade_time ?? '');
  if (d?.last_non_reg_trade_price && extendedTime > (regularTime || 0)) {
    return quote(d.last_non_reg_trade_price, 'Robinhood · extended hours');
  }
  return quote(d?.last_trade_price, 'Robinhood');
}

const MSTR_SOURCES: PriceSource[] = [
  {
    name: 'CNBC',
    url: 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=MSTR&requestMethod=itv&noform=0&partnerId=2&fund=1&exthrs=1&output=json&events=1',
    parse: parseCnbc,
  },
  {
    name: 'Robinhood',
    url: 'https://api.robinhood.com/quotes/MSTR/',
    parse: parseRobinhood,
  },
];

export function fetchBtcPrice(): Promise<PriceQuote> {
  return fetchFirst(BTC_SOURCES);
}

export function fetchMstrQuote(): Promise<PriceQuote> {
  return fetchFirst(MSTR_SOURCES);
}

// USD -> EUR rate
export async function fetchEurRate(): Promise<number> {
  const data = await getJson('https://api.coinbase.com/v2/exchange-rates?currency=USD');
  const rate = toNumber(data?.data?.rates?.EUR);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('unexpected response');
  return rate;
}
