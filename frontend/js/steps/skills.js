// Step 4: prerequisites for the chosen path; the user confirms where they stand on each.
import { api } from "../api.js";
import { invalidateAfter, nodeMap, notesFor, pathFor, save, state } from "../state.js";
import { banner, h, LEVELS, loading, mount, pageHead } from "../ui.js";

// Ratings start from the Coach Agent's estimate (resume, education, experience).
export function initialRatings(skills) {
  return Object.fromEntries(skills.map((sk) => [sk.id, { have: sk.estimated_have ?? 0, want: false }]));
}

function statusText(sk, have) {
  if (sk.measure === "yes_no") return have > 0 ? "✓ You have this" : "Required for this path";
  const gap = sk.target_level - have;
  if (gap <= 0) return `✓ Meets the target (${LEVELS[sk.target_level]})`;
  return `Target: ${LEVELS[sk.target_level]} · ${gap} level${gap > 1 ? "s" : ""} to go`;
}

function picker(sk, r, onChange) {
  const status = h("div", { class: "small rating-status" });
  const group = h("div", { class: sk.measure === "yes_no" ? "levels yn" : "levels", role: "radiogroup", "aria-label": `Your level in ${sk.name}` });
  const options = sk.measure === "yes_no"
    ? [[4, "I have this"], [0, "Not yet"]]
    : LEVELS.map((label, v) => [v, label]);
  const draw = () => {
    group.replaceChildren(...options.map(([v, label]) => {
      const on = sk.measure === "yes_no" ? (v > 0) === (r.have > 0) : r.have === v;
      const isTarget = sk.measure !== "yes_no" && v === sk.target_level;
      return h("button", {
        type: "button", role: "radio", "aria-checked": on ? "true" : "false",
        class: `lvl ${on ? "on" : ""} ${isTarget ? "target" : ""}`,
        title: isTarget ? "Level this path needs" : null,
        onclick: () => { r.have = v; draw(); onChange(); },
      }, label, isTarget ? h("span", { class: "tgt" }, "target") : null);
    }));
    status.textContent = statusText(sk, r.have);
    status.classList.toggle("ok", sk.measure === "yes_no" ? r.have > 0 : r.have >= sk.target_level);
  };
  draw();
  return h("div", {}, group, status);
}

export function renderSkills(view, { go, rerender }) {
  const tree = state.trees[state.chosen];
  const path = pathFor(state.chosen).map((id) => nodeMap(tree)[id]);
  const skills = state.skills || [];

  const row = (sk) => {
    const r = (state.ratings[sk.id] = state.ratings[sk.id] || { have: sk.estimated_have ?? 0, want: false });
    const want = h("input", { type: "checkbox" });
    want.checked = r.want;
    want.addEventListener("change", () => { r.want = want.checked; invalidateAfter(4); save(); });
    return h("div", { class: "skill" },
      h("div", {},
        h("div", { class: "name" }, sk.name),
        h("p", { class: "small muted" }, sk.description),
        h("div", { class: "meta" },
          h("span", { class: `chip ${sk.needed_by_year === 0 ? "dark" : "blue"}` }, sk.needed_by_year === 0 ? "Needed now" : `Needed by year ${sk.needed_by_year}`),
          h("span", { class: "chip" }, `for ${sk.needed_for}`),
          h("span", { class: "chip" }, sk.category),
          sk.importance === "essential" ? h("span", { class: "chip" }, "essential") : null,
          h("span", { class: "chip", title: "Where this requirement comes from" }, sk.source)),
        sk.evidence ? h("p", { class: "tiny evidence" }, "From your profile: ", sk.evidence) : null),
      h("div", { class: "rating" },
        picker(sk, r, () => { invalidateAfter(4); save(); }),
        h("label", { class: "check", style: { marginTop: "10px" } }, want, "I want to work on this")));
  };

  const group = (type, title, sub) => {
    const list = skills.filter((x) => x.type === type);
    if (!list.length) return null;
    return h("div", { class: "card section" }, h("h2", {}, title), h("p", { class: "small muted" }, sub), list.map(row));
  };

  const nextBtn = h("button", { type: "button", class: "btn primary" }, "Build my plan");
  nextBtn.addEventListener("click", async () => {
    invalidateAfter(4);
    view.replaceChildren(loading([
      "Coach Agent is building your plan…", "Timing each skill to when you'll need it…",
      "Adding steps you can take in your current job…", "Almost there…",
    ]));
    try {
      const ratings = skills.map((x) => ({ id: x.id, ...state.ratings[x.id] }));
      state.plan = await api.plan({
        profile: state.profile, tree, path: pathFor(state.chosen), skills, ratings, notes: notesFor(state.chosen),
      });
      go(5);
    } catch (e) {
      banner(e.message, "error");
      rerender();
    }
  });

  const prefilled = skills.filter((x) => (x.estimated_have ?? 0) > 0).length;
  mount(view,
    pageHead(`What you'll need: ${tree.job_title}`,
      `For your path ${path.map((n) => n.title).join(" → ")}. Check where you stand on each item and tick the ones you'd like to work on.`),
    prefilled ? h("p", { class: "small muted" }, `${prefilled} item${prefilled > 1 ? "s were" : " was"} pre-filled from your resume and profile. Adjust anything that's off.`) : null,
    group("hard", "Hard requirements", "Technical skills, education, credentials and experience."),
    group("soft", "Soft skills", "People, communication and leadership skills the roles depend on."),
    h("div", { class: "sticky-bar" }, nextBtn, h("span", { class: "muted small" }, `${skills.length} requirements`)),
  );
}
