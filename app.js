const registrationView = document.querySelector("#registration-view");
const adminView = document.querySelector("#admin-view");
const registrationForm = document.querySelector("#registration-form");
const feedback = document.querySelector("#form-feedback");
const adminFeedback = document.querySelector("#admin-feedback");
const applicationsBody = document.querySelector("#applications-body");
const emptyState = document.querySelector("#empty-state");
const applicationSearch = document.querySelector("#application-search");
const statusFilter = document.querySelector("#status-filter");
const applicationDialog = document.querySelector("#application-dialog");
const adminLoginDialog = document.querySelector("#admin-login-dialog");
const adminLoginForm = document.querySelector("#admin-login-form");
const adminPasswordInput = document.querySelector("#admin-password");
const dateOfBirthInput = document.querySelector("#date-of-birth");

let applications = [];
let adminPassword = "";
let loginResolver = null;

dateOfBirthInput.max = new Date().toISOString().slice(0, 10);

function showFeedback(message, isError = false, target = feedback) {
  target.textContent = message;
  target.classList.toggle("error", isError);
  target.hidden = false;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function readResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function requestAdminPassword() {
  adminPasswordInput.value = "";
  adminLoginDialog.showModal();
  adminPasswordInput.focus();
  return new Promise((resolve) => { loginResolver = resolve; });
}

adminLoginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  adminPassword = adminPasswordInput.value;
  adminLoginDialog.close();
  if (loginResolver) loginResolver(adminPassword);
  loginResolver = null;
});

document.querySelector("#cancel-admin-login").addEventListener("click", () => {
  adminLoginDialog.close();
  if (loginResolver) loginResolver(null);
  loginResolver = null;
});

adminLoginDialog.addEventListener("cancel", () => {
  if (loginResolver) loginResolver(null);
  loginResolver = null;
});

function authorizationHeaders() {
  if (!adminPassword) return {};
  const credentials = new TextEncoder().encode(`admin:${adminPassword}`);
  const binaryCredentials = Array.from(credentials, (byte) => String.fromCharCode(byte)).join("");
  return { Authorization: `Basic ${btoa(binaryCredentials)}` };
}

async function loadApplications() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!adminPassword) {
      const password = await requestAdminPassword();
      if (password === null) return false;
    }
    try {
      const response = await fetch("/api/applications", { headers: authorizationHeaders() });
      const payload = await readResponse(response);
      applications = payload.applications;
      renderApplications();
      return true;
    } catch (error) {
      if (error.status === 401 && attempt === 0) {
        adminPassword = "";
        continue;
      }
      if (error.status === 401) adminPassword = "";
      showFeedback(error.status === 401
        ? "Incorrect admin password. Please open Admin review and try again."
        : `Could not load registrations: ${error.message}`, true, adminFeedback);
      return false;
    }
  }
  return false;
}

async function setView(view) {
  const showAdmin = view === "admin";
  registrationView.hidden = showAdmin;
  adminView.hidden = !showAdmin;
  document.querySelectorAll(".nav-link").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (showAdmin) {
    adminFeedback.hidden = true;
    await loadApplications();
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    setView(button.dataset.view);
  });
});

function formatDate(dateString) {
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(new Date(dateString));
}

function getInitials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function makeAction(label, className, action, applicationId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `action-button ${className}`;
  button.dataset.action = action;
  button.dataset.id = applicationId;
  button.textContent = label;
  return button;
}

function renderApplications() {
  const counts = {
    all: applications.length,
    pending: applications.filter((application) => application.status === "pending").length,
    approved: applications.filter((application) => application.status === "approved").length,
    declined: applications.filter((application) => application.status === "declined").length,
  };
  document.querySelector("#total-count").textContent = counts.all;
  document.querySelector("#pending-count").textContent = counts.pending;
  document.querySelector("#approved-count").textContent = counts.approved;
  document.querySelector("#declined-count").textContent = counts.declined;
  document.querySelector("#pending-nav-count").textContent = counts.pending;

  const query = applicationSearch.value.trim().toLowerCase();
  const selectedStatus = statusFilter.value;
  const filtered = [...applications]
    .filter((application) => selectedStatus === "all" || application.status === selectedStatus)
    .filter((application) => [application.fullName, application.studentId, application.email].some((value) => value.toLowerCase().includes(query)))
    .sort((first, second) => new Date(second.submittedAt) - new Date(first.submittedAt));

  applicationsBody.replaceChildren();
  filtered.forEach((application) => {
    const row = document.createElement("tr");
    const studentCell = document.createElement("td");
    const identity = document.createElement("div");
    identity.className = "student-cell";
    const avatar = document.createElement("span");
    avatar.className = "student-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = getInitials(application.fullName);
    const identityText = document.createElement("span");
    identityText.className = "student-ident";
    const name = document.createElement("strong");
    name.textContent = application.fullName;
    const studentId = document.createElement("span");
    studentId.textContent = application.studentId;
    identityText.append(name, studentId);
    identity.append(avatar, identityText);
    studentCell.append(identity);

    const programCell = document.createElement("td");
    programCell.textContent = application.program;
    const yearCell = document.createElement("td");
    yearCell.textContent = application.studyYear;
    const dateCell = document.createElement("td");
    dateCell.textContent = formatDate(application.submittedAt);
    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    status.className = `status-pill status-${application.status}`;
    status.textContent = application.status;
    statusCell.append(status);
    const actionsCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.append(makeAction("View", "action-view", "view", application.id));
    if (application.status === "pending") {
      actions.append(makeAction("Approve", "action-approve", "approve", application.id));
      actions.append(makeAction("Decline", "action-decline", "decline", application.id));
    }
    actionsCell.append(actions);
    row.append(studentCell, programCell, yearCell, dateCell, statusCell, actionsCell);
    applicationsBody.append(row);
  });

  emptyState.hidden = filtered.length > 0;
  document.querySelector("#results-caption").textContent = query || selectedStatus !== "all"
    ? `Showing ${filtered.length} of ${applications.length} registrations`
    : "All student registrations";
}

registrationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!registrationForm.reportValidity()) return;

  const formData = new FormData(registrationForm);
  const application = Object.fromEntries(formData.entries());
  delete application.consent;
  application.fullName = application.fullName.trim();
  application.studentId = application.studentId.trim();
  application.email = application.email.trim().toLowerCase();
  application.phone = application.phone.trim();
  application.address = application.address.trim();

  const submitButton = registrationForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const response = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(application),
    });
    await readResponse(response);
    registrationForm.reset();
    dateOfBirthInput.max = new Date().toISOString().slice(0, 10);
    showFeedback("Your registration has been submitted successfully. The admissions team will review it shortly.");
  } catch (error) {
    showFeedback(error.message || "Your registration could not be saved. Please try again.", true);
  } finally {
    submitButton.disabled = false;
  }
});

async function updateStatus(applicationId, status) {
  try {
    const response = await fetch(`/api/applications/${encodeURIComponent(applicationId)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authorizationHeaders() },
      body: JSON.stringify({ status }),
    });
    await readResponse(response);
    await loadApplications();
  } catch (error) {
    showFeedback(`Could not update the registration: ${error.message}`, true, adminFeedback);
  }
}

function addDetail(list, label, value) {
  const item = document.createElement("div");
  item.className = "detail-item";
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  item.append(term, description);
  list.append(item);
}

function showApplicationDetails(application) {
  document.querySelector("#dialog-title").textContent = application.fullName;
  const details = document.querySelector("#dialog-details");
  details.replaceChildren();
  [
    ["Student ID", application.studentId],
    ["Email address", application.email],
    ["Phone number", application.phone],
    ["Date of birth", formatDate(application.dateOfBirth)],
    ["Program", application.program],
    ["Year of study", application.studyYear],
    ["Home address", application.address],
    ["Submitted", formatDate(application.submittedAt)],
    ["Status", application.status],
  ].forEach(([label, value]) => addDetail(details, label, value));

  const actions = document.querySelector("#dialog-actions");
  actions.replaceChildren();
  if (application.status === "pending") {
    actions.append(
      makeAction("Decline", "action-decline", "decline", application.id),
      makeAction("Approve", "action-approve", "approve", application.id),
    );
  }
  applicationDialog.showModal();
}

applicationsBody.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const application = applications.find((item) => item.id === button.dataset.id);
  if (!application) return;
  if (button.dataset.action === "view") showApplicationDetails(application);
  if (button.dataset.action === "approve") updateStatus(application.id, "approved");
  if (button.dataset.action === "decline") updateStatus(application.id, "declined");
});

document.querySelector("#dialog-actions").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || button.dataset.action === "view") return;
  updateStatus(button.dataset.id, button.dataset.action === "approve" ? "approved" : "declined");
  applicationDialog.close();
});

document.querySelector(".dialog-close").addEventListener("click", () => applicationDialog.close());
applicationDialog.addEventListener("click", (event) => {
  if (event.target === applicationDialog) applicationDialog.close();
});
applicationSearch.addEventListener("input", renderApplications);
statusFilter.addEventListener("change", renderApplications);

document.querySelector("#export-button").addEventListener("click", () => {
  if (applications.length === 0) {
    document.querySelector("#results-caption").textContent = "There are no registrations to export yet.";
    return;
  }

  const headers = ["Full name", "Student ID", "Date of birth", "Email", "Phone", "Program", "Year of study", "Address", "Status", "Submitted"];
  const csvCell = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const rows = applications.map((application) => [
    application.fullName, application.studentId, application.dateOfBirth, application.email,
    application.phone, application.program, application.studyYear, application.address,
    application.status, application.submittedAt,
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "northstar-student-registrations.csv";
  link.click();
  URL.revokeObjectURL(url);
});

renderApplications();
