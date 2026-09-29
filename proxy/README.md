# Robinhood proxy (optional)

Robinhood's API doesn't send CORS headers, so a web page can't read it directly.
This tiny Cloudflare Worker fetches Robinhood's MSTR price and passes it back with
CORS headers. With it, the calculator shows Robinhood's exact price, including the
overnight 24 Hour Market, without a browser extension.

Cloudflare's free plan allows 100,000 requests/day. The calculator makes ~5,760/day
per open tab (one every 15s).

## Deploy (dashboard, no install)

1. Sign up / log in at https://dash.cloudflare.com
2. **Workers & Pages → Create → Create Worker** (the "Hello World" template is fine), name it e.g. `mstr-robinhood`, click **Deploy**
3. **Edit code**, replace everything with the contents of `robinhood-worker.js`, click **Deploy**
4. Copy the worker URL, e.g. `https://mstr-robinhood.<your-subdomain>.workers.dev`
5. In the calculator, turn on **Auto** for the MSTR price and paste the URL into **Robinhood proxy URL**

## Deploy (command line)

```sh
npx wrangler login
npx wrangler deploy proxy/robinhood-worker.js --name mstr-robinhood --compatibility-date 2026-09-01
```

Open the printed URL in a browser. You should see Robinhood's JSON.
