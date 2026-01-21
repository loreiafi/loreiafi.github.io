const MEDIA_RANGE = { min: 6, max: 10 };
const SCORE_RANGE = { min: 17, max: 50 };
const SAT_RANGE = { min: 1040, max: 1600 };
const WEIGHTS = { media: 0.45, score: 0.55 };
const SCORE_CUTOFF = 0.524;

const state = {
  admissions: [],
  ready: false,
  chart: null,
  chartFocus: "",
  candidatePoint: null,
};

document.addEventListener("DOMContentLoaded", () => {
  hydrateCourseSelect();
  attachCalculator();
  attachSatButton();
  attachLoginForm();
  setupChartModule();
  loadAdmissions();
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
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [course, minMedia, minScore] = line.split(",").map((chunk) => chunk.trim());
      return {
        course,
        minMedia: parseFloat(minMedia),
        minScore: parseFloat(minScore),
      };
    });
}

function hydrateCourseSelect(data = []) {
  const selectIds = ["courseSelect", "chartCourseSelect"];
  selectIds.forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = '<option value="">Tutti i corsi</option>';
    if (data.length === 0) return;
    data.forEach((row) => {
      const option = document.createElement("option");
      option.value = row.course;
      option.textContent = row.course;
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
  const isAdmitted = weightedIndex >= SCORE_CUTOFF;

  const admittedCourses = filterAdmissions(weightedIndex, focusCourse);
  const heroPercent = (weightedIndex * 100).toFixed(1);

  const listHtml = buildCourseList(admittedCourses, focusCourse, weightedIndex);
  const statusCopy = isAdmitted
    ? `Indice ${heroPercent}% ≥ ${(SCORE_CUTOFF * 100).toFixed(1)}%: profilo sopra soglia.`
    : `Indice ${heroPercent}% < ${(SCORE_CUTOFF * 100).toFixed(1)}%: lavora su media o score.`;

  setResultsHtml(listHtml);
  updateSummary(heroPercent, statusCopy, normalizedMedia, normalizedScore, isAdmitted);
  updateCandidatePlot(media, score);
}

function filterAdmissions(candidateScore, focusCourse) {
  if (!state.ready || state.admissions.length === 0) return [];

  return state.admissions
    .map((row) => {
      const requiredScore = computeScoreValue(row.minMedia, row.minScore);
      return { ...row, requiredScore };
    })
    .filter((row) => {
      if (focusCourse && row.course !== focusCourse) return false;
      return candidateScore >= row.requiredScore;
    });
}

function buildCourseList(courses, focusCourse, candidateScore) {
  if (!state.ready) {
    return "<p>Caricamento soglie in corso...</p>";
  }

  if (courses.length === 0) {
    const courseMsg = focusCourse
      ? `per ${focusCourse}`
      : "per i corsi disponibili";
    return `<p class="result-empty">Ancora nessun corso ammissibile ${courseMsg}. Migliora il punteggio combinato e l'Ammission Calculator aggiornerà il responso.</p>`;
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

function updateSummary(heroPercent, statusCopy, normalizedMedia, normalizedScore, isPositive) {
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
    cutoffNode.textContent = `${(SCORE_CUTOFF * 100).toFixed(1)}% (0.524)`;
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
  updateSummary("--", "Completa i campi per vedere il verdetto personalizzato.", 0, 0, undefined);
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
    scatterDataset.data = state.admissions.map((row) => ({
      x: row.minScore,
      y: row.minMedia,
      course: row.course,
    }));

    const isoSeries = [];
    state.admissions.forEach((row, idx) => {
      const series = buildIsoSeries(row, row.course);
      isoSeries.push(...series);
      if (idx < state.admissions.length - 1) {
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

  const targetRow = state.admissions.find((row) => row.course === state.chartFocus);
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
  caption.textContent = courseName
    ? `Filtro attivo su ${courseName}: vedi il punto storico e la linea di combinazioni equivalenti media + score.`
    : "Nessun filtro applicato: visualizzi tutte le soglie storiche.";
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
