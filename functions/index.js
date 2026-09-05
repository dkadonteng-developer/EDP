// functions/index.js — InfoPort Spare Parts Sourcing (Firebase Cloud Functions, 2nd gen)
//
// Third host-agnostic-in-spirit twin of api/source-parts.js /
// source-parts-worker.js — same logic, deployed as a Cloud Function
// instead. Natural fit since InfoPort already uses Firebase for
// Auth/Firestore, so this keeps the SERPAPI_KEY secret in the same
// project rather than adding a new provider.
//
// IMPORTANT: Cloud Functions requires the Firebase project to be on the
// pay-as-you-go "Blaze" plan (the free "Spark" plan can't deploy
// functions or make outbound calls to non-Google domains like
// serpapi.com). Blaze has a generous free monthly quota, so actual cost
// for this feature's volume should be $0 — but billing must be enabled
// on the project first.
//
// Deploy:
//   1. cd into the repo root (where firebase.json lives)
//   2. firebase functions:secrets:set SERPAPI_KEY
//   3. firebase deploy --only functions
//   4. Copy the trigger URL printed in the deploy output — it'll look
//      like https://sourceparts-xxxxxxxxxx-uc.a.run.app (2nd gen) —
//      and use that as SOURCE_PARTS_API_URL in source-parts.html.

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const SERPAPI_KEY = defineSecret('SERPAPI_KEY');

exports.sourceParts = onRequest(
  { secrets: [SERPAPI_KEY], cors: true },
  async (req, res) => {
    if (req.method !== 'GET') {
      res.set('Allow', 'GET');
      res.status(405).json({ error: 'Method not allowed. Use GET.' });
      return;
    }

    const apiKey = SERPAPI_KEY.value();
    if (!apiKey) {
      res.status(500).json({
        error: 'config_missing',
        message:
          'Sourcing search is not configured yet — SERPAPI_KEY secret is missing. ' +
          'Run `firebase functions:secrets:set SERPAPI_KEY`, then redeploy.',
      });
      return;
    }

    const { q, partName, modelNumber, category, gl } = req.query;
    const freeText = typeof q === 'string' ? q.trim() : '';
    const composed = [modelNumber, partName, category].filter(Boolean).join(' ').trim();
    const query = freeText || composed;

    if (!query) {
      res.status(400).json({ error: 'bad_request', message: 'Provide a part name/model number, or a free-text query (q=).' });
      return;
    }
    if (query.length > 200) {
      res.status(400).json({ error: 'bad_request', message: 'Query is too long.' });
      return;
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
        res.status(502).json({ error: 'upstream_error', message: data.error || 'The supplier search service returned an error.' });
        return;
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

      // Skyscanner-style: cheapest first, no-price listings sort last.
      results.sort((a, b) => {
        if (a.extractedPrice == null && b.extractedPrice == null) return 0;
        if (a.extractedPrice == null) return 1;
        if (b.extractedPrice == null) return -1;
        return a.extractedPrice - b.extractedPrice;
      });

      res.set('Cache-Control', 'public, max-age=600');
      res.status(200).json({
        query,
        count: results.length,
        results,
        searchedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('sourceParts function failed', err);
      res.status(500).json({ error: 'server_error', message: 'Sourcing search failed. Please try again.' });
    }
  },
);
