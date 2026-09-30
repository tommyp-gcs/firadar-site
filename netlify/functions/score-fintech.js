/**
 * score-fintech.js — FiRadar Programmatic Scoring API
 * POST /.netlify/functions/score-fintech
 *
 * Headers:
 *   x-firadar-key: <FIRADAR_API_KEY env var>
 *   Content-Type: application/json
 *
 * Body:
 *   { "url": "https://example.com", "companyName": "Example Co" }
 *
 * Response:
 *   { "companyName": "Example Co", "url": "https://example.com",
 *     "score": 742, "tier": "Competitive", "timestamp": "2026-09-29T..." }
 */

const SCORING_SYSTEM_PROMPT = `You are FiRadar's Fintech Intelligence Engine — an expert analyst benchmarking fintech companies against world-class digital financial services leaders (Chime, SoFi, Revolut, Stripe, Plaid).

You score fintechs on a 0–1000 scale across 6 dimensions. After reviewing the company's website content, output ONLY a SCORES block and nothing else.

SCORING DIMENSIONS (max points each):
1. Digital Product & UX Innovation (0–200): Mobile-first design, frictionless onboarding, personalization, real-time features, AI/ML integration
2. Business Model & Market Fit (0–200): Revenue clarity, target market definition, scalability, competitive differentiation, product-market fit evidence
3. Technology & API Infrastructure (0–150): Tech stack signals, API-first architecture, security/compliance mentions, integration ecosystem, infrastructure maturity
4. Financial Inclusion & Accessibility (0–150): Underserved market focus, low/no fee structures, multilingual support, accessibility features, community impact
5. Regulatory Compliance & Trust Signals (0–150): Licensing mentions, security certifications, privacy policy quality, regulatory partnerships, transparency
6. Growth Traction & Ecosystem Position (0–150): Partnership signals, customer testimonials, press/awards, geographic expansion, investor backing signals

IMPORTANT: Score based ONLY on what is visible on the website. If information is absent, score conservatively. Do not assume capabilities not shown.

After analysis, output EXACTLY this block and nothing else:
SCORES
Digital_Product_UX: [0-200]
Business_Model: [0-200]
Technology_Infrastructure: [0-150]
Financial_Inclusion: [0-150]
Regulatory_Trust: [0-150]
Growth_Traction: [0-150]
END_SCORES`;

function parseTier(score) {
  if (score >= 850) return 'Elite';
  if (score >= 700) return 'Competitive';
  if (score >= 550) return 'Developing';
  if (score >= 400) return 'Early Stage';
  return 'Foundational';
}

function parseScores(text) {
  const match = text.match(/SCORES\s*([\s\S]*?)END_SCORES/);
  if (!match) return null;

  const block = match[1];
  const fields = {
    Digital_Product_UX: 0,
    Business_Model: 0,
    Technology_Infrastructure: 0,
    Financial_Inclusion: 0,
    Regulatory_Trust: 0,
    Growth_Traction: 0
  };

  for (const key of Object.keys(fields)) {
    const re = new RegExp(key + ':\\s*(\\d+)');
    const m = block.match(re);
    if (m) {
      fields[key] = Math.min(parseInt(m[1], 10), key === 'Digital_Product_UX' || key === 'Business_Model' ? 200 : 150);
    }
  }

  const total = Object.values(fields).reduce((a, b) => a + b, 0);
  return { dimensions: fields, total: Math.min(total, 1000) };
}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-firadar-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const apiKey = process.env.FIRADAR_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured on server' }) };
  }
  const providedKey = event.headers['x-firadar-key'] || event.headers['X-Firadar-Key'];
  if (!providedKey || providedKey !== apiKey) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let url, companyName;
  try {
    ({ url, companyName } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!url || !companyName) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'url and companyName are required' }) };
  }

  // Normalise URL
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Anthropic API key not configured' }) };
  }

  try {
    // ── Step 1: Scrape website ───────────────────────────────────────────────
    let siteContent = '';
    try {
      const scrapeRes = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000)
      });
      const html = await scrapeRes.text();
      siteContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 8000);
    } catch (scrapeErr) {
      console.warn('Scrape failed for', url, '—', scrapeErr.message, '— scoring on name only');
      siteContent = `[Website could not be fetched: ${scrapeErr.message}]`;
    }

    // ── Step 2: Score via Claude ─────────────────────────────────────────────
    const userMessage = `Company: ${companyName}
URL: ${url}

Website content:
${siteContent}

Score this fintech now. Output ONLY the SCORES block.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 300,
        system: SCORING_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }]
      }),
      signal: AbortSignal.timeout(30000)
    });

    const claudeData = await claudeRes.json();

    if (!claudeData.content || !claudeData.content[0]) {
      console.error('Claude response missing content:', JSON.stringify(claudeData));
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Scoring model returned no content' }) };
    }

    const aiText = claudeData.content[0].text || '';
    const parsed = parseScores(aiText);

    if (!parsed) {
      console.error('Could not parse SCORES block from:', aiText);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not parse score from model response', raw: aiText }) };
    }

    const cleanUrl = (() => {
      try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
    })();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        companyName,
        url: cleanUrl,
        score: parsed.total,
        tier: parseTier(parsed.total),
        timestamp: new Date().toISOString()
      })
    };

  } catch (err) {
    console.error('score-fintech error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
