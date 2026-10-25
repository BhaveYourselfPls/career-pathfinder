// Step 3: one sideways tree per career, a year slider, then choose a career and a path.
import { api } from "../api.js";
import { invalidateAfter, nodeMap, notesFor, pathFor, save, state } from "../state.js";
import { drawTree, rolesAt } from "../tree.js";
import { initialRatings } from "./skills.js";
import { banner, extLink, h, loading, pageHead, range, mount } from "../ui.js";

const focus = {};   // tree index -> focused node id (view-only, not saved)

export function renderCareers(view, { go, rerender }) {
  const trees = state.trees;
  const maxYear = Math.max(...trees.map((t) => t.max_year));
  state.year = Math.min(state.year || 0, maxYear);

  // ---- Slider + "where you might be" summary ----
  const yearOut = h("div", { class: "year" });
  const summary = h("div", { class: "summary-grid" });
  const setters = [];
  const updateYear = () => {
    const yr = state.year;
    yearOut.textContent = `Year ${yr}`;
    setters.forEach((fn) => fn(yr));
    const chosenPath = state.chosen !== null ? new Set(pathFor(state.chosen)) : new Set();
    summary.replaceChildren(...trees.map((t, i) => h("div", { class: "col" },
      h("h4", {}, t.job_title, state.chosen === i ? h("span", { class: "chip blue", style: { marginLeft: "6px" } }, "chosen") : null),
      h("ul", {}, rolesAt(t, yr).map((n) => h("li", {},
        h(state.chosen === i && chosenPath.has(n.id) ? "b" : "span", {}, n.title), " ",
        h("span", { class: "muted" }, range(n.salary_low, n.salary_high))))))));
  };
  const slider = h("input", { type: "range", min: 0, max: maxYear, step: 1, value: state.year, "aria-label": "Years into career" });
  slider.addEventListener("input", () => { state.year = Number(slider.value); updateYear(); });
  slider.addEventListener("change", save);

  const sliderPanel = h("div", { class: "slider-panel" },
    h("div", { class: "slider-row" }, yearOut,
      h("div", { style: { flex: 1 } }, slider, h("div", { class: "range-labels" }, h("span", {}, "Start"), h("span", {}, `${maxYear} years`)))),
    h("p", { class: "tiny muted", style: { marginTop: "6px" } }, "Move the slider to see where you might be in each career."),
    summary);

  // ---- One card per career ----
  const cards = trees.map((tree, i) => treeCard(tree, i, { rerender, setters }));

  const errors = state.careerErrors?.length
    ? h("div", { class: "card soft small" }, state.careerErrors.map((e) => h("p", {}, `Could not map ${e.title}: ${e.error}`)))
    : null;
  const pending = (state.pendingCareers || []).map((title) => h("div", { class: "card tree-card" },
    h("div", { class: "loading compact" }, h("div", { class: "spinner" }), h("div", { class: "msg" }, `Mapping ${title}…`))));

  const nextBtn = h("button", { type: "button", class: "btn primary", disabled: state.chosen === null }, "Continue with this path");
  nextBtn.addEventListener("click", async () => {
    invalidateAfter(3);
    const tree = trees[state.chosen];
    view.replaceChildren(loading([
      "Coach Agent is listing what this path requires…", "Combining research, O*NET skills and role requirements…",
      "Separating hard skills from soft skills…",
    ]));
    try {
      const r = await api.skills(state.profile, tree, pathFor(state.chosen), notesFor(state.chosen));
      state.skills = r.skills;
      state.skillSources = r.sources;
      state.ratings = initialRatings(r.skills);
      go(4);
    } catch (e) {
      banner(e.message, "error");
      rerender();
    }
  });

  mount(view, 
    pageHead("How each career could unfold", "Each map runs left to right over time. Black ? markers are decision points where the path splits. Choose the career you want to pursue, then pick a direction at each decision point. It's tentative, and you can change it later."),
    sliderPanel,
    h("div", { class: "legend", style: { marginTop: "14px" } },
      h("span", {}, h("i", { class: "sw" }), "Typical / common route"),
      h("span", {}, h("i", { class: "sw dash" }), "Less common route"),
      h("span", {}, h("i", { class: "sw fill" }), "Your chosen path"),
      h("span", {}, "Pay = annual base salary range")),
    errors,
    cards,
    pending,
    h("div", { class: "sticky-bar" }, nextBtn,
      h("span", { class: "muted small" }, state.chosen === null ? "Choose a career to continue." : `Path: ${pathFor(state.chosen).map((id) => nodeMap(trees[state.chosen])[id].title).join(" → ")}`)),
  );
  updateYear();
}

// One free-text box of extra details the Coach Agent should consider.
function notesBox(i) {
  const box = h("textarea", {
    maxlength: 600, rows: 2, style: { minHeight: "64px" },
    placeholder: "e.g. I want to work at Samsung GSG, or I'd like to stay remote.",
  });
  box.value = (state.pathNotes || {})[i] || "";
  box.addEventListener("input", () => { (state.pathNotes = state.pathNotes || {})[i] = box.value; save(); });
  box.addEventListener("change", () => { invalidateAfter(3); save(); });
  return h("label", { class: "field", style: { marginTop: "6px" } },
    h("span", {}, "Anything else about this path? ", h("span", { class: "hint" }, "(optional: target employer, location, niche…)")),
    box);
}

function treeCard(tree, i, { rerender, setters }) {
  const chosen = state.chosen === i;
  const path = chosen ? pathFor(i) : [];
  const by = nodeMap(tree);

  const selectNode = (id) => {
    focus[i] = id;
    if (chosen) {
      // Route the path through the clicked role.
      const picks = (state.choices[i] = state.choices[i] || {});
      let n = by[id];
      while (n && n.parent_id) {
        picks[n.parent_id] = n.id;
        n = by[n.parent_id];
      }
      invalidateAfter(3);
      save();
    }
    rerender();
  };

  const { svg, setYear } = drawTree(tree, { year: state.year, path, focusId: focus[i], onNode: selectNode });
  setters.push(setYear);

  const f = focus[i] && by[focus[i]];
  const sourcesById = Object.fromEntries((tree.sources || []).map((s) => [s.id, s]));
  const detail = f ? h("div", { class: "card soft detail small" },
    h("div", { class: "row", style: { justifyContent: "space-between" } },
      h("h3", {}, f.title), h("span", { class: "chip" }, f.commonness)),
    h("p", { class: "muted" }, `Years ${f.start_year}–${f.end_year} · ${range(f.salary_low, f.salary_high)}`),
    h("p", { style: { marginTop: "6px" } }, f.description),
    f.requirements?.length ? h("div", { style: { marginTop: "8px" } }, h("b", {}, "To get here"), h("ul", {}, f.requirements.map((r) => h("li", {}, r)))) : null,
    h("p", { class: "tiny", style: { marginTop: "8px" } },
      f.source_ids?.length
        ? ["Sources: ", ...f.source_ids.flatMap((sid, k) => [k ? ", " : "", extLink(sourcesById[sid]?.url, `[${sid}] ${sourcesById[sid]?.title || ""}`)])]
        : h("span", { class: "muted" }, "Estimate (no direct source for this role)."))) : null;

  // Decision-point picker along the chosen path.
  let decisions = null;
  if (chosen) {
    const forks = path.map((id) => by[id]).filter((n) => n.children.length > 1);
    decisions = h("div", { class: "card flat stack", style: { marginTop: "14px" } },
      h("h3", {}, "Your tentative path"),
      forks.length ? h("div", { class: "decision-list" }, forks.map((n) => {
        const inf = tree.inflections.find((x) => x.node_id === n.id);
        const nextId = path[path.indexOf(n.id) + 1];
        return h("div", { class: "decision-item" },
          h("div", { class: "q" }, `Year ${n.end_year}: ${inf?.question || `After ${n.title}, which way?`}`),
          inf?.considerations ? h("p", { class: "small muted" }, inf.considerations) : null,
          h("div", { class: "pills", style: { marginTop: "8px" } }, n.children.map((cid) => h("button", {
            type: "button", class: `pill ${cid === nextId ? "on" : ""}`,
            onclick: () => {
              (state.choices[i] = state.choices[i] || {})[n.id] = cid;
              invalidateAfter(3);
              save();
              rerender();
            },
          }, by[cid].title, by[cid].branch_label ? ` · ${by[cid].branch_label}` : ""))));
      })) : h("p", { class: "small muted" }, "This career has a single main route."),
      h("p", { class: "tiny muted" }, "Tip: click any role in the map to route your path through it."),
      notesBox(i));
  }

  const sources = tree.sources?.length
    ? h("details", { class: "small", style: { marginTop: "10px" } },
      h("summary", { class: "muted" }, `${tree.sources.length} sources from ${tree.searches_used} web search${tree.searches_used === 1 ? "" : "es"}`),
      h("ol", { class: "sources" }, tree.sources.map((s) => h("li", { value: s.id }, extLink(s.url, s.title)))))
    : h("p", { class: "tiny muted", style: { marginTop: "10px" } }, "No web sources were returned for this career; figures are AI estimates.");

  return h("div", { class: "card tree-card" },
    h("div", { class: "tree-head" },
      h("div", { style: { flex: 1 } },
        h("h2", {}, tree.job_title),
        h("p", { class: "small", style: { marginTop: "4px" } }, tree.summary),
        h("p", { class: "tiny muted", style: { marginTop: "4px" } }, `Pay basis: ${tree.salary_basis}`)),
      h("button", {
        type: "button", class: `btn ${chosen ? "primary" : "ghost"} sm`,
        onclick: () => {
          if (state.chosen === i) return;
          state.chosen = i;
          invalidateAfter(3);
          save();
          rerender();
        },
      }, chosen ? "✓ Chosen" : "Choose this career")),
    h("div", { class: "tree-scroll" }, svg),
    detail,
    decisions,
    sources);
}
