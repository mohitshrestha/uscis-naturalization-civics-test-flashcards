/**
 * js/scripts.js
 * Flashcards Web App - Production Ready & Optimized
 * Features:
 * - Google Sheets integration with fallback to local JSON or mock data
 * - Filters, shuffle, bookmarks, progress tracking
 * - Next/Previous skips answered questions when shuffle is on
 * - Markdown + HTML rendering (safe via DOMPurify)
 * - TTS with multilingual support & long text handling
 * - Toasts support multiple simultaneous messages
 * - Theme toggle, keyboard shortcuts
 */

/* ======================
   APP STATE
   ====================== */
let questions = [];                  // All loaded questions
let filteredQuestions = [];          // Questions after applying filters
let currentIndex = 0;                // Current question index in filteredQuestions
let historyBack = [];                // stack of previously shown question indices
let historyForward = [];             // stack of undone indices (for forward replay)
let showAnswerFlag = false;          // Whether answer is currently shown
let answeredQuestions = new Set();   // IDs of answered questions
let bookmarkedQuestions = new Set(); // IDs of bookmarked questions
let filtersVisible = false;          // Toggle filters panel
let ttsVoice = null;                 // Selected TTS voice
let isSpeaking = false;              // TTS active flag

const filters = {
  category: "All",
  subCategory: "All",
  bookmarked: "All",
  questionWithAsterisk: "All",
  civicsTestUpdates: "All",
  shuffleUnasked: false
};

/* ======================
   INITIALIZATION
   ====================== */
document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  await initSheetsAndData();
  initFilters();
  initShuffleButton();
  initKeyboardShortcuts();       // ✅ Desktop shortcut support
  initTTSVoices();
  initBookmarkImportExport();
  loadBookmarksFromStorage(); // Load bookmarks from localStorage

  bindShowAnswerButton(); // Bind Show Answer button once
});

/* ======================
   THEME MANAGEMENT
   ====================== */
function initTheme() {
  const theme = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", theme);
  updateThemeIcon(theme);
}

function toggleTheme() {
  const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  updateThemeIcon(theme);
}

function updateThemeIcon(theme) {
  const icon = document.getElementById("theme-icon");
  if(icon) icon.className = theme === "dark" ? "fas fa-sun" : "fas fa-moon";
}

/* ======================
   LOAD SHEETS & QUESTIONS
   ====================== */
async function initSheetsAndData() {
  showLoading(true);
  try {
    await initSheetsDropdown();
    questions = await loadQuestionsFromSelectedSheet();

    // Fallback to local JSON
    if(!questions || questions.length === 0){
      try{
        const resp = await fetch("data/questions.json");
        if(resp.ok) questions = await resp.json();
      } catch{}
    }

    // Fallback to mock questions
    if(!questions || questions.length === 0){
      questions = [...MOCK_QUESTIONS];
    }

    bookmarkedQuestions.clear();       // Clear bookmarks
    saveBookmarks();                   // Reset localStorage
    initializeBookmarks();             // Re-initialize for the new question set
    applyFilters();
    resetFilters(); // Ensure filters resets
    resetBookmarks(); // Ensure bookmarks reset
    resetProgress(); // Ensure progress resets
  } catch(err){
    console.error("Error initializing sheets or data:", err);
    questions = [...MOCK_QUESTIONS];
    showError(true);
  } finally {
    showLoading(false);
  }

  // Bind sheet selector
  const sheetSelector = document.getElementById("sheet-selector");
  if(sheetSelector){
    sheetSelector.addEventListener("change", async (e)=>{
      CONFIG.SHEET_NAME = e.target.value;
      questions = await loadQuestionsFromSelectedSheet() || [...MOCK_QUESTIONS];
      initializeBookmarks();
      resetFilters(); // Ensure filters resets
      resetBookmarks(); // Ensure bookmarks reset
      resetProgress(); // Ensure progress resets
      populateCategoryFilter();
      applyFilters();
      showToast(`Loaded "${CONFIG.SHEET_NAME}"`, "info");
    });
  }
}

/* ======================
   BOOKMARK MANAGEMENT
   ====================== */
function initializeBookmarks() {
  bookmarkedQuestions.clear();
  questions.forEach(q => { if(q.bookmark) bookmarkedQuestions.add(q.id); });
  loadBookmarksFromStorage(); 
  updateBookmarkIcon();
}

function toggleBookmark() {
  const q = filteredQuestions[currentIndex];
  if(!q) return;

  if(bookmarkedQuestions.has(q.id)){
    bookmarkedQuestions.delete(q.id);
    showToast("Removed from bookmarks", "warning");
  } else {
    bookmarkedQuestions.add(q.id);
    showToast("Bookmarked!", "success");
  }

  saveBookmarks();
  applyFilters();
  updateBookmarkIcon();
  validateCurrentQuestion();
}

function saveBookmarks() {
  localStorage.setItem("bookmarks", JSON.stringify([...bookmarkedQuestions]));
}

function loadBookmarksFromStorage() {
  const stored = localStorage.getItem("bookmarks");
  if(stored){
    try{
      const parsed = JSON.parse(stored);
      if(Array.isArray(parsed)) parsed.forEach(id => bookmarkedQuestions.add(id));
    }catch{}
  }
  updateBookmarkIcon();
}

function updateBookmarkIcon() {
  const bookmarkBtn = document.querySelector(".bookmark-btn");  // Reference to the button itself
  const icon = document.querySelector(".bookmark-btn i");  // Reference to the icon inside the button
  
  if (!icon || !bookmarkBtn || !filteredQuestions[currentIndex]) return;  // Make sure both button and icon exist

  const q = filteredQuestions[currentIndex];  // Get the current question
  const isBookmarked = bookmarkedQuestions.has(q.id);  // Check if it's bookmarked
  
  // Update the icon class based on whether the question is bookmarked
  icon.className = isBookmarked ? "fas fa-bookmark" : "far fa-bookmark";
  
  // Toggle the "active" class on the button based on the bookmark status
  bookmarkBtn.classList.toggle("active", isBookmarked);
}

function initBookmarkImportExport(){
  const importInput = document.getElementById("import-bookmarks-input");
  if(importInput) importInput.addEventListener("change", handleBookmarkImport);

  const exportBtn = document.getElementById("export-bookmarks-btn");
  if(exportBtn) exportBtn.addEventListener("click", exportBookmarks);

  const resetBtn = document.getElementById("reset-bookmarks-btn");
  if (resetBtn) resetBtn.addEventListener("click", resetBookmarks); // ← Instant clear
}

function resetBookmarks() {
  bookmarkedQuestions.clear();
  saveBookmarks();
  applyFilters();
  updateBookmarkIcon();
  showToast("Bookmarks reset!", "warning");
}

function updateResetBookmarkButton() {
  const btn = document.getElementById("reset-bookmarks-btn");
  if (btn) {
    btn.disabled = bookmarkedQuestions.size === 0;
  }
}

function exportBookmarks() {
  const setName = (CONFIG.SHEET_NAME || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9\-]+/gi, "-");

  const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const filename = `bookmarks-${setName}-${date}.json`;

  const data = {
    set: CONFIG.SHEET_NAME || "unknown",
    bookmarks: [...bookmarkedQuestions]
  };

  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  showToast("Bookmarks exported!", "info");
}

function handleBookmarkImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const imported = JSON.parse(e.target.result);

      if (
        imported &&
        typeof imported === "object" &&
        Array.isArray(imported.bookmarks)
      ) {
        const currentSet = CONFIG.SHEET_NAME || "unknown";
        const importedSet = imported.set || "unknown";

        if (importedSet !== currentSet) {
          showToast(
            `Set mismatch: Imported "${importedSet}", expected "${currentSet}"`,
            "error"
          );
          return;
        }

        imported.bookmarks.forEach(id => bookmarkedQuestions.add(id));
        saveBookmarks();
        applyFilters();
        showToast("Bookmarks imported!", "success");
      } else {
        showToast("Invalid bookmark file format", "error");
      }
    } catch {
      showToast("Failed to import bookmarks", "error");
    }
  };

  reader.readAsText(file);
}

/* ======================
   FILTERS
   ====================== */
function initFilters() {
  ["category-filter","subcategory-filter","bookmark-filter","asterisk-filter","civics-filter"].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.addEventListener("change", handleFilterChange);
  });
  populateCategoryFilter();
}

function populateCategoryFilter() {
  const catSelect = document.getElementById("category-filter"); 
  if(!catSelect) return;
  const categories = [...new Set(questions.map(q=>q.category).filter(Boolean))].sort();
  catSelect.innerHTML = '<option value="All">All</option>';
  categories.forEach(c=>{
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    catSelect.appendChild(opt);
  });
  updateSubCategories();
}

function updateSubCategories(){
  const subSelect = document.getElementById("subcategory-filter"); 
  if(!subSelect) return;
  const filtered = filters.category === "All" ? questions : questions.filter(q => q.category === filters.category);
  const subCats = [...new Set(filtered.map(q=>q.subCategory).filter(Boolean))].sort();
  subSelect.innerHTML = '<option value="All">All</option>';
  subCats.forEach(sc=>{
    const opt = document.createElement("option");
    opt.value = sc;
    opt.textContent = sc;
    subSelect.appendChild(opt);
  });
}

function handleFilterChange(event){
  const cat = document.getElementById("category-filter");
  const sub = document.getElementById("subcategory-filter");
  const bm = document.getElementById("bookmark-filter");
  const ast = document.getElementById("asterisk-filter");
  const civ = document.getElementById("civics-filter");
  if(!cat || !sub || !bm || !ast || !civ) return;

  filters.category = cat.value;
  filters.subCategory = sub.value;
  filters.bookmarked = bm.value;
  filters.questionWithAsterisk = ast.value;
  filters.civicsTestUpdates = civ.value;

  if(event?.target?.id === "category-filter"){
    updateSubCategories();
    sub.value = "All";
    filters.subCategory = "All";
  }

  applyFilters();
}

function toggleFilters(){
  filtersVisible = !filtersVisible;
  const content = document.getElementById("filters-content");
  const text = document.getElementById("filters-text");
  const chevron = document.getElementById("filters-chevron");
  if(!content || !text || !chevron) return;
  content.classList.toggle("show", filtersVisible);
  text.textContent = filtersVisible ? "Hide Filters & Settings" : "Show Filters & Settings";
  chevron.className = filtersVisible ? "fas fa-chevron-up" : "fas fa-chevron-down";
}

/* ======================
   SHUFFLE
   ====================== */
function initShuffleButton(){
  const btn = document.getElementById("shuffle-unasked-btn");
  if(!btn) return;
  btn.addEventListener("click", ()=>{
    filters.shuffleUnasked = !filters.shuffleUnasked;
    btn.textContent = filters.shuffleUnasked ? "Shuffle Unasked Questions On" : "Shuffle Unasked Questions Off";
    btn.classList.toggle("active", filters.shuffleUnasked);
    applyFilters();
    showToast(filters.shuffleUnasked ? "Shuffle enabled!" : "Shuffle disabled","info");
  });
}

/* ======================
   DISPLAY QUESTIONS (HTML + Markdown Safe)
   ====================== */
function applyFilters() {
  filteredQuestions = questions.filter(q => {
    if(filters.category !== "All" && q.category !== filters.category) return false;
    if(filters.subCategory !== "All" && q.subCategory !== filters.subCategory) return false;
    if(filters.bookmarked === "Bookmarked" && !bookmarkedQuestions.has(q.id)) return false;
    if(filters.questionWithAsterisk === "Yes" && q.questionWithAsterisk !== "Yes") return false;
    if(filters.civicsTestUpdates === "Yes" && q.civicsTestUpdates !== "Yes") return false;
    return true;
  });

  if(filters.shuffleUnasked) filteredQuestions = shuffleUnasked(filteredQuestions);

  if(filteredQuestions.length > 0){
    const currentQ = filteredQuestions[currentIndex];
    if(!currentQ || !filteredQuestions.includes(currentQ)){
      currentIndex = 0;
    }
  } else {
    currentIndex = 0;
  }

  showAnswerFlag = false;
  displayCurrentQuestion();
  initHistory();
}

function displayCurrentQuestion() {
  const questionText = document.getElementById("question-text");
  const answerText = document.getElementById("answer-text");
  const answerSection = document.getElementById("answer-section");
  const badges = document.getElementById("question-badges");

  if (!questionText || !answerText || !answerSection) return;

  if (!filteredQuestions.length) {
    questionText.textContent = "No questions found";
    answerText.textContent = "";
    answerSection.style.display = "none";
    updateProgress();
    return;
  }

  const q = filteredQuestions[currentIndex];

  // --- Render question and answer using Markdown + HTML ---
  questionText.innerHTML = parseFormattedContent(q.question);
  answerText.innerHTML = showAnswerFlag ? parseFormattedContent(q.answer) : "";

  // Show/hide answer section
  answerSection.style.display = showAnswerFlag ? "block" : "none";
  answerSection.classList.toggle("show", showAnswerFlag);

  // Question badges
  if(badges){
    badges.innerHTML = `
      <span class="badge badge-category">${escapeHtml(q.category || "")}</span>
      <span class="badge badge-subcategory">${escapeHtml(q.subCategory || "")}</span>
      ${String(q.questionWithAsterisk || "").includes("*") ? '<span class="badge badge-asterisk">*</span>' : ""}
    `;
  }

  updateBookmarkIcon();
  updateProgress();
}

/* ======================
   SHOW ANSWER BUTTON
   ====================== */
function bindShowAnswerButton() {
  const btn = document.getElementById("show-answer-btn");
  if(btn){
    btn.onclick = toggleAnswer;
  }
}

function toggleAnswer() {
  if (!filteredQuestions.length) return;

  // Toggle answer visibility
  showAnswerFlag = !showAnswerFlag;

  // Re-render the question with updated answer visibility
  displayCurrentQuestion();

  // Mark the question as answered if showing the answer
  if (showAnswerFlag) {
    markAnswered(filteredQuestions[currentIndex]);
  }
}

/* ======================
   NAVIGATION & ANSWER LOGIC
   ====================== */
function nextQuestion() {
  if (!showAnswerFlag) {
    toggleAnswer(); // Show answer + mark as answered
    return;
  }

  if (historyForward.length > 0) {
    // Replay forward history if user previously pressed Prev
    historyBack.push(currentIndex);
    currentIndex = historyForward.pop();
    showAnswerFlag = false;
    displayCurrentQuestion();
    updateProgress();
    return;
  }

  // Normal forward navigation
  historyBack.push(currentIndex); // push current before moving forward

  if (filters.shuffleUnasked) {
    const unasked = filteredQuestions.filter(q => !answeredQuestions.has(q.id));
    if (unasked.length === 0) {
      currentIndex = (currentIndex + 1) % filteredQuestions.length;
    } else {
      const randomQ = unasked[Math.floor(Math.random() * unasked.length)];
      currentIndex = filteredQuestions.findIndex(q => q.id === randomQ.id);
    }
  } else {
    currentIndex = (currentIndex + 1) % filteredQuestions.length;
  }

  historyForward = []; // clear forward history if new question chosen
  showAnswerFlag = false;
  displayCurrentQuestion();
  updateProgress();
}

function prevQuestion() {
  if (historyBack.length > 0) {
    historyForward.push(currentIndex);       // save current for forward
    currentIndex = historyBack.pop();        // move back
    showAnswerFlag = false;
    displayCurrentQuestion();
    updateProgress();
  }
}

function validateCurrentQuestion(isBackward=false) {
  if(!filteredQuestions.length) return;
  const q = filteredQuestions[currentIndex];
  if((filters.bookmarked === "Bookmarked" && !bookmarkedQuestions.has(q.id)) ||
     (filters.category !== "All" && q.category !== filters.category) ||
     (filters.subCategory !== "All" && q.subCategory !== filters.subCategory) ||
     (filters.questionWithAsterisk === "Yes" && q.questionWithAsterisk !== "Yes") ||
     (filters.civicsTestUpdates === "Yes" && q.civicsTestUpdates !== "Yes")) {
    isBackward ? prevQuestion() : nextQuestion();
  }
}

function markAnswered(q){ 
  if(q) answeredQuestions.add(q.id);
  updateProgress();
}

/* ======================
   PROGRESS
   ====================== */
function updateProgress() {
  const fill = document.getElementById("progress-fill");
  const text = document.getElementById("progress-text");
  const stats = document.getElementById("progress-stats");

  if (!fill || !text || !stats) return;

  const total = filteredQuestions.length;
  const answered = answeredQuestions.size;
  const percent = total ? Math.round((answered / total) * 100) : 0;
  
  // Fill bar reflects % of answered questions
  fill.style.width = `${percent}%`;
  text.textContent = `${percent}%`;       // percentage overlay

  stats.textContent = `Total: ${total} | Answered: ${answered} | Remaining: ${total - answered}`;
}

function shuffleUnasked(list){
  const unasked=list.filter(q=>!answeredQuestions.has(q.id));
  const asked=list.filter(q=>answeredQuestions.has(q.id));
  return [...shuffleArray(unasked),...asked];
}

function shuffleArray(arr){
  const a=arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

/* ======================
   RESET FILTERS & PROGRESS
   ====================== */
function resetFilters(){
  filters.category="All";
  filters.subCategory="All";
  filters.bookmarked="All";
  filters.questionWithAsterisk="All";
  filters.civicsTestUpdates="All";

  ["category-filter","subcategory-filter","bookmark-filter","asterisk-filter","civics-filter"].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.value="All";
  });

  populateCategoryFilter();
  applyFilters();
  showToast("Filters reset!","info");
}

function initHistory() {
  historyBack = [currentIndex]; // start history with current index
  historyForward = [];
}

function resetProgress(){
  answeredQuestions.clear();
  currentIndex=0;
  showAnswerFlag=false;
  if(filters.shuffleUnasked){
    filteredQuestions = shuffleUnasked(filteredQuestions);
  }
  displayCurrentQuestion();
  initHistory();
  showToast("Progress reset!","info");
}

/* ======================
   TTS (Multilingual + Long Text Support)
   ====================== */

// Clean HTML and formatting from TTS text
function sanitizeTextForSpeech(text) {
  if (!text) return "";

  // Remove HTML tags (supports nested tags)
  const strippedText = text.replace(/<[^>]*>/g, "");

  // Remove leading numbered list (e.g., "1. ", "42. ")
  const cleanedText = strippedText.replace(/^\d+\.\s*/, "");

  return cleanedText.trim();
}

// Initialize available TTS voices and populate the dropdown
function initTTSVoices() {
  const select = document.getElementById("tts-voice-select");
  if (!select) return;

  function populateVoices() {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;

    select.innerHTML = "";

    voices.forEach(voice => {
      const opt = document.createElement("option");
      opt.value = voice.name;
      opt.textContent = `${voice.name} (${voice.lang})`;
      select.appendChild(opt);
    });

    // Set default voice
    ttsVoice = voices[0];

    // Update selected voice
    select.addEventListener("change", () => {
      ttsVoice = voices.find(v => v.name === select.value);
    });
  }

  populateVoices();

  // Some browsers load voices asynchronously
  window.speechSynthesis.onvoiceschanged = populateVoices;
}

// Speak question and answer
function speakQuestion() {
  speakText(filteredQuestions[currentIndex]?.question || "");
}
function speakAnswer() {
  speakText(filteredQuestions[currentIndex]?.answer || "");
}

// Core TTS handler with chunking
function speakText(text) {
  if (!text || !window.speechSynthesis) return;

  if (isSpeaking) {
    speechSynthesis.cancel();
    isSpeaking = false;
    return;
  }

  const plainText = sanitizeTextForSpeech(text);
  const CHUNK_SIZE = 200;
  const chunks = [];

  for (let i = 0; i < plainText.length; i += CHUNK_SIZE) {
    chunks.push(plainText.slice(i, i + CHUNK_SIZE));
  }

  let idx = 0;
  isSpeaking = true;

  function speakChunk() {
    if (idx >= chunks.length) {
      isSpeaking = false;
      return;
    }

    const utter = new SpeechSynthesisUtterance(chunks[idx]);
    utter.voice = ttsVoice;
    utter.lang = ttsVoice?.lang || "en-US";

    utter.onend = () => {
      idx++;
      speakChunk(); // Recursive next chunk
    };

    utter.onerror = (err) => {
      console.error("TTS error:", err);
      isSpeaking = false;
    };

    speechSynthesis.speak(utter);
  }

  speakChunk();
}

/* ======================
   TOASTS
   ====================== */
function showToast(msg,type="info"){
  const toastContainer=document.getElementById("toast-container")||createToastContainer();
  const toast=document.createElement("div");
  toast.className=`toast ${type}`;
  toast.textContent=msg;
  toastContainer.appendChild(toast);
  setTimeout(()=>{ toast.classList.add("show"); },50);
  setTimeout(()=>{ toast.classList.remove("show"); setTimeout(()=>toast.remove(),300); },3000);
}

function createToastContainer(){
  const container=document.createElement("div");
  container.id="toast-container";
  document.body.appendChild(container);
  return container;
}

/* ======================
   UTILITIES
   ====================== */
function showLoading(show){ const el=document.getElementById("loading"); if(el) el.style.display=show?"block":"none"; }
function showError(show){ const el=document.getElementById("error"); if(el) el.style.display=show?"block":"none"; }
function escapeHtml(str){ return str.replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function parseFormattedContent(input){ return DOMPurify.sanitize(marked.parse(input||"")); }

/* ======================
   KEYBOARD SHORTCUTS
   ====================== */
/**
 * Initialize global keyboard shortcuts for desktop users.
 * Shortcuts are ignored when focused on input/editable elements.
 */
function initKeyboardShortcuts() {
  const ignoredTags = new Set(["input", "textarea", "select"]);

  document.addEventListener("keydown", e => {
    const tag = e.target.tagName.toLowerCase();

    // Skip if user is typing or editing content
    if (ignoredTags.has(tag) || e.target.isContentEditable) return;

    // Optional: skip repeated keypresses from holding down the key
    if (e.repeat) return;

    const key = e.key.toLowerCase(); // Normalize key name

    // Modifier shortcuts (Ctrl or Cmd)
    if (e.ctrlKey || e.metaKey) {
      switch (key) {
        case "arrowright":
          e.preventDefault();
          nextQuestion();
          break;
        case "arrowleft":
          e.preventDefault();
          prevQuestion();
          break;
      }
      return;
    }

    // Simple key shortcuts
    switch (key) {
      case " ":
      case "a": // Toggle answer
        e.preventDefault();
        toggleAnswer();
        break;

      case "arrowright":
      case "n": // Next question
        e.preventDefault();
        nextQuestion();
        break;

      case "arrowleft":
      case "p": // Previous question
        e.preventDefault();
        prevQuestion();
        break;

      case "b": // Bookmark
        e.preventDefault();
        toggleBookmark();
        break;

      case "r": // Reset progress
        e.preventDefault();
        resetProgress();
        break;

      case "f": // Reset filters
        e.preventDefault();
        resetFilters();
        break;

      case "escape": // Stop TTS and hide filters
        e.preventDefault();

        // Stop TTS if active
        if (typeof isSpeaking !== "undefined" && isSpeaking) {
          speechSynthesis.cancel();
          isSpeaking = false;
        }

        // Hide filters panel
        if (typeof filtersVisible !== "undefined" && filtersVisible) {
          toggleFilters();
        }
        break;
    }
  });
}

/* ======================
   MOCK QUESTIONS (Fallback)
   ====================== */
const MOCK_QUESTIONS = [
  {
    "id": 1,
    "category": "American Government",
    "subCategory": "A: Principles of American Government",
    "question": "1. What is the supreme law of the land?",
    "answer": "- the Constitution",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 2,
    "category": "American Government",
    "subCategory": "A: Principles of American Government",
    "question": "2. What does the Constitution do?",
    "answer": "- sets up the government\n- defines the government\n- protects basic rights of Americans",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 3,
    "category": "American Government",
    "subCategory": "A: Principles of American Government",
    "question": "3. The idea of self-government is in the first three words of the Constitution. What are these words?",
    "answer": "- We the People",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 4,
    "category": "American Government",
    "subCategory": "A: Principles of American Government",
    "question": "4. What is an amendment?",
    "answer": "- a change (to the Constitution)\n- an addition (to the Constitution)",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 5,
    "category": "American Government",
    "subCategory": "A: Principles of American Government",
    "question": "5. What do we call the first ten amendments to the Constitution?",
    "answer": "- the Bill of Rights",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 6,
    "category": "American Government",
    "subCategory": "A: Principles of American Government",
    "question": "6. What is <u>one</u> right or freedom from the First Amendment?*",
    "answer": "- speech\n- religion\n- assembly\n- press\n- petition the government",
    "questionWithAsterisk": "Yes",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 7,
    "category": "American Government",
    "subCategory": "A: Principles of American Government",
    "question": "7. How many amendments does the Constitution have?",
    "answer": "- twenty-seven (27)",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 8,
    "category": "American Government",
    "subCategory": "A: Principles of American Government",
    "question": "8. What did the Declaration of Independence do?",
    "answer": "- announced our independence (from Great Britain)\n- declared our independence (from Great Britain)\n- said that the United States is free (from Great Britain)",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 9,
    "category": "American Government",
    "subCategory": "A: Principles of American Government",
    "question": "9. What are <u>two</u> rights in the Declaration of Independence?",
    "answer": "- life\n- liberty\n- pursuit of happiness",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 10,
    "category": "American Government",
    "subCategory": "A: Principles of American Government",
    "question": "10. What is freedom of religion?",
    "answer": "- You can practice any religion, or not practice a religion.",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 11,
    "category": "American Government",
    "subCategory": "A: Principles of American Government",
    "question": "11. What is the economic system in the United States?*",
    "answer": "- capitalist economy\n- market economy",
    "questionWithAsterisk": "Yes",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 12,
    "category": "American Government",
    "subCategory": "A: Principles of American Government",
    "question": "12. What is the “rule of law”?",
    "answer": "- Everyone must follow the law.\n- Leaders must obey the law.\n- Government must obey the law.\n- No one is above the law. ",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 13,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "13. Name <u>one</u> branch or part of the government.*",
    "answer": "- Congress\n- legislative\n- President\n- executive\n- the courts\n- judicial",
    "questionWithAsterisk": "Yes",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 14,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "14. What stops <u>one</u> branch of government from becoming too powerful?",
    "answer": "- checks and balances\n- separation of powers",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 15,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "15. Who is in charge of the executive branch?",
    "answer": "- the President",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 16,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "16. Who makes federal laws?",
    "answer": "- Congress\n- Senate and House (of Representatives)\n- (U.S. or national) legislature",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 17,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "17. What are the <u>two</u> parts of the U.S. Congress?*",
    "answer": "- the Senate and House (of Representatives)",
    "questionWithAsterisk": "Yes",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 18,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "18. How many U.S. Senators are there?",
    "answer": "- one hundred (100)",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 19,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "19. We elect a U.S. Senator for how many years? ",
    "answer": "- six (6)",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 20,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "20. Who is <u>one</u> of your state’s U.S. Senators now?*",
    "answer": "- Answers will vary. \n- For state <strong>California</strong>: 2 out of 2 Senators\n- <strong>Alex Padilla</strong>\n- <strong>Adam B. Schiff</strong>\n\n- [District of Columbia residents and residents of U.S. territories should answer that D.C. (or the territory where the applicant lives) has no U.S. Senators.] \n\n- Visit [senate.gov](https://www.congress.gov/members) to find your state’s U.S. Senators.\n- Visit [uscis.gov/citizenship/testupdates](https://www.uscis.gov/citizenship/find-study-materials-and-resources/check-for-test-updates)\"",
    "questionWithAsterisk": "Yes",
    "civicsTestUpdates": "Yes",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 21,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "21. The House of Representatives has how many voting members? ",
    "answer": "- four hundred thirty-five (435)",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 22,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "22. We elect a U.S. Representative for how many years?",
    "answer": "- two (2)",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 23,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "23. Name your U.S. Representative.",
    "answer": "- Answers will vary. \n- For state <strong>California</strong>: 3 out of 52 Representatives below \n- <strong>Kevin Kiley (District 3)</strong>\n- <strong>Nancy Pelosi (District 11)</strong>\n- <strong>Kim Young (District 40)</strong>\n\n- [Residents of territories with nonvoting Delegates or Resident Commissioners may provide the name of that Delegate or Commissioner. Also acceptable is any statement that the territory has no (voting) Representatives in Congress.] \n\n- Visit [house.gov](https://www.congress.gov/members) to find your U.S. Representative.\n- Visit [uscis.gov/citizenship/testupdates](https://www.uscis.gov/citizenship/find-study-materials-and-resources/check-for-test-updates)",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "Yes",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 24,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "24. Who does a U.S. Senator represent?",
    "answer": "- all people of the state",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 25,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "25. Why do some states have more Representatives than other states?",
    "answer": "- (because of) the state’s population\n- (because) they have more people\n- (because) some states have more people",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 26,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "26. We elect a President for how many years?",
    "answer": "- four (4)",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 27,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "27. In what month do we vote for President?*",
    "answer": "- November",
    "questionWithAsterisk": "Yes",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 28,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "28. What is the name of the President of the United States now?*",
    "answer": "- <strong>Donald J. Trump</strong>\n- <strong>Donald Trump</strong>\n- <strong>Trump</strong>\n\n- Visit [uscis.gov/citizenship/testupdates](https://www.uscis.gov/citizenship/find-study-materials-and-resources/check-for-test-updates) for the name of the President of the United States.",
    "questionWithAsterisk": "Yes",
    "civicsTestUpdates": "Yes",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 29,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "29. What is the name of the Vice President of the United States now?",
    "answer": "- <strong>JD Vance</strong>\n- <strong>Vance</strong>\n\n- Visit [uscis.gov/citizenship/testupdates](https://www.uscis.gov/citizenship/find-study-materials-and-resources/check-for-test-updates) for the name of the Vice President of the United States.",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "Yes",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 30,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "30. If the President can no longer serve, who becomes President?",
    "answer": "- the Vice President",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 31,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "31. If both the President and the Vice President can no longer serve, who becomes President?",
    "answer": "- the Speaker of the House",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 32,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "32. Who is the Commander in Chief of the military?",
    "answer": "- the President",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 33,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "33. Who signs bills to become laws?",
    "answer": "- the President",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 34,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "34. Who vetoes bills?",
    "answer": "- the President",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 35,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "35. What does the President’s Cabinet do?",
    "answer": "- advises the President",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 36,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "36. What are <u>two</u> Cabinet-level positions?",
    "answer": "- Secretary of Agriculture\n- Secretary of Commerce\n- Secretary of Defense\n- Secretary of Education\n- Secretary of Energy\n- Secretary of Health and Human Services\n- Secretary of Homeland Security\n- Secretary of Housing and Urban Development\n- Secretary of the Interior\n- Secretary of Labor\n- Secretary of State\n- Secretary of Transportation\n- Secretary of the Treasury\n- Secretary of Veterans Affairs\n- Attorney General\n- Vice President",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 37,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "37. What does the judicial branch do?\n",
    "answer": "- reviews laws\n- explains laws\n- resolves disputes (disagreements)\n- decides if a law goes against the Constitution",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 38,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "38. What is the highest court in the United States?",
    "answer": "- the Supreme Court",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 39,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "39. How many justices are on the Supreme Court?",
    "answer": "- nine (9)",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "Yes",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 40,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "40. Who is the Chief Justice of the United States now?",
    "answer": "- <strong>John Roberts</strong>\n- <strong>John G. Roberts, Jr.</strong>\n- <strong>Roberts</strong>\n\n- Visit [uscis.gov/citizenship/testupdates](https://www.uscis.gov/citizenship/find-study-materials-and-resources/check-for-test-updates) for the name of the Chief Justice of the United States.",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "Yes",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 41,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "41. Under our Constitution, some powers belong to the federal government. What is <u>one</u> power of the federal\ngovernment?",
    "answer": "- to print money\n- to declare war\n- to create an army\n- to make treaties",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 42,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "42. Under our Constitution, some powers belong to the states. What is <u>one</u> power of the states? ",
    "answer": "- provide schooling and education\r\n- provide protection (police)\r\n- provide safety (fire departments)\r\n- give a driver’s license\r\n- approve zoning and land use",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 43,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "43. Who is the Governor of your state now?",
    "answer": "- Answers will vary. \n- For state <strong>California</strong>: <strong>Governor Gavin Newsom</strong>\n\n- [District of Columbia residents should answer that D.C. does not have a Governor.] \n\n- Visit [usa.gov/states-and-territories](https://www.usa.gov/state-governments) to find the Governor of your state.",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "Yes",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 44,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "44. What is the capital of your state?*",
    "answer": "- Answers will vary. \n- For state <strong>California</strong>: <strong>Sacramento</strong>\n\n- [District of Columbia residents should answer that D.C. is not a state and does not have a\ncapital. Residents of U.S. territories should name the capital of the territory.]\n",
    "questionWithAsterisk": "Yes",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 45,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "45. What are the <u>two</u> major political parties in the United States?*",
    "answer": "- Democratic and Republican",
    "questionWithAsterisk": "Yes",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 46,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "46. What is the political party of the President now?",
    "answer": "- Republican (Party)\n\n- Please verify the latest information as it may change over time based on the election year.\n\n- Visit [uscis.gov/citizenship/testupdates](https://www.uscis.gov/citizenship/find-study-materials-and-resources/check-for-test-updates)",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "Yes",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 47,
    "category": "American Government",
    "subCategory": "B: System of Government",
    "question": "47. What is the name of the Speaker of the House of Representatives now?",
    "answer": "- <strong>Mike Johnson</strong>\n- <strong>Johnson</strong>\n- <strong>James Michael Johnson (birth name)</strong>\n\n- Visit [uscis.gov/citizenship/testupdates](https://www.uscis.gov/citizenship/find-study-materials-and-resources/check-for-test-updates) for the name of the Speaker of the House of Representatives.",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "Yes",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 48,
    "category": "American Government",
    "subCategory": "C: Rights and Responsibilities",
    "question": "48. There are four amendments to the Constitution about who can vote. Describe <u>one</u> of them.",
    "answer": "- Citizens eighteen (18) and older (can vote).\r\n- You don’t have to pay (a poll tax) to vote.\r\n- Any citizen can vote. (Women and men can vote.)\r\n- A male citizen of any race (can vote).",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 49,
    "category": "American Government",
    "subCategory": "C: Rights and Responsibilities",
    "question": "49. What is <u>one</u> responsibility that is only for United States citizens?*",
    "answer": "- serve on a jury\r\n- vote in a federal election",
    "questionWithAsterisk": "Yes",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 50,
    "category": "American Government",
    "subCategory": "C: Rights and Responsibilities",
    "question": "50. Name <u>one</u> right only for United States citizens.",
    "answer": "- vote in a federal election\r\n- run for federal office",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 51,
    "category": "American Government",
    "subCategory": "C: Rights and Responsibilities",
    "question": "51. What are <u>two</u> rights of everyone living in the United States?",
    "answer": "- freedom of expression\r\n- freedom of speech\r\n- freedom of assembly\r\n- freedom to petition the government\r\n- freedom of religion\r\n- the right to bear arms",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 52,
    "category": "American Government",
    "subCategory": "C: Rights and Responsibilities",
    "question": "52. What do we show loyalty to when we say the Pledge of Allegiance?",
    "answer": "- the United States\r\n- the flag",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 53,
    "category": "American Government",
    "subCategory": "C: Rights and Responsibilities",
    "question": "53. What is <u>one</u> promise you make when you become a United States citizen?",
    "answer": "- give up loyalty to other countries\r\n- defend the Constitution and laws of the United States\r\n- obey the laws of the United States\r\n- serve in the U.S. military (if needed)\r\n- serve (do important work for) the nation (if needed)\r\n- be loyal to the United States",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 54,
    "category": "American Government",
    "subCategory": "C: Rights and Responsibilities",
    "question": "54. How old do citizens have to be to vote for President?*",
    "answer": "- eighteen (18) and older",
    "questionWithAsterisk": "Yes",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 55,
    "category": "American Government",
    "subCategory": "C: Rights and Responsibilities",
    "question": "55. What are <u>two</u> ways that Americans can participate in their democracy?",
    "answer": "- vote\r\n- join a political party\r\n- help with a campaign\r\n- join a civic group\r\n- join a community group\r\n- give an elected official your opinion on an issue\r\n- call Senators and Representatives\r\n- publicly support or oppose an issue or policy\r\n- run for office\r\n- write to a newspaper",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 56,
    "category": "American Government",
    "subCategory": "C: Rights and Responsibilities",
    "question": "56. When is the last day you can send in federal income tax forms?*",
    "answer": "- April 15",
    "questionWithAsterisk": "Yes",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 57,
    "category": "American Government",
    "subCategory": "C: Rights and Responsibilities",
    "question": "57. When must all men register for the Selective Service?",
    "answer": "- at age eighteen (18)\r\n- between eighteen (18) and twenty-six (26)",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 58,
    "category": "American History",
    "subCategory": "A: Colonial Period and Independence",
    "question": "58. What is <u>one</u> reason colonists came to America?",
    "answer": "- freedom\r\n- political liberty\r\n- religious freedom\r\n- economic opportunity\r\n- practice their religion\r\n- escape persecution",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 59,
    "category": "American History",
    "subCategory": "A: Colonial Period and Independence",
    "question": "59. Who lived in America before the Europeans arrived?",
    "answer": "- American Indians\r\n- Native Americans",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 60,
    "category": "American History",
    "subCategory": "A: Colonial Period and Independence",
    "question": "60. What group of people was taken to America and sold as slaves?",
    "answer": "- Africans\r\n- people from Africa",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 61,
    "category": "American History",
    "subCategory": "A: Colonial Period and Independence",
    "question": "61. Why did the colonists fight the British?",
    "answer": "- because of high taxes (taxation without representation)\r\n- because the British army stayed in their houses (boarding, quartering)\r\n- because they didn’t have self-government",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 62,
    "category": "American History",
    "subCategory": "A: Colonial Period and Independence",
    "question": "62. Who wrote the Declaration of Independence?",
    "answer": "- (Thomas) Jefferson",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 63,
    "category": "American History",
    "subCategory": "A: Colonial Period and Independence",
    "question": "63. When was the Declaration of Independence adopted?",
    "answer": "- July 4, 1776",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 64,
    "category": "American History",
    "subCategory": "A: Colonial Period and Independence",
    "question": "64. There were 13 original states. Name <u>three</u>.",
    "answer": "- New Hampshire\r\n- Massachusetts\r\n- Rhode Island\r\n- Connecticut\r\n- New York\r\n- New Jersey\r\n- Pennsylvania\r\n- Delaware\r\n- Maryland\r\n- Virginia\r\n- North Carolina\r\n- South Carolina\r\n- Georgia",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 65,
    "category": "American History",
    "subCategory": "A: Colonial Period and Independence",
    "question": "65. What happened at the Constitutional Convention?",
    "answer": "- The Constitution was written.\r\n- The Founding Fathers wrote the Constitution",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 66,
    "category": "American History",
    "subCategory": "A: Colonial Period and Independence",
    "question": "66. When was the Constitution written?",
    "answer": "- 1787",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 67,
    "category": "American History",
    "subCategory": "A: Colonial Period and Independence",
    "question": "67. The Federalist Papers supported the passage of the U.S. Constitution. Name <u>one</u> of the writers.",
    "answer": "- (James) Madison\r\n- (Alexander) Hamilton\r\n- (John) Jay\r\n- Publius",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 68,
    "category": "American History",
    "subCategory": "A: Colonial Period and Independence",
    "question": "68. What is <u>one</u> thing Benjamin Franklin is famous for?",
    "answer": "- U.S. diplomat\r\n- oldest member of the Constitutional Convention\r\n- first Postmaster General of the United States\r\n- writer of “Poor Richard’s Almanac”\r\n- started the first free libraries",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 69,
    "category": "American History",
    "subCategory": "A: Colonial Period and Independence",
    "question": "69. Who is the “Father of Our Country”?",
    "answer": "- (George) Washington",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 70,
    "category": "American History",
    "subCategory": "A: Colonial Period and Independence",
    "question": "70. Who was the first President?*",
    "answer": "- (George) Washington",
    "questionWithAsterisk": "Yes",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 71,
    "category": "American History",
    "subCategory": "B: 1800s",
    "question": "71. What territory did the United States buy from France in 1803?",
    "answer": "- the Louisiana Territory\r\n- Louisiana",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 72,
    "category": "American History",
    "subCategory": "B: 1800s",
    "question": "72. Name <u>one</u> war fought by the United States in the 1800s.",
    "answer": "- War of 1812\r\n- Mexican-American War\r\n- Civil War\r\n- Spanish-American War",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 73,
    "category": "American History",
    "subCategory": "B: 1800s",
    "question": "73. Name the U.S. war between the North and the South. ",
    "answer": "- the Civil War\r\n- the War between the States",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 74,
    "category": "American History",
    "subCategory": "B: 1800s",
    "question": "74. Name <u>one</u> problem that led to the Civil War.",
    "answer": "- slavery\r\n- economic reasons\r\n- states’ rights",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 75,
    "category": "American History",
    "subCategory": "B: 1800s",
    "question": "75. What was <u>one</u> important thing that Abraham Lincoln did?*",
    "answer": "- freed the slaves (Emancipation Proclamation)\r\n- saved (or preserved) the Union\r\n- led the United States during the Civil War",
    "questionWithAsterisk": "Yes",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 76,
    "category": "American History",
    "subCategory": "B: 1800s",
    "question": "76. What did the Emancipation Proclamation do?",
    "answer": "- freed the slaves\r\n- freed slaves in the Confederacy\r\n- freed slaves in the Confederate states\r\n- freed slaves in most Southern states",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 77,
    "category": "American History",
    "subCategory": "B: 1800s",
    "question": "77. What did Susan B. Anthony do?",
    "answer": "- fought for women’s rights\r\n- fought for civil rights",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 78,
    "category": "American History",
    "subCategory": "B: 1800s",
    "question": "78. Name <u>one</u> war fought by the United States in the 1900s.*",
    "answer": "- World War I\r\n- World War II\r\n- Korean War\r\n- Vietnam War\r\n- (Persian) Gulf War",
    "questionWithAsterisk": "Yes",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 79,
    "category": "American History",
    "subCategory": "C: Recent American History and Other Important Historical Information",
    "question": "79. Who was President during World War I?",
    "answer": "- (Woodrow) Wilson",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 80,
    "category": "American History",
    "subCategory": "C: Recent American History and Other Important Historical Information",
    "question": "80. Who was President during the Great Depression and World War II?",
    "answer": "- (Franklin) Roosevelt",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 81,
    "category": "American History",
    "subCategory": "C: Recent American History and Other Important Historical Information",
    "question": "81. Who did the United States fight in World War II?",
    "answer": "- Japan, Germany, and Italy",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 82,
    "category": "American History",
    "subCategory": "C: Recent American History and Other Important Historical Information",
    "question": "82. Before he was President, Eisenhower was a general. What war was he in?",
    "answer": "- World War II",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 83,
    "category": "American History",
    "subCategory": "C: Recent American History and Other Important Historical Information",
    "question": "83. During the Cold War, what was the main concern of the United States?",
    "answer": "- Communism",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 84,
    "category": "American History",
    "subCategory": "C: Recent American History and Other Important Historical Information",
    "question": "84. What movement tried to end racial discrimination?",
    "answer": "- civil rights (movement)",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 85,
    "category": "American History",
    "subCategory": "C: Recent American History and Other Important Historical Information",
    "question": "85. What did Martin Luther King, Jr. do?*",
    "answer": "- fought for civil rights\r\n- worked for equality for all Americans",
    "questionWithAsterisk": "Yes",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 86,
    "category": "American History",
    "subCategory": "C: Recent American History and Other Important Historical Information",
    "question": "86. What major event happened on September 11, 2001, in the United States?",
    "answer": "- Terrorists attacked the United States.",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 87,
    "category": "American History",
    "subCategory": "C: Recent American History and Other Important Historical Information",
    "question": "87. Name <u>one</u> American Indian tribe in the United States.",
    "answer": "[USCIS Officers will be supplied with a list of federally recognized American Indian tribes.]\r\n- Cherokee\r\n- Navajo\r\n- Sioux\r\n- Chippewa\r\n- Choctaw\r\n- Pueblo\r\n- Apache\r\n- Iroquois\r\n- Creek\r\n- Blackfeet\r\n- Seminole\r\n- Cheyenne\r\n- Arawak\r\n- Shawnee\r\n- Mohegan\r\n- Huron\r\n- Oneida\r\n- Lakota\r\n- Crow\r\n- Teton\r\n- Hopi\r\n- Inuit",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 88,
    "category": "Integrated Civics",
    "subCategory": "A: Geography",
    "question": "88. Name <u>one</u> of the two longest rivers in the United States.",
    "answer": "- Missouri (River)\r\n- Mississippi (River)",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 89,
    "category": "Integrated Civics",
    "subCategory": "A: Geography",
    "question": "89. What ocean is on the West Coast of the United States?",
    "answer": "- Pacific (Ocean)",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 90,
    "category": "Integrated Civics",
    "subCategory": "A: Geography",
    "question": "90. What ocean is on the East Coast of the United States?",
    "answer": "- Atlantic (Ocean)",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 91,
    "category": "Integrated Civics",
    "subCategory": "A: Geography",
    "question": "91. Name <u>one</u> U.S. territory.",
    "answer": "- Puerto Rico\r\n- U.S. Virgin Islands\r\n- American Samoa\r\n- Northern Mariana Islands\r\n- Guam",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 92,
    "category": "Integrated Civics",
    "subCategory": "A: Geography",
    "question": "92. Name <u>one</u> state that borders Canada",
    "answer": "- Maine\r\n- New Hampshire\r\n- Vermont\r\n- New York\r\n- Pennsylvania\r\n- Ohio\r\n- Michigan\r\n- Minnesota\r\n- North Dakota\r\n- Montana\r\n- Idaho\r\n- Washington\r\n- Alaska",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 93,
    "category": "Integrated Civics",
    "subCategory": "A: Geography",
    "question": "93. Name <u>one</u> state that borders Mexico",
    "answer": "- California\r\n- Arizona\r\n- New Mexico\r\n- Texas",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 94,
    "category": "Integrated Civics",
    "subCategory": "A: Geography",
    "question": "94. What is the capital of the United States?*",
    "answer": "- Washington, D.C.",
    "questionWithAsterisk": "Yes",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 95,
    "category": "Integrated Civics",
    "subCategory": "A: Geography",
    "question": "95. Where is the Statue of Liberty?*",
    "answer": "- New York (Harbor)\r\n- Liberty Island\r\n[Also acceptable are New Jersey, near New York City, and on the Hudson (River).]",
    "questionWithAsterisk": "Yes",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 96,
    "category": "Integrated Civics",
    "subCategory": "B: Symbols",
    "question": "96. Why does the flag have 13 stripes?",
    "answer": "- because there were 13 original colonies\r\n- because the stripes represent the original colonies",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 97,
    "category": "Integrated Civics",
    "subCategory": "B: Symbols",
    "question": "97. Why does the flag have 50 stars?*",
    "answer": "- because there is one star for each state\r\n- because each star represents a state\r\n- because there are 50 states",
    "questionWithAsterisk": "Yes",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 98,
    "category": "Integrated Civics",
    "subCategory": "B: Symbols",
    "question": "98. What is the name of the national anthem?",
    "answer": "- The Star-Spangled Banner",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 99,
    "category": "Integrated Civics",
    "subCategory": "C: Holidays",
    "question": "99. When do we celebrate Independence Day?*",
    "answer": "- July 4",
    "questionWithAsterisk": "Yes",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  },
  {
    "id": 100,
    "category": "Integrated Civics",
    "subCategory": "C: Holidays",
    "question": "100. Name <u>two</u> national U.S. holidays.",
    "answer": "- New Year’s Day\r\n- Martin Luther King, Jr. Day\r\n- Presidents’ Day\r\n- Memorial Day\r\n- Juneteenth\r\n- Independence Day\r\n- Labor Day\r\n- Columbus Day\r\n- Veterans Day\r\n- Thanksgiving\r\n- Christmas",
    "questionWithAsterisk": "No",
    "civicsTestUpdates": "No",
    "bookmark": "No",
    "asked": "No"
  }
];