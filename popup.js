// popup.js — Shadow Shopper Agent
// Extracted from popup.html to comply with Chrome Extension Manifest V3 CSP.
// No inline scripts are allowed; all logic lives here and is loaded via
//   <script src="popup.js" defer></script>
"use strict";

// ── DOM helpers ───────────────────────────────────────────────────────────────

const el   = (id)              => document.getElementById(id);
const show = (id, display = 'flex') => { const e = el(id); e.classList.remove('hidden'); e.style.display = display; };
const hide = (id)              => { el(id).classList.add('hidden'); el(id).style.display = ''; };

// ── Scan step labels ──────────────────────────────────────────────────────────

const STEPS = [
  'Scraping product DOM…',
  'Extracting review nodes…',
  'Running NLP sentiment pass…',
  'Checking supply chain signals…',
  'Computing composite fraud score…',
  'Finalising report…',
];

// ── Keyword lists ─────────────────────────────────────────────────────────────

const NEG_KW = [
  'fake', 'counterfeit', 'broke', 'broken', 'defective', 'scam', 'fraud',
  'not as described', 'misleading', 'refund', 'return', 'stopped working',
  'fell apart', 'terrible', 'horrible', 'awful', 'worst', 'useless',
  'poor quality', 'waste', 'disappointed', 'cheap', 'replica',
];

const POS_KW = [
  'genuine', 'authentic', 'love', 'great', 'excellent', 'amazing', 'perfect',
  'highly recommend', 'worth it', 'durable', 'quality', 'exactly as described',
];

// ── Review analysis ───────────────────────────────────────────────────────────

function analyzeReviews(reviews) {
  const total      = reviews.length || 1;
  const unverified = reviews.filter(r => !r.verified).length;
  const unvPct     = Math.round((unverified / total) * 100);

  let negHits = 0, posHits = 0;
  const foundNeg = new Set();

  reviews.forEach(r => {
    const txt = (r.title + ' ' + r.body).toLowerCase();
    NEG_KW.forEach(kw => { if (txt.includes(kw)) { negHits++; foundNeg.add(kw); } });
    POS_KW.forEach(kw => { if (txt.includes(kw)) posHits++; });
  });

  const negRatio       = negHits / (total * NEG_KW.length);
  const sentimentScore = Math.min(Math.round(negRatio * 100 * 3.5), 92);

  const flags = [];
  const f = (text, severity) => flags.push({ text, severity });

  if (foundNeg.has('fake') || foundNeg.has('counterfeit') || foundNeg.has('replica'))
    f('Multiple reviews report counterfeit or replica product', 'danger');
  if (foundNeg.has('scam') || foundNeg.has('fraud'))
    f('Reviews contain explicit scam or fraud language', 'danger');
  if (foundNeg.has('not as described') || foundNeg.has('misleading'))
    f('Product may not match the listing description', 'danger');
  if (unvPct > 45)
    f(`${unvPct}% of reviews are from unverified purchases`, 'warning');
  if (foundNeg.has('broke') || foundNeg.has('broken') || foundNeg.has('defective') || foundNeg.has('stopped working'))
    f('Recurring complaints about early failure or defects', 'warning');
  if (foundNeg.has('refund') || foundNeg.has('return'))
    f('High volume of refund / return mentions in reviews', 'warning');
  if (reviews.length > 0 && reviews.length < 4)
    f('Very few reviews — insufficient sample for confidence', 'info');
  if (reviews.length === 0)
    f('No reviews scraped — listing may be new or sparse', 'info');

  return { sentimentScore, flags, unvPct, negHits, posHits };
}

// ── Dropship detection ────────────────────────────────────────────────────────

function detectDropship(data) {
  const title   = (data.title || '').toLowerCase();
  const signals = [];
  let score     = 18;

  if (!data.price)
    { score += 15; signals.push({ text: 'No clear price listed on page',            risk: true  }); }
  if (data.reviews.length === 0)
    { score += 22; signals.push({ text: 'Zero reviews — brand-new or ghost listing', risk: true  }); }
  if (/wholesale|bulk|lot of|combo pack/.test(title))
    { score += 24; signals.push({ text: 'Wholesale / bulk language detected in title', risk: true }); }

  const unvRatio = data.reviews.filter(r => !r.verified).length / (data.reviews.length || 1);
  if (unvRatio > 0.55)
    { score += 18; signals.push({ text: 'Majority of reviews are unverified purchases', risk: true  }); }
  if (data.reviews.length > 6)
    { score -= 12; signals.push({ text: 'Established review history present',          risk: false }); }
  if (data.rating && parseFloat(data.rating) > 4.2 && data.reviews.length > 10)
    { score -= 8;  signals.push({ text: 'Strong rating across large review sample',    risk: false }); }

  score = Math.max(5, Math.min(95, score));

  const query   = encodeURIComponent((data.title || '').split(' ').slice(0, 7).join(' '));
  const altLink = `https://www.aliexpress.com/wholesale?SearchText=${query}`;

  return { score, signals, altLink, showAlt: score > 38 };
}

// ── Risk meter ────────────────────────────────────────────────────────────────

function setRiskMeter(score) {
  const CIRC   = 2 * Math.PI * 37; // ≈ 232.5
  const offset = CIRC * (1 - score / 100);
  const ring   = el('risk-ring');
  const svg    = el('ring-svg');

  let color, label, bClass, bText;
  if      (score >= 68) { color = '#ff2244'; label = 'HIGH RISK';     bClass = 'badge-danger'; bText = 'AVOID THIS ITEM';      }
  else if (score >= 38) { color = '#ffaa00'; label = 'MODERATE RISK'; bClass = 'badge-warn';   bText = 'PROCEED WITH CAUTION'; }
  else                  { color = '#00ff88'; label = 'LOW RISK';      bClass = 'badge-safe';   bText = 'SAFE TO BUY';          }

  ring.setAttribute('stroke-dashoffset', offset.toFixed(2));
  ring.setAttribute('stroke', color);
  svg.style.setProperty('--rc', color);

  el('risk-num').textContent   = score;
  el('risk-num').style.color   = color;
  el('risk-label').textContent = label;
  el('risk-label').style.color = color;
  el('risk-badge').className   = `badge ${bClass}`;
  el('risk-badge').textContent = bText;
}

// ── Mini breakdown bars ───────────────────────────────────────────────────────

function renderBars(items) {
  el('risk-bars').innerHTML = items.map(({ label, val, color }) => `
    <div>
      <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
        <span style="font-size:8.5px;color:#4a5575;">${label}</span>
        <span class="mono" style="font-size:8.5px;color:#5a6580;">${val}%</span>
      </div>
      <div style="height:3px;background:rgba(255,255,255,.05);border-radius:99px;overflow:hidden;">
        <div style="height:100%;width:${val}%;background:${color};border-radius:99px;transition:width 1.1s ease;"></div>
      </div>
    </div>`).join('');
}

// ── Red flag cards ────────────────────────────────────────────────────────────

const FLAG_ICON   = { danger: '🔴', warning: '🟡', info: '🔵' };
const FLAG_BORDER = { danger: 'rgba(255,34,68,.15)', warning: 'rgba(255,170,0,.15)', info: 'rgba(0,212,255,.12)' };
const FLAG_BG     = { danger: 'rgba(255,34,68,.05)', warning: 'rgba(255,170,0,.05)', info: 'rgba(0,212,255,.05)' };

function renderFlags(flags) {
  const list = el('flags-list');
  list.innerHTML = '';
  if (!flags.length) { show('no-flags', 'flex'); return; }
  hide('no-flags');
  flags.forEach(({ text, severity }, i) => {
    const div = document.createElement('div');
    div.className   = 'flag-item';
    div.style.cssText = [
      'display:flex', 'align-items:flex-start', 'gap:7px',
      'padding:6px 8px', 'border-radius:8px',
      `background:${FLAG_BG[severity]}`,
      `border:1px solid ${FLAG_BORDER[severity]}`,
      `animation-delay:${i * 0.07}s`,
    ].join(';');
    div.innerHTML = `
      <span style="font-size:11px;flex-shrink:0;line-height:1.5;">${FLAG_ICON[severity]}</span>
      <span style="font-size:10px;color:#94a3b8;line-height:1.55;">${text}</span>`;
    list.appendChild(div);
  });
}

// ── Supply chain signals ──────────────────────────────────────────────────────

function renderSignals(signals) {
  el('ds-signals').innerHTML = signals.map(({ text, risk }) => `
    <div style="display:flex;align-items:center;gap:6px;">
      <span style="font-size:9px;color:${risk ? '#ff4466' : '#00ff88'};">${risk ? '▲' : '▼'}</span>
      <span style="font-size:10px;color:#64748b;">${text}</span>
    </div>`).join('');
}

// ── Platform price-comparison hub ────────────────────────────────────────────
//
// Each entry defines one comparison platform: its search URL template,
// display metadata, and colour scheme. Add new platforms here freely.

const PLATFORMS = [
  {
    id:      'daraz-np',
    name:    'Daraz Nepal',
    tagline: 'Largest South-Asian marketplace',
    icon:    '🏪',
    label:   'NPR',
    color:   '#e8002d',
    bg:      'rgba(232,0,45,.09)',
    border:  'rgba(232,0,45,.20)',
    url:     (q) => `https://www.daraz.com.np/catalog/?q=${q}`,
  },
  {
    id:      'flipkart',
    name:    'Flipkart',
    tagline: 'India\'s leading e-commerce',
    icon:    '📦',
    label:   'INR',
    color:   '#2874f0',
    bg:      'rgba(40,116,240,.10)',
    border:  'rgba(40,116,240,.22)',
    url:     (q) => `https://www.flipkart.com/search?q=${q}`,
  },
  {
    id:      'ebay',
    name:    'eBay',
    tagline: 'Competitive auction & buy-now',
    icon:    '🏷️',
    label:   'USD',
    color:   '#e5a00d',
    bg:      'rgba(229,160,13,.09)',
    border:  'rgba(229,160,13,.20)',
    url:     (q) => `https://www.ebay.com/sch/i.html?_nkw=${q}`,
  },
];

/**
 * Strips noise from a raw product title and returns a clean, short search
 * query suitable for all platforms.
 *
 * Strategy:
 *   1. Remove parenthetical/bracketed content  ("(2-Pack)", "[Renewed]")
 *   2. Remove common marketing/logistics words
 *   3. Collapse whitespace
 *   4. Keep first 6 meaningful words only
 *
 * @param   {string} title  Raw product title
 * @returns {string}        Clean query string (un-encoded)
 */
function sanitizeProductQuery(title) {
  if (!title) return '';

  const NOISE = [
    'pack','packs','set','sets','lot','bundle','bundles','combo','piece','pcs',
    'renewed','certified','refurbished','new','original','genuine','official',
    'edition','version','series','gen','generation','pro','max','ultra','plus',
    'inch','inches','cm','mm','gb','tb','mb','hz','mah','wh','w','v',
    'brand','model','type','size','color','colour','black','white','silver',
    'gold','blue','red','green','pink','with','and','for','the','in','of',
  ];

  const noiseRx = new RegExp(
    '\\b(' + NOISE.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
    'gi'
  );

  return title
    .replace(/[\[\(][^\]\)]{0,40}[\]\)]/g, '')   // strip bracketed content
    .replace(/[,|/\\:;!?*"'`~_]/g, ' ')            // punctuation → space
    .replace(noiseRx, ' ')                          // remove noise words
    .replace(/\s{2,}/g, ' ')                        // collapse whitespace
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(' ');
}

/**
 * Builds and injects the multi-platform comparison rows into #alt-platforms-list.
 * Shows the section when dropship probability is high enough; hides it otherwise.
 *
 * @param {string} title     Raw product title from the scrape result
 * @param {object} dropship  Output of detectDropship()
 */
function renderPlatformLinks(title, dropship) {
  if (!dropship.showAlt) {
    hide('alt-section');
    return;
  }

  const cleanQuery = sanitizeProductQuery(title);
  if (!cleanQuery) {
    hide('alt-section');
    return;
  }

  const encodedQuery = encodeURIComponent(cleanQuery);
  const list         = el('alt-platforms-list');
  list.innerHTML     = '';

  PLATFORMS.forEach((p, i) => {
    const href = p.url(encodedQuery);

    const row = document.createElement('div');
    row.className   = 'platform-row';
    row.style.animationDelay = `${i * 0.06}s`;
    row.innerHTML = [
      `<div class="platform-icon" style="background:${p.bg};border:1px solid ${p.border};">`,
        p.icon,
      `</div>`,
      `<div style="flex:1;min-width:0;">`,
        `<div style="display:flex;align-items:center;gap:5px;margin-bottom:2px;">`,
          `<span style="font-size:11px;font-weight:600;color:#e2e8f0;">${p.name}</span>`,
          `<span class="mono" style="`,
            `font-size:7.5px;font-weight:700;padding:1px 5px;border-radius:99px;`,
            `letter-spacing:.07em;background:${p.bg};border:1px solid ${p.border};color:${p.color};">`,
            p.label,
          `</span>`,
        `</div>`,
        `<div style="font-size:9px;color:#3a4566;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:168px;">`,
          p.tagline,
        `</div>`,
      `</div>`,
      `<a href="${href}" target="_blank" rel="noopener noreferrer" class="platform-check-btn"`,
         `style="color:${p.color};border-color:${p.border};background:${p.bg};">`,
        `CHECK&nbsp;→`,
      `</a>`,
    ].join('');

    list.appendChild(row);
  });

  show('alt-section', 'block');
}

// ── Render full results ───────────────────────────────────────────────────────

// ISO code → subtle display colour
const CURRENCY_COLORS = {
  USD: '#00d4ff', CAD: '#00d4ff', AUD: '#00d4ff', NZD: '#00d4ff', HKD: '#00d4ff', SGD: '#00d4ff',
  EUR: '#a78bfa', GBP: '#a78bfa', CHF: '#a78bfa',
  INR: '#fb923c', NPR: '#fb923c', PKR: '#fb923c', LKR: '#fb923c',
  JPY: '#f472b6', CNY: '#f472b6', KRW: '#f472b6',
  BRL: '#34d399', ZAR: '#34d399', MYR: '#34d399', IDR: '#34d399',
};

// Human-readable data-source labels shown in the product card header
const SOURCE_LABELS = {
  'json-ld':      'JSON-LD ✓',
  'json-ld+dom':  'JSON-LD + DOM',
  'dom':          'DOM',
  'regex-fallback': 'REGEX SCAN',
  'partial':      'PARTIAL',
};

function renderResults(data) {
  // ── Product strip ──────────────────────────────────────────────────────────
  el('r-title').textContent = data.title || 'Product title not found';

  // Price
  el('r-price').textContent = data.price || '—';

  // Currency ISO badge
  const currEl    = el('r-currency');
  const isoCode   = (data.priceCurrency || '').toUpperCase();
  if (isoCode) {
    currEl.textContent        = isoCode;
    currEl.style.display      = 'inline-block';
    currEl.style.color        = CURRENCY_COLORS[isoCode] || '#94a3b8';
    currEl.style.borderColor  = (CURRENCY_COLORS[isoCode] || '#94a3b8') + '44';
    currEl.style.background   = (CURRENCY_COLORS[isoCode] || '#94a3b8') + '11';
  } else {
    currEl.style.display = 'none';
  }

  // Data-source indicator (subtle, top-right of product card)
  const srcEl = el('r-data-source');
  if (srcEl) {
    srcEl.textContent = data.dataSource ? 'via ' + (SOURCE_LABELS[data.dataSource] || data.dataSource) : '';
  }

  el('r-rating').textContent = data.rating
    ? `⭐ ${data.rating}${data.ratingCount ? ' · ' + data.ratingCount : ''}`
    : '';

  const analysis = analyzeReviews(data.reviews);
  const dropship = detectDropship(data);

  const risk = Math.min(Math.round(analysis.sentimentScore * 0.58 + dropship.score * 0.42), 97);
  setRiskMeter(risk);

  renderBars([
    {
      label: 'Sentiment Risk',
      val:   Math.min(analysis.sentimentScore, 99),
      color: analysis.sentimentScore > 60 ? '#ff2244' : analysis.sentimentScore > 30 ? '#ffaa00' : '#00ff88',
    },
    {
      label: 'Dropship Probability',
      val:   dropship.score,
      color: dropship.score > 60 ? '#ff2244' : dropship.score > 35 ? '#ffaa00' : '#00ff88',
    },
    {
      label: 'Unverified Reviews',
      val:   analysis.unvPct,
      color: analysis.unvPct > 55 ? '#ff2244' : analysis.unvPct > 30 ? '#ffaa00' : '#3b82f6',
    },
  ]);

  el('r-review-count').textContent = `${data.reviews.length} REVIEWS ANALYZED`;
  renderFlags(analysis.flags);

  // Dropship bar + badge
  el('ds-bar').style.width = dropship.score + '%';
  const [dClass, dText] = dropship.score >= 65
    ? ['badge-danger', 'LIKELY DROPSHIPPED']
    : dropship.score >= 35
    ? ['badge-warn',   'POSSIBLY DROPSHIPPED']
    : ['badge-safe',   'DIRECT SELLER'];
  el('ds-badge').className   = `badge ${dClass}`;
  el('ds-badge').textContent = dText;
  renderSignals(dropship.signals);

  // Multi-platform price comparison hub
  renderPlatformLinks(data.title, dropship);

  // Header status dot
  const dotColor = risk >= 68 ? '#ff3355' : risk >= 38 ? '#ffaa00' : '#00ff88';
  const dotLabel = risk >= 68 ? 'HIGH RISK' : risk >= 38 ? 'CAUTION'  : 'SAFE';
  el('hdr-status').innerHTML = `
    <div style="width:6px;height:6px;border-radius:50%;background:${dotColor};box-shadow:0 0 6px ${dotColor};"></div>
    <span class="mono" style="font-size:8.5px;color:${dotColor};">${dotLabel}</span>`;
}

// ── Progress animation ────────────────────────────────────────────────────────

function runProgress(onDone) {
  let pct = 0, stepIdx = 0;
  const pctEl  = el('scan-pct');
  const stepEl = el('scan-step');

  const iv = setInterval(() => {
    pct = Math.min(pct + Math.floor(Math.random() * 7 + 2), 99);
    pctEl.textContent = pct + '%';

    const s = Math.min(Math.floor((pct / 100) * STEPS.length), STEPS.length - 1);
    if (s !== stepIdx) { stepIdx = s; stepEl.textContent = STEPS[stepIdx]; }

    if (pct >= 99) {
      clearInterval(iv);
      pctEl.textContent  = '100%';
      stepEl.textContent = 'Analysis complete ✓';
      setTimeout(onDone, 380);
    }
  }, 55);
}

// ── Display results ───────────────────────────────────────────────────────────

function displayResults(data) {
  renderResults(data);
  hide('state-scanning');
  show('state-results', 'block');
  el('state-results').classList.add('fade-up');
  el('scan-btn').disabled  = false;
  el('scan-btn').innerHTML = '⬡ &nbsp;RE-SCAN PAGE';
}

// ── Demo fallback (shown when not on Amazon) ──────────────────────────────────

function showDemo() {
  const demo = {
    title:         'Wireless Earbuds X200 — Noise Cancelling 40H IPX7 True Wireless (DEMO DATA)',
    price:         '$18.99',
    priceCurrency: 'USD',
    dataSource:    'demo',
    rating:        '3.6 out of 5 stars',
    ratingCount:   '2,341 ratings',
    reviews: [
      { title: 'Fake product!',        body: 'Counterfeit item. Broke after two days.',          rating: '1 out of 5 stars', verified: false },
      { title: 'Great value',          body: 'Amazing sound quality, highly recommend!',          rating: '5 out of 5 stars', verified: true  },
      { title: 'Not as described',     body: 'Product is misleading. Asked for a refund.',        rating: '1 out of 5 stars', verified: false },
      { title: 'Stopped working',      body: 'Defective unit. Terrible quality.',                 rating: '2 out of 5 stars', verified: false },
      { title: 'Love them!',           body: 'Perfect fit and great sound. Worth every penny.',   rating: '5 out of 5 stars', verified: true  },
      { title: 'Scam seller',          body: 'This is a scam. Replica product, not genuine.',     rating: '1 out of 5 stars', verified: false },
      { title: 'Returned immediately', body: 'Broke within a week. Returned immediately.',        rating: '1 out of 5 stars', verified: false },
    ],
  };
  runProgress(() => displayResults(demo));
}

// ── Scan button ───────────────────────────────────────────────────────────────

el('scan-btn').addEventListener('click', () => {
  hide('state-initial');
  hide('state-results');
  show('state-scanning', 'flex');

  el('scan-btn').disabled     = true;
  el('scan-btn').textContent  = 'SCANNING…';
  el('scan-pct').textContent  = '0%';
  el('scan-step').textContent = STEPS[0];

  // Route through background.js — it handles injection + Amazon URL validation.
  chrome.runtime.sendMessage({ action: 'scrape' }, (response) => {
    if (chrome.runtime.lastError || !response?.success) {
      // Not on Amazon, content script unavailable, or injection failed → demo
      showDemo();
      return;
    }
    runProgress(() => displayResults(response.data));
  });
});

// ── On load: check storage for a prior scrape ─────────────────────────────────
// The result is stored by content.js after every successful scrape.
// We surface it silently; the user must re-click Scan to refresh.
chrome.storage.local.get('lastScrape', ({ lastScrape }) => {
  if (lastScrape && lastScrape.title) {
    // Optional: could auto-render here. Currently intentionally left idle.
  }
});
