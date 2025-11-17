/**
 * config/config.js
 *
 * Browser-friendly configuration for the Flashcards App.
 * - Works in plain JS (no Node.js / process.env)
 * - Can be modified dynamically in UI or during build
 * - Must be loaded before sheets.js in HTML
 */

const CONFIG = {
  // Your Google Sheet ID (the long string from the URL)
  SHEET_ID: "",

  // Sheet tab name exactly as in Google Sheets
  SHEET_NAME: "",

  // Data range to fetch (adjust as needed)
  RANGE: "",

  // Browser API key with Sheets API enabled
  API_KEY: "",

  // Optional fallback for read-only CSV (publicly published)
  PUBLIC_CSV_URL: "",

  // Development mock questions fallback
  USE_MOCK: true
};

/**
 * Validate configuration before use
 */
function validateConfig() {
  if (!CONFIG.SHEET_ID && !CONFIG.PUBLIC_CSV_URL && !CONFIG.USE_MOCK) {
    console.warn("⚠️ No data source configured. The app will have no questions.");
  }
}

validateConfig();
