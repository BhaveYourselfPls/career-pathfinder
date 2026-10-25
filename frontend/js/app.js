import { api, onUsage } from "./api.js";
import { download, replace, reset, save, state } from "./state.js";
import { banner } from "./ui.js";
import { renderStart } from "./steps/start.js";
import { renderPositions } from "./steps/positions.js";
import { renderCareers } from "./steps/careers.js";
import { renderSkills } from "./steps/skills.js";
import { renderPlan } from "./steps/plan.js";

const RENDER = { 1: renderStart, 2: renderPositions, 3: renderCareers, 4: renderSkills, 5: renderPlan };
const view = document.getElementById("view");

export function go(step) {
  state.step = step;
  state.maxStep = Math.max(state.maxStep, step);
  save();
  render();
  window.scrollTo({ top: 0 });
}

export function render() {
  document.querySelectorAll("#steps li").forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle("active", n === state.step);
    li.classList.toggle("done", n < state.step);
    li.classList.toggle("reachable", n <= state.maxStep);
    li.querySelector("button").setAttribute("aria-current", n === state.step ? "step" : "false");
  });
  view.replaceChildren();
  RENDER[state.step](view, { go, rerender: render });
}

document.querySelectorAll("#steps li").forEach((li) => {
  li.querySelector("button").addEventListener("click", () => {
    const n = Number(li.dataset.step);
    if (n <= state.maxStep && n !== state.step) go(n);
  });
});

const usageEl = document.getElementById("usage");
onUsage((u) => {
  usageEl.textContent = `Searches ${u.searches_used}/${u.searches_max}`;
  state.usage = u;
});

document.getElementById("btn-save").addEventListener("click", download);
document.getElementById("btn-restart").addEventListener("click", () => {
  if (!confirm("Start over? Your current answers and results will be cleared.")) return;
  reset();
  sessionStorage.removeItem("career-run-id");
  usageEl.textContent = "Searches 0/15";
  render();
});
document.getElementById("file-load").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    replace(JSON.parse(await file.text()));
    banner("Saved progress loaded.");
    render();
  } catch (err) {
    banner(err.message || "Could not load that file.", "error");
  }
});

api.status().then((st) => {
  if (!st.key_configured) {
    banner("PORTKEY_API_KEY is missing. Add it to a .env file in the project folder or its parent, then restart the app.", "error");
  }
}).catch((e) => banner(e.message, "error"));

// A reload interrupts any maps still being built; don't show them as pending forever.
state.pendingCareers = [];
if (state.step >= 3 && !state.trees.length) state.step = 2;
render();
