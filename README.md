# 🛡️ Shadow Shopper — AI Consumer Defense Utility

> **A Universal Multi-Market Price & Risk Analyzer Browser Extension.**
> Instantly uncovering pricing variations, supply-chain markups, and e-commerce transparency vectors across regional and global shopping platforms.

---

## 🚀 What is This Project About?
When shopping online on regional platforms (like **Daraz Nepal** or **Flipkart India**) or global platforms (like **eBay**), it is incredibly difficult for everyday consumers to know if they are paying a massive, artificial markup or if a listing is a low-quality dropshipped item. 

**Shadow Shopper** is a lightweight browser utility that acts as an analytical consumer defense system. With one click, it scans the product page you are looking at, calculates a real-time vulnerability risk score, and opens a comparison portal showing where you can verify or cross-reference the item on other regional networks.

---

## 🛠️ Key Technical Features Implemented
* **Eliminated Strict Platform Lock-in:** Built with a truly global extension architecture that can read data elements across completely different e-commerce web formats.
* **Resolved Manifest V3 Security Blocks:** Re-architected our internal file systems to perfectly pass Chrome's strict Content Security Policies (CSP) without relying on buggy external styling networks or insecure script tags.
* **Built a Multi-Market Search Filter:** Developed a text-sanitization engine that strips useless fluff words (like "Premium", "Official", "2-Pack") from long 30-word product descriptions so it passes clean search vectors to local databases.

---

## 💻 How Does It Work? (The Architecture)

When you click **"Scan Active Vector"**, the extension executes an automated 3-stage harvesting loop behind the scenes:
1. **Layer 1 (The Search Bot Route):** It hunts for hidden data blocks (`JSON-LD`) inside the webpage background that merchants format specifically for Google Search bots.
2. **Layer 2 (The Visual Scanner):** If those are missing, it falls back to parsing high-priority visual headers on your screen to isolate the exact item title and price.
3. **Layer 3 (The Currency Radar):** It uses pattern-matching algorithms to detect regional currency tokens (`रू`, `₹`, `$`, `€`) and dynamically tags the application with localized color-coded badges (e.g., Orange for NPR/INR).
4. **The Router Matrix:** If a markup or discrepancy risk is flagged, it dynamically unfolds a **Cross-Border Pricing Matrix** allowing the user to cross-check prices on local and global options natively.

---

## 🔧 Tools & Tech Stack Used
* **Languages:** Clean HTML5, Raw Embedded CSS Variables (for the cyber-dark analytics UI theme), and Modular Vanilla JavaScript.
* **Ecosystem Foundations:** Chrome Extensions Primitives (`chrome.runtime` for messaging loops, `chrome.scripting` for injection tasks, and `manifest_version: 3`).
* **Orchestration Environment:** Built, debugged, and version-controlled utilizing the advanced agentic pipelines of **Google Antigravity 2.0** powered by advanced reasoning AI models.

---

## 🗺️ Future Roadmap
This project is an ongoing utility with active feature targets under development:
* **Real-time Price Conversion:** Integration with exchange rate APIs to convert currency dynamically into the user's local values (like matching INR/USD directly to NPR).
* **Automated Image Search API:** Implementing reverse image scanning to spot exact matching items even if the title words are completely rewritten by dropshippers.
* **Expanded Regional Coverage:** Broadening native selector sets to include more local South-Asian and Western boutique marketplaces.

---

## 📥 How to Run It in Developer Mode
1. Download or clone this folder locally on your computer.
2. Open Google Chrome and type **`chrome://extensions/`** in your browser bar.
3. Turn on **Developer mode** using the slider in the top right.
4. Click **Load unpacked** in the top left.
5. Select this project folder (`shadow-shopper-agent`) and confirm.
6. Open any product page, click your extension, and run a scan!