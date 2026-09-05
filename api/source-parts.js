// /api/source-parts — InfoPort Spare Parts Sourcing
//
// Given a part's name/model number, queries a live shopping search API
// (SerpApi's Google Shopping engine) and returns listings sorted by price,
// ascending — the same idea as a flight-comparison site, but for spare
// parts: procurement gets a ranked shortlist of OEM/aftermarket sources
// instead of having to Google each part by hand.
//
// Requires the SERPAPI_KEY environment variable to be set in the Vercel
// project (Project Settings -> Environment Variables). Get a free key at
// https://serpapi.com/ (100 free searches/month on the free plan).
//
// GET /api/source-parts?partName=...&modelNumber=...&category=...
//   or /api/source-parts?q=free+text+query
// Optional: &gl=us (country to search from — see SerpApi's `gl` param)

// Allows source-parts.html to call this from a different origin than
// wherever this function itself is deployed — you're not only on
// Vercel, so the page and this API may not share a domain. Tighten this
// to your real site's origin instead of '*' once you know it, the same
// way you would for any other public endpoint.
const ALLOWED_ORIGIN = '*';

function withCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  return res;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    withCors(res);
    return res.status(204).end();
  }
  withCors(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'config_missing',
      message:
        'Sourcing search is not configured yet — SERPAPI_KEY is missing on the server. ' +
        'Add it under Vercel Project Settings -> Environment Variables, then redeploy.',
    });
  }

  const { q, partName, modelNumber, category, gl } = req.query;

  const freeText = typeof q === 'string' ? q.trim() : '';
  const composed = [modelNumber, partName, category].filter(Boolean).join(' ').trim();
  const query = freeText || composed;

  if (!query) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'Provide a part name/model number, or a free-text query (q=).',
    });
  }
  if (query.length > 200) {
    return res.status(400).json({ error: 'bad_request', message: 'Query is too long.' });
  }

  const params = new URLSearchParams({
    engine: 'google_shopping',
    q: query,
    api_key: apiKey,
    gl: (typeof gl === 'string' && gl) || 'us',
    hl: 'en',
  });

  try {
    const upstream = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
    const data = await upstream.json();

    if (!upstream.ok) {
      console.error('SerpApi error', upstream.status, data);
      return res.status(502).json({
        error: 'upstream_error',
        message: data.error || 'The supplier search service returned an error.',
      });
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

    // Skyscanner-style: cheapest first. Listings with no parsed price
    // (common for industrial suppliers that show "Get quote") sort last
    // rather than being dropped, since they can still be useful leads.
    results.sort((a, b) => {
      if (a.extractedPrice == null && b.extractedPrice == null) return 0;
      if (a.extractedPrice == null) return 1;
      if (b.extractedPrice == null) return -1;
      return a.extractedPrice - b.extractedPrice;
    });

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=300');
    return res.status(200).json({
      query,
      count: results.length,
      results,
      searchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('source-parts handler failed', err);
    return res.status(500).json({ error: 'server_error', message: 'Sourcing search failed. Please try again.' });
  }
};
