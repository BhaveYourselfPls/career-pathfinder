// Step 2: follow-up questions, then 10 ranked jobs; the user picks up to 3.
import { api } from "../api.js";
import { invalidateAfter, save, state } from "../state.js";
import { banner, dots, extLink, field, h, loading, money, pageHead, range, mount } from "../ui.js";

const MAX_PICK = 3;

// Start mapping a job once it has stayed selected for a moment, so the career
// maps are mostly ready by the time the user clicks "Map these careers".
const prefetched = new Set();
function schedulePrefetch(title) {
  setTimeout(() => {
    const job = state.selected.find((s) => s.title === title);
    const key = `${title}|${JSON.stringify(state.profile)}`;
    if (!job || prefetched.has(key)) return;
    prefetched.add(key);
    api.prefetch(state.profile, job).catch(() => prefetched.delete(key));
  }, 2000);
}

// Map each career with its own request and show step 3 as soon as the first is ready.
let mappingRun = 0;
function mapCareers({ go, rerender, onFail }) {
  const run = ++mappingRun;
  const jobs = [...state.selected];
  invalidateAfter(2);
  state.pendingCareers = jobs.map((j) => j.title);
  let opened = false;
  let failures = 0;
  jobs.forEach((job) => {
    api.careers(state.profile, [job])
      .then((r) => {
        if (run !== mappingRun) return;
        state.trees.push(...r.trees);
        state.careerErrors.push(...r.errors);
        failures += r.trees.length ? 0 : 1;
      })
      .catch((e) => {
        if (run !== mappingRun) return;
        state.careerErrors.push({ title: job.title, error: e.message });
        failures += 1;
      })
      .finally(() => {
        if (run !== mappingRun) return;
        state.pendingCareers = state.pendingCareers.filter((t) => t !== job.title);
        if (jobs.length === 1 && state.trees.length === 1) state.chosen = 0;
        save();
        if (failures === jobs.length) return onFail(state.careerErrors[0]?.error || "No career paths could be mapped.");
        if (!state.trees.length) return;
        if (!opened) { opened = true; go(3); } else if (state.step === 3) refreshCareers(rerender);
      });
  });
}

// Re-render step 3 for a newly arrived map, without stealing focus from a text box.
function refreshCareers(rerender) {
  const active = document.activeElement;
  if (active && active.tagName === "TEXTAREA" && document.getElementById("view").contains(active)) {
    active.addEventListener("blur", () => { if (state.step === 3) rerender(); }, { once: true });
  } else {
    rerender();
  }
}

export function renderPositions(view, { go, rerender }) {
  if (!state.positions) return renderQuestions(view, { rerender });
  renderJobs(view, { go, rerender });
}

// Answers are { picked: [options...], other: "free text" }; several options can be picked.
function answerOf(id) {
  const a = state.answers[id];
  if (!a || typeof a === "string") state.answers[id] = { picked: [], other: typeof a === "string" ? a : "" };
  return state.answers[id];
}

function answerText(id) {
  const a = answerOf(id);
  return [...a.picked, a.other.trim()].filter(Boolean).join("; ");
}

function renderQuestions(view, { rerender }) {
  const qs = state.questions || [];
  const fetchJobs = async () => {
    state.profile.followups = qs
      .filter((q) => answerText(q.id))
      .map((q) => ({ question: q.question, answer: answerText(q.id).slice(0, 500) }));
    view.replaceChildren(loading(["Position Agent is matching jobs to you…", "Ranking by interests, pay and balance…", "Running the safety check…"]));
    try {
      state.positions = await api.positions(state.profile);
      state.selected = [];
      save();
      rerender();
    } catch (e) {
      banner(e.message, "error");
      view.replaceChildren(h("div", { class: "loading" },
        h("p", {}, "Matching did not finish."),
        h("button", { type: "button", class: "btn primary", onclick: fetchJobs }, "Try again")));
    }
  };

  if (!qs.length) {
    fetchJobs();
    return;
  }

  const cards = qs.map((q) => {
    const a = answerOf(q.id);
    const other = h("input", { type: "text", placeholder: "Anything else? (optional)", maxlength: 200 });
    other.value = a.other;
    const pills = h("div", { class: "pills", role: "group", "aria-label": q.question });
    const drawPills = () => pills.replaceChildren(...q.options.map((opt) => {
      const on = a.picked.includes(opt);
      return h("button", {
        type: "button", class: `pill ${on ? "on" : ""}`, "aria-pressed": on ? "true" : "false",
        onclick: () => {
          a.picked = on ? a.picked.filter((x) => x !== opt) : [...a.picked, opt];
          save();
          drawPills();
        },
      }, on ? `✓ ${opt}` : opt);
    }));
    drawPills();
    other.addEventListener("input", () => { a.other = other.value; save(); });
    return h("div", { class: "card stack" },
      h("h3", {}, q.question),
      h("p", { class: "small muted" }, q.why, " ", h("b", {}, "Pick all that apply.")),
      pills, other);
  });

  mount(view,
    pageHead("A few quick questions", "Your answers sharpen the ranking. Pick as many options as fit, or skip any you're unsure about."),
    h("div", { class: "stack" }, cards),
    h("div", { class: "actions" },
      h("button", { type: "button", class: "btn primary", onclick: fetchJobs }, "Show my matches"),
      h("button", { type: "button", class: "btn ghost", onclick: () => { state.answers = {}; fetchJobs(); } }, "Skip questions")));
}

function salaryLine(job) {
  const parts = [h("b", {}, range(job.salary_low, job.salary_high)), " ", h("span", { class: "chip" }, "AI estimate")];
  if (job.onet?.median_wage) {
    parts.push(" ", h("span", { class: "chip blue", title: "U.S. Bureau of Labor Statistics, national median" }, `BLS median ${money(job.onet.median_wage)}`));
  }
  return h("span", {}, ...parts);
}

function renderJobs(view, { go, rerender }) {
  const { jobs, removed, ranking_note } = state.positions;
  const all = [...jobs, ...state.customJobs];
  const isOn = (j) => state.selected.some((s) => s.title === j.title);
  const counter = h("span", { class: "muted small" });
  const nextBtn = h("button", { type: "button", class: "btn primary" }, "Map these careers");
  const list = h("div", { class: "stack" });

  const draw = () => {
    counter.textContent = `${state.selected.length} of ${MAX_PICK} selected`;
    nextBtn.disabled = state.selected.length === 0 || all.some((j) => j.pending);
    list.replaceChildren(...all.map((job, i) => {
      const on = isOn(job);
      const full = !on && state.selected.length >= MAX_PICK;
      const toggle = () => {
        if (on) state.selected = state.selected.filter((s) => s.title !== job.title);
        else if (!full) {
          state.selected.push({ title: job.title, soc_code: job.soc_code || "" });
          if (!job.pending) schedulePrefetch(job.title);
        } else return banner(`You can compare up to ${MAX_PICK} jobs. Unselect one first.`);
        invalidateAfter(2);
        save();
        draw();
      };
      return h("div", {
        class: `card job ${on ? "on" : ""} ${full ? "disabled" : ""}`, role: "checkbox", tabindex: 0,
        "aria-checked": on ? "true" : "false", onclick: (e) => { if (!e.target.closest("a")) toggle(); },
        onkeydown: (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); } },
      },
        h("div", { class: "rank" }, job.custom ? "+" : String(i + 1)),
        h("div", {},
          h("h3", {}, job.title),
          job.custom
            ? h("div", {},
              h("div", { class: "job-meta" }, h("span", { class: "chip blue" }, job.pending ? "Checking…" : "Added by you"),
                job.preparation ? h("span", {}, h("b", {}, "Preparation: "), job.preparation) : null),
              job.description ? h("p", { class: "small" }, job.description) : null)
            : h("div", { class: "job-meta" },
              salaryLine(job),
              h("span", {}, "Work/life ", dots(job.work_life)),
              h("span", {}, h("b", {}, "Education: "), job.education_needed),
              h("span", {}, h("b", {}, "Outlook: "), job.outlook)),
          job.custom ? null : h("p", { class: "small", style: { marginBottom: "10px" } }, job.day_to_day),
          job.custom ? null : h("div", { class: "pros" },
            h("div", {}, h("b", {}, "Why it fits"), job.why_fit),
            h("div", {}, h("b", {}, "Watch out"), job.drawback)),
          job.custom ? null : h("details", { class: "small", style: { marginTop: "10px" }, onclick: (e) => e.stopPropagation() },
            h("summary", { class: "muted" }, "More"),
            h("p", { style: { marginTop: "6px" } }, h("b", {}, "How people get in: "), job.entry_path),
            h("p", {}, h("b", {}, "Pay basis: "), job.salary_basis),
            job.onet ? h("p", {}, h("b", {}, "Preparation: "), job.onet.preparation || "n/a", " · ", extLink(job.onet.url, "Occupation profile")) : null)),
        job.custom ? h("div", {}) : h("div", { class: "fit" },
          h("div", { class: "score" }, String(job.fit_score)), h("div", { class: "tiny muted" }, "fit score"),
          h("div", { class: "bar" }, h("i", { style: { width: `${job.fit_score}%` } }))));
    }));
  };

  // Let the user add a job title the agent did not suggest (safety-checked).
  const custom = h("input", { type: "text", placeholder: "e.g. Urban Planner", maxlength: 120 });
  const addBtn = h("button", { type: "button", class: "btn ghost sm" }, "Add");
  // Show the job right away (and select it); the safety check finishes in the background.
  const addCustom = async () => {
    const title = custom.value.trim();
    if (title.length < 2) return;
    if (all.some((j) => j.title.toLowerCase() === title.toLowerCase())) return banner("That job is already in the list.");
    const job = { title, soc_code: "", custom: true, pending: true };
    state.customJobs.push(job);
    all.push(job);
    if (state.selected.length < MAX_PICK) {
      state.selected.push({ title, soc_code: "" });
      invalidateAfter(2);
    }
    custom.value = "";
    draw();
    try {
      const r = await api.customJob(title);
      Object.assign(job, { soc_code: r.soc_code, description: r.description, preparation: r.preparation, pending: false });
      const sel = state.selected.find((s) => s.title === title);
      if (sel) {
        sel.soc_code = r.soc_code;
        schedulePrefetch(title);
      }
    } catch (e) {
      banner(e.message, "error");
      state.customJobs = state.customJobs.filter((j) => j !== job);
      all.splice(all.indexOf(job), 1);
      state.selected = state.selected.filter((s) => s.title !== title);
    }
    save();
    draw();
  };
  addBtn.addEventListener("click", addCustom);
  custom.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } });

  nextBtn.addEventListener("click", () => {
    view.replaceChildren(loading([
      "Career Agent is researching each path…", "Checking titles and pay on BLS, Indeed and LinkedIn…",
      "Finding the decision points…", "The first map appears as soon as it's ready…",
    ]));
    mapCareers({ go, rerender, onFail: (msg) => { banner(msg, "error"); state.step = 2; rerender(); } });
  });

  draw();
  mount(view, 
    pageHead("Your top matches", `${ranking_note} Pick up to ${MAX_PICK} to map in detail.`),
    removed?.length ? h("p", { class: "small muted", style: { marginBottom: "14px" } },
      `${removed.length} suggestion${removed.length > 1 ? "s were" : " was"} removed by the safety filter (gambling, harm to others or illegal activity).`) : null,
    list,
    h("div", { class: "card soft", style: { marginTop: "16px" } },
      field("Have another job in mind?", h("div", { class: "row", style: { flexWrap: "nowrap" } }, custom, addBtn))),
    h("div", { class: "sticky-bar" }, nextBtn, counter, h("span", { class: "spacer" }),
      h("button", { type: "button", class: "btn ghost sm", onclick: () => { state.positions = null; save(); rerender(); } }, "Re-run matching")),
  );
}
