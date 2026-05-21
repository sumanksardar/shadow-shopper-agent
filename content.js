// content.js — Shadow Shopper Agent · Universal Product & Review Scraper
// Triggered via chrome.runtime.sendMessage({ action: "scrape" })
//
// Data extraction priority:
//   1. JSON-LD <script type="application/ld+json"> (universal, richest signal)
//   2. Amazon-specific DOM selectors              (reliable on Amazon)
//   3. Regex monetary fallback                    (universal catch-all)
"use strict";

// ═══════════════════════════════════════════════════════════════════════════════
// CURRENCY SYMBOL → ISO 4217 MAP
// Sorted longest-first so multi-char symbols (e.g. "US$") are matched before
// their single-char prefixes (e.g. "$").
// ═══════════════════════════════════════════════════════════════════════════════

const SYMBOL_TO_ISO = {
  // Multi-char (must come first in sorted order)
  'US$':  'USD',
  'CA$':  'CAD',
  'A$':   'AUD',
  'HK$':  'HKD',
  'NZ$':  'NZD',
  'CN¥':  'CNY',
  // Single-char symbols
  'रू':   'NPR',   // Nepalese Rupee
  '₹':    'INR',   // Indian Rupee
  '₨':    'PKR',   // Pakistani Rupee
  '$':    'USD',   // US Dollar (default for bare "$")
  '€':    'EUR',   // Euro
  '£':    'GBP',   // British Pound Sterling
  '¥':    'JPY',   // Japanese Yen / Chinese Yuan (bare)
  '元':   'CNY',   // Chinese Yuan (character)
  '₩':    'KRW',   // South Korean Won
  '฿':    'THB',   // Thai Baht
  '₫':    'VND',   // Vietnamese Dong
  '₱':    'PHP',   // Philippine Peso
  '₦':    'NGN',   // Nigerian Naira
  '₴':    'UAH',   // Ukrainian Hryvnia
  '₺':    'TRY',   // Turkish Lira
  '₼':    'AZN',   // Azerbaijani Manat
  'R$':   'BRL',   // Brazilian Real
  'R':    'ZAR',   // South African Rand
  'kr':   'SEK',   // Nordic Krone (generic fallback)
  'Rp':   'IDR',   // Indonesian Rupiah
  'RM':   'MYR',   // Malaysian Ringgit
  'Rs':   'LKR',   // Sri Lankan Rupee
  'S$':   'SGD',   // Singapore Dollar
  'Fr':   'CHF',   // Swiss Franc
};

// Keys sorted longest-first to prevent partial-match false positives
const SYMBOL_KEYS = Object.keys(SYMBOL_TO_ISO).sort((a, b) => b.length - a.length);

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 1 — JSON-LD STRUCTURED DATA PARSER
// Reads every <script type="application/ld+json"> block on the page.
// Handles: Product, Offer, AggregateOffer, @graph arrays, and nested offers.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extracts name / price / priceCurrency from a single JSON-LD node.
 * Returns null if the node is not a recognised product or offer type.
 *
 * @param   {unknown} node
 * @returns {{ name:string, price:string, priceCurrency:string }|null}
 */
function extractFromJsonLdNode(node) {
  if (!node || typeof node !== 'object') return null;

  const type      = node['@type'];
  const typeStr   = Array.isArray(type) ? type.join(',') : String(type || '');
  const isProduct = /product/i.test(typeStr);
  const isOffer   = /offer/i.test(typeStr);

  if (isProduct) {
    const name = String(node.name || '').trim();
    let price = '', priceCurrency = '';

    if (node.offers) {
      const offersArr = Array.isArray(node.offers) ? node.offers : [node.offers];
      const offer     = offersArr[0] || {};
      price           = String(offer.price ?? offer.lowPrice ?? offer.highPrice ?? '').trim();
      priceCurrency   = String(offer.priceCurrency || '').trim().toUpperCase();
    }

    if (name || price) return { name, price, priceCurrency };
  }

  if (isOffer && !isProduct) {
    return {
      name:          '',
      price:         String(node.price ?? node.lowPrice ?? '').trim(),
      priceCurrency: String(node.priceCurrency || '').trim().toUpperCase(),
    };
  }

  return null;
}

/**
 * Scans all JSON-LD blocks on the current page and returns the first
 * Product / Offer match found.
 *
 * @returns {{ name:string, price:string, priceCurrency:string }|null}
 */
function scrapeJsonLd() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');

  for (const script of scripts) {
    let parsed;
    try {
      parsed = JSON.parse(script.textContent || '');
    } catch (_) {
      continue; // Malformed JSON — skip silently
    }

    // Unwrap @graph arrays (common in Yoast, Schema.org generators)
    const nodes = parsed?.['@graph']
      ? parsed['@graph']
      : Array.isArray(parsed) ? parsed : [parsed];

    for (const node of nodes) {
      const result = extractFromJsonLdNode(node);
      if (result && (result.name || result.price)) return result;

      // Recurse one level for nested item arrays (e.g. ItemList > ListItem > item)
      if (node && typeof node === 'object') {
        for (const val of Object.values(node)) {
          if (val && typeof val === 'object') {
            const nested = extractFromJsonLdNode(val);
            if (nested && (nested.name || nested.price)) return nested;
          }
        }
      }
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 2 — AMAZON DOM SCRAPERS
// Retained for maximum accuracy on Amazon product and review pages.
// ═══════════════════════════════════════════════════════════════════════════════

function scrapeProductTitle() {
  const selectors = [
    '#productTitle',
    '#title span',
    'h1.a-size-large',
    'h1#title',
    'h1[itemprop="name"]',
    'h1',
  ];
  for (const sel of selectors) {
    const node = document.querySelector(sel);
    if (node && node.textContent.trim()) return node.textContent.trim();
  }
  return document.title || '';
}

function scrapeOverallRating() {
  const node =
    document.querySelector('#acrPopover .a-icon-alt') ||
    document.querySelector("span[data-hook='rating-out-of-text']") ||
    document.querySelector('.a-icon-star .a-icon-alt') ||
    document.querySelector('[itemprop="ratingValue"]');
  return node ? node.textContent.trim() : '';
}

function scrapeRatingCount() {
  const node =
    document.querySelector('#acrCustomerReviewText') ||
    document.querySelector("span[data-hook='total-review-count']");
  return node ? node.textContent.trim() : '';
}

/**
 * Infers an ISO 4217 currency code from a raw price string by scanning
 * for known symbols and explicit ISO codes (e.g. "USD", "EUR").
 *
 * @param   {string} str
 * @returns {string} ISO code, or '' if undetectable.
 */
function detectCurrencyFromString(str) {
  for (const sym of SYMBOL_KEYS) {
    if (str.includes(sym)) return SYMBOL_TO_ISO[sym];
  }
  // Bare ISO code written in text (e.g. "18.99 USD")
  const isoMatch = str.match(/\b([A-Z]{3})\b/);
  if (isoMatch) return isoMatch[1];
  return '';
}

/**
 * Scrapes the product price from Amazon-specific DOM selectors.
 *
 * @returns {{ price:string, priceCurrency:string }}
 */
function scrapeAmazonPrice() {
  const selectors = [
    '.a-price .a-offscreen',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '#apex_desktop .a-price .a-offscreen',
    "span[data-a-color='price'] .a-offscreen",
    '.a-price-whole',
  ];
  for (const sel of selectors) {
    const node = document.querySelector(sel);
    if (node && node.textContent.trim()) {
      const raw = node.textContent.trim();
      return { price: raw, priceCurrency: detectCurrencyFromString(raw) };
    }
  }
  return { price: '', priceCurrency: '' };
}

/**
 * Scrapes all visible customer reviews on the page.
 * Works on the main product page and /product-reviews/ pages.
 *
 * @returns {Array<{ title:string, rating:string, body:string, verified:boolean }>}
 */
function scrapeReviews() {
  const containers = document.querySelectorAll(
    '[data-hook="review"], .review, .a-section.review'
  );
  if (!containers.length) return [];

  const reviews = [];
  containers.forEach((c) => {
    const titleEl =
      c.querySelector('[data-hook="review-title"] span:not(.a-icon-alt)') ||
      c.querySelector('.review-title span') ||
      c.querySelector('[data-hook="review-title"]');

    const ratingEl =
      c.querySelector('[data-hook="review-star-rating"] .a-icon-alt') ||
      c.querySelector('[data-hook="cmps-review-star-rating"] .a-icon-alt') ||
      c.querySelector('.review-rating .a-icon-alt');

    const bodyEl =
      c.querySelector('[data-hook="review-body"] span') ||
      c.querySelector('.review-text-content span') ||
      c.querySelector('[data-hook="review-body"]');

    const title    = titleEl  ? titleEl.textContent.trim()  : '';
    const rating   = ratingEl ? ratingEl.textContent.trim() : '';
    const body     = bodyEl   ? bodyEl.textContent.trim()   : '';
    const verified = !!c.querySelector('[data-hook="avp-badge"],[data-hook="avp-badge-linkless"]');

    if (title || body) reviews.push({ title, rating, body, verified });
  });
  return reviews;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 3 — REGEX MONETARY FALLBACK
// Scans the visible page text for the most prominent price pattern.
// Works on any e-commerce page regardless of platform or markup.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Builds a single RegExp that matches:
 *   SYMBOL NUMBER   — e.g.  रू 1,299  |  ₹2,499.00  |  $18.99
 *   NUMBER SYMBOL   — e.g.  18.99 USD |  2499 ₹
 *
 * The 'u' flag enables correct matching of multi-byte Unicode symbols.
 *
 * @returns {RegExp}
 */
function buildPriceRegex() {
  const esc  = (s) => s.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&');
  const syms = SYMBOL_KEYS.map(esc).join('|');
  return new RegExp(
    `(?:(${syms})\\s?([\\d][\\d,.\\s]*(?:\\.\\d{1,2})?)` +
    `|([\\d][\\d,.\\s]*(?:\\.\\d{1,2})?)\\s?(${syms}))`,
    'gu'
  );
}

/**
 * Scans document.body.innerText for monetary patterns.
 * Returns the dominant price — symbol that appears most often, first occurrence.
 *
 * @returns {{ price:string, priceCurrency:string, rawSymbol:string }|null}
 */
function scrapeMonetaryFallback() {
  const bodyText = (document.body && document.body.innerText) || '';
  if (!bodyText) return null;

  const regex   = buildPriceRegex();
  const matches = [];
  let m;

  while ((m = regex.exec(bodyText)) !== null) {
    if (m[1] && m[2]) {
      // Symbol-first pattern (e.g. "$18.99")
      matches.push({
        symbol:    m[1],
        amount:    m[2].replace(/\s/g, '').trim(),
        formatted: m[1] + m[2].replace(/\s/g, '').trim(),
      });
    } else if (m[3] && m[4]) {
      // Number-first pattern (e.g. "18.99 USD")
      matches.push({
        symbol:    m[4],
        amount:    m[3].replace(/\s/g, '').trim(),
        formatted: m[3].replace(/\s/g, '').trim() + '\u00a0' + m[4],
      });
    }
  }

  if (!matches.length) return null;

  // Tally frequency of each symbol across the page
  const freq = {};
  matches.forEach(({ symbol }) => { freq[symbol] = (freq[symbol] || 0) + 1; });
  const dominant = Object.keys(freq).reduce((a, b) => freq[a] >= freq[b] ? a : b);

  const first = matches.find((x) => x.symbol === dominant);
  if (!first) return null;

  return {
    price:         first.formatted,
    priceCurrency: SYMBOL_TO_ISO[dominant] || detectCurrencyFromString(dominant),
    rawSymbol:     dominant,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MASTER SCRAPE FUNCTION — Layered, universal strategy
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Orchestrates all three extraction layers and merges the best available data.
 *
 * @returns {{
 *   title:         string,
 *   price:         string,
 *   priceCurrency: string,
 *   rating:        string,
 *   ratingCount:   string,
 *   url:           string,
 *   scrapedAt:     string,
 *   reviews:       Array,
 *   dataSource:    'json-ld' | 'json-ld+dom' | 'dom' | 'regex-fallback' | 'partial'
 * }}
 */
function scrapeAmazonPage() {
  let title         = '';
  let price         = '';
  let priceCurrency = '';
  let dataSource    = 'dom';

  // ── Layer 1: JSON-LD ────────────────────────────────────────────────────────
  const jsonLd = scrapeJsonLd();
  if (jsonLd) {
    if (jsonLd.name)          title         = jsonLd.name;
    if (jsonLd.price)         price         = jsonLd.price;
    if (jsonLd.priceCurrency) priceCurrency = jsonLd.priceCurrency;
    dataSource = 'json-ld';
  }

  // ── Layer 2: Amazon DOM (fills gaps left by JSON-LD or missing entirely) ────
  if (!title) title = scrapeProductTitle();

  if (!price) {
    const domPrice = scrapeAmazonPrice();
    if (domPrice.price) {
      price         = domPrice.price;
      priceCurrency = priceCurrency || domPrice.priceCurrency;
      dataSource    = jsonLd ? 'json-ld+dom' : 'dom';
    }
  }

  // ── Layer 3: Regex fallback (if still no price found) ──────────────────────
  if (!price) {
    const fallback = scrapeMonetaryFallback();
    if (fallback) {
      price         = fallback.price;
      priceCurrency = fallback.priceCurrency;
      dataSource    = 'regex-fallback';
    }
  }

  // If we have a price string but no ISO code yet, try to infer from string
  if (price && !priceCurrency) {
    priceCurrency = detectCurrencyFromString(price);
  }

  return {
    title,
    price,
    priceCurrency,
    rating:      scrapeOverallRating(),
    ratingCount: scrapeRatingCount(),
    url:         window.location.href,
    scrapedAt:   new Date().toISOString(),
    reviews:     scrapeReviews(),
    dataSource,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGE LISTENER
// ═══════════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'scrape') {
    try {
      const data = scrapeAmazonPage();
      chrome.storage.local.set({ lastScrape: data });
      sendResponse({ success: true, data });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true; // Keep message channel open for async sendResponse
  }
});
