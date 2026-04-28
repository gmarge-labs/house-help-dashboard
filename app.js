const STORAGE_KEY = "house_help_dashboard_state_v3";

let state = loadState();
let isBootstrapping = true;

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
    flash: "",
  };
}

function normalizeTask(task, index) {
  return {
    id: task.id || uid(),
    title: task.title || "Untitled task",
    area: task.area || "General",
    notes: task.notes || "",
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
        arrivalWindow: "",
        feeHours: "",
        hourlyRate: "",
        tasks: value.map(normalizeTask).sort((a, b) => a.order - b.order),
      };
      return;
    }

    normalized[date] = {
      note: value?.note || "",
      arrivalWindow: value?.arrivalWindow || "",
      feeHours: value?.feeHours || "",
      hourlyRate: value?.hourlyRate || "",
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
      helperName: raw.household.helperName || "",
      familyPin: raw.household.familyPin || "",
      helperPin: raw.household.helperPin || "",
      templates: Array.isArray(raw.household.templates)
        ? raw.household.templates.map((template) => ({
            id: template.id || uid(),
            title: template.title || "Untitled template",
            area: template.area || "General",
            notes: template.notes || "",
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

function getHousehold() {
  return state.household;
}

function ensureDayPlan(date) {
  const household = getHousehold();
  if (!household.assignments[date]) {
    household.assignments[date] = {
      note: "",
      arrivalWindow: "",
      feeHours: "",
      hourlyRate: "",
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
      return plan.tasks.length > 0 || plan.note || plan.arrivalWindow;
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

  app.innerHTML = state.session.role === "family" ? renderFamilyApp() : renderHelperDashboard();

  if (state.session.role === "family") {
    bindFamilyApp();
  } else {
    bindHelperDashboard();
  }

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
        helperName,
        familyPin,
        helperPin,
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
  const household = getHousehold();
  const role = state.loginRole || "helper";

  return `
    <main class="login-wrap">
      <section class="login-card">
        <div class="eyebrow">${escapeHtml(household.name)}</div>
        <h1>Enter a PIN to continue.</h1>
        <p class="muted">
          Choose how you are signing in. The planner can manage the schedule and open the checklist view. The caretaker can only open the checklist.
        </p>

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
    if (role === "helper") {
      state.helperDate = todayString();
    }
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

  return `
    <section class="planner-layout">
      <section class="panel">
        <div class="section-header">
          <div>
            <h2>Plan this day</h2>
            <p class="small-note">Build the checklist and the note that appears on the task board.</p>
          </div>
          <span class="pill">${tasks.length} tasks</span>
        </div>

        <form id="day-details-form">
          <div class="form-grid">
            <div class="field">
              <label for="arrival-window">Arrival window</label>
              <input id="arrival-window" name="arrivalWindow" value="${escapeHtml(plan.arrivalWindow)}" placeholder="10:00 AM to 2:00 PM" />
            </div>
          </div>
          <div class="field" style="margin-top: 14px;">
            <label for="day-note">Daily note</label>
            <textarea id="day-note" name="note" placeholder="Start upstairs first, then finish the kitchen.">${escapeHtml(plan.note)}</textarea>
          </div>
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
                          </div>
                          <span class="pill">${escapeHtml(task.area)}</span>
                        </header>
                        <div class="task-actions" style="margin-top: 14px;">
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
                      <div class="small-note">${escapeHtml(template.notes || "No note added yet.")}</div>
                    </div>
                    <span class="pill">${escapeHtml(template.area || "General")}</span>
                  </header>
                  <div class="template-actions" style="margin-top: 14px;">
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
  const plan = getDayPlan(selectedDate);
  const feeSummary = getDayFeeSummary(selectedDate);
  const weeklyFeeSummary = getFeeRangeSummary(selectedDate, 7);
  const biweeklyFeeSummary = getFeeRangeSummary(selectedDate, 14);

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
            <h2>Helper fees</h2>
            <p class="small-note">For ${formatDate(selectedDate, { weekday: true })}</p>
          </div>
        </div>
        <form id="fee-calculator-form">
          <div class="form-grid">
            <div class="field">
              <label for="fee-hours">Hours worked</label>
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
          <div class="info-card" style="margin-top: 18px;">
            <div class="info-line">
              <strong>Calculated total</strong>
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
          <div class="actions">
            <button class="btn btn-primary" type="submit">Save fee details</button>
          </div>
        </form>
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
    setFlash(`Saved visit details for ${formatDate(date, { weekday: true })}.`);
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
      arrivalWindow: sourcePlan.arrivalWindow,
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
    });
    setFlash("Saved a new reusable task.");
    render();
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

      replaceTasksForDate(date, [...getAssignmentsForDate(date), task]);
      setFlash(`Assigned "${template.title}" to ${formatDate(date, { weekday: true })}.`);
      render();
    });
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

  document.getElementById("fee-calculator-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = state.selectedDate || todayString();
    const plan = getDayPlan(date);

    plan.feeHours = String(form.get("feeHours") || "").trim();
    plan.hourlyRate = String(form.get("hourlyRate") || "").trim();

    const feeSummary = getDayFeeSummary(date);
    setFlash(`Fee details saved. Estimated total: $${feeSummary.total.toFixed(2)}.`);
    render();
  });
}

function renderHelperDashboard() {
  const selectedDate = state.helperDate || todayString();
  const plan = getDayPlan(selectedDate);
  const { tasks, completed, remaining, progress } = getDayStats(selectedDate);
  const nextTask = tasks.find((task) => task.status !== "done");
  const helperDates = getHelperWindowDates();

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
                    <span class="score-label">At a glance</span>
                    <strong>${tasks.length ? remaining : "Off"}</strong>
                    <p>${tasks.length ? (remaining === 1 ? "task left undone" : "tasks left undone") : "day"}</p>
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

            <section class="dashboard-content">
              <section class="task-board helper-task-board">
                <div class="task-board-header">
                  <h3>${nextTask ? `Next task: ${escapeHtml(nextTask.title)}` : "Task list"}</h3>
                  ${plan.arrivalWindow ? `<span class="pill warm">${escapeHtml(plan.arrivalWindow)}</span>` : ""}
                </div>

                ${
                  tasks.length
                    ? `
                      <div class="task-list clean-list helper-task-list">
                        ${tasks
                          .map(
                            (task) => `
                              <article class="task-row ${task.status === "done" ? "task-complete" : ""}">
                                <div class="task-row-main">
                                  <label class="task-row-check">
                                    <input class="checkbox" data-helper-toggle="${task.id}" type="checkbox" ${task.status === "done" ? "checked" : ""} />
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
                      <div class="empty-state off-day-state">
                        <h3>Off day</h3>
                        <p class="muted">No tasks are scheduled for ${formatDate(selectedDate, { weekday: true })}.</p>
                      </div>
                    `
                }
              </section>
            </section>

            <footer class="helper-footer">
              <button class="btn btn-secondary" data-logout type="button">Log out</button>
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
      replaceTasksForDate(
        date,
        getAssignmentsForDate(date).map((item) =>
          item.id === checkbox.dataset.helperToggle
            ? { ...item, status: checkbox.checked ? "done" : "pending" }
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
