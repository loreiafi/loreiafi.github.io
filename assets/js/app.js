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
const SUPABASE_URL =
  (typeof window !== "undefined" && window.SUPABASE_URL) || "";
const SUPABASE_ANON_KEY =
  (typeof window !== "undefined" && window.SUPABASE_ANON_KEY) || "";
const SUPABASE_ADMIN_EMAIL =
  (typeof window !== "undefined" && window.SUPABASE_ADMIN_EMAIL) || "";

let supabaseClient = null;

const state = {
  admissions: [],
  courseBoundaries: [],
  ready: false,
  chart: null,
  chartFocus: "",
  showRejectedAdmissions: false,
  candidatePoint: null,
  sessionData: [],
  adminUnlocked: false,
  adminOverrides: { intake: {}, profiles: {} },
  adminDeleted: { intake: {}, profiles: {} },
  supabaseProfiles: [],
  supabaseProfilesError: "",
  sessionDataError: "",
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

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const factory = window?.supabase?.createClient;
  if (typeof factory !== "function") {
    console.warn("Supabase SDK non disponibile nel browser.");
    return null;
  }
  supabaseClient = factory(SUPABASE_URL, SUPABASE_ANON_KEY);
  return supabaseClient;
}

function isSupabaseConfigured() {
  return Boolean(getSupabaseClient());
}

function mapAdmissionRow(row) {
  const course = row.course || row.courses || "";
  const session = normalizeSession(row.session) || "early";
  const minMedia = parseFloat(row.min_media ?? row.minmedia ?? row.media ?? row.gpa);
  const minScore = parseFloat(row.min_score ?? row.minscore ?? row.score);
  const admitted = normalizeAdmissionStatus(row.admitted ?? row.status ?? row.esito ?? row.decision);

  return {
    course,
    session,
    minMedia,
    minScore,
    admitted,
  };
}

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

async function loadAdmissions() {
  try {
    if (!isSupabaseConfigured()) {
      throw new Error("Supabase non configurato: impossibile caricare admissions.");
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from("admissions")
      .select("course,session,min_media,min_score,admitted,status,decision")
      .order("course", { ascending: true });

    if (error) {
      throw new Error(`Supabase admissions error: ${error.message}`);
    }

    const admissionsRows = Array.isArray(data) ? data.map(mapAdmissionRow) : [];

    state.admissions = admissionsRows.filter((row) => row.course && Number.isFinite(row.minMedia) && Number.isFinite(row.minScore));
    state.courseBoundaries = buildCourseBoundaries(state.admissions);
    state.ready = true;
    hydrateCourseSelect(state.admissions);
    const chartSelect = document.getElementById("chartCourseSelect");
    state.chartFocus = chartSelect ? chartSelect.value : "";
    updateChartCaption(state.chartFocus);
    renderAdmissionsChart();
    updateCalculator();
  } catch (error) {
    const results = document.getElementById("results");
    if (results) {
      results.innerHTML = `<p>Errore durante il caricamento dei dati: ${error.message}</p>`;
    }
  }
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

    return mapAdmissionRow(row);
  }).filter((row) => row.course && Number.isFinite(row.minMedia) && Number.isFinite(row.minScore));
}

function normalizeAdmissionStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (["ammesso", "ammessa", "admitted", "yes", "si", "true", "1", "pass"].includes(normalized)) {
    return "admitted";
  }

  if (["non ammesso", "non ammessa", "rejected", "no", "false", "0", "respinto", "fail"].includes(normalized)) {
    return "rejected";
  }

  return "";
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

function buildCourseBoundaries(rows) {
  const grouped = rows.reduce((acc, row) => {
    const key = `${row.course}__${normalizeSession(row.session) || "early"}`;
    if (!acc[key]) {
      acc[key] = {
        course: row.course,
        session: normalizeSession(row.session) || "early",
        allScores: [],
        admittedRows: [],
        rejectedRows: [],
      };
    }

    const score = computeScoreValue(row.minMedia, row.minScore);
    if (!Number.isFinite(score)) return acc;

    acc[key].allScores.push(score);
    if (row.admitted === "admitted") {
      acc[key].admittedRows.push({ ...row, totalScore: score });
    }
    if (row.admitted === "rejected") {
      acc[key].rejectedRows.push({ ...row, totalScore: score });
    }
    return acc;
  }, {});

  return Object.values(grouped).map((group) => ({
    course: group.course,
    session: group.session,
    admittedCutoff: group.admittedRows.length
      ? Math.min(...group.admittedRows.map((row) => row.totalScore))
      : (group.allScores.length ? Math.min(...group.allScores) : null),
    rejectedCutoff: group.rejectedRows.length
      ? Math.max(...group.rejectedRows.map((row) => row.totalScore))
      : null,
    admittedPoint: selectBoundaryPoint(group.admittedRows, "min"),
    rejectedPoint: selectBoundaryPoint(group.rejectedRows, "max"),
  }));
}

function selectBoundaryPoint(rows, mode) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const sorted = [...rows].sort((left, right) => left.totalScore - right.totalScore);
  const row = mode === "max" ? sorted[sorted.length - 1] : sorted[0];
  return {
    x: row.minScore,
    y: row.minMedia,
    course: row.course,
    session: row.session,
    admitted: row.admitted,
    totalScore: row.totalScore,
  };
}

function getBoundaryForCourse(course, session) {
  return state.courseBoundaries.find((boundary) => boundary.course === course && normalizeSession(boundary.session) === normalizeSession(session));
}

function getVisibleBoundaries(session, focusCourse, kind) {
  const normalizedSession = normalizeSession(session);
  return state.courseBoundaries.filter((boundary) => {
    if (normalizedSession && normalizeSession(boundary.session) !== normalizedSession) return false;
    if (focusCourse && boundary.course !== focusCourse) return false;
    if (kind === "admitted") return typeof boundary.admittedCutoff === "number";
    if (kind === "rejected") return typeof boundary.rejectedCutoff === "number";
    return true;
  });
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

  const matchingRows = state.admissions
    .map((row) => {
      const requiredScore = computeScoreValue(row.minMedia, row.minScore);
      return { ...row, requiredScore };
    })
    .filter((row) => {
      if (session && normalizeSession(row.session) !== session) return false;
      if (focusCourse && row.course !== focusCourse) return false;
      return candidateScore >= row.requiredScore;
    });

  const deduped = matchingRows.reduce((acc, row) => {
    const existing = acc.get(row.course);
    if (!existing || row.requiredScore < existing.requiredScore) {
      acc.set(row.course, row);
    }
    return acc;
  }, new Map());

  return [...deduped.values()].sort((left, right) => left.requiredScore - right.requiredScore);
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

  const rejectedToggle = document.getElementById("toggleRejectedButton");
  if (rejectedToggle) {
    rejectedToggle.addEventListener("click", () => {
      state.showRejectedAdmissions = !state.showRejectedAdmissions;
      updateRejectedToggleButton();
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

  updateRejectedToggleButton();
  updateChartCaption(state.chartFocus);
}

function getChartConfig() {
  return {
    type: "scatter",
    data: {
      datasets: [],
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
              if (context.dataset?.metaKind === "admitted-point" || context.dataset?.metaKind === "rejected-point") {
                const courseName = context.raw?.course || "Corso";
                const session = context.raw?.session || "";
                const totalScore = Number.isFinite(context.raw?.totalScore)
                  ? context.raw.totalScore
                  : computeScoreValue(context.raw?.y ?? MEDIA_RANGE.min, context.raw?.x ?? SCORE_RANGE.min);
                const mediaVal = context.raw?.y ?? 0;
                const scoreVal = context.raw?.x ?? 0;
                const status = context.dataset?.metaKind === "admitted-point" ? "ammesso" : "non ammesso";
                return `${courseName}${session ? ` · ${session}` : ""}: ${status}, punteggio complessivo ${totalScore.toFixed(3)}, media ${mediaVal.toFixed(2)}, score ${scoreVal.toFixed(1)}`;
              }
              if (context.dataset?.metaKind === "admitted-line" || context.dataset?.metaKind === "rejected-line") {
                const courseName = context.raw?.course || "Corso";
                const totalScore = Number.isFinite(context.raw?.totalScore) ? context.raw.totalScore : null;
                return totalScore !== null
                  ? `${courseName}: retta con punteggio complessivo ${totalScore.toFixed(3)}`
                  : `${courseName}: retta di ammissione`;
              }
              const course = context.raw?.course || "Corso";
              const mediaVal = context.raw?.y ?? 0;
              const scoreVal = context.raw?.x ?? 0;
              const admitted = context.raw?.admitted;
              const status = admitted === "admitted" ? "ammesso" : admitted === "rejected" ? "non ammesso" : "dato storico";
              return `${course}: media ${mediaVal.toFixed(2)} · score ${scoreVal.toFixed(1)} (${status})`;
            },
          },
        },
      },
    },
  };
}

function renderAdmissionsChart() {
  if (!state.chart) return;

  const selectedSession = getSelectedSession();
  const admissions = state.ready
    ? state.admissions.filter((row) => normalizeSession(row.session) === selectedSession)
    : [];
  const admittedBoundaries = getVisibleBoundaries(selectedSession, state.chartFocus, "admitted");
  const rejectedBoundaries = getVisibleBoundaries(selectedSession, state.chartFocus, "rejected");
  const hasSelectedCourse = Boolean(state.chartFocus);
  if (!state.ready) {
    state.chart.data.datasets = [];
    updateChartLegend([]);
    updateRejectedToggleButton();
    state.chart.update();
    return;
  }

  const datasets = buildChartDatasets({
    admissions,
    admittedBoundaries,
    rejectedBoundaries,
    selectedSession,
    focusCourse: state.chartFocus,
    showRejected: state.showRejectedAdmissions && hasSelectedCourse,
    candidatePoint: state.candidatePoint,
  });

  state.chart.data.datasets = datasets;
  applyChartScale(datasets);
  updateChartLegend(datasets);
  updateRejectedToggleButton();
  state.chart.update();
}

function buildChartDatasets({
  admissions,
  admittedBoundaries,
  rejectedBoundaries,
  focusCourse,
  showRejected,
  candidatePoint,
}) {
  const datasets = [];
  const pointColor = "rgba(86, 207, 225, 0.9)";

  if (!focusCourse) {
    datasets.push({
      label: "Punti ammessi",
      metaKind: "admitted-point",
      type: "scatter",
      data: admittedBoundaries.map((boundary) => boundary.admittedPoint).filter(Boolean),
      parsing: false,
      pointRadius: 5,
      pointHoverRadius: 10,
      pointBackgroundColor: pointColor,
      pointBorderWidth: 0,
    });

    admittedBoundaries.forEach((boundary) => {
      datasets.push(buildCourseLineDataset(boundary.course, boundary.admittedCutoff, getCourseColor(boundary.course), "admitted-line"));
    });
  } else {
    const boundary = getBoundaryForCourse(focusCourse, getSelectedSession());
    const admittedPoint = boundary?.admittedPoint || null;
    const rejectedPoint = boundary?.rejectedPoint || null;

    datasets.push({
      label: "Punto ammesso",
      metaKind: "admitted-point",
      type: "scatter",
      data: admittedPoint ? [admittedPoint] : [],
      parsing: false,
      pointRadius: 8,
      pointHoverRadius: 10,
      pointBackgroundColor: pointColor,
      pointBorderWidth: 0,
    });

    datasets.push(buildCourseLineDataset(focusCourse, boundary?.admittedCutoff, getCourseColor(focusCourse), "admitted-line"));

    if (showRejected && rejectedPoint) {
      datasets.push({
        label: "Punto non ammesso",
        metaKind: "rejected-point",
        type: "scatter",
        data: [rejectedPoint],
        parsing: false,
        pointRadius: 8,
        pointHoverRadius: 10,
        pointBackgroundColor: "rgba(255, 129, 154, 0.9)",
        pointBorderWidth: 0,
      });

      datasets.push(buildCourseLineDataset(focusCourse, boundary?.rejectedCutoff, "#ff819a", "rejected-line"));
    }
  }

  if (candidatePoint) {
    datasets.push({
      label: "Il tuo profilo",
      metaKind: "candidate",
      type: "scatter",
      data: [candidatePoint],
      parsing: false,
      pointRadius: 9,
      pointHoverRadius: 11,
      pointBackgroundColor: "#56cfe1",
      pointBorderColor: "#05060a",
      pointBorderWidth: 2,
    });
  }

  return datasets;
}

function buildCourseLineDataset(course, cutoff, borderColor, metaKind) {
  const data = typeof cutoff === "number" ? buildIsoSeriesFromCutoff(cutoff, course) : [];
  return {
    label: course,
    metaKind,
    type: "line",
    data,
    parsing: false,
    showLine: true,
    borderColor,
    borderWidth: 2,
    backgroundColor: borderColor,
    pointRadius: 0,
    tension: 0.25,
    hidden: data.length === 0,
    spanGaps: false,
    fill: false,
  };
}

function applyChartScale(datasets) {
  if (!state.chart) return;

  const points = datasets.flatMap((dataset) => Array.isArray(dataset.data) ? dataset.data : []);
  if (!points.length) return;

  const xValues = points.map((point) => point.x).filter((value) => Number.isFinite(value));
  const yValues = points.map((point) => point.y).filter((value) => Number.isFinite(value));
  if (!xValues.length || !yValues.length) return;

  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const xPadding = Math.max((xMax - xMin) * 0.12, 1.2);
  const yPadding = Math.max((yMax - yMin) * 0.12, 0.25);

  state.chart.options.scales.x.min = Math.max(SCORE_RANGE.min, xMin - xPadding);
  state.chart.options.scales.x.max = Math.min(SCORE_RANGE.max, xMax + xPadding);
  state.chart.options.scales.y.min = Math.max(MEDIA_RANGE.min, yMin - yPadding);
  state.chart.options.scales.y.max = Math.min(MEDIA_RANGE.max, yMax + yPadding);
}

function getCourseColor(course) {
  const palette = [
    "#56cfe1",
    "#7df2be",
    "#ffd166",
    "#ff9f68",
    "#c77dff",
    "#4dd6ac",
    "#6ea8fe",
    "#f78fb3",
  ];
  const hash = [...String(course || "")].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

function updateChartLegend(datasets) {
  const legend = document.getElementById("chartLegend");
  if (!legend) return;

  const items = datasets
    .filter((dataset) => dataset?.metaKind === "admitted-line" || dataset?.metaKind === "rejected-line")
    .map((dataset) => {
      const color = dataset.borderColor || "#56cfe1";
      const label = dataset.label || "Corso";
      return `<div class="chart-legend__item"><span class="chart-legend__swatch" style="background:${color}"></span><span>${escapeHtml(label)}</span></div>`;
    });

  legend.innerHTML = items.length
    ? items.join("")
    : '<div class="chart-legend__item"><span class="chart-legend__swatch" style="background:#56cfe1"></span><span>Nessuna linea disponibile</span></div>';
}

function buildBoundarySeries(boundaries, cutoffKey) {
  const series = [];
  boundaries.forEach((boundary, index) => {
    const cutoff = boundary?.[cutoffKey];
    if (typeof cutoff !== "number") return;
    const boundarySeries = buildIsoSeriesFromCutoff(cutoff, boundary.course);
    series.push(...boundarySeries);
    if (index < boundaries.length - 1) {
      series.push({ x: null, y: null, course: boundary.course });
    }
  });
  return series;
}

function buildIsoSeriesFromCutoff(requiredScore, courseName = "") {
  const steps = 24;
  const points = [];

  for (let i = 0; i <= steps; i += 1) {
    const mediaValue = MEDIA_RANGE.min + ((MEDIA_RANGE.max - MEDIA_RANGE.min) * i) / steps;
    const scoreValue = solveScoreForMedia(mediaValue, requiredScore);
    if (scoreValue === null) continue;
    points.push({
      x: parseFloat(scoreValue.toFixed(2)),
      y: parseFloat(mediaValue.toFixed(2)),
      course: courseName,
      totalScore: requiredScore,
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
  const toggleLabel = state.showRejectedAdmissions ? "non ammessi visibili" : "non ammessi nascosti";
  caption.textContent = courseName
    ? `Sessione ${session} e filtro su ${courseName}: ${toggleLabel}. Passa sui punti per vedere il punteggio complessivo; il blu mostra l'ammesso, il rosso compare solo con il bottone.`
    : `Sessione ${session} attiva: vedi solo i punti blu con la loro retta per ogni corso; passa sui punti per leggere il punteggio complessivo.`;
}

function updateRejectedToggleButton() {
  const button = document.getElementById("toggleRejectedButton");
  if (!button) return;
  const enabled = Boolean(state.chartFocus);
  button.disabled = !enabled;
  button.setAttribute("aria-pressed", String(state.showRejectedAdmissions));
  button.textContent = !enabled
    ? "Mostra non ammessi"
    : state.showRejectedAdmissions
      ? "Nascondi non ammessi"
      : "Mostra non ammessi";
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
  const candidateDataset = state.chart.data.datasets.find((dataset) => dataset?.metaKind === "candidate");
  if (!candidateDataset) return;

  candidateDataset.data = state.candidatePoint ? [state.candidatePoint] : [];
  state.chart.update();
}

/* Login page logic */
function attachLoginForm() {
  const form = document.getElementById("login-form");
  if (!form) return;

  const feedback = document.getElementById("loginFeedback");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!data.consent) {
      feedback.textContent = "È necessario accettare il consenso.";
      return;
    }

    if (!isSupabaseConfigured()) {
      feedback.textContent = "Supabase non configurato: impossibile salvare il profilo.";
      feedback.classList.add("error");
      return;
    }

    const client = getSupabaseClient();
    const { error } = await client.from("profiles").insert([
      {
        first_name: data.firstName || "",
        last_name: data.lastName || "",
        email: data.email || "",
        nationality: data.nationality || "",
        target_course: data.targetCourse || "",
        phone: data.phone || "",
        notes: data.notes || "",
      },
    ]);

    if (error) {
      feedback.textContent = `Salvataggio Supabase non riuscito: ${error.message}`;
      feedback.classList.add("error");
      return;
    }

    feedback.textContent = "Profilo salvato su Supabase. Reindirizzamento...";
    feedback.classList.remove("error");
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

  unlockForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.getElementById("adminMessage");
    const input = document.getElementById("adminAccessKey");
    const value = String(input?.value || "").trim();

    if (isSupabaseConfigured()) {
      if (!SUPABASE_ADMIN_EMAIL) {
        if (message) {
          message.textContent = "Configura window.SUPABASE_ADMIN_EMAIL nella pagina admin.";
          message.classList.add("error");
        }
        return;
      }

      const client = getSupabaseClient();
      const { error } = await client.auth.signInWithPassword({
        email: SUPABASE_ADMIN_EMAIL,
        password: value,
      });

      if (error) {
        if (message) {
          message.textContent = "Credenziali admin non valide.";
          message.classList.add("error");
        }
        return;
      }

      state.adminUnlocked = true;
      await refreshAdminProfilesFromSupabase();
      if (message) {
        message.textContent = "Accesso admin effettuato.";
        message.classList.remove("error");
      }
      renderAdminPanel();
      return;
    }

    if (!ADMIN_ACCESS_KEY || ADMIN_ACCESS_KEY === "cambia-questa-chiave-admin") {
      if (message) {
        message.textContent = "Configura prima window.ADMIN_ACCESS_KEY in admin.html.";
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
    if (message) {
      message.textContent = "Accesso admin effettuato.";
      message.classList.remove("error");
    }
    renderAdminPanel();
  });

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      if (isSupabaseConfigured()) {
        const client = getSupabaseClient();
        await client.auth.signOut();
      }
      state.adminUnlocked = false;
      const input = document.getElementById("adminAccessKey");
      if (input) input.value = "";
      renderAdminPanel();
    });
  }

  if (isSupabaseConfigured()) {
    const client = getSupabaseClient();
    client.auth.getSession().then(({ data }) => {
      if (data?.session) {
        state.adminUnlocked = true;
        refreshAdminProfilesFromSupabase().finally(() => {
          renderAdminPanel();
        });
      }
    });
  }

  renderAdminPanel();
  attachAdminEditors();
}

async function refreshAdminProfilesFromSupabase() {
  state.supabaseProfilesError = "";
  if (!isSupabaseConfigured() || !state.adminUnlocked) {
    state.supabaseProfiles = [];
    return;
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client.from("profiles").select("*");

    if (error) {
      state.supabaseProfiles = [];
      state.supabaseProfilesError = error.message || "Impossibile leggere profiles da Supabase.";
      return;
    }

    const rows = Array.isArray(data) ? data : [];
    state.supabaseProfiles = rows.map((profile, index) => ({
      firstName: profile.first_name || profile.firstName || "",
      lastName: profile.last_name || profile.lastName || "",
      email: profile.email || "",
      nationality: profile.nationality || "",
      targetCourse: profile.target_course || profile.targetCourse || "",
      phone: profile.phone || "",
      notes: profile.notes || "",
      timestamp: profile.created_at || profile.timestamp || "",
      __supabaseId: profile.id || null,
      __adminId: `sb-${profile.id || profile.email || index}`,
    }));
  } catch (error) {
    state.supabaseProfiles = [];
    state.supabaseProfilesError = error?.message || "Errore durante la lettura da Supabase.";
  }
}

function bootstrapAdminPersistence() {
  loadAdminOverrides();
  loadAdminDeleted();
  state.adminUnlocked = false;
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
    if (state.sessionDataError) {
      container.innerHTML = `<p>Nessun dato intake visibile. Supabase ha risposto: ${escapeHtml(state.sessionDataError)}</p>`;
      return;
    }
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
    if (state.supabaseProfilesError) {
      container.innerHTML = `<p>Nessun profilo visibile. Supabase ha risposto: ${escapeHtml(state.supabaseProfilesError)}</p>`;
      return;
    }
    container.innerHTML = "<p>Nessun profilo disponibile (locale o Supabase).</p>";
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

  const handleClick = async (event) => {
    const saveBtn = event.target.closest(".admin-save-row");
    const resetBtn = event.target.closest(".admin-reset-row");
    const deleteBtn = event.target.closest(".admin-delete-row");
    const row = event.target.closest("tr");
    if (!row) return;

    if (saveBtn) {
      if (row.closest("#adminIntakeTable")) {
        await saveAdminIntakeRow(row);
      } else if (row.closest("#adminProfilesTable")) {
        await saveAdminProfileRow(row);
      }
      return;
    }

    if (resetBtn) {
      if (row.closest("#adminIntakeTable")) {
        await resetAdminIntakeRow(row);
      } else if (row.closest("#adminProfilesTable")) {
        await resetAdminProfileRow(row);
      }
      return;
    }

    if (deleteBtn) {
      if (row.closest("#adminIntakeTable")) {
        await deleteAdminIntakeRow(row);
      } else if (row.closest("#adminProfilesTable")) {
        await deleteAdminProfileRow(row);
      }
    }
  };

  intakeContainer?.addEventListener("click", handleClick);
  profilesContainer?.addEventListener("click", handleClick);
}

function loadAdminOverrides() {
  state.adminOverrides = { intake: {}, profiles: {} };
}

function loadAdminDeleted() {
  state.adminDeleted = { intake: {}, profiles: {} };
}

function saveAdminOverrides() {
  // Persistenza spostata su Supabase.
}

function saveAdminDeleted() {
  // Persistenza spostata su Supabase.
}

function getMergedAdminIntakeRows() {
  return Array.isArray(state.sessionData) ? state.sessionData : [];
}

function getMergedAdminProfiles() {
  const baseProfiles = Array.isArray(state.supabaseProfiles) ? state.supabaseProfiles : [];
  return baseProfiles.map((profile, index) => ({
    ...profile,
    __adminId: profile.__adminId || profile.timestamp || profile.email || `${profile.firstName || "profile"}-${index}`,
  }));
}

function getRowFieldValue(row, field) {
  const selector = `[data-field="${field}"]`;
  const input = row.querySelector(selector);
  if (!input) return "";
  if (input.type === "checkbox") return input.checked;
  return input.value;
}

async function saveAdminIntakeRow(row) {
  const id = row.dataset.adminRow;
  if (!id) return;

  const current = getMergedAdminIntakeRows().find((item) => (item.fingerprint || item.id) === id);
  if (!current) return;

  if (!isSupabaseConfigured()) {
    alert("Supabase non configurato: impossibile salvare.");
    return;
  }

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

  const client = getSupabaseClient();
  const payload = {
    first_name: updated.firstName,
    last_name: updated.lastName,
    anon: Boolean(updated.anon),
    session: updated.session,
    media: updated.media,
    score_type: updated.scoreType,
    raw_score: updated.rawScore,
    bocconi_score: updated.bocconiScore,
    courses: updated.courses,
    fingerprint: updated.fingerprint,
  };

  let query = client.from("intake_records").update(payload);
  if (updated.__supabaseId) {
    query = query.eq("id", updated.__supabaseId);
  } else {
    query = query.eq("fingerprint", current.fingerprint || updated.fingerprint);
  }

  const { error } = await query;
  if (error) {
    alert(`Salvataggio intake non riuscito: ${error.message}`);
    return;
  }

  await loadSessionData();
  updateSessionDashboard();
  renderAdminPanel();
}

async function resetAdminIntakeRow() {
  await loadSessionData();
  renderAdminPanel();
  updateSessionDashboard();
}

async function deleteAdminIntakeRow(row) {
  const id = row.dataset.adminRow;
  if (!id) return;

  if (!isSupabaseConfigured()) {
    alert("Supabase non configurato: impossibile eliminare.");
    return;
  }

  const current = getMergedAdminIntakeRows().find((item) => (item.fingerprint || item.id) === id);
  if (!current) return;

  const client = getSupabaseClient();
  let query = client.from("intake_records").delete();
  if (current.__supabaseId) {
    query = query.eq("id", current.__supabaseId);
  } else {
    query = query.eq("fingerprint", current.fingerprint);
  }

  const { error } = await query;
  if (error) {
    alert(`Eliminazione intake non riuscita: ${error.message}`);
    return;
  }

  await loadSessionData();
  renderAdminPanel();
  updateSessionDashboard();
}

async function saveAdminProfileRow(row) {
  const id = row.dataset.adminProfileRow;
  if (!id) return;

  if (!isSupabaseConfigured()) {
    alert("Supabase non configurato: impossibile salvare.");
    return;
  }

  const current = getMergedAdminProfiles().find((item) => item.__adminId === id);
  if (!current) return;

  const updated = {
    firstName: getRowFieldValue(row, "firstName").trim(),
    lastName: getRowFieldValue(row, "lastName").trim(),
    email: getRowFieldValue(row, "email").trim(),
    nationality: getRowFieldValue(row, "nationality").trim(),
    targetCourse: getRowFieldValue(row, "targetCourse").trim(),
    phone: getRowFieldValue(row, "phone").trim(),
    timestamp: getRowFieldValue(row, "timestamp").trim(),
  };

  const client = getSupabaseClient();
  let query = client.from("profiles").update({
    first_name: updated.firstName,
    last_name: updated.lastName,
    email: updated.email,
    nationality: updated.nationality,
    target_course: updated.targetCourse,
    phone: updated.phone,
  });

  if (current.__supabaseId) {
    query = query.eq("id", current.__supabaseId);
  } else {
    query = query.eq("email", current.email);
  }

  const { error } = await query;
  if (error) {
    alert(`Salvataggio profilo non riuscito: ${error.message}`);
    return;
  }

  await refreshAdminProfilesFromSupabase();
  renderAdminPanel();
}

async function resetAdminProfileRow() {
  await refreshAdminProfilesFromSupabase();
  renderAdminPanel();
}

async function deleteAdminProfileRow(row) {
  const id = row.dataset.adminProfileRow;
  if (!id) return;

  if (!isSupabaseConfigured()) {
    alert("Supabase non configurato: impossibile eliminare.");
    return;
  }

  const current = getMergedAdminProfiles().find((item) => item.__adminId === id);
  if (!current) return;

  const client = getSupabaseClient();
  let query = client.from("profiles").delete();
  if (current.__supabaseId) {
    query = query.eq("id", current.__supabaseId);
  } else {
    query = query.eq("email", current.email);
  }

  const { error } = await query;
  if (error) {
    alert(`Eliminazione profilo non riuscita: ${error.message}`);
    return;
  }

  await refreshAdminProfilesFromSupabase();
  renderAdminPanel();
}

function readStoredProfiles() {
  return [];
}

function saveStoredProfiles() {
  // Persistenza locale dismessa.
}

/* Session results logic */
function bootstrapSessionSubmissionFlag() {
  state.sessionSubmitted = false;
  state.sessionUserEntry = null;
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
  return state.sessionFingerprint;
}

async function loadSessionData() {
  state.sessionData = [];
  state.sessionDataError = "";

  try {
    const remoteRows = await fetchSessionSheetData();
    state.sessionData = remoteRows;
  } catch (error) {
    console.warn("Errore nel recupero dei dati da Supabase", error);
    state.sessionData = [];
    state.sessionDataError = error.message || "Errore sconosciuto durante caricamento intake_records.";
    reportSessionError(error.message);
  }

  const ownRecord = state.sessionData.find((row) => row.fingerprint && row.fingerprint === state.sessionFingerprint);
  state.sessionSubmitted = Boolean(ownRecord);
  state.sessionUserEntry = ownRecord || null;

  state.sessionData = getMergedAdminIntakeRows();
  const form = document.getElementById("sessionForm");
  if (form && state.sessionSubmitted) {
    lockSessionForm(form);
  }
  renderAdminPanel();
  return state.sessionData;
}

async function fetchSessionSheetData() {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase non configurato");
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("intake_records")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Lettura intake_records fallita: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((row, index) => normalizeSheetRow(row, index))
    .filter(Boolean);
}

function appendLocalSubmission() {
  // Persistenza locale dismessa.
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
  const bocconiScore = parseFloat(row.bocconi_score ?? row.bocconiScore ?? row.score ?? row.Score ?? row.raw_score ?? row.rawScore);
  if (Number.isNaN(media) || Number.isNaN(bocconiScore)) {
    return null;
  }

  const rawCourses = row.courses ?? row.course_preferences ?? row.coursePreferences ?? row.corsi ?? [];
  const courses = sanitizeCourses(rawCourses);
  const anonFlag = row.anon === true || row.anon === "true" || row.anon === 1;
  const firstName = row.first_name || row.firstName || row.nome || "Profilo";
  const lastName = row.last_name || row.lastName || row.cognome || "Community";
  const recordId = row.id || row.fingerprint || row.timestamp || `sheet-${index}`;

  return {
    id: recordId,
    firstName,
    lastName,
    name: anonFlag ? "Profilo anonimo" : `${firstName} ${lastName}`.trim(),
    anon: anonFlag,
    session: row.session || row.sessione || "storico",
    media,
    rawScore: parseFloat(row.raw_score ?? row.rawScore ?? row.score ?? bocconiScore) || bocconiScore,
    scoreType: row.score_type || row.scoreType || row.metric || "score",
    bocconiScore,
    combinedScore: computeScoreValue(media, bocconiScore),
    courses: courses.length ? courses : ["CORSO"],
    timestamp: row.created_at || row.timestamp || new Date().toISOString(),
    fingerprint: row.fingerprint || String(recordId),
    __supabaseId: row.id || null,
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
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase non configurato: impossibile salvare i dati sessione.");
  }

  const client = getSupabaseClient();
  const payload = {
    first_name: entry.firstName,
    last_name: entry.lastName,
    anon: entry.anon,
    session: entry.session,
    media: entry.media,
    score_type: entry.scoreType,
    raw_score: entry.rawScore,
    bocconi_score: entry.bocconiScore,
    courses: entry.courses,
    created_at: entry.timestamp,
  };

  const { error } = await client.from("intake_records").insert([payload]);
  if (error) {
    throw new Error(`Salvataggio intake_records fallito: ${error.message}`);
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
