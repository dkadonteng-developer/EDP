/**
 * hubtel-sms-worker.js
 *
 * Cloudflare Worker that proxies "send SMS" requests to Hubtel, so the
 * Hubtel Client ID / Client Secret never has to live in the browser. The
 * GHACEM inventory.html page calls this Worker's URL instead of calling
 * Hubtel directly.
 *
 * ---- Deploy steps (all free, no credit card needed for this tier) ----
 * 1. Go to https://dash.cloudflare.com/ and sign up (free account).
 * 2. In the left sidebar: Workers & Pages > Create > Create Worker.
 *    Give it any name, e.g. "ghacem-sms-proxy".
 * 3. Click "Edit code" and replace the default contents with this whole
 *    file, then click "Deploy".
 * 4. Go to the Worker's Settings > Variables and add these as
 *    "Secret" (not plain text) environment variables:
 *      HUBTEL_CLIENT_ID      = your Hubtel Client ID
 *      HUBTEL_CLIENT_SECRET  = your Hubtel Client Secret
 *      HUBTEL_SENDER_ID      = the sender name Hubtel approved for you
 *                              (e.g. "GHACEM"), max 11 characters
 *      ALLOWED_ORIGIN        = https://your-github-pages-domain.com
 *                              (locks the Worker to only accept requests
 *                              from your site — see CORS check below)
 * 5. Copy the Worker's URL (shown at the top of its page, looks like
 *    https://ghacem-sms-proxy.YOUR-SUBDOMAIN.workers.dev) and paste it
 *    into SMS_PROXY_URL near the top of inventory.html's <script> block,
 *    with /send-sms appended, e.g.:
 *      https://ghacem-sms-proxy.YOUR-SUBDOMAIN.workers.dev/send-sms
 *
 * Hubtel SMS API docs (for reference / troubleshooting):
 * https://developers.hubtel.com/docs/send-quick-sms
 */

export default {
  async fetch(request, env) {
    // Only accept POSTs to /send-sms — anything else gets a 404.
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    if (url.pathname !== '/send-sms' || request.method !== 'POST') {
      return new Response('Not found', { status: 404 });
    }

    // Basic origin check so random sites can't ride on your Hubtel
    // balance. This isn't unbeatable (a determined caller can fake an
    // Origin header from a server), but it stops casual abuse from
    // someone who just reads your page source.
    const origin = request.headers.get('Origin') || '';
    if (env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN) {
      return new Response('Forbidden', { status: 403, headers: corsHeaders(env) });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Invalid JSON body', { status: 400, headers: corsHeaders(env) });
    }

    const { to, message } = body || {};
    if (!to || !message) {
      return new Response('Missing "to" or "message"', { status: 400, headers: corsHeaders(env) });
    }

    // Basic rate limit: cap message length so a bad request can't rack up
    // an unexpectedly large multi-part SMS bill.
    const trimmedMessage = String(message).slice(0, 480);

    const hubtelUrl = new URL('https://smsc.hubtel.com/v1/messages/send');
    hubtelUrl.searchParams.set('clientid', env.HUBTEL_CLIENT_ID);
    hubtelUrl.searchParams.set('clientsecret', env.HUBTEL_CLIENT_SECRET);
    hubtelUrl.searchParams.set('from', env.HUBTEL_SENDER_ID);
    hubtelUrl.searchParams.set('to', to);
    hubtelUrl.searchParams.set('content', trimmedMessage);

    try {
      const hubtelRes = await fetch(hubtelUrl.toString(), { method: 'GET' });
      const hubtelJson = await hubtelRes.json().catch(() => ({}));

      if (!hubtelRes.ok) {
        console.error('Hubtel send failed', hubtelRes.status, hubtelJson);
        return new Response(JSON.stringify({ ok: false, error: 'Hubtel rejected the request' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
      });
    } catch (err) {
      console.error('Worker -> Hubtel request failed', err);
      return new Response(JSON.stringify({ ok: false, error: 'Could not reach Hubtel' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
      });
    }
  },
};

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
