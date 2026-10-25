// Step 5: trajectory, salary projection, what to do and when.
import { api } from "../api.js";
import { allPaths, download, nodeMap, notesFor, pathFor, save, state } from "../state.js";
import { extLink, h, LEVELS, loading, money, mount, pageHead, range, s } from "../ui.js";

const norm = (t) => (t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sameTitle = (a, b) => !!norm(b) && norm(a) === norm(b);

export function renderPlan(view, { rerender }) {
  const tree = state.trees[state.chosen];
  const by = nodeMap(tree);
  const path = pathFor(state.chosen).map((id) => by[id]);
  const plan = state.plan;
  const first = path[0];
  const last = path[path.length - 1];
  const skillName = Object.fromEntries((plan.gaps || []).map((g) => [g.id, g.name]));
  const planSources = Object.fromEntries((plan.sources || []).map((x) => [x.id, x]));

  const actionItem = (a, cls = "todo") => h("div", { class: cls },
    cls === "todo" ? h("span", { class: "box", "aria-hidden": "true" }) : null,
    h("div", {},
      h("strong", {}, a.title),
      h("p", { class: "small" }, a.detail),
      h("div", { class: "row tiny muted", style: { gap: "6px", marginTop: "4px" } },
        a.effort ? h("span", { class: "chip" }, a.effort) : null,
        ...(a.skill_ids || []).map((id) => (skillName[id] ? h("span", { class: "chip blue" }, skillName[id]) : null)),
        ...(a.source_ids || []).map((id) => (planSources[id] ? extLink(planSources[id].url, `[${id}] ${planSources[id].title}`) : null)))));

  // ---- Hero ----
  const hero = h("div", { class: "hero" },
    h("div", { class: "stack", style: { gap: "10px" } },
      h("span", { class: "tiny muted" }, "YOUR CAREER PLAN"),
      h("h1", {}, `${first.title} → ${last.title}`),
      h("p", {}, plan.headline)),
    h("div", { class: "stack", style: { gap: "12px" } },
      h("div", {}, h("div", { class: "tiny muted" }, "Starting pay (year 0)"), h("div", { class: "stat" }, range(first.salary_low, first.salary_high))),
      h("div", {}, h("div", { class: "tiny muted" }, `Projected pay (year ${last.start_year}+)`), h("div", { class: "stat" }, range(last.salary_low, last.salary_high)))));

  // ---- Trajectory ----
  const trajectory = h("div", { class: "card section" },
    h("h2", {}, "Your trajectory"),
    h("div", { class: "trajectory" }, path.map((n) => h("div", { class: "traj-step" },
      h("div", { class: "dot" }),
      h("div", { class: "yr" }, `Years ${n.start_year}–${n.end_year}`),
      h("div", { class: "ttl" }, n.title),
      h("div", { class: "pay" }, range(n.salary_low, n.salary_high))))));

  // ---- Salary projection ----
  const chart = h("div", { class: "card section" },
    h("h2", {}, "Salary projection"),
    h("p", { class: "small muted" }, `Shaded band = your path's base-pay range; dashed lines = the other routes in this career. ${tree.salary_basis}`),
    salaryChart(tree, path));

  // ---- What to do in the current job ----
  const currentJob = plan.current_job_moves?.length ? h("div", { class: "card section" },
    h("h2", {}, plan.current_job_heading || "Where you are now"),
    h("p", { class: "small muted" }, `Moves you can make now to get closer to ${path.find((n) => !sameTitle(n.title, state.profile.current_title))?.title || first.title}.`),
    plan.current_job_moves.map((a) => actionItem(a))) : null;

  // ---- 90 days ----
  const ninety = h("div", { class: "card section" },
    h("h2", {}, "Your next 90 days"),
    plan.next_90_days.length ? plan.next_90_days.map((a) => actionItem(a)) : h("p", { class: "muted" }, "Nothing urgent: you already meet the requirements for your first step."),
    plan.timing_adjustments ? h("p", { class: "tiny muted", style: { marginTop: "8px" } },
      `${plan.timing_adjustments} item(s) were moved to a later phase because you won't need them yet.`) : null);

  // ---- Phases ----
  const phases = h("div", { class: "card section" },
    h("h2", {}, "When to build what"),
    plan.phases.map((p) => h("div", { class: "phase" },
      h("div", {}, h("div", { class: "when" }, `Years ${p.start_year}–${p.end_year}`), h("div", { class: "small muted" }, p.target_role)),
      h("div", {},
        h("strong", {}, p.label),
        h("p", { class: "small muted" }, p.goal),
        h("div", {}, p.actions.map((a) => actionItem(a, "plain")))))),
    plan.deferred_note ? h("p", { class: "small", style: { marginTop: "10px" } }, h("b", {}, "Deliberately later: "), plan.deferred_note) : null);

  // ---- Gaps table ----
  const gaps = (plan.gaps || []).slice().sort((a, b) => a.needed_by_year - b.needed_by_year);
  const gapTable = h("div", { class: "card section" },
    h("h2", {}, "Skill gaps"),
    h("table", { class: "gaps" },
      h("thead", {}, h("tr", {}, ["Skill", "You", "Target", "Needed by", "Start working on it"].map((t) => h("th", {}, t)))),
      h("tbody", {}, gaps.map((g) => h("tr", {},
        h("td", {}, g.name, g.want ? h("span", { class: "chip blue", style: { marginLeft: "6px" } }, "your pick") : null),
        h("td", {}, g.measure === "yes_no" ? (g.have > 0 ? "Yes" : "No") : LEVELS[g.have]),
        h("td", {}, g.measure === "yes_no" ? "Required" : LEVELS[g.target_level]),
        h("td", {}, g.needed_by_year === 0 ? "Now" : `Year ${g.needed_by_year}`),
        h("td", {}, g.earliest_start === null ? h("span", { class: "muted" }, "Already there") : g.earliest_start === 0 ? "Now" : `Around year ${g.earliest_start}`))))));

  const watch = plan.watch_outs?.length ? h("div", { class: "card section" },
    h("h2", {}, "Decision signals to watch"), h("ul", {}, plan.watch_outs.map((w) => h("li", {}, w)))) : null;

  // ---- Openings (read-only search, on demand) ----
  // Default to the first role on the path the person doesn't already hold.
  const notes = notesFor(state.chosen);
  const roleSelect = h("select", { style: { width: "auto", minWidth: "260px" } },
    path.map((n) => h("option", { value: n.title }, n.title)));
  roleSelect.value = state.openingsRole || path.find((n) => !sameTitle(n.title, state.profile.current_title))?.title || first.title;
  const openingsBox = h("div", {});
  const drawOpenings = () => {
    const o = state.openings;
    openingsBox.replaceChildren();
    if (!o) {
      mount(openingsBox,
        h("p", { class: "small muted" }, `Uses 1 web search of LinkedIn, Indeed and other job boards${state.profile.location ? ` near ${state.profile.location}` : ""}${notes ? ", using your notes" : ""}. The app only reads; it never applies or submits anything.`));
      return;
    }
    mount(openingsBox,
      h("p", { class: "small muted", style: { margin: "8px 0" } }, `Results for ${o.role || roleSelect.value}:`),
      o.openings.length ? h("div", {}, h("h3", {}, "Specific postings"), h("ul", { class: "sources" }, o.openings.map((x) => h("li", {},
        extLink(x.url, x.title), x.company ? ` · ${x.company}` : "", x.location ? ` · ${x.location}` : "")))) : null,
      o.listing_pages?.length ? h("div", { style: { marginTop: "8px" } }, h("h3", {}, "Current listings found"),
        h("ul", { class: "sources" }, o.listing_pages.map((x) => h("li", {}, extLink(x.url, x.title))))) : null,
      o.note ? h("p", { class: "small muted" }, o.note) : null,
      o.search_links?.length ? h("p", { class: "small", style: { marginTop: "8px" } }, "Search yourself: ",
        ...o.search_links.flatMap((l, k) => [k ? " · " : "", extLink(l.url, l.site)])) : null);
  };
  const findBtn = h("button", { type: "button", class: "btn primary sm" }, "Find current openings");
  const findOpenings = async () => {
    const role = roleSelect.value;
    state.openingsRole = role;
    findBtn.disabled = true;
    openingsBox.replaceChildren(loading(["Searching job boards…", "Checking postings…"], true));
    try {
      state.openings = { ...(await api.openings(role, state.profile.location || "", notes)), role };
      save();
    } catch (e) {
      state.openings = null;
      openingsBox.replaceChildren(h("p", { class: "small" }, `The search didn't finish: ${e.message}`));
      findBtn.disabled = false;
      return;
    }
    findBtn.disabled = false;
    drawOpenings();
  };
  findBtn.addEventListener("click", findOpenings);
  drawOpenings();
  const openings = h("div", { class: "card section no-print" },
    h("h2", {}, "Current openings"),
    h("div", { class: "row", style: { alignItems: "center", marginTop: "8px" } },
      h("span", { class: "small" }, "Role:"), roleSelect, findBtn),
    openingsBox);

  // ---- Sources ----
  const sources = h("div", { class: "card section" },
    h("h2", {}, "Sources"),
    tree.sources?.length ? h("div", {}, h("h3", { style: { marginTop: "4px" } }, "Career research"),
      h("ol", { class: "sources" }, tree.sources.map((x) => h("li", { value: x.id }, extLink(x.url, x.title))))) : null,
    plan.sources?.length ? h("div", {}, h("h3", { style: { marginTop: "12px" } }, "Learning resources"),
      h("ol", { class: "sources" }, plan.sources.map((x) => h("li", { value: x.id }, extLink(x.url, x.title))))) : null,
    h("p", { class: "tiny muted", style: { marginTop: "10px" } },
      "Occupation data: O*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA), used under CC BY 4.0. Salaries are estimates; verify before making decisions."));

  mount(view, 
    pageHead("Your plan", "Your path, what to work on and when, and what you could earn along the way."),
    hero, notes ? h("p", { class: "small muted", style: { marginTop: "10px" } }, `Your notes: ${notes}`) : null,
    trajectory, chart, currentJob, ninety, phases, gapTable, watch, openings, sources,
    h("div", { class: "actions" },
      h("button", { type: "button", class: "btn primary", onclick: () => window.print() }, "Print / save as PDF"),
      h("button", { type: "button", class: "btn ghost", onclick: download }, "Download plan file"),
      h("button", { type: "button", class: "btn ghost", onclick: () => { state.step = 3; save(); rerender(); } }, "Try a different path")),
  );
}

function salaryChart(tree, path) {
  const W = 1000, H = 300, L = 64, R = 20, T = 20, B = 36;
  const maxYear = Math.max(tree.max_year, 1);
  const routes = allPaths(tree);
  const maxPay = Math.max(...tree.nodes.map((n) => n.salary_high)) * 1.08;
  const X = (y) => L + (y / maxYear) * (W - L - R);
  const Y = (v) => H - B - (v / maxPay) * (H - T - B);

  const svg = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": "Salary projection chart" });
  // Gridlines and axis labels
  const step = maxPay > 300_000 ? 100_000 : maxPay > 150_000 ? 50_000 : 25_000;
  for (let v = 0; v <= maxPay; v += step) {
    svg.append(s("line", { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: "#f0f0f3" }),
      s("text", { x: L - 8, y: Y(v) + 4, "text-anchor": "end" }, money(v)));
  }
  for (let y = 0; y <= maxYear; y += maxYear > 20 ? 5 : 2) {
    svg.append(s("text", { x: X(y), y: H - 12, "text-anchor": "middle" }, `Yr ${y}`));
  }

  const midLine = (nodes) => nodes.map((n, k) => {
    const mid = (n.salary_low + n.salary_high) / 2;
    return `${k ? "L" : "M"}${X(n.start_year)},${Y(mid)} L${X(n.end_year)},${Y(mid)}`;
  }).join(" ");

  const chosen = new Set(path.map((n) => n.id));
  routes.forEach((r) => {
    if (r.every((n) => chosen.has(n.id))) return;
    svg.append(s("path", { class: "alt", d: midLine(r) }, s("title", {}, `${r[r.length - 1].title} route`)));
  });

  // Band for the chosen path (stepped by role)
  const top = path.map((n) => `${X(n.start_year)},${Y(n.salary_high)} ${X(n.end_year)},${Y(n.salary_high)}`).join(" ");
  const bottom = path.slice().reverse().map((n) => `${X(n.end_year)},${Y(n.salary_low)} ${X(n.start_year)},${Y(n.salary_low)}`).join(" ");
  svg.append(s("polygon", { class: "band", points: `${top} ${bottom}` }));
  svg.append(s("path", { class: "mid", d: midLine(path) }));
  path.forEach((n, k) => {
    const mid = (n.salary_low + n.salary_high) / 2;
    svg.append(s("circle", { class: "pt", cx: X(n.start_year), cy: Y(mid), r: 4.5 }, s("title", {}, `${n.title}: ${range(n.salary_low, n.salary_high)}`)));
    svg.append(s("text", { class: "lbl", x: X(n.start_year) + 6, y: Y(n.salary_high) - (k % 2 ? 18 : 6) }, n.title.length > 26 ? `${n.title.slice(0, 25)}…` : n.title));
  });
  return svg;
}
