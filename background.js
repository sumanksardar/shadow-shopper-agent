// background.js — Shadow Shopper Agent · Manifest V3 Service Worker
// ─────────────────────────────────────────────────────────────────
// Responsibilities:
//   1. Listen for extension install / update lifecycle events.
//   2. Track which tabs already have content.js injected to avoid
//      double-injection (service workers are ephemeral, so we use
//      chrome.storage.session as a lightweight in-memory registry).
//   3. Relay messages from the popup to the correct content script,
//      dynamically injecting content.js first if ANY active tab requests
//      a scrape — no domain restriction (works on Amazon, Daraz, eBay,
//      Shopify, WooCommerce, or any other e-commerce platform).
//   4. Clean up the injection registry when tabs are closed or navigate.
// ─────────────────────────────────────────────────────────────────

"use strict";

// ── Constants ─────────────────────────────────────────────────────────────────

const CONTENT_SCRIPT = "content.js";

// URL schemes that Chrome never permits scripting into.
// Everything else (http, https, file with flag, etc.) is allowed.
const UNINJECTABLE_PATTERN = /^(chrome|chrome-extension|about|data|javascript|blob):/i;

// Session-storage key that maps tabId → true when content.js is injected.
// chrome.storage.session is cleared when the browser profile session ends,
// which is exactly the right lifetime for an injection guard.
const SESSION_KEY = "injectedTabs";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the current injection registry from session storage.
 * @returns {Promise<Record<string,boolean>>}
 */
async function getInjectionRegistry() {
  const result = await chrome.storage.session.get(SESSION_KEY);
  return result[SESSION_KEY] ?? {};
}

/**
 * Marks a tab as having content.js injected.
 * @param {number} tabId
 */
async function markInjected(tabId) {
  const registry = await getInjectionRegistry();
  registry[String(tabId)] = true;
  await chrome.storage.session.set({ [SESSION_KEY]: registry });
}

/**
 * Removes a tab from the injection registry (called on tab close / navigation).
 * @param {number} tabId
 */
async function clearInjected(tabId) {
  const registry = await getInjectionRegistry();
  delete registry[String(tabId)];
  await chrome.storage.session.set({ [SESSION_KEY]: registry });
}

/**
 * Returns true if content.js is already injected into the given tab.
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
async function isInjected(tabId) {
  const registry = await getInjectionRegistry();
  return registry[String(tabId)] === true;
}

/**
 * Injects content.js into the given tab if it hasn't been injected yet.
 * Uses chrome.scripting.executeScript (Manifest V3 API).
 *
 * @param {number} tabId
 * @returns {Promise<void>}
 */
async function ensureContentScriptInjected(tabId) {
  if (await isInjected(tabId)) return; // already loaded — nothing to do

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files:  [CONTENT_SCRIPT],
    });
    await markInjected(tabId);
    console.log(`[ShadowShopper] Injected ${CONTENT_SCRIPT} into tab ${tabId}`);
  } catch (err) {
    // Injection can legitimately fail on chrome:// or restricted pages.
    console.warn(`[ShadowShopper] Could not inject into tab ${tabId}:`, err.message);
    throw err; // re-throw so caller can surface the error to the popup
  }
}

/**
 * Sends a message to content.js in the specified tab and returns the response.
 * Injects the content script first if needed.
 *
 * @param {number}  tabId
 * @param {object}  message
 * @returns {Promise<object>} content.js response
 */
async function relayToContentScript(tabId, message) {
  await ensureContentScriptInjected(tabId);
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ── Lifecycle: Install / Update ───────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    console.log("[ShadowShopper] Extension installed. Ready to scan any product page.");

    // Initialise a clean injection registry.
    await chrome.storage.session.set({ [SESSION_KEY]: {} });

    // Clear any stale data from a previous install.
    await chrome.storage.local.remove("lastScrape");
  }

  if (reason === chrome.runtime.OnInstalledReason.UPDATE) {
    console.log(
      `[ShadowShopper] Updated from v${previousVersion} → v${chrome.runtime.getManifest().version}`
    );
    // Reset the injection registry on update — old content scripts are stale.
    await chrome.storage.session.set({ [SESSION_KEY]: {} });
  }
});

// ── Message Passing: Popup → Content.js ──────────────────────────────────────
//
// The popup cannot directly call chrome.scripting (it lacks the activeTab
// grant at the moment the popup opens). Instead it sends a message to the
// background service worker which holds the activeTab grant after the user
// clicked the extension icon.
//
// Message protocol:
//   Popup → Background : { action: "scrape" }
//   Background → Content: { action: "scrape" }
//   Content → Background: { success: true, data: {...} }  |  { success: false, error: "..." }
//   Background → Popup  : (same response forwarded)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle messages that originate from the extension popup / pages,
  // NOT from content scripts (those have a sender.tab).
  if (sender.tab) return; // message from a content script — ignore here

  if (message.action === "scrape") {
    handleScrapeRequest(sendResponse);
    return true; // keep the message channel open for async sendResponse
  }

  if (message.action === "ping") {
    sendResponse({ pong: true });
    return false;
  }
});

/**
 * Orchestrates the full scrape flow on ANY web page:
 *   1. Get the active tab.
 *   2. Reject only genuinely un-injectable system tabs (chrome://, about:, etc.).
 *   3. Inject content.js dynamically if it hasn't been loaded yet.
 *   4. Send { action: "scrape" } and relay the response back to the popup.
 *
 * No domain restriction — works on Amazon, Daraz, eBay, Shopify, WooCommerce,
 * or any other e-commerce platform the user visits.
 *
 * @param {(response: object) => void} sendResponse
 */
async function handleScrapeRequest(sendResponse) {
  let tabs;

  try {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (err) {
    sendResponse({ success: false, error: "Could not query active tab: " + err.message });
    return;
  }

  const tab = tabs[0];

  if (!tab?.id) {
    sendResponse({ success: false, error: "No active tab found." });
    return;
  }

  const tabUrl = tab.url ?? "";

  // Block only system / privileged pages where injection is structurally impossible.
  // Regular http/https pages — including any e-commerce domain — are always allowed.
  if (UNINJECTABLE_PATTERN.test(tabUrl) || tabUrl === "") {
    sendResponse({
      success: false,
      error: `Cannot scan this page (${tabUrl || "no URL"}). Navigate to any product listing and try again.`,
      uninjectable: true,
    });
    return;
  }

  try {
    const response = await relayToContentScript(tab.id, { action: "scrape" });
    sendResponse(response);
  } catch (err) {
    sendResponse({
      success: false,
      error: "Failed to communicate with the page: " + err.message,
    });
  }
}

// ── Tab Cleanup ───────────────────────────────────────────────────────────────

// When a tab is closed, remove it from the injection registry.
chrome.tabs.onRemoved.addListener((tabId) => {
  clearInjected(tabId).catch(() => {});
});

// When a tab navigates to a new page, the content script is gone —
// reset the flag so it gets re-injected on the next scan.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    // Page is navigating — content script will be destroyed.
    clearInjected(tabId).catch(() => {});
  }
});

// ── Context Menu (optional, future use) ───────────────────────────────────────
// Placeholder registration for a right-click "Scan with Shadow Shopper" option.
// Uncomment and extend when ready.
//
// chrome.contextMenus.create({
//   id:       "shadow-shopper-scan",
//   title:    "Scan with Shadow Shopper",
//   contexts: ["page"],
//   documentUrlPatterns: ["https://www.amazon.com/*", "https://www.amazon.co.uk/*"],
// });
//
// chrome.contextMenus.onClicked.addListener((info, tab) => {
//   if (info.menuItemId === "shadow-shopper-scan" && tab?.id) {
//     handleScrapeRequest(() => {});
//   }
// });
