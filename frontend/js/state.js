// One shared record of the user's answers and the agents' results.
// Autosaved to this browser; can be downloaded and reloaded as JSON.

const KEY = "career-pathfinder-v1";
const VERSION = 1;

export function defaultProfile() {
  return {
    mode: "explore",
    interests: "",
    salary_min: null,
    salary_max: null,
    work_life: 3,
    education: "",
    location: "",
    remote: "any",
    relocate: false,
    school: "maybe",
    learning_hours: 5,
    current_title: "",
    years_experience: null,
    current_salary: null,
    resume: null,
    followups: [],
  };
}

function fresh() {
  return {
    version: VERSION,
    step: 1,
    maxStep: 1,
    startInput: "manual",        // "resume" | "manual" (when mode = start)
    profile: defaultProfile(),
    resumeRedacted: [],
    questions: null,             // null = not asked yet
    answers: {},                 // question id -> answer text
    positions: null,             // { jobs, removed, ranking_note }
    customJobs: [],
    selected: [],                // [{title, soc_code}]
    trees: [],
    careerErrors: [],
    chosen: null,                // index into trees
    choices: {},                 // tree index -> { decision node id -> chosen child id }
    pathNotes: {},               // tree index -> free-text notes, e.g. "I want to work at Samsung GSG"
    year: 0,
    skills: null,
    skillSources: [],
    ratings: {},                 // skill id -> { have, want }
    plan: null,
    openings: null,
  };
}

export const state = load() || fresh();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.version === VERSION ? { ...fresh(), ...s } : null;
  } catch {
    return null;
  }
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or disabled */ }
}

export function reset() {
  Object.keys(state).forEach((k) => delete state[k]);
  Object.assign(state, fresh());
  save();
}

export function replace(data) {
  if (!data || data.version !== VERSION) throw new Error("This file was not saved by Career Pathfinder.");
  Object.keys(state).forEach((k) => delete state[k]);
  Object.assign(state, fresh(), data);
  save();
}

// Clear everything computed after `step`, because its inputs changed.
export function invalidateAfter(step) {
  if (step < 2) Object.assign(state, { questions: null, answers: {}, positions: null, customJobs: [], selected: [] });
  if (step < 3) Object.assign(state, { trees: [], pendingCareers: [], careerErrors: [], chosen: null, choices: {}, pathNotes: {}, year: 0 });
  if (step < 4) Object.assign(state, { skills: null, skillSources: [], ratings: {} });
  if (step < 5) Object.assign(state, { plan: null, openings: null, openingsRole: null });
  state.maxStep = Math.min(state.maxStep, step);
}

export function download() {
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "career-plan.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function notesFor(treeIndex) {
  return ((state.pathNotes || {})[treeIndex] || "").trim();
}

// ---- Tree helpers shared by the career and plan steps ----

export function nodeMap(tree) {
  return Object.fromEntries(tree.nodes.map((n) => [n.id, n]));
}

// Follow the user's choice at each decision point (default: first branch).
export function pathFor(treeIndex) {
  const tree = state.trees[treeIndex];
  if (!tree) return [];
  const by = nodeMap(tree);
  const picks = state.choices[treeIndex] || {};
  const path = [];
  let node = by[tree.root_id];
  while (node && path.length < 30) {
    path.push(node.id);
    if (!node.children.length) break;
    const next = picks[node.id] && node.children.includes(picks[node.id]) ? picks[node.id] : node.children[0];
    node = by[next];
  }
  return path;
}

// Every root-to-leaf route through a tree.
export function allPaths(tree) {
  const by = nodeMap(tree);
  const out = [];
  const walk = (id, acc) => {
    const n = by[id];
    if (!n) return;
    const next = [...acc, n];
    if (!n.children.length) out.push(next);
    n.children.forEach((c) => walk(c, next));
  };
  walk(tree.root_id, []);
  return out;
}
