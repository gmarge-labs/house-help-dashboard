const STORAGE_KEY = "house_help_dashboard_state_v3";

let state = loadState();
let isBootstrapping = true;
let helperTimerRenderHandle = null;

const cloudState = {
  enabled: false,
  db: null,
  dashboardId: null,
  unsubscribe: null,
  lastSerializedHousehold: null,
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function createSampleTemplates() {
  return [
    {
      id: uid(),
      title: "Kitchen reset",
      area: "Kitchen",
      notes: "Wipe counters, load dishwasher, sweep the floor, and empty the trash.",
    },
    {
      id: uid(),
      title: "Laundry round",
      area: "Laundry",
      notes: "Wash, dry, fold, and place clothes in each room.",
    },
    {
      id: uid(),
      title: "Bathroom refresh",
      area: "Bathrooms",
      notes: "Clean sinks, mirrors, toilet areas, and replace hand towels if needed.",
    },
  ];
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function futureDate(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function generateDashboardId() {
  return `dash-${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 6)}`;
}

function readDashboardIdFromLocation() {
  if (typeof window === "undefined" || !window.location) return null;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  return params.get("dashboard");
}

function writeDashboardIdToLocation(dashboardId) {
  if (typeof window === "undefined" || !window.location) return;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  params.set("dashboard", dashboardId);
  const nextHash = `#${params.toString()}`;

  if (window.history?.replaceState) {
    window.history.replaceState(null, "", `${window.location.pathname || ""}${window.location.search || ""}${nextHash}`);
  } else {
    window.location.hash = nextHash;
  }
}

function defaultState() {
  return {
    household: null,
    session: { role: null },
    loginRole: "helper",
    familyPage: "dashboard",
    selectedDate: todayString(),
    helperDate: todayString(),
    duplicateTargetDate: futureDate(1),
    openInstructionTaskId: null,
    editingTaskId: null,
    editingTemplateId: null,
    welcomeRole: null,
    flash: "",
  };
}

function defaultHouseholdSettings() {
  return {
    caretakerCompletionLock: true,
  };
}

function defaultRecurrence() {
  return {
    cadence: "manual",
    weekday: "",
    anchorDate: "",
  };
}

function normalizeTask(task, index) {
  return {
    id: task.id || uid(),
    title: task.title || "Untitled task",
    area: task.area || "General",
    notes: task.notes || "",
    estimateHours: task.estimateHours || "",
    status: task.status === "done" ? "done" : "pending",
    source: task.source || "custom",
    order: Number.isFinite(task.order) ? task.order : index + 1,
    createdAt: task.createdAt || new Date().toISOString(),
  };
}

function normalizeAssignments(assignments) {
  const safeAssignments = assignments && typeof assignments === "object" ? assignments : {};
  const normalized = {};

  Object.entries(safeAssignments).forEach(([date, value]) => {
    if (Array.isArray(value)) {
      normalized[date] = {
        note: "",
        privateNote: "",
        arrivalWindow: "",
        feeHours: "",
        hourlyRate: "",
        paymentStatus: "unpaid",
        workStartAt: "",
        workEndAt: "",
        timerStatus: "idle",
        timerAccumulatedMs: 0,
        timerLastStartedAt: "",
        tasks: value.map(normalizeTask).sort((a, b) => a.order - b.order),
      };
      return;
    }

    normalized[date] = {
      note: value?.note || "",
      privateNote: value?.privateNote || "",
      arrivalWindow: value?.arrivalWindow || "",
      feeHours: value?.feeHours || "",
      hourlyRate: value?.hourlyRate || "",
      paymentStatus: value?.paymentStatus === "paid" ? "paid" : "unpaid",
      workStartAt: value?.workStartAt || "",
      workEndAt: value?.workEndAt || "",
      timerStatus: value?.timerStatus || "idle",
      timerAccumulatedMs: Number(value?.timerAccumulatedMs) || 0,
      timerLastStartedAt: value?.timerLastStartedAt || "",
      tasks: Array.isArray(value?.tasks)
        ? value.tasks.map(normalizeTask).sort((a, b) => a.order - b.order)
        : [],
    };
  });

  return normalized;
}

function normalizeState(raw) {
  const next = { ...defaultState(), ...raw };

  if (raw?.household) {
    next.household = {
      name: raw.household.name || "",
      plannerName: raw.household.plannerName || "Halima",
      helperName: raw.household.helperName || "",
      familyPin: raw.household.familyPin || "",
      helperPin: raw.household.helperPin || "",
      settings: { ...defaultHouseholdSettings(), ...(raw.household.settings || {}) },
      templates: Array.isArray(raw.household.templates)
        ? raw.household.templates.map((template) => ({
            id: template.id || uid(),
            title: template.title || "Untitled template",
            area: template.area || "General",
            notes: template.notes || "",
            estimateHours: template.estimateHours || "",
            recurrence: {
              ...defaultRecurrence(),
              ...(template.recurrence || {}),
            },
          }))
        : [],
      assignments: normalizeAssignments(raw.household.assignments),
    };
  }

  return next;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return normalizeState(JSON.parse(raw));
    }
  } catch (error) {
    console.error("Failed to read saved state", error);
  }

  return defaultState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function renderLoadingScreen() {
  return `
    <main class="login-wrap">
      <section class="login-card">
        <div class="eyebrow">Syncing dashboard</div>
        <h1>Loading your shared board.</h1>
        <p class="muted">Please wait while tasks and access settings are pulled in.</p>
      </section>
    </main>
  `;
}

function serializeHousehold(household) {
  return JSON.stringify(household || null);
}

function ensureDashboardId() {
  if (cloudState.dashboardId) return cloudState.dashboardId;
  cloudState.dashboardId = readDashboardIdFromLocation() || generateDashboardId();
  writeDashboardIdToLocation(cloudState.dashboardId);
  return cloudState.dashboardId;
}

function getCloudDocRef() {
  if (!cloudState.enabled || !cloudState.db || !cloudState.dashboardId) return null;
  return cloudState.db.collection("household_dashboards").doc(cloudState.dashboardId);
}

function initCloud() {
  const config = typeof window !== "undefined" ? window.CHORES_FIREBASE_CONFIG : null;
  const firebaseSdk = typeof window !== "undefined" ? window.firebase : null;

  if (!config?.enabled || !firebaseSdk?.firestore) return;

  if (!firebaseSdk.apps?.length) {
    firebaseSdk.initializeApp(config);
  }

  cloudState.enabled = true;
  cloudState.db = firebaseSdk.firestore();
  cloudState.dashboardId = readDashboardIdFromLocation();
}

async function loadHouseholdFromCloud() {
  const docRef = getCloudDocRef();
  if (!docRef) return false;

  const snap = await docRef.get();
  if (!snap.exists) return false;

  const payload = snap.data()?.household || null;
  if (!payload) return false;

  state.household = normalizeState({ household: payload }).household;
  cloudState.lastSerializedHousehold = serializeHousehold(state.household);
  return true;
}

function subscribeToCloud() {
  const docRef = getCloudDocRef();
  if (!docRef || cloudState.unsubscribe) return;

  cloudState.unsubscribe = docRef.onSnapshot((snap) => {
    if (!snap.exists) return;
    const payload = snap.data()?.household || null;
    if (!payload) return;

    const serializedIncoming = serializeHousehold(normalizeState({ household: payload }).household);
    const serializedCurrent = serializeHousehold(state.household);
    if (serializedIncoming === serializedCurrent) return;

    state.household = normalizeState({ household: payload }).household;
    cloudState.lastSerializedHousehold = serializedIncoming;
    render();
  });
}

function persistHouseholdToCloud() {
  if (!cloudState.enabled || !state.household) return;

  const dashboardId = ensureDashboardId();
  if (!dashboardId) return;

  const docRef = getCloudDocRef();
  if (!docRef) return;

  const serialized = serializeHousehold(state.household);
  if (serialized === cloudState.lastSerializedHousehold) return;

  cloudState.lastSerializedHousehold = serialized;
  docRef
    .set(
      {
        household: state.household,
        updatedAt: typeof window !== "undefined" && window.firebase?.firestore?.FieldValue
          ? window.firebase.firestore.FieldValue.serverTimestamp()
          : new Date().toISOString(),
      },
      { merge: true }
    )
    .catch((error) => {
      console.error("Failed to sync dashboard to Firestore", error);
      cloudState.lastSerializedHousehold = null;
      setFlash("Cloud sync failed. Your latest changes may not be shared yet.");
      render();
    });
}

function getShareUrl() {
  if (typeof window === "undefined" || !window.location || !cloudState.dashboardId) return "";
  const url = new URL(window.location.href);
  url.hash = `dashboard=${cloudState.dashboardId}`;
  return url.toString();
}

async function bootstrap() {
  initCloud();

  if (cloudState.enabled && cloudState.dashboardId) {
    try {
      await loadHouseholdFromCloud();
    } catch (error) {
      console.error("Failed to load dashboard from Firestore", error);
      setFlash("Could not load the shared dashboard. Falling back to local data.");
    }
  }

  isBootstrapping = false;
  render();
  subscribeToCloud();
}

function setFlash(message) {
  state.flash = message;
}

function clearFlash() {
  state.flash = "";
}

function formatDate(dateString, options = {}) {
  return new Date(`${dateString}T12:00:00`).toLocaleDateString([], {
    weekday: options.weekday ? "long" : undefined,
    month: "short",
    day: "numeric",
    year: options.year ? "numeric" : undefined,
  });
}

function formatShortDay(dateString) {
  return new Date(`${dateString}T12:00:00`).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(dateTimeString) {
  if (!dateTimeString) return "";
  return new Date(dateTimeString).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function addDays(dateString, offset) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function getMonthMatrix(dateString) {
  const base = new Date(`${dateString}T12:00:00`);
  const monthStart = new Date(base.getFullYear(), base.getMonth(), 1, 12);
  const startOffset = monthStart.getDay();
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - startOffset);

  return Array.from({ length: 35 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const iso = date.toISOString().slice(0, 10);
    return {
      date: iso,
      day: date.getDate(),
      inMonth: date.getMonth() === base.getMonth(),
    };
  });
}

function getHousehold() {
  return state.household;
}

function ensureDayPlan(date) {
  const household = getHousehold();
  if (!household.assignments[date]) {
    household.assignments[date] = {
      note: "",
      privateNote: "",
      arrivalWindow: "",
      feeHours: "",
      hourlyRate: "",
      paymentStatus: "unpaid",
      workStartAt: "",
      workEndAt: "",
      timerStatus: "idle",
      timerAccumulatedMs: 0,
      timerLastStartedAt: "",
      tasks: [],
    };
  }
  return household.assignments[date];
}

function getDayPlan(date) {
  return ensureDayPlan(date);
}

function getAssignmentsForDate(date) {
  return [...getDayPlan(date).tasks].sort((a, b) => a.order - b.order);
}

function parseFeeInput(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return 0;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatHours(value) {
  return `${parseFeeInput(value).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")} hrs`;
}

function getDayFeeSummary(date) {
  const plan = getDayPlan(date);
  const hours = parseFeeInput(plan.feeHours);
  const rate = parseFeeInput(plan.hourlyRate);
  return {
    hours,
    rate,
    total: hours * rate,
  };
}

function getDayWorkSessionSummary(date) {
  const plan = getDayPlan(date);
  const start = plan.workStartAt ? new Date(plan.workStartAt) : null;
  const end = plan.workEndAt ? new Date(plan.workEndAt) : null;
  const runningMs = plan.timerStatus === "running" && plan.timerLastStartedAt
    ? Math.max(0, Date.now() - new Date(plan.timerLastStartedAt).getTime())
    : 0;
  const totalMs = plan.timerAccumulatedMs + runningMs;
  const spentHours = totalMs / (1000 * 60 * 60);
  return {
    start,
    end,
    totalMs,
    timerStatus: plan.timerStatus || "idle",
    spentHours,
  };
}

function formatElapsedTime(totalMs) {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function getDayWorkloadSummary(date) {
  const plan = getDayPlan(date);
  const taskHours = getAssignmentsForDate(date).reduce((sum, task) => sum + parseFeeInput(task.estimateHours), 0);
  const limitHours = parseFeeInput(plan.feeHours);
  return {
    taskHours,
    limitHours,
    overloadHours: Math.max(0, taskHours - limitHours),
    isOverLimit: limitHours > 0 && taskHours > limitHours,
  };
}

function getOverloadMessage(date) {
  const workload = getDayWorkloadSummary(date);
  if (!workload.isOverLimit) return "";
  return ` Planned task time is ${formatHours(workload.taskHours)}, which is over the daily limit of ${formatHours(workload.limitHours)}.`;
}

function getFeeRangeSummary(startDate, numberOfDays) {
  const dates = Array.from({ length: numberOfDays }, (_, index) => {
    const date = new Date(`${startDate}T12:00:00`);
    date.setDate(date.getDate() + index);
    return date.toISOString().slice(0, 10);
  });

  return dates.reduce(
    (summary, date) => {
      const fee = getDayFeeSummary(date);
      return {
        hours: summary.hours + fee.hours,
        total: summary.total + fee.total,
      };
    },
    { hours: 0, total: 0 }
  );
}

function getWeekdayValue(dateString) {
  return new Date(`${dateString}T12:00:00`).getDay();
}

function matchesRecurrence(template, date) {
  const recurrence = {
    ...defaultRecurrence(),
    ...(template?.recurrence || {}),
  };

  if (recurrence.cadence === "manual") return false;
  if (recurrence.cadence === "every_visit") return true;

  const weekday = recurrence.weekday === "" ? null : Number(recurrence.weekday);
  if (weekday !== null && getWeekdayValue(date) !== weekday) return false;

  if (recurrence.cadence === "weekly") return true;

  if (recurrence.cadence === "biweekly") {
    const anchorDate = recurrence.anchorDate || date;
    const current = new Date(`${date}T12:00:00`);
    const anchor = new Date(`${anchorDate}T12:00:00`);
    const diffDays = Math.round((current - anchor) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays % 14 === 0;
  }

  return false;
}

function getRecurringTemplatesForDate(date) {
  const household = getHousehold();
  const assignedTitles = new Set(getAssignmentsForDate(date).map((task) => task.title.toLowerCase()));
  return household.templates.filter((template) => {
    if (!matchesRecurrence(template, date)) return false;
    return !assignedTitles.has(template.title.toLowerCase());
  });
}

function formatRecurrenceLabel(recurrence) {
  const safe = { ...defaultRecurrence(), ...(recurrence || {}) };
  if (safe.cadence === "every_visit") return "Every visit";
  if (safe.cadence === "weekly") {
    const day = safe.weekday === "" ? "selected day" : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][Number(safe.weekday)];
    return `Weekly on ${day}`;
  }
  if (safe.cadence === "biweekly") {
    const day = safe.weekday === "" ? "selected day" : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][Number(safe.weekday)];
    return `Every 2 weeks on ${day}`;
  }
  return "Manual only";
}

function getPaymentHistory() {
  return Object.entries(getHousehold().assignments)
    .map(([date, plan]) => {
      const fee = getDayFeeSummary(date);
      return {
        date,
        hours: fee.hours,
        rate: fee.rate,
        total: fee.total,
        paymentStatus: plan.paymentStatus === "paid" ? "paid" : "unpaid",
      };
    })
    .filter((entry) => entry.hours > 0 || entry.total > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
}

function getPaymentRollup(entries) {
  return entries.reduce(
    (summary, entry) => {
      summary.total += entry.total;
      if (entry.paymentStatus === "paid") {
        summary.paid += entry.total;
      } else {
        summary.outstanding += entry.total;
      }
      return summary;
    },
    { total: 0, paid: 0, outstanding: 0 }
  );
}

function replaceTasksForDate(date, tasks) {
  const plan = ensureDayPlan(date);
  plan.tasks = tasks.map((task, index) => ({
    ...task,
    order: index + 1,
  }));
}

function getUpcomingDates() {
  const household = getHousehold();
  return Object.keys(household.assignments)
    .filter((date) => {
      const plan = household.assignments[date];
      return plan.tasks.length > 0 || plan.note || plan.privateNote || plan.arrivalWindow;
    })
    .sort()
    .slice(0, 8);
}

function getNextPlannedDate() {
  return getUpcomingDates().find((date) => date >= todayString()) || todayString();
}

function getHelperWindowDates() {
  return Array.from({ length: 7 }, (_, index) => futureDate(index));
}

function createTaskAssignment({ title, area, notes, date, source = "custom" }) {
  const current = getAssignmentsForDate(date);

  return {
    id: uid(),
    title,
    area: area || "General",
    notes: notes || "",
    estimateHours: "",
    status: "pending",
    source,
    order: current.length + 1,
    createdAt: new Date().toISOString(),
  };
}

function getDayStats(date) {
  const tasks = getAssignmentsForDate(date);
  const completed = tasks.filter((task) => task.status === "done").length;
  const remaining = tasks.length - completed;
  const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
  return { tasks, completed, remaining, progress };
}

function render() {
  const app = document.getElementById("app");
  saveState();
  if (helperTimerRenderHandle) {
    clearTimeout(helperTimerRenderHandle);
    helperTimerRenderHandle = null;
  }

  if (isBootstrapping) {
    app.innerHTML = renderLoadingScreen();
    return;
  }

  if (!state.household) {
    app.innerHTML = renderSetup();
    bindSetup();
    return;
  }

  if (!state.session.role) {
    app.innerHTML = renderLogin();
    bindLogin();
    return;
  }

  const mainView = state.session.role === "family" ? renderFamilyApp() : renderHelperDashboard();
  app.innerHTML = `${mainView}${state.welcomeRole ? renderWelcomeModal() : ""}`;

  if (state.session.role === "family") {
    bindFamilyApp();
  } else {
    bindHelperDashboard();
    const helperDate = state.helperDate || todayString();
    if (getDayPlan(helperDate).timerStatus === "running") {
      helperTimerRenderHandle = setTimeout(() => render(), 1000);
    }
  }

  bindWelcomeModal();

  persistHouseholdToCloud();
}

function renderSetup() {
  return `
    <main class="setup-wrap">
      <section class="setup-card">
        <div class="eyebrow">Shared home dashboard</div>
        <h1>Create a calm routine board for your home.</h1>
        <p class="muted">
          Set up one shared space for planning visit days, tracking tasks, and opening a simple checklist view on the tablet.
        </p>

        <form id="setup-form">
          <div class="form-grid">
            <div class="field">
              <label for="household-name">Dashboard name</label>
              <input id="household-name" name="householdName" placeholder="Home dashboard" required />
            </div>
            <div class="field">
              <label for="helper-name">Caretaker label</label>
              <input id="helper-name" name="helperName" placeholder="Caretaker checklist" required />
            </div>
            <div class="field">
              <label for="family-pin">Planner PIN</label>
              <input id="family-pin" name="familyPin" placeholder="4 digits" minlength="4" required />
            </div>
            <div class="field">
              <label for="helper-pin">Caretaker PIN</label>
              <input id="helper-pin" name="helperPin" placeholder="4 digits" minlength="4" required />
            </div>
          </div>
          <div class="actions">
            <button class="btn btn-primary" type="submit">Create dashboard</button>
          </div>
          ${state.flash ? `<div class="message">${escapeHtml(state.flash)}</div>` : ""}
        </form>
      </section>
    </main>
  `;
}

function bindSetup() {
  document.getElementById("setup-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const householdName = String(form.get("householdName") || "").trim();
    const helperName = String(form.get("helperName") || "").trim();
    const familyPin = String(form.get("familyPin") || "").trim();
    const helperPin = String(form.get("helperPin") || "").trim();

    if (!householdName || !helperName || familyPin.length < 4 || helperPin.length < 4) {
      setFlash("Please fill every field and use at least 4 digits for each PIN.");
      render();
      return;
    }

    state = {
      ...defaultState(),
      household: {
        name: householdName,
        plannerName: "Halima",
        helperName,
        familyPin,
        helperPin,
        settings: defaultHouseholdSettings(),
        templates: createSampleTemplates(),
        assignments: {},
      },
      loginRole: "family",
      familyPage: "dashboard",
    };

    replaceTasksForDate(todayString(), [
      createTaskAssignment({
        title: "Kitchen reset",
        area: "Kitchen",
        notes: "Wipe counters, load dishwasher, and sweep the floor.",
        date: todayString(),
        source: "template",
      }),
    ]);
    getDayPlan(todayString()).note = "Please start here first, then continue down the checklist.";
    ensureDashboardId();
    clearFlash();
    render();
  });
}

function renderLogin() {
  const role = state.loginRole || "helper";

  return `
    <main class="login-wrap">
      <section class="login-card">
        <div class="login-actions">
          <div class="login-switch">
            <button class="${role === "family" ? "active" : ""}" data-role-switch="family" type="button">Planner</button>
            <button class="${role === "helper" ? "active" : ""}" data-role-switch="helper" type="button">Caretaker</button>
          </div>
        </div>

        <form id="login-form">
          <div class="form-grid single" style="margin-top: 20px;">
            <div class="field">
              <label for="pin-input">${role === "family" ? "Planner PIN" : "Caretaker PIN"}</label>
              <input id="pin-input" name="pin" placeholder="Enter PIN" required />
            </div>
          </div>
          <div class="actions">
            <button class="btn btn-primary" type="submit">Continue</button>
          </div>
          ${state.flash ? `<div class="message">${escapeHtml(state.flash)}</div>` : ""}
        </form>
      </section>
    </main>
  `;
}

function renderWelcomeModal() {
  const household = getHousehold();
  const label = state.welcomeRole === "family"
    ? household.plannerName || "Halima"
    : household.helperName || "Caretaker";

  return `
    <div class="welcome-modal-backdrop">
      <section class="welcome-modal">
        <div class="eyebrow">Welcome back</div>
        <h2>Welcome back ${escapeHtml(label)}</h2>
        <div class="actions">
          <button class="btn btn-primary" data-close-welcome type="button">Continue</button>
        </div>
      </section>
    </div>
  `;
}

function bindLogin() {
  document.querySelectorAll("[data-role-switch]").forEach((button) => {
    button.addEventListener("click", () => {
      state.loginRole = button.dataset.roleSwitch;
      clearFlash();
      render();
    });
  });

  document.getElementById("login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const pin = new FormData(event.currentTarget).get("pin");
    const household = getHousehold();
    const enteredPin = String(pin).trim();
    const chosenRole = state.loginRole || "helper";
    let role = chosenRole;
    const expectedPin = chosenRole === "family" ? household.familyPin : household.helperPin;

    if (enteredPin !== expectedPin) {
      setFlash(
        chosenRole === "family"
          ? "That planner PIN does not match. Try again."
          : "That caretaker PIN does not match. Try again."
      );
      render();
      return;
    }

    state.session = { role };
    state.welcomeRole = role;
    if (role === "helper") {
      state.helperDate = todayString();
    }
    clearFlash();
    render();
  });
}

function bindWelcomeModal() {
  document.querySelector("[data-close-welcome]")?.addEventListener("click", () => {
    state.welcomeRole = null;
    clearFlash();
    render();
  });
}

function renderFamilyNav() {
  const items = [
    { id: "dashboard", label: "Dashboard" },
    { id: "planner", label: "Planner" },
    { id: "templates", label: "Templates" },
    { id: "settings", label: "Settings" },
  ];

  return `
    <nav class="family-nav">
      ${items
        .map(
          (item) => `
            <button
              class="family-nav-item ${state.familyPage === item.id ? "active" : ""}"
              data-family-page="${item.id}"
              type="button"
            >
              ${item.label}
            </button>
          `
        )
        .join("")}
    </nav>
  `;
}

function renderFamilyApp() {
  const selectedDate = state.selectedDate || todayString();

  return `
    <main class="shell">
      <div class="backdrop">
        <section class="app-frame">
          <div class="page-toolbar">
            <div class="date-inline">
              <label for="global-selected-date">Current date</label>
              <input id="global-selected-date" type="date" value="${selectedDate}" />
            </div>
            <div class="header-actions">
              <button class="btn btn-secondary" data-open-helper type="button">Open checklist view</button>
              <button class="btn btn-secondary" data-logout type="button">Log out</button>
            </div>
          </div>

          ${renderFamilyNav()}
          <section class="page-body">${renderFamilyPage()}</section>
        </section>
        ${state.flash ? `<div class="message">${escapeHtml(state.flash)}</div>` : ""}
      </div>
    </main>
  `;
}

function renderFamilyPage() {
  switch (state.familyPage) {
    case "planner":
      return renderPlannerPage();
    case "templates":
      return renderTemplatesPage();
    case "settings":
      return renderSettingsPage();
    case "dashboard":
    default:
      return renderDashboardPage();
  }
}

function renderDashboardPage() {
  const selectedDate = state.selectedDate || todayString();
  const { tasks, completed, remaining, progress } = getDayStats(selectedDate);

  return `
    <section class="dashboard-layout">
      <div class="dashboard-topbar">
        <div>
          <h2 class="page-title">Checklist for ${formatDate(selectedDate, { weekday: true })}</h2>
          <p class="small-note">A cleaner day view with just the essentials.</p>
        </div>
        <aside class="score-card score-card-compact">
          <div class="score-card-copy">
            <span class="score-label">At a glance</span>
            <strong>${remaining}</strong>
            <p>${remaining === 1 ? "task left undone" : "tasks left undone"}</p>
          </div>
          <div class="progress-wrap">
            <span>${progress}% complete</span>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${progress}%;"></div>
            </div>
          </div>
        </aside>
      </div>

      <section class="dashboard-content">
        <section class="task-board">
          <div class="task-board-header">
            <h3>Task list</h3>
            <span class="pill">${tasks.length} total</span>
          </div>

          ${
            tasks.length
              ? `
                <div class="task-list clean-list">
                  ${tasks
                    .map(
                      (task) => `
                        <article class="task-row ${task.status === "done" ? "task-complete" : ""}">
                          <div class="task-row-main">
                            <label class="task-row-check">
                              <input class="checkbox" data-family-toggle="${task.id}" type="checkbox" ${task.status === "done" ? "checked" : ""} />
                              <span class="task-row-copy">
                                <strong>${escapeHtml(task.title)}</strong>
                                <span>${escapeHtml(task.area)}</span>
                              </span>
                            </label>
                            ${
                              task.notes
                                ? `<button class="btn btn-secondary btn-sm" data-toggle-instructions="${task.id}" type="button">Instructions</button>`
                                : ""
                            }
                          </div>
                          ${
                            state.openInstructionTaskId === task.id && task.notes
                              ? `<div class="task-instructions">${escapeHtml(task.notes)}</div>`
                              : ""
                          }
                        </article>
                      `
                    )
                    .join("")}
                </div>
              `
              : `
                <div class="empty-state">
                  <h3>No tasks planned yet</h3>
                  <p class="muted">Use the Planner or Templates page to add tasks for this date.</p>
                </div>
              `
          }
        </section>
      </section>

    </section>
  `;
}

function renderPlannerPage() {
  const selectedDate = state.selectedDate || todayString();
  const plan = getDayPlan(selectedDate);
  const tasks = getAssignmentsForDate(selectedDate);
  const upcoming = getUpcomingDates();
  const feeSummary = getDayFeeSummary(selectedDate);
  const recurringTemplates = getRecurringTemplatesForDate(selectedDate);
  const monthDays = getMonthMatrix(selectedDate);
  const workload = getDayWorkloadSummary(selectedDate);
  const session = getDayWorkSessionSummary(selectedDate);

  return `
    <section class="planner-layout">
      <section class="panel">
        <div class="section-header">
          <div>
            <h2>Plan this day</h2>
            <p class="small-note">Build the checklist, save the day note, and set the hours and pay for this visit.</p>
          </div>
          <span class="pill">${tasks.length} tasks</span>
        </div>

        <form id="day-details-form">
          <div class="form-grid">
            <div class="field">
              <label for="arrival-window">Arrival window</label>
              <input id="arrival-window" name="arrivalWindow" value="${escapeHtml(plan.arrivalWindow)}" placeholder="10:00 AM to 2:00 PM" />
            </div>
            <div class="field">
              <label for="fee-hours">Daily work limit</label>
              <input
                id="fee-hours"
                name="feeHours"
                type="number"
                min="0"
                step="0.25"
                value="${escapeHtml(String(plan.feeHours || ""))}"
                placeholder="6"
              />
            </div>
            <div class="field">
              <label for="hourly-rate">Price per hour</label>
              <input
                id="hourly-rate"
                name="hourlyRate"
                type="number"
                min="0"
                step="0.01"
                value="${escapeHtml(String(plan.hourlyRate || ""))}"
                placeholder="25"
              />
            </div>
          </div>
          <div class="field" style="margin-top: 14px;">
            <label for="day-note">Daily note</label>
            <textarea id="day-note" name="note" placeholder="Start upstairs first, then finish the kitchen.">${escapeHtml(plan.note)}</textarea>
          </div>
          <div class="field" style="margin-top: 14px;">
            <label for="private-note">Private planner note</label>
            <textarea id="private-note" name="privateNote" placeholder="Private reminder for the family only.">${escapeHtml(plan.privateNote || "")}</textarea>
          </div>
          <div class="info-card" style="margin-top: 18px;">
            <div class="info-line">
              <strong>Calculated pay for this day</strong>
              <span>$${feeSummary.total.toFixed(2)}</span>
            </div>
            <div class="info-line">
              <strong>Planned task time</strong>
              <span>${formatHours(workload.taskHours)}</span>
            </div>
            <div class="info-line">
              <strong>Daily limit</strong>
              <span>${workload.limitHours ? formatHours(workload.limitHours) : "Not set"}</span>
            </div>
            <div class="info-line">
              <strong>Work started</strong>
              <span>${session.start ? formatDateTime(plan.workStartAt) : "Not started"}</span>
            </div>
            <div class="info-line">
              <strong>Work finished</strong>
              <span>${session.end ? formatDateTime(plan.workEndAt) : "Not finished"}</span>
            </div>
            <div class="info-line">
              <strong>Hours spent</strong>
              <span>${session.end ? formatHours(session.spentHours) : "In progress"}</span>
            </div>
            <div class="info-line">
              <strong>Timer</strong>
              <span>${formatElapsedTime(session.totalMs)}</span>
            </div>
          </div>
          ${
            workload.isOverLimit
              ? `
                <div class="info-card workload-warning" style="margin-top: 18px;">
                  <div class="info-line">
                    <strong>Time warning</strong>
                    <span>Tasks exceed the day by ${formatHours(workload.overloadHours)}</span>
                  </div>
                </div>
              `
              : ""
          }
          <div class="actions">
            <button class="btn btn-primary" type="submit">Save visit details</button>
          </div>
        </form>
      </section>

      <section class="panel">
        <div class="section-header">
          <div>
            <h2>Tasks for this date</h2>
            <p class="small-note">Reorder, remove, and add one-off tasks here.</p>
          </div>
        </div>

        <div class="task-list">
          ${
            tasks.length
              ? tasks
                  .map((task, index) => {
                    const canMoveUp = index > 0;
                    const canMoveDown = index < tasks.length - 1;
                    return `
                      <article class="task-card">
                        <header>
                          <div>
                            <h4>${escapeHtml(task.title)}</h4>
                            <div class="small-note">${escapeHtml(task.notes || "No note added yet.")}</div>
                            <div class="small-note">${task.estimateHours ? formatHours(task.estimateHours) : "No time estimate yet."}</div>
                          </div>
                          <span class="pill">${escapeHtml(task.area)}</span>
                        </header>
                        ${
                          state.editingTaskId === task.id
                            ? `
                              <form class="inline-edit-form" data-edit-task-form="${task.id}">
                                <div class="form-grid">
                                  <div class="field">
                                    <label>Task name</label>
                                    <input name="title" value="${escapeHtml(task.title)}" required />
                                  </div>
                                  <div class="field">
                                    <label>Area</label>
                                    <input name="area" value="${escapeHtml(task.area)}" />
                                  </div>
                                  <div class="field">
                                    <label>Estimated hours</label>
                                    <input name="estimateHours" type="number" min="0" step="0.25" value="${escapeHtml(String(task.estimateHours || ""))}" />
                                  </div>
                                </div>
                                <div class="field" style="margin-top: 14px;">
                                  <label>Instructions</label>
                                  <textarea name="notes">${escapeHtml(task.notes || "")}</textarea>
                                </div>
                                <div class="actions">
                                  <button class="btn btn-primary btn-sm" type="submit">Save task</button>
                                  <button class="btn btn-ghost btn-sm" data-cancel-edit-task="${task.id}" type="button">Cancel</button>
                                </div>
                              </form>
                            `
                            : ""
                        }
                        <div class="task-actions" style="margin-top: 14px;">
                          <button class="btn btn-secondary" data-edit-task="${task.id}" type="button">Edit</button>
                          <button class="btn btn-secondary" data-move-task="${task.id}" data-direction="up" type="button" ${canMoveUp ? "" : "disabled"}>Move up</button>
                          <button class="btn btn-secondary" data-move-task="${task.id}" data-direction="down" type="button" ${canMoveDown ? "" : "disabled"}>Move down</button>
                          <button class="btn btn-ghost" data-delete-task="${task.id}" type="button">Remove</button>
                        </div>
                      </article>
                    `;
                  })
                  .join("")
              : `
                <div class="empty-state">
                  <h3>Nothing planned yet</h3>
                  <p class="muted">Assign a saved task or add a one-off task below.</p>
                </div>
              `
          }
        </div>
      </section>

      <section class="panel">
        <div class="section-header">
          <div>
            <h2>Recurring suggestions</h2>
            <p class="small-note">Reusable tasks that match this date and are not yet on the list.</p>
          </div>
          <span class="pill">${recurringTemplates.length} matches</span>
        </div>
        ${
          recurringTemplates.length
            ? `
              <div class="template-list">
                ${recurringTemplates
                  .map(
                    (template) => `
                      <article class="task-card">
                        <header>
                          <div>
                            <h4>${escapeHtml(template.title)}</h4>
                            <div class="small-note">${formatRecurrenceLabel(template.recurrence)}</div>
                            <div class="small-note">${template.estimateHours ? formatHours(template.estimateHours) : "No time estimate yet."}</div>
                          </div>
                          <span class="pill">${escapeHtml(template.area || "General")}</span>
                        </header>
                        <div class="template-actions" style="margin-top: 14px;">
                          <button class="btn btn-secondary" data-assign-template="${template.id}" type="button">Add to this day</button>
                        </div>
                      </article>
                    `
                  )
                  .join("")}
              </div>
              <div class="actions">
                <button class="btn btn-primary" data-assign-all-recurring type="button">Add all recurring matches</button>
              </div>
            `
            : `
              <div class="empty-state">
                <h3>No recurring tasks to add</h3>
                <p class="muted">Templates with every-visit, weekly, or biweekly schedules will appear here when they match this date.</p>
              </div>
            `
        }
      </section>

      <section class="panel">
        <div class="section-header">
          <div>
            <h2>Monthly view</h2>
            <p class="small-note">See planned days, task counts, and daily pay across the month.</p>
          </div>
        </div>
        <div class="month-grid-labels">
          <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
        </div>
        <div class="month-grid">
          ${monthDays
            .map((day) => {
              const taskCount = getAssignmentsForDate(day.date).length;
              const fee = getDayFeeSummary(day.date);
              return `
                <button class="month-cell ${day.inMonth ? "" : "month-cell-muted"} ${day.date === selectedDate ? "month-cell-active" : ""}" data-pick-date="${day.date}" type="button">
                  <strong>${day.day}</strong>
                  <span>${taskCount ? `${taskCount} task${taskCount === 1 ? "" : "s"}` : "Off"}</span>
                  <small>$${fee.total.toFixed(0)}</small>
                </button>
              `;
            })
            .join("")}
        </div>
      </section>

      <section class="panel">
        <div class="section-header">
          <h2>Upcoming visit days</h2>
          <span class="pill">${upcoming.length} dates</span>
        </div>
        ${
          upcoming.length
            ? `
              <div class="calendar-list">
                ${upcoming
                  .map((date) => {
                    const count = getAssignmentsForDate(date).length;
                    return `
                      <button class="day-card day-card-button" data-pick-date="${date}" type="button">
                        <strong>${formatDate(date, { weekday: true })}</strong>
                        <div class="small-note">${count} ${count === 1 ? "task" : "tasks"} planned</div>
                      </button>
                    `;
                  })
                  .join("")}
              </div>
            `
            : `
              <div class="empty-state">
                <h3>No upcoming days yet</h3>
                <p class="muted">As soon as you add tasks or a note to a date, it will show here.</p>
              </div>
            `
        }
      </section>

      <section class="panel">
        <div class="section-header">
          <h2>Copy this plan</h2>
          <span class="pill">Duplicate day</span>
        </div>
        <div class="field">
          <label for="duplicate-target-date">Copy this plan to</label>
          <input id="duplicate-target-date" name="targetDate" type="date" value="${state.duplicateTargetDate || futureDate(1)}" />
        </div>
        <div class="actions">
          <button class="btn btn-secondary" id="duplicate-day-button" type="button">Duplicate day</button>
        </div>
      </section>
    </section>
  `;
}

function renderTemplatesPage() {
  const household = getHousehold();
  const selectedDate = state.selectedDate || todayString();

  return `
    <section class="planner-layout">
      <section class="panel">
        <div class="section-header">
          <div>
            <h2>Saved tasks</h2>
            <p class="small-note">Build your reusable library here, then assign tasks to the selected day.</p>
          </div>
          <span class="pill">${household.templates.length} templates</span>
        </div>

        <form id="template-form">
          <div class="form-grid">
            <div class="field">
              <label for="template-title">Task name</label>
              <input id="template-title" name="title" placeholder="Change bed sheets" required />
            </div>
            <div class="field">
              <label for="template-area">Area</label>
              <input id="template-area" name="area" placeholder="Bedrooms" />
            </div>
            <div class="field">
              <label for="template-estimate-hours">Estimated hours</label>
              <input id="template-estimate-hours" name="estimateHours" type="number" min="0" step="0.25" placeholder="1.5" />
            </div>
            <div class="field">
              <label for="template-recurrence">Recurrence</label>
              <select id="template-recurrence" name="recurrenceCadence">
                <option value="manual">Manual only</option>
                <option value="every_visit">Every visit</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
              </select>
            </div>
            <div class="field">
              <label for="template-weekday">Weekday</label>
              <select id="template-weekday" name="recurrenceWeekday">
                <option value="">Use selected day</option>
                <option value="0">Sunday</option>
                <option value="1">Monday</option>
                <option value="2">Tuesday</option>
                <option value="3">Wednesday</option>
                <option value="4">Thursday</option>
                <option value="5">Friday</option>
                <option value="6">Saturday</option>
              </select>
            </div>
          </div>
          <div class="form-grid" style="margin-top: 14px;">
            <div class="field">
              <label for="template-anchor-date">Biweekly start date</label>
              <input id="template-anchor-date" name="recurrenceAnchorDate" type="date" value="${selectedDate}" />
            </div>
          </div>
          <div class="field" style="margin-top: 14px;">
            <label for="template-notes">Notes</label>
            <textarea id="template-notes" name="notes" placeholder="Anything important to remember"></textarea>
          </div>
          <div class="actions">
            <button class="btn btn-primary" type="submit">Save task template</button>
          </div>
        </form>
      </section>

      <section class="panel">
        <div class="section-header">
          <div>
            <h2>Assign templates</h2>
            <p class="small-note">Currently assigning to ${formatDate(selectedDate, { weekday: true })}.</p>
          </div>
        </div>

        <div class="template-list">
          ${household.templates
            .map(
              (template) => `
                <article class="task-card">
                  <header>
                    <div>
                      <h4>${escapeHtml(template.title)}</h4>
                      <div class="small-note">${formatRecurrenceLabel(template.recurrence)}</div>
                      <div class="small-note">${template.estimateHours ? formatHours(template.estimateHours) : "No time estimate yet."}</div>
                      <div class="small-note">${escapeHtml(template.notes || "No note added yet.")}</div>
                    </div>
                    <span class="pill">${escapeHtml(template.area || "General")}</span>
                  </header>
                  ${
                    state.editingTemplateId === template.id
                      ? `
                        <form class="inline-edit-form" data-edit-template-form="${template.id}">
                          <div class="form-grid">
                            <div class="field">
                              <label>Task name</label>
                              <input name="title" value="${escapeHtml(template.title)}" required />
                            </div>
                            <div class="field">
                              <label>Area</label>
                              <input name="area" value="${escapeHtml(template.area || "")}" />
                            </div>
                            <div class="field">
                              <label>Estimated hours</label>
                              <input name="estimateHours" type="number" min="0" step="0.25" value="${escapeHtml(String(template.estimateHours || ""))}" />
                            </div>
                            <div class="field">
                              <label>Recurrence</label>
                              <select name="recurrenceCadence">
                                <option value="manual" ${template.recurrence?.cadence === "manual" ? "selected" : ""}>Manual only</option>
                                <option value="every_visit" ${template.recurrence?.cadence === "every_visit" ? "selected" : ""}>Every visit</option>
                                <option value="weekly" ${template.recurrence?.cadence === "weekly" ? "selected" : ""}>Weekly</option>
                                <option value="biweekly" ${template.recurrence?.cadence === "biweekly" ? "selected" : ""}>Every 2 weeks</option>
                              </select>
                            </div>
                            <div class="field">
                              <label>Weekday</label>
                              <select name="recurrenceWeekday">
                                <option value="" ${template.recurrence?.weekday === "" ? "selected" : ""}>Use selected day</option>
                                <option value="0" ${template.recurrence?.weekday === "0" ? "selected" : ""}>Sunday</option>
                                <option value="1" ${template.recurrence?.weekday === "1" ? "selected" : ""}>Monday</option>
                                <option value="2" ${template.recurrence?.weekday === "2" ? "selected" : ""}>Tuesday</option>
                                <option value="3" ${template.recurrence?.weekday === "3" ? "selected" : ""}>Wednesday</option>
                                <option value="4" ${template.recurrence?.weekday === "4" ? "selected" : ""}>Thursday</option>
                                <option value="5" ${template.recurrence?.weekday === "5" ? "selected" : ""}>Friday</option>
                                <option value="6" ${template.recurrence?.weekday === "6" ? "selected" : ""}>Saturday</option>
                              </select>
                            </div>
                          </div>
                          <div class="form-grid" style="margin-top: 14px;">
                            <div class="field">
                              <label>Biweekly start date</label>
                              <input name="recurrenceAnchorDate" type="date" value="${escapeHtml(template.recurrence?.anchorDate || selectedDate)}" />
                            </div>
                          </div>
                          <div class="field" style="margin-top: 14px;">
                            <label>Notes</label>
                            <textarea name="notes">${escapeHtml(template.notes || "")}</textarea>
                          </div>
                          <div class="actions">
                            <button class="btn btn-primary btn-sm" type="submit">Save template</button>
                            <button class="btn btn-ghost btn-sm" data-cancel-edit-template="${template.id}" type="button">Cancel</button>
                          </div>
                        </form>
                      `
                      : ""
                  }
                  <div class="template-actions" style="margin-top: 14px;">
                    <button class="btn btn-secondary" data-edit-template="${template.id}" type="button">Edit</button>
                    <button class="btn btn-secondary" data-assign-template="${template.id}" type="button">Assign to selected day</button>
                    <button class="btn btn-ghost" data-delete-template="${template.id}" type="button">Delete</button>
                  </div>
                </article>
              `
            )
            .join("")}
        </div>
      </section>
    </section>
  `;
}

function renderSettingsPage() {
  const household = getHousehold();
  const selectedDate = state.selectedDate || todayString();
  const stats = getDayStats(selectedDate);
  const shareUrl = getShareUrl();
  const feeSummary = getDayFeeSummary(selectedDate);
  const weeklyFeeSummary = getFeeRangeSummary(selectedDate, 7);
  const biweeklyFeeSummary = getFeeRangeSummary(selectedDate, 14);
  const paymentHistory = getPaymentHistory();
  const paymentRollup = getPaymentRollup(paymentHistory);
  const workload = getDayWorkloadSummary(selectedDate);
  const session = getDayWorkSessionSummary(selectedDate);

  return `
    <section class="planner-layout">
      <section class="panel">
        <div class="section-header">
          <h2>Household</h2>
        </div>
        <div class="info-card">
          <div class="info-line">
            <strong>Dashboard</strong>
            <span>${escapeHtml(household.name)}</span>
          </div>
          <div class="info-line">
            <strong>Checklist label</strong>
            <span>${escapeHtml(household.helperName)}</span>
          </div>
          <div class="info-line">
            <strong>Selected day</strong>
            <span>${formatDate(selectedDate, { weekday: true })}</span>
          </div>
          <div class="info-line">
            <strong>Current day summary</strong>
            <span>${stats.remaining} left undone, ${stats.completed} completed</span>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="section-header">
          <h2>PIN management</h2>
        </div>
        <form id="pin-update-form">
          <div class="form-grid">
            <div class="field">
              <label for="new-family-pin">New planner PIN</label>
              <input id="new-family-pin" name="familyPin" placeholder="4 digits" minlength="4" required />
            </div>
            <div class="field">
              <label for="new-helper-pin">New caretaker PIN</label>
              <input id="new-helper-pin" name="helperPin" placeholder="4 digits" minlength="4" required />
            </div>
          </div>
          <div class="actions">
            <button class="btn btn-primary" type="submit">Update PINs</button>
          </div>
        </form>
      </section>

      <section class="panel">
        <div class="section-header">
          <h2>Caretaker controls</h2>
        </div>
        <form id="caretaker-controls-form">
          <label class="toggle-row">
            <input
              id="caretaker-completion-lock"
              name="caretakerCompletionLock"
              type="checkbox"
              ${household.settings?.caretakerCompletionLock ? "checked" : ""}
            />
            <span>Lock completed tasks in caretaker view</span>
          </label>
          <p class="small-note">When this is on, the caretaker can mark a task done but cannot uncheck it later without planner access.</p>
          <div class="actions">
            <button class="btn btn-primary" type="submit">Save caretaker controls</button>
          </div>
        </form>
      </section>

      <section class="panel">
        <div class="section-header">
          <h2>Shared access</h2>
        </div>
        <div class="info-card">
          <div class="info-line">
            <strong>Dashboard link</strong>
            <span>${escapeHtml(shareUrl || "This link will appear once cloud sync is ready.")}</span>
          </div>
          <div class="actions">
            <button class="btn btn-secondary" data-copy-share-link type="button">Copy share link</button>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="section-header">
          <div>
            <h2>Payment summary</h2>
            <p class="small-note">Rollups starting from ${formatDate(selectedDate, { weekday: true })}</p>
          </div>
        </div>
        <div class="info-card">
          <div class="info-line">
            <strong>Selected day hours</strong>
            <span>${feeSummary.hours ? `${feeSummary.hours} hrs` : "Not set"}</span>
          </div>
          <div class="info-line">
            <strong>Planned task time</strong>
            <span>${formatHours(workload.taskHours)}</span>
          </div>
          <div class="info-line">
            <strong>Hours spent</strong>
            <span>${session.end ? formatHours(session.spentHours) : session.start ? "In progress" : "Not tracked"}</span>
          </div>
          <div class="info-card" style="margin-top: 18px;">
            <div class="info-line">
              <strong>Selected day total</strong>
              <span>$${feeSummary.total.toFixed(2)}</span>
            </div>
            <div class="info-line">
              <strong>Weekly total</strong>
              <span>$${weeklyFeeSummary.total.toFixed(2)}</span>
            </div>
            <div class="info-line">
              <strong>Biweekly total</strong>
              <span>$${biweeklyFeeSummary.total.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="section-header">
          <div>
            <h2>Payment history</h2>
            <p class="small-note">Track daily pay and mark visits as paid when they are settled.</p>
          </div>
          <span class="pill">${paymentHistory.length} entries</span>
        </div>
        <div class="actions" style="margin-top: 0; margin-bottom: 18px;">
          <button class="btn btn-secondary" data-export-payments type="button">Export payment CSV</button>
        </div>
        <div class="info-card">
          <div class="info-line">
            <strong>Total tracked</strong>
            <span>$${paymentRollup.total.toFixed(2)}</span>
          </div>
          <div class="info-line">
            <strong>Paid</strong>
            <span>$${paymentRollup.paid.toFixed(2)}</span>
          </div>
          <div class="info-line">
            <strong>Outstanding</strong>
            <span>$${paymentRollup.outstanding.toFixed(2)}</span>
          </div>
        </div>
        ${
          paymentHistory.length
            ? `
              <div class="payment-history">
                ${paymentHistory
                  .map(
                    (entry) => `
                      <article class="payment-row">
                        <div>
                          <strong>${formatDate(entry.date, { weekday: true })}</strong>
                          <div class="small-note">${entry.hours} hrs at $${entry.rate.toFixed(2)}/hr</div>
                        </div>
                        <div class="payment-row-side">
                          <span class="pill ${entry.paymentStatus === "paid" ? "success" : "warm"}">$${entry.total.toFixed(2)}</span>
                          <button class="btn btn-secondary btn-sm" data-toggle-payment-status="${entry.date}" type="button">
                            Mark as ${entry.paymentStatus === "paid" ? "unpaid" : "paid"}
                          </button>
                        </div>
                      </article>
                    `
                  )
                  .join("")}
              </div>
            `
            : `
              <div class="empty-state">
                <h3>No payment history yet</h3>
                <p class="muted">As soon as you save hours and rate on a day, it will appear here.</p>
              </div>
            `
        }
      </section>

      <section class="panel">
        <div class="section-header">
          <h2>Housekeeping tools</h2>
        </div>
        <div class="tool-row">
          <button class="btn btn-secondary" data-clear-completed type="button">Clear completed tasks from selected day</button>
          <button class="btn btn-secondary" data-export type="button">Export backup</button>
          <button class="btn btn-ghost" data-reset-dashboard type="button">Reset dashboard</button>
        </div>
      </section>
    </section>
  `;
}

function bindFamilyApp() {
  document.getElementById("global-selected-date").addEventListener("change", (event) => {
    state.selectedDate = event.target.value;
    clearFlash();
    render();
  });

  document.querySelector("[data-open-helper]").addEventListener("click", () => {
    state.session = { role: "helper" };
    state.helperDate = state.selectedDate || todayString();
    clearFlash();
    render();
  });

  document.querySelector("[data-logout]").addEventListener("click", () => {
    state.session = { role: null };
    clearFlash();
    render();
  });

  document.querySelectorAll("[data-family-page]").forEach((button) => {
    button.addEventListener("click", () => {
      state.familyPage = button.dataset.familyPage;
      clearFlash();
      render();
    });
  });

  document.querySelectorAll("[data-pick-date]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedDate = button.dataset.pickDate;
      clearFlash();
      render();
    });
  });

  document.querySelectorAll("[data-family-toggle]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const date = state.selectedDate || todayString();
      replaceTasksForDate(
        date,
        getAssignmentsForDate(date).map((item) =>
          item.id === checkbox.dataset.familyToggle
            ? { ...item, status: checkbox.checked ? "done" : "pending" }
            : item
        )
      );
      clearFlash();
      render();
    });
  });

  document.querySelectorAll("[data-edit-task]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingTaskId = button.dataset.editTask;
      clearFlash();
      render();
    });
  });

  document.querySelectorAll("[data-cancel-edit-task]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingTaskId = null;
      clearFlash();
      render();
    });
  });

  document.querySelectorAll("[data-edit-task-form]").forEach((formNode) => {
    formNode.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const date = state.selectedDate || todayString();
      const taskId = event.currentTarget.dataset.editTaskForm;
      replaceTasksForDate(
        date,
        getAssignmentsForDate(date).map((task) =>
          task.id === taskId
            ? {
                ...task,
                title: String(form.get("title") || "").trim() || task.title,
                area: String(form.get("area") || "").trim() || "General",
                notes: String(form.get("notes") || "").trim(),
                estimateHours: String(form.get("estimateHours") || "").trim(),
              }
            : task
        )
      );
      state.editingTaskId = null;
      setFlash(`Task updated.${getOverloadMessage(date)}`);
      render();
    });
  });

  document.querySelectorAll("[data-toggle-instructions]").forEach((button) => {
    button.addEventListener("click", () => {
      state.openInstructionTaskId =
        state.openInstructionTaskId === button.dataset.toggleInstructions
          ? null
          : button.dataset.toggleInstructions;
      clearFlash();
      render();
    });
  });

  document.getElementById("day-details-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = state.selectedDate || todayString();
    const plan = getDayPlan(date);
    plan.arrivalWindow = String(form.get("arrivalWindow") || "").trim();
    plan.note = String(form.get("note") || "").trim();
    plan.privateNote = String(form.get("privateNote") || "").trim();
    plan.feeHours = String(form.get("feeHours") || "").trim();
    plan.hourlyRate = String(form.get("hourlyRate") || "").trim();
    setFlash(`Saved visit details for ${formatDate(date, { weekday: true })}.${getOverloadMessage(date)}`);
    render();
  });

  document.getElementById("duplicate-day-button")?.addEventListener("click", () => {
    const sourceDate = state.selectedDate || todayString();
    const targetDate = document.getElementById("duplicate-target-date")?.value?.trim();

    if (!targetDate) {
      setFlash("Choose a date to copy the plan to.");
      render();
      return;
    }

    const sourcePlan = getDayPlan(sourceDate);
    const copiedTasks = getAssignmentsForDate(sourceDate).map((task, index) => ({
      ...task,
      id: uid(),
      status: "pending",
      order: index + 1,
      createdAt: new Date().toISOString(),
    }));

    state.duplicateTargetDate = targetDate;
    getHousehold().assignments[targetDate] = {
      note: sourcePlan.note,
      privateNote: sourcePlan.privateNote || "",
      arrivalWindow: sourcePlan.arrivalWindow,
      feeHours: sourcePlan.feeHours || "",
      hourlyRate: sourcePlan.hourlyRate || "",
      paymentStatus: "unpaid",
      tasks: copiedTasks,
    };
    setFlash(`Copied the plan from ${formatDate(sourceDate, { weekday: true })} to ${formatDate(targetDate, { weekday: true })}.`);
    render();
  });

  document.getElementById("template-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    if (!title) return;

    getHousehold().templates.unshift({
      id: uid(),
      title,
      area: String(form.get("area") || "").trim(),
      notes: String(form.get("notes") || "").trim(),
      estimateHours: String(form.get("estimateHours") || "").trim(),
      recurrence: {
        cadence: String(form.get("recurrenceCadence") || "manual"),
        weekday: String(form.get("recurrenceWeekday") || "").trim(),
        anchorDate: String(form.get("recurrenceAnchorDate") || "").trim(),
      },
    });
    setFlash("Saved a new reusable task.");
    render();
  });

  document.querySelectorAll("[data-edit-template]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingTemplateId = button.dataset.editTemplate;
      clearFlash();
      render();
    });
  });

  document.querySelectorAll("[data-cancel-edit-template]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingTemplateId = null;
      clearFlash();
      render();
    });
  });

  document.querySelectorAll("[data-edit-template-form]").forEach((formNode) => {
    formNode.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const templateId = event.currentTarget.dataset.editTemplateForm;
      getHousehold().templates = getHousehold().templates.map((template) =>
        template.id === templateId
          ? {
              ...template,
              title: String(form.get("title") || "").trim() || template.title,
              area: String(form.get("area") || "").trim(),
              notes: String(form.get("notes") || "").trim(),
              estimateHours: String(form.get("estimateHours") || "").trim(),
              recurrence: {
                cadence: String(form.get("recurrenceCadence") || "manual"),
                weekday: String(form.get("recurrenceWeekday") || "").trim(),
                anchorDate: String(form.get("recurrenceAnchorDate") || "").trim(),
              },
            }
          : template
      );
      state.editingTemplateId = null;
      setFlash("Template updated.");
      render();
    });
  });

  document.querySelectorAll("[data-assign-template]").forEach((button) => {
    button.addEventListener("click", () => {
      const template = getHousehold().templates.find((item) => item.id === button.dataset.assignTemplate);
      const date = state.selectedDate || todayString();
      if (!template) return;

      const task = createTaskAssignment({
        title: template.title,
        area: template.area,
        notes: template.notes,
        date,
        source: "template",
      });
      task.estimateHours = String(template.estimateHours || "").trim();

      replaceTasksForDate(date, [...getAssignmentsForDate(date), task]);
      setFlash(`Assigned "${template.title}" to ${formatDate(date, { weekday: true })}.${getOverloadMessage(date)}`);
      render();
    });
  });

  document.querySelector("[data-assign-all-recurring]")?.addEventListener("click", () => {
    const date = state.selectedDate || todayString();
    const recurringTemplates = getRecurringTemplatesForDate(date);
    if (!recurringTemplates.length) {
      setFlash("There are no recurring matches left for this day.");
      render();
      return;
    }

    const nextTasks = recurringTemplates.map((template) => ({
        ...createTaskAssignment({
          title: template.title,
          area: template.area,
          notes: template.notes,
          date,
          source: "template",
        }),
        estimateHours: String(template.estimateHours || "").trim(),
      })
    );

    replaceTasksForDate(date, [...getAssignmentsForDate(date), ...nextTasks]);
    setFlash(`Added ${nextTasks.length} recurring ${nextTasks.length === 1 ? "task" : "tasks"} to ${formatDate(date, { weekday: true })}.${getOverloadMessage(date)}`);
    render();
  });

  document.querySelectorAll("[data-delete-template]").forEach((button) => {
    button.addEventListener("click", () => {
      getHousehold().templates = getHousehold().templates.filter((item) => item.id !== button.dataset.deleteTemplate);
      setFlash("Removed that saved task.");
      render();
    });
  });

  document.querySelectorAll("[data-delete-task]").forEach((button) => {
    button.addEventListener("click", () => {
      const date = state.selectedDate || todayString();
      replaceTasksForDate(
        date,
        getAssignmentsForDate(date).filter((item) => item.id !== button.dataset.deleteTask)
      );
      setFlash("Removed that task from the day.");
      render();
    });
  });

  document.querySelectorAll("[data-move-task]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;

      const date = state.selectedDate || todayString();
      const tasks = getAssignmentsForDate(date);
      const index = tasks.findIndex((task) => task.id === button.dataset.moveTask);
      const direction = button.dataset.direction === "up" ? -1 : 1;
      const nextIndex = index + direction;

      if (index < 0 || nextIndex < 0 || nextIndex >= tasks.length) return;

      const swapped = [...tasks];
      const current = swapped[index];
      swapped[index] = swapped[nextIndex];
      swapped[nextIndex] = current;
      replaceTasksForDate(date, swapped);
      clearFlash();
      render();
    });
  });

  document.querySelector("[data-clear-completed]")?.addEventListener("click", () => {
    const date = state.selectedDate || todayString();
    replaceTasksForDate(
      date,
      getAssignmentsForDate(date).filter((task) => task.status !== "done")
    );
    setFlash("Cleared completed tasks from the selected day.");
    render();
  });

  document.querySelector("[data-export]")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.household, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `house-help-dashboard-backup-${todayString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setFlash("Downloaded a backup of your household plan.");
    render();
  });

  document.querySelector("[data-export-payments]")?.addEventListener("click", () => {
    const rows = [
      ["date", "hours", "rate", "total", "status"],
      ...getPaymentHistory().map((entry) => [
        entry.date,
        String(entry.hours),
        entry.rate.toFixed(2),
        entry.total.toFixed(2),
        entry.paymentStatus,
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `house-help-payments-${todayString()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setFlash("Downloaded payment history CSV.");
    render();
  });

  document.querySelector("[data-copy-share-link]")?.addEventListener("click", async () => {
    const shareUrl = getShareUrl();
    if (!shareUrl) {
      setFlash("Share link is not ready yet.");
      render();
      return;
    }

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setFlash("Share link copied.");
      } else {
        setFlash(`Share this link: ${shareUrl}`);
      }
    } catch (error) {
      console.error("Failed to copy share link", error);
      setFlash(`Share this link: ${shareUrl}`);
    }
    render();
  });

  document.querySelector("[data-reset-dashboard]")?.addEventListener("click", () => {
    const confirmed = window.confirm("Reset the whole dashboard on this device? This will remove the saved household plan.");
    if (!confirmed) return;

    localStorage.removeItem(STORAGE_KEY);
    state = defaultState();
    cloudState.lastSerializedHousehold = null;
    cloudState.dashboardId = null;
    if (cloudState.unsubscribe) {
      cloudState.unsubscribe();
      cloudState.unsubscribe = null;
    }
    if (typeof window !== "undefined" && window.history?.replaceState) {
      window.history.replaceState(null, "", `${window.location.pathname || ""}${window.location.search || ""}`);
    }
    render();
  });

  document.getElementById("pin-update-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const familyPin = String(form.get("familyPin") || "").trim();
    const helperPin = String(form.get("helperPin") || "").trim();

    if (familyPin.length < 4 || helperPin.length < 4) {
      setFlash("Both PINs must be at least 4 digits.");
      render();
      return;
    }

    getHousehold().familyPin = familyPin;
    getHousehold().helperPin = helperPin;
    setFlash("Planner and caretaker PINs updated.");
    render();
  });

  document.getElementById("caretaker-controls-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    getHousehold().settings = {
      ...defaultHouseholdSettings(),
      ...(getHousehold().settings || {}),
      caretakerCompletionLock: Boolean(document.getElementById("caretaker-completion-lock")?.checked),
    };
    setFlash("Caretaker controls updated.");
    render();
  });

  document.querySelectorAll("[data-toggle-payment-status]").forEach((button) => {
    button.addEventListener("click", () => {
      const date = button.dataset.togglePaymentStatus;
      const plan = getDayPlan(date);
      plan.paymentStatus = plan.paymentStatus === "paid" ? "unpaid" : "paid";
      setFlash(
        plan.paymentStatus === "paid"
          ? `Marked ${formatDate(date, { weekday: true })} as paid.`
          : `Marked ${formatDate(date, { weekday: true })} as unpaid.`
      );
      render();
    });
  });

}

function renderHelperDashboard() {
  const selectedDate = state.helperDate || todayString();
  const plan = getDayPlan(selectedDate);
  const { tasks, completed, remaining, progress } = getDayStats(selectedDate);
  const nextTask = tasks.find((task) => task.status !== "done");
  const helperDates = getHelperWindowDates();
  const feeSummary = getDayFeeSummary(selectedDate);
  const workload = getDayWorkloadSummary(selectedDate);
  const session = getDayWorkSessionSummary(selectedDate);
  const completionLock = getHousehold().settings?.caretakerCompletionLock;

  return `
    <main class="shell">
      <div class="backdrop">
        <section class="app-frame helper-frame">
          <section class="dashboard-layout">
            <div class="dashboard-topbar helper-topline helper-singleline">
              <div class="helper-singleline-main">
                <div class="field helper-select-field helper-select-inline">
                  <select id="helper-day-select">
                    ${helperDates
                      .map(
                        (date) => `
                          <option value="${date}" ${date === selectedDate ? "selected" : ""}>
                            ${date === todayString() ? `Today (${formatShortDay(date)})` : formatShortDay(date)}
                          </option>
                        `
                      )
                      .join("")}
                  </select>
                </div>
                <h2 class="page-title">Checklist for ${formatDate(selectedDate, { weekday: true })}</h2>
              </div>
              <div class="helper-singleline-side">
                <aside class="score-card score-card-compact">
                  <div class="score-card-copy">
                    <strong>${tasks.length ? `${completed}/${tasks.length}` : "0/0"}</strong>
                    <p>tasks completed</p>
                  </div>
                  <div class="progress-wrap">
                    <span>${progress}% complete</span>
                    <div class="progress-bar">
                      <div class="progress-fill" style="width: ${progress}%;"></div>
                    </div>
                  </div>
                </aside>
              </div>
            </div>

            <section class="panel notes-footer helper-day-summary helper-day-summary-top">
              <div class="helper-day-summary-strip">
                <div class="summary-chip">
                  <strong>Plan</strong>
                  <span>${formatHours(workload.taskHours)} / ${feeSummary.hours ? formatHours(feeSummary.hours) : "No limit"}</span>
                </div>
                <div class="summary-chip">
                  <strong>Pay</strong>
                  <span>$${feeSummary.total.toFixed(2)}</span>
                </div>
                <div class="summary-chip">
                  <strong>Timer</strong>
                  <span>${formatElapsedTime(session.totalMs)}</span>
                </div>
                <div class="summary-chip ${workload.isOverLimit ? "summary-chip-warn" : ""}">
                  <strong>Fit</strong>
                  <span>${workload.isOverLimit ? `Over ${formatHours(workload.overloadHours)}` : "Within limit"}</span>
                </div>
              </div>
              <div class="actions helper-session-actions">
                ${
                  session.timerStatus === "idle" || session.timerStatus === "finished"
                    ? `<button class="btn btn-primary btn-sm" data-start-work type="button">Start work</button>`
                    : session.timerStatus === "running"
                      ? `
                          <button class="btn btn-secondary btn-sm" data-pause-work type="button">Pause</button>
                          <button class="btn btn-primary btn-sm" data-finish-work type="button">Finish work</button>
                        `
                      : `
                          <button class="btn btn-secondary btn-sm" data-resume-work type="button">Resume</button>
                          <button class="btn btn-primary btn-sm" data-finish-work type="button">Finish work</button>
                        `
                }
              </div>
            </section>

            <section class="dashboard-content">
              <section class="task-board helper-task-board">
                <div class="task-board-header">
                  <h3>${tasks.length && remaining === 0 ? "All done for this day" : nextTask ? `Next task: ${escapeHtml(nextTask.title)}` : "Task list"}</h3>
                  ${plan.arrivalWindow ? `<span class="pill warm">${escapeHtml(plan.arrivalWindow)}</span>` : ""}
                </div>

                ${
                  tasks.length && remaining === 0
                    ? `
                      <div class="empty-state done-state">
                        <h3>Everything is complete</h3>
                        <p class="muted">Great work. All scheduled tasks for ${formatDate(selectedDate, { weekday: true })} are done.</p>
                      </div>
                    `
                    : tasks.length
                    ? `
                      <div class="task-list clean-list helper-task-list">
                        ${tasks
                          .map(
                            (task) => `
                              <article class="task-row ${task.status === "done" ? "task-complete" : ""}">
                                <div class="task-row-main">
                                  <label class="task-row-check">
                                    <input class="checkbox" data-helper-toggle="${task.id}" type="checkbox" ${task.status === "done" ? "checked" : ""} ${completionLock && task.status === "done" ? "disabled" : ""} />
                                    <span class="task-row-copy">
                                      <strong>${escapeHtml(task.title)}</strong>
                                      <span>${escapeHtml(task.area)}</span>
                                      <small>${task.estimateHours ? formatHours(task.estimateHours) : "No time estimate set"}</small>
                                    </span>
                                  </label>
                                  ${
                                    task.notes
                                      ? `<button class="btn btn-secondary btn-sm" data-toggle-instructions="${task.id}" type="button">Instructions</button>`
                                      : ""
                                  }
                                </div>
                                ${
                                  state.openInstructionTaskId === task.id && task.notes
                                    ? `<div class="task-instructions">${escapeHtml(task.notes)}</div>`
                                    : ""
                                }
                              </article>
                            `
                          )
                          .join("")}
                      </div>
                    `
                    : `
                      <div class="empty-state off-day-state">
                        <h3>Off day</h3>
                        <p class="muted">No tasks are scheduled for ${formatDate(selectedDate, { weekday: true })}.</p>
                      </div>
                    `
                }
              </section>
            </section>

            <footer class="helper-footer">
              <button class="btn btn-secondary btn-sm helper-logout-button" data-logout type="button">Log out</button>
            </footer>

          </section>
        </section>
        ${state.flash ? `<div class="message">${escapeHtml(state.flash)}</div>` : ""}
      </div>
    </main>
  `;
}

function bindHelperDashboard() {
  document.querySelector("[data-logout]").addEventListener("click", () => {
    state.session = { role: null };
    clearFlash();
    render();
  });

  document.getElementById("helper-day-select")?.addEventListener("change", (event) => {
    state.helperDate = event.target.value;
    state.openInstructionTaskId = null;
    clearFlash();
    render();
  });

  document.querySelectorAll("[data-helper-toggle]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const date = state.helperDate || todayString();
      const completionLock = getHousehold().settings?.caretakerCompletionLock;
      replaceTasksForDate(
        date,
        getAssignmentsForDate(date).map((item) =>
          item.id === checkbox.dataset.helperToggle
            ? {
                ...item,
                status: completionLock && item.status === "done"
                  ? "done"
                  : checkbox.checked
                    ? "done"
                    : "pending",
              }
            : item
        )
      );
      clearFlash();
      render();
    });
  });

  document.querySelectorAll("[data-toggle-instructions]").forEach((button) => {
    button.addEventListener("click", () => {
      state.openInstructionTaskId =
        state.openInstructionTaskId === button.dataset.toggleInstructions
          ? null
          : button.dataset.toggleInstructions;
      clearFlash();
      render();
    });
  });

  document.querySelector("[data-start-work]")?.addEventListener("click", () => {
    const date = state.helperDate || todayString();
    const plan = getDayPlan(date);
    const now = new Date().toISOString();
    plan.workStartAt = plan.workStartAt || now;
    plan.workEndAt = "";
    plan.timerAccumulatedMs = 0;
    plan.timerLastStartedAt = now;
    plan.timerStatus = "running";
    setFlash("Work session started.");
    render();
  });

  document.querySelector("[data-pause-work]")?.addEventListener("click", () => {
    const date = state.helperDate || todayString();
    const plan = getDayPlan(date);
    if (plan.timerStatus !== "running" || !plan.timerLastStartedAt) return;
    plan.timerAccumulatedMs += Math.max(0, Date.now() - new Date(plan.timerLastStartedAt).getTime());
    plan.timerLastStartedAt = "";
    plan.timerStatus = "paused";
    setFlash("Work timer paused.");
    render();
  });

  document.querySelector("[data-resume-work]")?.addEventListener("click", () => {
    const date = state.helperDate || todayString();
    const plan = getDayPlan(date);
    if (plan.timerStatus !== "paused") return;
    plan.timerLastStartedAt = new Date().toISOString();
    plan.timerStatus = "running";
    setFlash("Work timer resumed.");
    render();
  });

  document.querySelector("[data-finish-work]")?.addEventListener("click", () => {
    const date = state.helperDate || todayString();
    const plan = getDayPlan(date);
    if (!plan.workStartAt) {
      setFlash("Start work first.");
      render();
      return;
    }
    if (plan.timerStatus === "running" && plan.timerLastStartedAt) {
      plan.timerAccumulatedMs += Math.max(0, Date.now() - new Date(plan.timerLastStartedAt).getTime());
    }
    plan.timerLastStartedAt = "";
    plan.timerStatus = "finished";
    plan.workEndAt = new Date().toISOString();
    const session = getDayWorkSessionSummary(date);
    setFlash(`Work session finished. Total time: ${formatHours(session.spentHours)}.`);
    render();
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

bootstrap();
