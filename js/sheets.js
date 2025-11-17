/**
 * js/sheets.js
 *
 * Features:
 * - Fetches sheet names dynamically from Google Sheets API
 * - Populates "Question Sets" dropdown
 * - Loads questions from selected sheet
 * - Transforms raw Google Sheets data into structured question objects
 * - Handles API errors and provides fallback
 */

/* ======================
   FETCH SHEET NAMES
   ====================== */
async function fetchSheetNames() {
  if (!CONFIG.SHEET_ID || !CONFIG.API_KEY) {
    throw new Error("Missing SHEET_ID or API_KEY in CONFIG");
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(CONFIG.SHEET_ID)}?key=${encodeURIComponent(CONFIG.API_KEY)}`;

  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Failed to fetch sheet names: ${response.statusText}`);
  }

  const data = await response.json();
  return data.sheets.map(sheet => sheet.properties.title);
}

/* ======================
   INIT SHEET DROPDOWN
   ====================== */
async function initSheetsDropdown() {
  const selector = document.getElementById("sheet-selector");
  if (!selector) return;

  try {
    const sheetNames = await fetchSheetNames();

    // Populate dropdown
    selector.innerHTML = "";
    sheetNames.forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      selector.appendChild(opt);
    });

    // Default to first sheet if CONFIG.SHEET_NAME not set
    if (!CONFIG.SHEET_NAME && sheetNames.length > 0) {
      CONFIG.SHEET_NAME = sheetNames[0];
    }

    // Trigger load from selected sheet
    await loadQuestionsFromSelectedSheet();

  } catch (err) {
    console.error("Error loading sheet names:", err);
    selector.innerHTML = '<option value="">Default</option>';
  }
}

/* ======================
   LOAD QUESTIONS FROM GOOGLE SHEET
   ====================== */
async function loadQuestionsFromSelectedSheet() {
  if (!CONFIG.SHEET_NAME) {
    console.warn("No sheet selected. Using mock questions.");
    return [...MOCK_QUESTIONS];
  }

  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      CONFIG.SHEET_ID
    )}/values/${encodeURIComponent(CONFIG.SHEET_NAME)}!${encodeURIComponent(CONFIG.RANGE)}?key=${encodeURIComponent(
      CONFIG.API_KEY || ""
    )}`;

    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`Google Sheets API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return transformSheetsData(data);

  } catch (err) {
    console.error("Failed to load questions:", err);
    return [...MOCK_QUESTIONS]; // fallback
  }
}

/* ======================
   HANDLE SHEET CHANGE EVENT
   ====================== */
async function handleSheetChange(event) {
  const selected = event.target.value;
  if (!selected) return;

  CONFIG.SHEET_NAME = selected;
  questions = await loadQuestionsFromSelectedSheet();
  initializeBookmarks();
  applyFilters();
}

/* ======================
   TRANSFORM SHEETS DATA
   ====================== */
function transformSheetsData(data) {
  if (!data || !data.values || data.values.length < 1) return [];

  const rows = data.values;
  const hasHeader = rows.length > 1;
  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows
    .map((row, index) => {
      const questionText = String(row[2] || "").trim();
      return {
        id: index + 1,
        category: String(row[0] || "").trim(),
        subCategory: String(row[1] || "").trim(),
        question: questionText,
        answer: String(row[3] || "").trim(),
        questionWithAsterisk: String(row[4] || row[2] || "").trim(),
        civicsTestUpdates: String(row[5] || "").trim(),
        bookmark:
          String(row[6] || "").toLowerCase() === "true" ||
          String(row[6] || "") === "1",
        asked:
          String(row[7] || "").toLowerCase() === "true" ||
          String(row[7] || "") === "1"
      };
    })
    .filter(item => item.question && item.question.length > 0);
}

/* ======================
   INITIALIZE SHEETS DROPDOWN ON PAGE LOAD
   ====================== */
document.addEventListener("DOMContentLoaded", initSheetsDropdown);
