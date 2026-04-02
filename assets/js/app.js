const MEDIA_RANGE = { min: 6, max: 10 };
const SCORE_RANGE = { min: 17, max: 50 };
const SAT_RANGE = { min: 1040, max: 1600 };
const ACT_RANGE = { min: 11, max: 36 };
const WEIGHTS = { media: 0.45, score: 0.55 };
const SESSION_API_URL =
  (typeof window !== "undefined" && window.SESSION_API_URL) ||
  (typeof window !== "undefined" && window.__SESSION_API__) ||
  "";
const SESSION_PROXY_URL =
  (typeof window !== "undefined" && window.SESSION_PROXY_URL) ||
  "https://cors.isomorphic-git.org/";
const SUBMISSION_KEY = "bocconiSessionSubmission";
const FINGERPRINT_KEY = "bocconiSessionFingerprint";

const state = {
  admissions: [],
  ready: false,
  chart: null,
  chartFocus: "",
  candidatePoint: null,
  sessionData: [],
  sessionChart: null,
  sessionSubmitted: false,
  sessionUserEntry: null,
  sessionFingerprint: null,
};

document.addEventListener("DOMContentLoaded", () => {
  bootstrapSessionSubmissionFlag();
  hydrateCourseSelect();
  attachCalculator();
  attachSatButton();
  attachLoginForm();
  setupChartModule();
  loadAdmissions();
  initResultsModal();
  initSessionModule();
});

function loadAdmissions() {
  fetch("data/admissions.csv")
    .then((response) => {
      if (!response.ok) {
        throw new Error("Impossibile caricare il CSV");
      }
      return response.text();
    })
    .then((text) => {
      state.admissions = parseCsv(text);
      state.ready = true;
      hydrateCourseSelect(state.admissions);
      const chartSelect = document.getElementById("chartCourseSelect");
      state.chartFocus = chartSelect ? chartSelect.value : "";
      updateChartCaption(state.chartFocus);
      renderAdmissionsChart();
      updateCalculator();
    })
    .catch((error) => {
      const results = document.getElementById("results");
      if (results) {
        results.innerHTML = `<p>Errore durante il caricamento dei dati: ${error.message}</p>`;
      }
    });
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];

  const headers = lines[0].split(",").map((chunk) => chunk.trim().toLowerCase());

  return lines.slice(1).map((line) => {
    const values = line.split(",").map((chunk) => chunk.trim());
    const row = headers.reduce((acc, header, index) => {
      acc[header] = values[index] ?? "";
      return acc;
    }, {});

    const course = row.course || row.courses || "";
    const session = normalizeSession(row.session) || "early";
    const minMedia = parseFloat(row.min_media ?? row.minmedia ?? row.media ?? row.gpa);
    const minScore = parseFloat(row.min_score ?? row.minscore ?? row.score);

    return {
      course,
      session,
      minMedia,
      minScore,
    };
  }).filter((row) => row.course && Number.isFinite(row.minMedia) && Number.isFinite(row.minScore));
}

function hydrateCourseSelect(data = []) {
  const selectIds = ["courseSelect", "chartCourseSelect"];
  const uniqueCourses = [...new Set(data.map((row) => row.course).filter(Boolean))];
  selectIds.forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = '<option value="">Tutti i corsi</option>';
    if (uniqueCourses.length === 0) return;
    uniqueCourses.forEach((course) => {
      const option = document.createElement("option");
      option.value = course;
      option.textContent = course;
      select.appendChild(option);
    });
  });
}

function attachCalculator() {
  const form = document.getElementById("calculator-form");
  if (!form) return;

  form.addEventListener("input", (event) => {
    // Re-render as the user types for immediacy.
    if (event.target.matches("input, select")) {
      updateCalculator(event);
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    updateCalculator(event);
  });

  updateCalculator();
}

function normalizeSession(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["early", "winter", "spring"].includes(normalized)) {
    return normalized;
  }
  return "";
}

function getSelectedSession() {
  const sessionSelect = document.getElementById("sessionFilterSelect");
  return normalizeSession(sessionSelect?.value) || "early";
}

function attachSatButton() {
  const button = document.getElementById("satButton");
  const scoreField = document.getElementById("scoreInput");
  if (!button || !scoreField) return;

  button.addEventListener("click", () => {
    const rawValue = prompt("Inserisci il punteggio SAT (1040-1600)");
    if (rawValue === null) return;
    const satValue = Number(rawValue.trim());
    if (Number.isNaN(satValue)) {
      alert("Inserisci un numero valido per il SAT.");
      return;
    }
    if (satValue < SAT_RANGE.min || satValue > SAT_RANGE.max) {
      alert(`Il SAT deve essere tra ${SAT_RANGE.min} e ${SAT_RANGE.max}.`);
      return;
    }

    const normalized = (satValue - SAT_RANGE.min) / (SAT_RANGE.max - SAT_RANGE.min);
    const convertedScore = SCORE_RANGE.min + normalized * (SCORE_RANGE.max - SCORE_RANGE.min);
    scoreField.value = convertedScore.toFixed(2);
    scoreField.focus();
    scoreField.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function updateCalculator(event) {
  if (event) {
    event.preventDefault();
  }
  const form = document.getElementById("calculator-form");
  const mediaField = document.getElementById("mediaInput");
  const scoreField = document.getElementById("scoreInput");
  const select = document.getElementById("courseSelect");
  const session = getSelectedSession();
  if (!form || !mediaField || !scoreField) return;

  const media = parseFloat(mediaField.value);
  const score = parseFloat(scoreField.value);
  const focusCourse = select ? select.value : "";

  if (Number.isNaN(media) || Number.isNaN(score)) {
    setResultsHtml("Completa i campi per vedere il verdetto personalizzato.");
    resetSummary();
    updateCandidatePlot();
    return;
  }

  const normalizedMedia = normalize(media, MEDIA_RANGE);
  const normalizedScore = normalize(score, SCORE_RANGE);
  const weightedIndex = normalizedMedia * WEIGHTS.media + normalizedScore * WEIGHTS.score;
  const cutoffScore = getDynamicCutoff(focusCourse, session);
  const hasCutoff = typeof cutoffScore === "number";
  const isAdmitted = hasCutoff && weightedIndex >= cutoffScore;

  const admittedCourses = filterAdmissions(weightedIndex, focusCourse, session);
  const heroPercent = (weightedIndex * 100).toFixed(1);
  const cutoffPercent = hasCutoff ? (cutoffScore * 100).toFixed(1) : null;

  const listHtml = buildCourseList(admittedCourses, focusCourse, session, weightedIndex);
  const statusCopy = hasCutoff
    ? isAdmitted
      ? `Sessione ${session}: indice ${heroPercent}% ≥ ${cutoffPercent}%, profilo sopra soglia.`
      : `Sessione ${session}: indice ${heroPercent}% < ${cutoffPercent}%, lavora su media o score.`
    : "Carica i dati di ammissione per confrontare il tuo indice con la soglia minima.";

  setResultsHtml(listHtml);
  updateSummary(heroPercent, statusCopy, normalizedMedia, normalizedScore, isAdmitted, cutoffScore);
  updateCandidatePlot(media, score);
}

function filterAdmissions(candidateScore, focusCourse, session = "") {
  if (!state.ready || state.admissions.length === 0) return [];

  return state.admissions
    .map((row) => {
      const requiredScore = computeScoreValue(row.minMedia, row.minScore);
      return { ...row, requiredScore };
    })
    .filter((row) => {
      if (session && normalizeSession(row.session) !== session) return false;
      if (focusCourse && row.course !== focusCourse) return false;
      return candidateScore >= row.requiredScore;
    });
}

function buildCourseList(courses, focusCourse, session, candidateScore) {
  if (!state.ready) {
    return "<p>Caricamento soglie in corso...</p>";
  }

  if (courses.length === 0) {
    const courseMsg = focusCourse
      ? `per ${focusCourse}`
      : "per i corsi disponibili";
    return `<p class="result-empty">Ancora nessun corso ammissibile ${courseMsg} nella sessione ${session}. Migliora il punteggio combinato e l'Ammission Calculator aggiornerà il responso.</p>`;
  }

  const items = courses
    .map((course) => {
      const delta = candidateScore - course.requiredScore;
      const deltaLabel = `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)} pt`;
      return `
        <div class="course-item">
          <div>
            <strong>${course.course}</strong>
            <p class="tiny-text">Soglia ≥ ${(course.requiredScore * 100).toFixed(1)}%</p>
          </div>
          <span class="badge pass">${deltaLabel}</span>
        </div>
      `;
    })
    .join("");

  return `<div class="course-list">${items}</div>`;
}

function setResultsHtml(markup) {
  const results = document.getElementById("results");
  if (results) {
    results.innerHTML = markup;
  }
}

function updateSummary(
  heroPercent,
  statusCopy,
  normalizedMedia,
  normalizedScore,
  isPositive,
  cutoffScore
) {
  const scoreValue = document.getElementById("heroScore");
  if (scoreValue) {
    const suffix = heroPercent === "--" ? "" : "%";
    scoreValue.textContent = `${heroPercent}${suffix}`;
  }

  const statusNode = document.getElementById("scoreStatus");
  if (statusNode) {
    statusNode.textContent = statusCopy;
    const hasDecision = typeof isPositive === "boolean";
    statusNode.classList.toggle("positive", hasDecision && Boolean(isPositive));
    statusNode.classList.toggle("negative", hasDecision && !isPositive);
  }

  const cutoffNode = document.getElementById("cutoffValue");
  if (cutoffNode) {
    cutoffNode.textContent = typeof cutoffScore === "number" ? `${(cutoffScore * 100).toFixed(1)}%` : "—";
  }

  const heroMediaBar = document.getElementById("heroMediaBar");
  if (heroMediaBar) {
    heroMediaBar.style.width = `${(normalizedMedia * 100).toFixed(1)}%`;
  }

  const heroScoreBar = document.getElementById("heroScoreBar");
  if (heroScoreBar) {
    heroScoreBar.style.width = `${(normalizedScore * 100).toFixed(1)}%`;
  }
}

function resetSummary() {
  updateSummary("--", "Completa i campi per vedere il verdetto personalizzato.", 0, 0, undefined, null);
}

function normalize(value, range) {
  const raw = (value - range.min) / (range.max - range.min);
  return Math.min(1, Math.max(0, raw));
}

function computeScoreValue(mediaValue, scoreValue) {
  const mediaNorm = normalize(mediaValue, MEDIA_RANGE);
  const scoreNorm = normalize(scoreValue, SCORE_RANGE);
  return mediaNorm * WEIGHTS.media + scoreNorm * WEIGHTS.score;
}

function getDynamicCutoff(focusCourse = "", session = "") {
  if (!state.ready || state.admissions.length === 0) {
    return null;
  }

  const filtered = focusCourse
    ? state.admissions.filter((row) => row.course === focusCourse)
    : state.admissions;

  const sessionFiltered = session
    ? filtered.filter((row) => normalizeSession(row.session) === session)
    : filtered;

  const universe = session ? sessionFiltered : filtered;

  if (universe.length === 0) {
    return null;
  }

  const values = universe
    .map((row) => computeScoreValue(row.minMedia, row.minScore))
    .filter((value) => typeof value === "number" && !Number.isNaN(value));

  if (values.length === 0) {
    return null;
  }

  return Math.min(...values);
}

function setupChartModule() {
  const canvas = document.getElementById("admissionsChart");
  if (!canvas || typeof Chart === "undefined") return;

  state.chart = new Chart(canvas, getChartConfig());
  const select = document.getElementById("chartCourseSelect");
  if (select) {
    select.addEventListener("change", (event) => {
      state.chartFocus = event.target.value;
      updateChartCaption(state.chartFocus);
      renderAdmissionsChart();
    });
  }

  const sessionSelect = document.getElementById("sessionFilterSelect");
  if (sessionSelect) {
    sessionSelect.addEventListener("change", () => {
      updateChartCaption(state.chartFocus);
      renderAdmissionsChart();
    });
  }

  updateChartCaption(state.chartFocus);
}

function getChartConfig() {
  return {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Soglie storiche",
          data: [],
          parsing: false,
          pointRadius: (context) => {
            const course = context.raw?.course;
            return state.chartFocus && course === state.chartFocus ? 8 : 5;
          },
          pointHoverRadius: 10,
          pointBackgroundColor: (context) => {
            const course = context.raw?.course;
            return state.chartFocus && course === state.chartFocus
              ? "#ff4f70"
              : "rgba(86, 207, 225, 0.7)";
          },
          pointBorderWidth: 0,
        },
        {
          label: "Trade-off equivalente",
          data: [],
          parsing: false,
          showLine: true,
          borderColor: "#ff4f70",
          borderWidth: 2,
          backgroundColor: "rgba(255, 79, 112, 0.15)",
          pointRadius: 0,
          tension: 0.25,
          hidden: true,
          spanGaps: false,
        },
        {
          label: "Il tuo profilo",
          data: [],
          parsing: false,
          pointRadius: 9,
          pointHoverRadius: 11,
          pointBackgroundColor: "#56cfe1",
          pointBorderColor: "#05060a",
          pointBorderWidth: 2,
          showLine: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "nearest",
        intersect: false,
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Score minimo",
          },
          min: SCORE_RANGE.min,
          max: SCORE_RANGE.max,
          grid: {
            color: "rgba(255, 255, 255, 0.08)",
          },
          ticks: {
            color: "rgba(255, 255, 255, 0.6)",
          },
        },
        y: {
          title: {
            display: true,
            text: "Media minima",
          },
          min: MEDIA_RANGE.min,
          max: MEDIA_RANGE.max,
          grid: {
            color: "rgba(255, 255, 255, 0.08)",
          },
          ticks: {
            color: "rgba(255, 255, 255, 0.6)",
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              if (context.dataset.label === "Trade-off equivalente") {
                const mediaVal = context.parsed?.y ?? 0;
                const scoreVal = context.parsed?.x ?? 0;
                const courseName = context.raw?.course;
                if (courseName) {
                  return `${courseName}: media ${mediaVal.toFixed(2)} ↔ score ${scoreVal.toFixed(1)}`;
                }
                return `Media ${mediaVal.toFixed(2)} ↔ score ${scoreVal.toFixed(1)}`;
              }
              const course = context.raw?.course || "Corso";
              const mediaVal = context.raw?.y ?? 0;
              const scoreVal = context.raw?.x ?? 0;
              return `${course}: media ${mediaVal.toFixed(2)} · score ${scoreVal.toFixed(1)}`;
            },
          },
        },
      },
    },
  };
}

function renderAdmissionsChart() {
  if (!state.chart) return;

  const scatterDataset = state.chart.data.datasets[0];
  const isoDataset = state.chart.data.datasets[1];
  const candidateDataset = state.chart.data.datasets[2];
  const selectedSession = getSelectedSession();
  const admissions = state.ready
    ? state.admissions.filter((row) => normalizeSession(row.session) === selectedSession)
    : [];

  if (!state.ready) {
    scatterDataset.data = [];
    isoDataset.data = [];
    isoDataset.hidden = true;
    if (candidateDataset) {
      candidateDataset.data = [];
    }
    state.chart.update();
    return;
  }

  if (!state.chartFocus) {
    scatterDataset.data = admissions.map((row) => ({
      x: row.minScore,
      y: row.minMedia,
      course: row.course,
    }));

    const isoSeries = [];
    admissions.forEach((row, idx) => {
      const series = buildIsoSeries(row, row.course);
      isoSeries.push(...series);
      if (idx < admissions.length - 1) {
        isoSeries.push({ x: null, y: null });
      }
    });

    isoDataset.data = isoSeries;
    isoDataset.hidden = isoDataset.data.length === 0;
    if (candidateDataset) {
      candidateDataset.data = state.candidatePoint ? [state.candidatePoint] : [];
    }
    state.chart.update();
    return;
  }

  const targetRow = admissions.find((row) => row.course === state.chartFocus);
  if (!targetRow) {
    scatterDataset.data = [];
    isoDataset.data = [];
    isoDataset.hidden = true;
    state.chart.update();
    return;
  }

  scatterDataset.data = [
    {
      x: targetRow.minScore,
      y: targetRow.minMedia,
      course: targetRow.course,
    },
  ];

  isoDataset.data = buildIsoSeries(targetRow, targetRow.course);
  isoDataset.hidden = isoDataset.data.length === 0;
  if (candidateDataset) {
    candidateDataset.data = state.candidatePoint ? [state.candidatePoint] : [];
  }
  state.chart.update();
}

function buildIsoSeries(courseRow, courseName = "") {
  const requiredScore = computeScoreValue(courseRow.minMedia, courseRow.minScore);
  const steps = 24;
  const points = [];

  for (let i = 0; i <= steps; i += 1) {
    const mediaValue = MEDIA_RANGE.min + ((MEDIA_RANGE.max - MEDIA_RANGE.min) * i) / steps;
    const scoreValue = solveScoreForMedia(mediaValue, requiredScore);
    if (scoreValue === null) continue;
    points.push({
      x: parseFloat(scoreValue.toFixed(2)),
      y: parseFloat(mediaValue.toFixed(2)),
      course: courseName || courseRow.course,
    });
  }

  return points;
}

function solveScoreForMedia(mediaValue, targetScore) {
  const mediaNorm = normalize(mediaValue, MEDIA_RANGE);
  const scoreNorm = (targetScore - WEIGHTS.media * mediaNorm) / WEIGHTS.score;
  if (scoreNorm < 0 || scoreNorm > 1) {
    return null;
  }
  const rawScore = SCORE_RANGE.min + scoreNorm * (SCORE_RANGE.max - SCORE_RANGE.min);
  if (rawScore < SCORE_RANGE.min || rawScore > SCORE_RANGE.max) {
    return null;
  }
  return rawScore;
}

function updateChartCaption(courseName) {
  const caption = document.getElementById("chartCaption");
  if (!caption) return;
  const session = getSelectedSession();
  caption.textContent = courseName
    ? `Sessione ${session} e filtro su ${courseName}: vedi il punto storico e la linea di combinazioni equivalenti media + score.`
    : `Sessione ${session} attiva: visualizzi tutte le soglie storiche di questa sessione.`;
}

function updateCandidatePlot(mediaValue, scoreValue) {
  if (
    typeof mediaValue === "number" &&
    typeof scoreValue === "number" &&
    !Number.isNaN(mediaValue) &&
    !Number.isNaN(scoreValue)
  ) {
    const clampedMedia = Math.min(Math.max(mediaValue, MEDIA_RANGE.min), MEDIA_RANGE.max);
    const clampedScore = Math.min(Math.max(scoreValue, SCORE_RANGE.min), SCORE_RANGE.max);
    state.candidatePoint = { x: clampedScore, y: clampedMedia, course: "Il tuo profilo" };
  } else {
    state.candidatePoint = null;
  }

  if (!state.chart) return;
  const candidateDataset = state.chart.data.datasets[2];
  if (!candidateDataset) return;

  candidateDataset.data = state.candidatePoint ? [state.candidatePoint] : [];
  state.chart.update();
}

/* Login page logic */
function attachLoginForm() {
  const form = document.getElementById("login-form");
  if (!form) return;

  const feedback = document.getElementById("loginFeedback");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!data.consent) {
      feedback.textContent = "È necessario accettare il consenso.";
      return;
    }

    localStorage.setItem("bocconiAccessProfile", JSON.stringify(data));
    feedback.textContent = "Profilo salvato in locale. Reindirizzamento...";
    form.classList.add("is-submitted");

    setTimeout(() => {
      window.location.href = "index.html";
    }, 1200);
  });
}

/* Session results logic */
function bootstrapSessionSubmissionFlag() {
  try {
    const cached = localStorage.getItem(SUBMISSION_KEY);
    if (!cached) return;
    const parsed = JSON.parse(cached);
    state.sessionSubmitted = true;
    state.sessionUserEntry = parsed;
    if (parsed?.fingerprint) {
      state.sessionFingerprint = parsed.fingerprint;
      localStorage.setItem(FINGERPRINT_KEY, parsed.fingerprint);
    }
  } catch (error) {
    console.warn("Impossibile ripristinare le submission locali", error);
  }
}

function initResultsModal() {
  const modal = document.getElementById("resultsModal");
  if (!modal) return;
  if (state.sessionSubmitted) {
    modal.setAttribute("aria-hidden", "true");
    modal.classList.remove("is-visible");
    return;
  }

  const confirmBtn = modal.querySelector('[data-gate="confirm"]');
  const laterBtn = modal.querySelector('[data-gate="later"]');
  const closeModal = () => {
    modal.classList.remove("is-visible");
    modal.setAttribute("aria-hidden", "true");
  };

  if (confirmBtn) {
    confirmBtn.addEventListener("click", () => {
      closeModal();
      const section = document.getElementById("sessioni");
      if (section) {
        section.scrollIntoView({ behavior: "smooth" });
      }
    });
  }

  if (laterBtn) {
    laterBtn.addEventListener("click", closeModal);
  }

  requestAnimationFrame(() => {
    modal.classList.add("is-visible");
    modal.setAttribute("aria-hidden", "false");
  });
}

async function initSessionModule() {
  attachSessionForm();
  attachDashboardRefresh();
  await hydrateFingerprint();
  await loadSessionData();
  updateSessionDashboard();
}

function attachDashboardRefresh() {
  const refreshBtn = document.getElementById("refreshDashboard");
  if (!refreshBtn) return;
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    const originalLabel = refreshBtn.textContent;
    refreshBtn.textContent = "Aggiorno...";
    try {
      await loadSessionData();
      updateSessionDashboard();
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = originalLabel || "Aggiorna dati";
    }
  });
}

async function hydrateFingerprint() {
  if (state.sessionFingerprint) {
    return state.sessionFingerprint;
  }

  const stored = localStorage.getItem(FINGERPRINT_KEY);
  if (stored) {
    state.sessionFingerprint = stored;
    return stored;
  }

  try {
    const response = await fetch("https://api.ipify.org?format=json");
    if (response.ok) {
      const payload = await response.json();
      state.sessionFingerprint = hashString(payload.ip || String(Date.now()));
    }
  } catch (error) {
    console.warn("Fingerprint IP non disponibile", error);
  }

  if (!state.sessionFingerprint) {
    state.sessionFingerprint = `local-${Date.now()}`;
  }

  localStorage.setItem(FINGERPRINT_KEY, state.sessionFingerprint);
  return state.sessionFingerprint;
}

async function loadSessionData() {
  state.sessionData = [];

  try {
    const remoteRows = await fetchSessionSheetData();
    state.sessionData = remoteRows;
  } catch (error) {
    console.warn("Errore nel recupero dei dati dal foglio", error);
    state.sessionData = [];
    reportSessionError(error.message);
  }

  appendLocalSubmission();
  return state.sessionData;
}

async function fetchSessionSheetData() {
  if (!SESSION_API_URL) {
    throw new Error("Endpoint Google Sheet non configurato");
  }

  const response = await fetchWithCors(SESSION_API_URL, {
    method: "GET",
    headers: {
      "Cache-Control": "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error(`Endpoint Google Sheet non disponibile (${response.status})`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((row, index) => normalizeSheetRow(row, index))
    .filter(Boolean);
}

function appendLocalSubmission() {
  if (!(state.sessionSubmitted && state.sessionUserEntry)) {
    return;
  }
  const exists = state.sessionData.some((row) => row.fingerprint === state.sessionUserEntry.fingerprint);
  if (!exists) {
    state.sessionData.push(state.sessionUserEntry);
  }
}

function reportSessionError(message) {
  const feedback = document.getElementById("sessionMessage");
  if (feedback) {
    feedback.textContent = `Errore dati sessioni: ${message}`;
    feedback.classList.add("error");
  }
  const locked = document.getElementById("dashboardLocked");
  if (locked) {
    locked.innerHTML = `<p>Impossibile recuperare i dati condivisi.</p><p>${escapeHtml(message)}</p>`;
  }
}

function normalizeSheetRow(row = {}, index = 0) {
  const media = parseFloat(row.media ?? row.gpa ?? row.Media ?? row.GPA);
  const bocconiScore = parseFloat(row.bocconiScore ?? row.score ?? row.Score ?? row.rawScore);
  if (Number.isNaN(media) || Number.isNaN(bocconiScore)) {
    return null;
  }

  const rawCourses = row.courses ?? row.coursePreferences ?? row.corsi ?? [];
  const courses = sanitizeCourses(rawCourses);
  const anonFlag = row.anon === true || row.anon === "true" || row.anon === 1;
  const firstName = row.firstName || row.nome || "Profilo";
  const lastName = row.lastName || row.cognome || "Community";

  return {
    id: row.id || row.fingerprint || row.timestamp || `sheet-${index}`,
    firstName,
    lastName,
    name: anonFlag ? "Profilo anonimo" : `${firstName} ${lastName}`.trim(),
    anon: anonFlag,
    session: row.session || row.sessione || "storico",
    media,
    rawScore: parseFloat(row.rawScore ?? row.score ?? bocconiScore) || bocconiScore,
    scoreType: row.scoreType || row.metric || "score",
    bocconiScore,
    combinedScore: computeScoreValue(media, bocconiScore),
    courses: courses.length ? courses : ["CORSO"],
    timestamp: row.timestamp || new Date().toISOString(),
    fingerprint: row.fingerprint || row.id || `sheet-${index}`,
  };
}

function attachSessionForm() {
  const form = document.getElementById("sessionForm");
  if (!form) return;

  if (state.sessionSubmitted) {
    lockSessionForm(form);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.sessionSubmitted) return;
    const formData = Object.fromEntries(new FormData(form));
    const feedback = document.getElementById("sessionMessage");

    try {
      const record = await buildUserSubmission(formData);
      state.sessionSubmitted = true;
      state.sessionUserEntry = record;
      state.sessionData.push(record);
      localStorage.setItem(SUBMISSION_KEY, JSON.stringify(record));
      if (record.fingerprint) {
        localStorage.setItem(FINGERPRINT_KEY, record.fingerprint);
      }
      await persistSubmissionSheet(record);
      if (feedback) {
        feedback.textContent = "Dati registrati correttamente. Dashboard sbloccata.";
      }
      lockSessionForm(form);
      updateSessionDashboard();
    } catch (error) {
      if (feedback) {
        feedback.textContent = error.message;
        feedback.classList.add("error");
      }
    }
  });
}

  function lockSessionForm(form) {
    const controls = form.querySelectorAll("input, select, textarea, button");
    controls.forEach((node) => {
      node.disabled = true;
    });
    const feedback = document.getElementById("sessionMessage");
    if (feedback) {
      feedback.textContent = "Hai gia inserito i dati: la dashboard restera disponibile.";
    }
  }

async function buildUserSubmission(formData) {
  const firstName = (formData.firstName || "").trim();
  const lastName = (formData.lastName || "").trim();
  const session = formData.session;
  const gpa = parseFloat(formData.gpa);
  const scoreType = formData.scoreType;
  const scoreValue = parseFloat(formData.scoreValue);
  const preferences = (formData.coursePreferences || "").trim();

  if (!firstName || !lastName) {
    throw new Error("Nome e cognome sono obbligatori.");
  }
  if (!session) {
    throw new Error("Seleziona la sessione d'ammissione.");
  }
  if (Number.isNaN(gpa) || gpa < MEDIA_RANGE.min || gpa > MEDIA_RANGE.max) {
    throw new Error("La media deve essere compresa tra 6 e 10.");
  }
  if (Number.isNaN(scoreValue)) {
    throw new Error("Inserisci un punteggio valido.");
  }

  const bocconiScore = convertScoreByType(scoreType, scoreValue);
  if (bocconiScore === null) {
    throw new Error("Il punteggio non rientra nei range consentiti.");
  }

  const courseList = sanitizeCourses(preferences);
  if (!courseList.length) {
    throw new Error("Inserisci almeno un corso di preferenza.");
  }

  const entity = {
    id: `user-${Date.now()}`,
    firstName,
    lastName,
    name: formData.anonymity ? "Profilo anonimo" : `${firstName} ${lastName}`,
    anon: Boolean(formData.anonymity),
    session,
    media: gpa,
    rawScore: scoreValue,
    scoreType,
    bocconiScore,
    combinedScore: computeScoreValue(gpa, bocconiScore),
    courses: courseList,
    timestamp: new Date().toISOString(),
    fingerprint: state.sessionFingerprint || (await hydrateFingerprint()),
  };

  return entity;
}

function convertScoreByType(type, value) {
  if (type === "score") {
    if (value < SCORE_RANGE.min || value > SCORE_RANGE.max) {
      return null;
    }
    return value;
  }

  if (type === "sat") {
    if (value < SAT_RANGE.min || value > SAT_RANGE.max) {
      return null;
    }
    const normalized = normalize(value, SAT_RANGE);
    return SCORE_RANGE.min + normalized * (SCORE_RANGE.max - SCORE_RANGE.min);
  }

  if (type === "act") {
    if (value < ACT_RANGE.min || value > ACT_RANGE.max) {
      return null;
    }
    const normalized = normalize(value, ACT_RANGE);
    return SCORE_RANGE.min + normalized * (SCORE_RANGE.max - SCORE_RANGE.min);
  }

  return null;
}

function sanitizeCourses(preferenceInput) {
  if (!preferenceInput) {
    return [];
  }

  let rawList = [];
  if (Array.isArray(preferenceInput)) {
    rawList = preferenceInput;
  } else {
    rawList = String(preferenceInput)
      .split(/[,|]/);
  }

  return rawList
    .map((chunk) => chunk.trim().toUpperCase())
    .filter(Boolean);
}

function updateSessionDashboard() {
  const locked = document.getElementById("dashboardLocked");
  const body = document.getElementById("dashboardBody");

  if (!locked || !body) return;

  if (!state.sessionSubmitted) {
    locked.style.display = "block";
    body.hidden = true;
    return;
  }

  locked.style.display = "none";
  body.hidden = false;

  renderSessionStats();
  renderSessionTable();
  renderSessionChart();
}

function renderSessionStats() {
  const container = document.getElementById("sessionStats");
  if (!container) return;
  const stats = computeSessionStats(state.sessionData);
  if (!stats) {
    container.innerHTML = "<p>Nessun dato disponibile.</p>";
    return;
  }

  container.innerHTML = `
    <div class="stat-card">
      <p>Indice medio</p>
      <strong>${stats.averageCombined.toFixed(1)}%</strong>
    </div>
    <div class="stat-card">
      <p>Media scolastica media</p>
      <strong>${stats.averageGpa.toFixed(2)}</strong>
    </div>
    <div class="stat-card">
      <p>Sessione dominante</p>
      <strong>${stats.topSession}</strong>
    </div>
    <div class="stat-card">
      <p>Corsi monitorati</p>
      <strong>${stats.courseCount}</strong>
    </div>
  `;
}

function computeSessionStats(entries) {
  if (!entries.length) return null;
  const combinedSum = entries.reduce((sum, row) => sum + (row.combinedScore || 0), 0);
  const gpaSum = entries.reduce((sum, row) => sum + (row.media || 0), 0);
  const sessions = entries.reduce((acc, row) => {
    const bucket = row.session || "storico";
    acc[bucket] = acc[bucket] || { total: 0, count: 0 };
    acc[bucket].total += row.combinedScore || 0;
    acc[bucket].count += 1;
    return acc;
  }, {});

  const topSession = Object.entries(sessions)
    .map(([name, data]) => ({ name, value: data.total / data.count }))
    .sort((a, b) => b.value - a.value)[0]?.name;

  const courses = new Set();
  entries.forEach((row) => {
    (row.courses || []).forEach((course) => courses.add(course));
  });

  return {
    averageCombined: (combinedSum / entries.length) * 100,
    averageGpa: gpaSum / entries.length,
    topSession: topSession ? topSession.charAt(0).toUpperCase() + topSession.slice(1) : "-",
    courseCount: courses.size,
  };
}

function renderSessionTable() {
  const container = document.getElementById("sessionTable");
  if (!container) return;
  if (!state.sessionData.length) {
    container.innerHTML = "<p>Nessun contributo ancora disponibile.</p>";
    return;
  }

  const latestEntries = [...state.sessionData]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 6);

  const rowsHtml = latestEntries
    .map((entry) => {
      const name = escapeHtml(entry.name || "Profilo");
      const sessionLabel = (entry.session || "storico").toUpperCase();
      const gpa = (entry.media || 0).toFixed(2);
      const score = (entry.bocconiScore || 0).toFixed(2);
      const combined = ((entry.combinedScore || 0) * 100).toFixed(1);
      const tags = (entry.courses || []).map(escapeHtml).join(", ");
      return `
        <div class="session-row">
          <div class="session-row__info">
            <strong>${name}</strong>
            <span class="course-tags">${tags}</span>
          </div>
          <div class="session-row__badge">${sessionLabel}</div>
          <div class="session-row__badge">GPA ${gpa}</div>
          <div class="session-row__badge">Score ${score}</div>
          <div class="session-row__badge">Indice ${combined}%</div>
        </div>
      `;
    })
    .join("");

  container.innerHTML = rowsHtml;
}

function renderSessionChart() {
  const canvas = document.getElementById("sessionChart");
  if (!canvas || typeof Chart === "undefined") return;

  const aggregates = getCourseAggregates(state.sessionData).slice(0, 6);
  const labels = aggregates.map((row) => row.course);
  const values = aggregates.map((row) => row.average * 100);

  if (!state.sessionChart) {
    state.sessionChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Indice combinato medio",
            data: values,
            backgroundColor: "rgba(86, 207, 225, 0.6)",
            borderRadius: 12,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            ticks: {
              color: "rgba(255, 255, 255, 0.6)",
              callback: (value) => `${value}%`,
            },
            grid: {
              color: "rgba(255, 255, 255, 0.08)",
            },
          },
          x: {
            ticks: {
              color: "rgba(255, 255, 255, 0.6)",
            },
            grid: {
              display: false,
            },
          },
        },
        plugins: {
          legend: { display: false },
        },
      },
    });
    return;
  }

  state.sessionChart.data.labels = labels;
  state.sessionChart.data.datasets[0].data = values;
  state.sessionChart.update();
}

function getCourseAggregates(entries) {
  const tally = new Map();
  entries.forEach((entry) => {
    (entry.courses || []).forEach((course) => {
      const key = course.toUpperCase();
      const bucket = tally.get(key) || { total: 0, count: 0, course: key };
      bucket.total += entry.combinedScore || 0;
      bucket.count += 1;
      tally.set(key, bucket);
    });
  });

  return Array.from(tally.values())
    .map((bucket) => ({ course: bucket.course, average: bucket.total / bucket.count }))
    .sort((a, b) => b.average - a.average);
}

async function persistSubmissionSheet(entry) {
  if (!SESSION_API_URL) {
    console.warn("Nessun endpoint Google Sheet configurato: salto la persistenza remota.");
    return;
  }

  const payload = {
    timestamp: entry.timestamp,
    firstName: entry.firstName,
    lastName: entry.lastName,
    anon: entry.anon,
    session: entry.session,
    media: entry.media,
    scoreType: entry.scoreType,
    rawScore: entry.rawScore,
    bocconiScore: entry.bocconiScore,
    courses: entry.courses,
    fingerprint: entry.fingerprint,
  };

  try {
    const formPayload = new URLSearchParams();
    Object.entries(payload).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        formPayload.append(key, value.join("|"));
      } else if (typeof value === "boolean") {
        formPayload.append(key, value ? "true" : "false");
      } else {
        formPayload.append(key, value ?? "");
      }
    });

    const response = await fetchWithCors(SESSION_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: formPayload.toString(),
    });

    if (!response.ok) {
      throw new Error(`Persistenza sheet fallita: ${response.status}`);
    }
  } catch (error) {
    console.warn("Scrittura Google Sheet non riuscita", error);
  }
}

async function fetchWithCors(url, options = {}) {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (!SESSION_PROXY_URL) {
      throw error;
    }
    const proxiedUrl = `${SESSION_PROXY_URL}${url}`;
    return fetch(proxiedUrl, options);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hashString(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return `fp-${Math.abs(hash)}`;
}
