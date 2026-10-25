// Calls to the local backend. The run id ties every call to one search budget.

const RUN_KEY = "career-run-id";

export class ApiError extends Error {
  constructor(message, kind, status) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

let usageListener = () => {};
export function onUsage(fn) { usageListener = fn; }

async function call(path, { json, form, method = "POST" } = {}) {
  const headers = {};
  const runId = sessionStorage.getItem(RUN_KEY);
  if (runId) headers["X-Run-Id"] = runId;
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }
  let res;
  try {
    res = await fetch(path, { method, headers, body });
  } catch {
    throw new ApiError("Cannot reach the app server. Is `python app.py` still running?", "network", 0);
  }
  const newId = res.headers.get("X-Run-Id");
  if (newId) sessionStorage.setItem(RUN_KEY, newId);
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (data.usage) usageListener(data.usage);
  if (!res.ok) {
    const msg = data.error || (Array.isArray(data.detail) ? "Some inputs are invalid." : `Request failed (${res.status}).`);
    throw new ApiError(msg, data.kind || "http", res.status);
  }
  return data;
}

export const api = {
  status: () => call("/api/status", { method: "GET" }),
  resume: (file) => {
    const form = new FormData();
    form.append("file", file);
    return call("/api/resume", { form });
  },
  questions: (profile) => call("/api/positions/questions", { json: { profile } }),
  positions: (profile) => call("/api/positions", { json: { profile } }),
  customJob: (title) => call("/api/positions/custom", { json: { title } }),
  prefetch: (profile, job) => call("/api/careers/prefetch", { json: { profile, job } }),
  careers: (profile, jobs) => call("/api/careers", { json: { profile, jobs } }),
  skills: (profile, tree, path, notes) => call("/api/coach/skills", { json: { profile, tree, path, notes } }),
  plan: (body) => call("/api/coach/plan", { json: body }),
  openings: (title, location, notes) => call("/api/openings", { json: { title, location, notes } }),
};
