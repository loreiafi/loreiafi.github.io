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
const ADMIN_UNLOCK_KEY = "bocconiAdminUnlocked";
const ADMIN_OVERRIDES_KEY = "bocconiAdminOverrides";
const ADMIN_DELETED_KEY = "bocconiAdminDeleted";
const ADMIN_ACCESS_KEY =
  (typeof window !== "undefined" && window.ADMIN_ACCESS_KEY) || "";

const state = {
  admissions: [],
  ready: false,
  chart: null,
  chartFocus: "",
  candidatePoint: null,
  sessionData: [],
  adminUnlocked: false,
  adminOverrides: { intake: {}, profiles: {} },
  adminDeleted: { intake: {}, profiles: {} },
  sessionChart: null,
  sessionSubmitted: false,
  sessionUserEntry: null,
  sessionFingerprint: null,
};

document.addEventListener("DOMContentLoaded", () => {
  initMobileNavigation();
  initSessionSwitch();
  bootstrapSessionSubmissionFlag();
  bootstrapAdminPersistence();
  hydrateCourseSelect();
  attachCalculator();
  attachSatButton();
  attachLoginForm();
  initAdminModule();
  setupChartModule();
  loadAdmissions();
  initResultsModal();
  initSessionModule();
});

function initMobileNavigation() {
  const toggle = document.getElementById("navToggle");
  const panel = document.getElementById("mobileNav");
  if (!toggle || !panel) return;

  const closeMenu = () => {
    document.body.classList.remove("nav-open");
    toggle.setAttribute("aria-expanded", "false");
    panel.setAttribute("aria-hidden", "true");
  };

  toggle.addEventListener("click", () => {
    const willOpen = !document.body.classList.contains("nav-open");
    document.body.classList.toggle("nav-open", willOpen);
    toggle.setAttribute("aria-expanded", String(willOpen));
    panel.setAttribute("aria-hidden", String(!willOpen));
  });

  panel.addEventListener("click", (event) => {
    if (event.target === panel || event.target.classList.contains("mobile-nav__link")) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
    }
  });
}

function initSessionSwitch() {
  const select = document.getElementById("sessionFilterSelect");
  const chips = Array.from(document.querySelectorAll(".session-chip[data-session-choice]"));
  if (!select || chips.length === 0) return;

  const syncFromSelect = () => {
    chips.forEach((chip) => {
      const isActive = chip.dataset.sessionChoice === select.value;
      chip.classList.toggle("is-active", isActive);
      chip.setAttribute("aria-selected", String(isActive));
    });
  };

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const value = chip.dataset.sessionChoice;
      if (!value) return;
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      select.dispatchEvent(new Event("input", { bubbles: true }));
      syncFromSelect();
      updateCalculator();
    });
  });

  select.addEventListener("change", syncFromSelect);
  syncFromSelect();
}

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

    const adminId = `profile-${Date.now()}`;
    localStorage.setItem("bocconiAccessProfile", JSON.stringify(data));
    const existing = readStoredProfiles();
    existing.push({
      ...data,
      __adminId: adminId,
      timestamp: new Date().toISOString(),
    });
    localStorage.setItem("bocconiAccessProfiles", JSON.stringify(existing));
    feedback.textContent = "Profilo salvato in locale. Reindirizzamento...";
    form.classList.add("is-submitted");

    setTimeout(() => {
      window.location.href = "index.html";
    }, 1200);
  });
}

function initAdminModule() {
  const unlockForm = document.getElementById("adminUnlockForm");
  const logoutBtn = document.getElementById("adminLogout");
  if (!unlockForm) return;

  unlockForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = document.getElementById("adminMessage");
    const input = document.getElementById("adminAccessKey");
    const value = String(input?.value || "").trim();

    if (!ADMIN_ACCESS_KEY || ADMIN_ACCESS_KEY === "cambia-questa-chiave-admin") {
      if (message) {
        message.textContent = "Configura prima window.ADMIN_ACCESS_KEY in index.html.";
        message.classList.add("error");
      }
      return;
    }

    if (value !== ADMIN_ACCESS_KEY) {
      if (message) {
        message.textContent = "Chiave admin non valida.";
        message.classList.add("error");
      }
      return;
    }

    state.adminUnlocked = true;
    sessionStorage.setItem(ADMIN_UNLOCK_KEY, "1");
    if (message) {
      message.textContent = "Accesso admin effettuato.";
      message.classList.remove("error");
    }
    renderAdminPanel();
  });

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      state.adminUnlocked = false;
      sessionStorage.removeItem(ADMIN_UNLOCK_KEY);
      const input = document.getElementById("adminAccessKey");
      if (input) input.value = "";
      renderAdminPanel();
    });
  }

  renderAdminPanel();
  attachAdminEditors();
}

function bootstrapAdminPersistence() {
  loadAdminOverrides();
  loadAdminDeleted();
  state.adminUnlocked = sessionStorage.getItem(ADMIN_UNLOCK_KEY) === "1";

  window.addEventListener("storage", (event) => {
    if (!event.key || ![ADMIN_OVERRIDES_KEY, ADMIN_DELETED_KEY, "bocconiAccessProfiles", "bocconiAccessProfile"].includes(event.key)) {
      return;
    }

    loadAdminOverrides();
    loadAdminDeleted();
    if (state.sessionData.length) {
      state.sessionData = getMergedAdminIntakeRows();
      updateSessionDashboard();
      renderAdminPanel();
    }
  });
}

function renderAdminPanel() {
  const locked = document.getElementById("adminLocked");
  const body = document.getElementById("adminBody");
  if (!locked || !body) return;

  if (!state.adminUnlocked) {
    locked.style.display = "block";
    body.hidden = true;
    return;
  }

  locked.style.display = "none";
  body.hidden = false;
  renderAdminIntakeTable();
  renderAdminProfilesTable();
}

function renderAdminIntakeTable() {
  const container = document.getElementById("adminIntakeTable");
  if (!container) return;
  const rowsData = getMergedAdminIntakeRows();
  if (!rowsData.length) {
    container.innerHTML = "<p>Nessun dato intake disponibile.</p>";
    return;
  }

  const rows = rowsData
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .map((entry) => {
      const courses = escapeHtml((entry.courses || []).join(", "));
      return `
        <tr data-admin-row="${escapeHtml(entry.fingerprint || entry.id)}">
          <td data-label="Nome"><input class="admin-cell-input" data-field="firstName" value="${escapeHtml(entry.firstName || "")}" /></td>
          <td data-label="Cognome"><input class="admin-cell-input" data-field="lastName" value="${escapeHtml(entry.lastName || "")}" /></td>
          <td data-label="Label"><input class="admin-cell-input" data-field="name" value="${escapeHtml(entry.name || "")}" /></td>
          <td data-label="Anon"><label class="admin-check"><input type="checkbox" data-field="anon" ${entry.anon ? "checked" : ""} /></label></td>
          <td data-label="Sessione">
            <select class="admin-cell-input" data-field="session">
              ${["early", "winter", "spring"].map((session) => `<option value="${session}" ${normalizeSession(entry.session) === session ? "selected" : ""}>${session}</option>`).join("")}
            </select>
          </td>
          <td data-label="GPA"><input class="admin-cell-input" data-field="media" type="number" step="0.01" value="${Number(entry.media || 0).toFixed(2)}" /></td>
          <td data-label="Tipo">
            <select class="admin-cell-input" data-field="scoreType">
              ${["score", "sat", "act"].map((type) => `<option value="${type}" ${String(entry.scoreType || "score") === type ? "selected" : ""}>${type}</option>`).join("")}
            </select>
          </td>
          <td data-label="Raw"><input class="admin-cell-input" data-field="rawScore" type="number" step="0.01" value="${Number(entry.rawScore || 0).toFixed(2)}" /></td>
          <td data-label="Score"><input class="admin-cell-input" data-field="bocconiScore" type="number" step="0.01" value="${Number(entry.bocconiScore || 0).toFixed(2)}" /></td>
          <td data-label="Corsi"><input class="admin-cell-input" data-field="courses" value="${courses}" /></td>
          <td data-label="Fingerprint"><input class="admin-cell-input" data-field="fingerprint" value="${escapeHtml(entry.fingerprint || "")}" /></td>
          <td data-label="Timestamp"><input class="admin-cell-input" data-field="timestamp" value="${escapeHtml(entry.timestamp || "")}" /></td>
          <td data-label="Azioni" class="admin-actions-cell">
            <button type="button" class="micro-btn admin-save-row">💾</button>
            <button type="button" class="micro-btn admin-reset-row">↩</button>
            <button type="button" class="micro-btn admin-delete-row">❌</button>
          </td>
        </tr>
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Cognome</th>
            <th>Label</th>
            <th>Anon</th>
            <th>Sessione</th>
            <th>GPA</th>
            <th>Tipo</th>
            <th>Raw</th>
            <th>Score</th>
            <th>Corsi</th>
            <th>Fingerprint</th>
            <th>Timestamp</th>
            <th>Azioni</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderAdminProfilesTable() {
  const container = document.getElementById("adminProfilesTable");
  if (!container) return;

  const profiles = getMergedAdminProfiles();
  if (!profiles.length) {
    container.innerHTML = "<p>Nessun profilo registrato nel browser locale.</p>";
    return;
  }

  const rows = profiles
    .map((profile) => `
      <tr data-admin-profile-row="${escapeHtml(profile.__adminId)}">
        <td data-label="Nome"><input class="admin-cell-input" data-field="firstName" value="${escapeHtml(profile.firstName || "")}" /></td>
        <td data-label="Cognome"><input class="admin-cell-input" data-field="lastName" value="${escapeHtml(profile.lastName || "")}" /></td>
        <td data-label="Email"><input class="admin-cell-input" data-field="email" value="${escapeHtml(profile.email || "")}" /></td>
        <td data-label="Nazionalita"><input class="admin-cell-input" data-field="nationality" value="${escapeHtml(profile.nationality || "")}" /></td>
        <td data-label="Target"><input class="admin-cell-input" data-field="targetCourse" value="${escapeHtml(profile.targetCourse || "")}" /></td>
        <td data-label="Telefono"><input class="admin-cell-input" data-field="phone" value="${escapeHtml(profile.phone || "")}" /></td>
        <td data-label="Timestamp"><input class="admin-cell-input" data-field="timestamp" value="${escapeHtml(profile.timestamp || "")}" /></td>
        <td data-label="Azioni" class="admin-actions-cell">
          <button type="button" class="micro-btn admin-save-row">💾</button>
          <button type="button" class="micro-btn admin-reset-row">↩</button>
          <button type="button" class="micro-btn admin-delete-row">❌</button>
        </td>
      </tr>
    `)
    .join("");

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Cognome</th>
            <th>Email</th>
            <th>Nazionalita</th>
            <th>Target</th>
            <th>Telefono</th>
            <th>Timestamp</th>
            <th>Azioni</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function attachAdminEditors() {
  const intakeContainer = document.getElementById("adminIntakeTable");
  const profilesContainer = document.getElementById("adminProfilesTable");

  const handleClick = (event) => {
    const saveBtn = event.target.closest(".admin-save-row");
    const resetBtn = event.target.closest(".admin-reset-row");
    const deleteBtn = event.target.closest(".admin-delete-row");
    const row = event.target.closest("tr");
    if (!row) return;

    if (saveBtn) {
      if (row.closest("#adminIntakeTable")) {
        saveAdminIntakeRow(row);
      } else if (row.closest("#adminProfilesTable")) {
        saveAdminProfileRow(row);
      }
      return;
    }

    if (resetBtn) {
      if (row.closest("#adminIntakeTable")) {
        resetAdminIntakeRow(row);
      } else if (row.closest("#adminProfilesTable")) {
        resetAdminProfileRow(row);
      }
      return;
    }

    if (deleteBtn) {
      if (row.closest("#adminIntakeTable")) {
        deleteAdminIntakeRow(row);
      } else if (row.closest("#adminProfilesTable")) {
        deleteAdminProfileRow(row);
      }
    }
  };

  intakeContainer?.addEventListener("click", handleClick);
  profilesContainer?.addEventListener("click", handleClick);
}

function loadAdminOverrides() {
  try {
    const raw = localStorage.getItem(ADMIN_OVERRIDES_KEY);
    if (!raw) {
      state.adminOverrides = { intake: {}, profiles: {} };
      return;
    }
    const parsed = JSON.parse(raw);
    state.adminOverrides = {
      intake: parsed?.intake || {},
      profiles: parsed?.profiles || {},
    };
  } catch (error) {
    console.warn("Override admin non valide", error);
    state.adminOverrides = { intake: {}, profiles: {} };
  }
}

function loadAdminDeleted() {
  try {
    const raw = localStorage.getItem(ADMIN_DELETED_KEY);
    if (!raw) {
      state.adminDeleted = { intake: {}, profiles: {} };
      return;
    }
    const parsed = JSON.parse(raw);
    state.adminDeleted = {
      intake: parsed?.intake || {},
      profiles: parsed?.profiles || {},
    };
  } catch (error) {
    console.warn("Eliminazioni admin non valide", error);
    state.adminDeleted = { intake: {}, profiles: {} };
  }
}

function saveAdminOverrides() {
  localStorage.setItem(ADMIN_OVERRIDES_KEY, JSON.stringify(state.adminOverrides));
}

function saveAdminDeleted() {
  localStorage.setItem(ADMIN_DELETED_KEY, JSON.stringify(state.adminDeleted));
}

function getMergedAdminIntakeRows() {
  const baseRows = Array.isArray(state.sessionData) ? state.sessionData : [];
  return baseRows.map((row) => {
    const key = row.fingerprint || row.id;
    if (key && state.adminDeleted.intake[key]) {
      return null;
    }
    const override = key ? state.adminOverrides.intake[key] : null;
    return override ? { ...row, ...override } : row;
  }).filter(Boolean);
}

function getMergedAdminProfiles() {
  const baseProfiles = readStoredProfiles();
  return baseProfiles.map((profile, index) => {
    const adminId = profile.timestamp || profile.email || `${profile.firstName || "profile"}-${index}`;
    if (state.adminDeleted.profiles[adminId]) {
      return null;
    }
    const override = state.adminOverrides.profiles[adminId];
    return {
      ...profile,
      __adminId: adminId,
      ...(override || {}),
    };
  }).filter(Boolean);
}

function getRowFieldValue(row, field) {
  const selector = `[data-field="${field}"]`;
  const input = row.querySelector(selector);
  if (!input) return "";
  if (input.type === "checkbox") return input.checked;
  return input.value;
}

function saveAdminIntakeRow(row) {
  const id = row.dataset.adminRow;
  if (!id) return;

  const current = getMergedAdminIntakeRows().find((item) => (item.fingerprint || item.id) === id);
  if (!current) return;

  const updated = {
    ...current,
    firstName: getRowFieldValue(row, "firstName").trim(),
    lastName: getRowFieldValue(row, "lastName").trim(),
    name: getRowFieldValue(row, "name").trim(),
    anon: Boolean(getRowFieldValue(row, "anon")),
    session: normalizeSession(getRowFieldValue(row, "session")) || current.session,
    media: parseFloat(getRowFieldValue(row, "media")) || 0,
    scoreType: getRowFieldValue(row, "scoreType").trim() || current.scoreType,
    rawScore: parseFloat(getRowFieldValue(row, "rawScore")) || 0,
    bocconiScore: parseFloat(getRowFieldValue(row, "bocconiScore")) || 0,
    courses: sanitizeCourses(getRowFieldValue(row, "courses")),
    fingerprint: getRowFieldValue(row, "fingerprint").trim() || current.fingerprint,
    timestamp: getRowFieldValue(row, "timestamp").trim() || current.timestamp,
  };

  state.adminOverrides.intake[id] = updated;
  saveAdminOverrides();
  state.sessionData = getMergedAdminIntakeRows();
  renderAdminPanel();
  updateSessionDashboard();
}

function resetAdminIntakeRow(row) {
  const id = row.dataset.adminRow;
  if (!id) return;
  delete state.adminOverrides.intake[id];
  saveAdminOverrides();
  state.sessionData = getMergedAdminIntakeRows();
  renderAdminPanel();
  updateSessionDashboard();
}

function deleteAdminIntakeRow(row) {
  const id = row.dataset.adminRow;
  if (!id) return;
  delete state.adminOverrides.intake[id];
  state.adminDeleted.intake[id] = true;
  saveAdminOverrides();
  saveAdminDeleted();
  state.sessionData = getMergedAdminIntakeRows();
  renderAdminPanel();
  updateSessionDashboard();
}

function saveAdminProfileRow(row) {
  const id = row.dataset.adminProfileRow;
  if (!id) return;

  const updated = {
    firstName: getRowFieldValue(row, "firstName").trim(),
    lastName: getRowFieldValue(row, "lastName").trim(),
    email: getRowFieldValue(row, "email").trim(),
    nationality: getRowFieldValue(row, "nationality").trim(),
    targetCourse: getRowFieldValue(row, "targetCourse").trim(),
    phone: getRowFieldValue(row, "phone").trim(),
    timestamp: getRowFieldValue(row, "timestamp").trim(),
  };

  state.adminOverrides.profiles[id] = updated;
  saveAdminOverrides();
  renderAdminPanel();
}

function resetAdminProfileRow(row) {
  const id = row.dataset.adminProfileRow;
  if (!id) return;
  delete state.adminOverrides.profiles[id];
  saveAdminOverrides();
  renderAdminPanel();
}

function deleteAdminProfileRow(row) {
  const id = row.dataset.adminProfileRow;
  if (!id) return;

  delete state.adminOverrides.profiles[id];
  state.adminDeleted.profiles[id] = true;

  const profiles = readStoredProfiles().filter((profile, index) => {
    const profileId = profile.__adminId || profile.timestamp || profile.email || `${profile.firstName || "profile"}-${index}`;
    return profileId !== id;
  });

  saveStoredProfiles(profiles);
  saveAdminOverrides();
  saveAdminDeleted();
  renderAdminPanel();
}

function readStoredProfiles() {
  const multi = localStorage.getItem("bocconiAccessProfiles");
  if (multi) {
    try {
      const parsed = JSON.parse(multi);
      if (Array.isArray(parsed)) {
        return parsed
          .map((profile, index) => ({
            ...profile,
            __adminId: profile.__adminId || profile.timestamp || profile.email || `${profile.firstName || "profile"}-${index}`,
          }))
          .filter((profile) => !state.adminDeleted.profiles[profile.__adminId]);
      }
    } catch (error) {
      console.warn("Profili multipli non validi", error);
    }
  }

  const single = localStorage.getItem("bocconiAccessProfile");
  if (!single) return [];
  try {
    const parsed = JSON.parse(single);
    const profile = {
      ...parsed,
      __adminId: parsed.__adminId || parsed.timestamp || parsed.email || `${parsed.firstName || "profile"}-0`,
    };
    return state.adminDeleted.profiles[profile.__adminId] ? [] : [profile];
  } catch (error) {
    console.warn("Profilo singolo non valido", error);
    return [];
  }
}

function saveStoredProfiles(profiles) {
  if (!Array.isArray(profiles) || profiles.length === 0) {
    localStorage.removeItem("bocconiAccessProfiles");
    localStorage.removeItem("bocconiAccessProfile");
    return;
  }

  const payload = profiles.map((profile) => {
    const { __adminId, ...rest } = profile;
    return {
      ...rest,
      __adminId,
    };
  });

  localStorage.setItem("bocconiAccessProfiles", JSON.stringify(payload));
  localStorage.setItem("bocconiAccessProfile", JSON.stringify(payload[0]));
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
  renderAdminPanel();
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
  state.sessionData = getMergedAdminIntakeRows();
  renderAdminPanel();
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
      renderAdminPanel();
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
