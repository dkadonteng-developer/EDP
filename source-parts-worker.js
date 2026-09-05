// source-parts-worker.js — InfoPort Spare Parts Sourcing (Cloudflare Worker)
//
// Host-agnostic twin of api/source-parts.js. Runs on its own
// *.workers.dev (or custom) domain, so it works no matter where
// source-parts.html itself is deployed — Vercel, Cloudflare Pages,
// Firebase Hosting, Netlify, anywhere.
//
// Deploy (same pattern as hubtel-sms-worker.js):
//   1. `npx wrangler deploy source-parts-worker.js` (or paste into the
//      Cloudflare dashboard: Workers & Pages -> Create -> paste code)
//   2. Set the secret:  npx wrangler secret put SERPAPI_KEY
//      (or Dashboard -> your Worker -> Settings -> Variables -> Encrypt)
//   3. Note the resulting URL, e.g. https://source-parts.<subdomain>.workers.dev
//   4. In source-parts.html, set SOURCE_PARTS_API_URL to that URL + /source-parts
//
// In production, tighten ALLOWED_ORIGIN below to your real site's origin
// instead of "*", the same way you'd lock down any other public endpoint.

const ALLOWED_ORIGIN = '*'; // e.g. 'https://edp-omega.vercel.app'

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    ...extra,
  };
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(extraHeaders) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed. Use GET.' }, 405);
    }

    const apiKey = env.SERPAPI_KEY;
    if (!apiKey) {
      return json({
        error: 'config_missing',
        message:
          'Sourcing search is not configured yet — SERPAPI_KEY secret is missing on this Worker. ' +
          'Run `wrangler secret put SERPAPI_KEY` (or set it in the dashboard), then redeploy.',
      }, 500);
    }

    const params = url.searchParams;
    const freeText = (params.get('q') || '').trim();
    const composed = [params.get('modelNumber'), params.get('partName'), params.get('category')]
      .filter(Boolean).join(' ').trim();
    const query = freeText || composed;

    if (!query) {
      return json({ error: 'bad_request', message: 'Provide a part name/model number, or a free-text query (q=).' }, 400);
    }
    if (query.length > 200) {
      return json({ error: 'bad_request', message: 'Query is too long.' }, 400);
    }

    const serpParams = new URLSearchParams({
      engine: 'google_shopping',
      q: query,
      api_key: apiKey,
      gl: params.get('gl') || 'gh',
      hl: 'en',
    });

    try {
      const upstream = await fetch(`https://serpapi.com/search.json?${serpParams.toString()}`);
      const data = await upstream.json();

      if (!upstream.ok) {
        console.error('SerpApi error', upstream.status, data);
        return json({ error: 'upstream_error', message: data.error || 'The supplier search service returned an error.' }, 502);
      }

      const raw = Array.isArray(data.shopping_results) ? data.shopping_results : [];

      const results = raw
        .map((r) => ({
          title: r.title || 'Untitled listing',
          price: r.price || null,
          extractedPrice: typeof r.extracted_price === 'number' ? r.extracted_price : null,
          source: r.source || 'Unknown supplier',
          link: r.product_link || r.link || null,
          thumbnail: r.thumbnail || null,
          rating: typeof r.rating === 'number' ? r.rating : null,
          reviews: typeof r.reviews === 'number' ? r.reviews : null,
          delivery: r.delivery || null,
          condition: r.second_hand_condition || null,
        }))
        .filter((r) => r.link);

      results.sort((a, b) => {
        if (a.extractedPrice == null && b.extractedPrice == null) return 0;
        if (a.extractedPrice == null) return 1;
        if (b.extractedPrice == null) return -1;
        return a.extractedPrice - b.extractedPrice;
      });

      return json(
        { query, count: results.length, results, searchedAt: new Date().toISOString() },
        200,
        { 'Cache-Control': 's-maxage=600, stale-while-revalidate=300' },
      );
    } catch (err) {
      console.error('source-parts worker failed', err);
      return json({ error: 'server_error', message: 'Sourcing search failed. Please try again.' }, 500);
    }
  },
};
