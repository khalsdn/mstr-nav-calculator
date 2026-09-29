// Cloudflare Worker that relays Robinhood's MSTR price with CORS headers, so the
// calculator can show Robinhood's 24-hour price without a browser extension.
// It only ever fetches this one URL, so it cannot be used as an open proxy.
// Deploy steps: see proxy/README.md

const ROBINHOOD_MSTR_URL =
  'https://bonfire.robinhood.com/instruments/8249abab-d19e-449d-bd80-1c18e24f491c/detail-page-live-updating-data/?display_span=day&hide_extended_hours=false';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    try {
      const upstream = await fetch(ROBINHOOD_MSTR_URL, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
        },
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  },
};
