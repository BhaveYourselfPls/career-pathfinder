// Step 1: where is the person starting from?
import { api } from "../api.js";
import { invalidateAfter, save, state } from "../state.js";
import { banner, field, h, loading, pageHead, WORK_LIFE, mount } from "../ui.js";

const EDUCATION = ["", "High school", "Some college", "Associate degree", "Bachelor's degree", "Master's degree", "Doctorate", "Professional degree (JD, MD...)"];
const num = (v) => (v === "" || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

export function renderStart(view, { go, rerender }) {
  const p = state.profile;
  const bind = (key, el, parse = (v) => v) => {
    el.addEventListener("input", () => { p[key] = parse(el.type === "checkbox" ? el.checked : el.value); save(); });
    return el;
  };
  const input = (key, attrs = {}, parse) => {
    const el = h("input", { type: "text", ...attrs });
    el.value = p[key] ?? "";
    return bind(key, el, parse);
  };
  const select = (key, options) => {
    const el = h("select", {}, options.map(([v, t]) => h("option", { value: v }, t)));
    el.value = p[key] ?? "";
    return bind(key, el);
  };

  const modeCard = (mode, title, text) => h("button", {
    type: "button", class: `choice ${p.mode === mode ? "on" : ""}`,
    onclick: () => { p.mode = mode; save(); rerender(); },
  }, h("strong", {}, title), h("span", { class: "muted small" }, text));

  // ---- Shared controls (built fresh for whichever form is shown) ----
  const workLife = () => {
    const wlLabel = h("span", { class: "chip blue" }, WORK_LIFE[p.work_life]);
    const wl = h("input", { type: "range", min: 1, max: 5, step: 1, value: p.work_life, "aria-label": "Work/life balance" });
    wl.addEventListener("input", () => { p.work_life = Number(wl.value); wlLabel.textContent = WORK_LIFE[p.work_life]; save(); });
    return h("div", { class: "stack", style: { gap: "6px" } },
      h("div", { class: "row", style: { justifyContent: "space-between", alignItems: "center" } },
        h("span", { style: { fontWeight: 550, fontSize: "14px" } }, "Work/life balance"), wlLabel),
      wl, h("div", { class: "range-labels" }, h("span", {}, "Career first"), h("span", {}, "Balance first")));
  };
  const educationSel = () => {
    const opts = EDUCATION.map((e) => [e, e || "Prefer not to say"]);
    if (p.education && !EDUCATION.includes(p.education)) opts.push([p.education, p.education]);  // e.g. from a resume
    return select("education", opts);
  };

  // ---- Explore mode ----
  const explore = h("div", { class: "card stack" },
    h("h2", {}, "What you enjoy"),
    field("What do you like to do?", (() => {
      const t = h("textarea", { placeholder: "e.g. I like solving puzzles with data, explaining ideas to people, and building things with my hands.", maxlength: 2000 });
      t.value = p.interests;
      return bind("interests", t);
    })(), "Activities, subjects, problems you like solving"),
    h("div", { class: "grid-2" },
      field("Ideal earnings: from (USD/year)", input("salary_min", { type: "number", min: 0, step: 5000, placeholder: "60000" }, num)),
      field("to (USD/year)", input("salary_max", { type: "number", min: 0, step: 5000, placeholder: "120000" }, num))),
    workLife(),
    h("div", { class: "grid-2" },
      field("Education", educationSel(), "(optional)"),
      field("Current job", input("current_title", { placeholder: "e.g. Retail Associate", maxlength: 120 }), "(optional, helps plan your transition)")));

  // ---- Starting-point mode ----
  const resumeBox = h("div", { class: "stack" });
  const renderResume = () => {
    resumeBox.replaceChildren();
    const file = h("input", { type: "file", accept: ".pdf,.docx,.txt,.md" });
    const btn = h("button", { type: "button", class: "btn ghost sm" }, "Read resume");
    btn.addEventListener("click", async () => {
      if (!file.files[0]) return banner("Choose a resume file first.", "error");
      resumeBox.replaceChildren(loading(["Reading your resume on this computer…", "Removing contact details…", "Resume Agent is extracting your experience…"]));
      try {
        const r = await api.resume(file.files[0]);
        p.resume = r.profile;
        state.resumeRedacted = r.redacted;
        p.current_title = r.profile.current_title || p.current_title;
        if (r.profile.years_experience !== null) p.years_experience = r.profile.years_experience;
        if (!p.education && r.profile.education_detail) p.education = r.profile.education_detail;
        save();
        banner("Resume read. Check the details below.");
      } catch (e) {
        banner(e.message, "error");
      }
      rerender();
    });
    resumeBox.append(
      h("p", { class: "small muted" }, "PDF, Word or text. The file is read on this computer and never stored. Your name, email, phone, address and links are removed before anything is sent to the AI."),
      h("div", { class: "row", style: { alignItems: "center" } }, file, btn),
    );
    if (p.resume) {
      const r = p.resume;
      resumeBox.append(h("div", { class: "card soft stack", style: { gap: "8px" } },
        h("strong", {}, "From your resume"),
        h("p", { class: "small" }, r.summary),
        r.skills?.length ? h("div", { class: "pills" }, r.skills.slice(0, 14).map((sk) => h("span", { class: "chip" }, sk))) : null,
        state.resumeRedacted?.length ? h("p", { class: "tiny muted" }, `Removed before sending: ${state.resumeRedacted.join(", ")}.`) : null,
        h("button", { type: "button", class: "link small", onclick: () => { p.resume = null; save(); rerender(); } }, "Remove resume data")));
    }
  };
  renderResume();

  const inputSeg = h("div", { class: "seg" },
    ["resume", "manual"].map((m) => h("button", {
      type: "button", class: state.startInput === m ? "on" : "",
      onclick: () => { state.startInput = m; save(); rerender(); },
    }, m === "resume" ? "Upload resume" : "Enter details")));

  const start = h("div", { class: "card stack" },
    h("div", { class: "row", style: { justifyContent: "space-between", alignItems: "center" } }, h("h2", {}, "Your starting point"), inputSeg),
    state.startInput === "resume" ? resumeBox : null,
    h("div", { class: "grid-2" },
      field("Job title", input("current_title", { placeholder: "e.g. Customer Service Representative", maxlength: 120 })),
      field("Years of experience", input("years_experience", { type: "number", min: 0, max: 50, step: 0.5, placeholder: "3" }, num))),
    h("div", { class: "grid-2" },
      field("Education", educationSel()),
      field("Current salary (USD/year)", input("current_salary", { type: "number", min: 0, step: 1000, placeholder: "optional" }, num), "(optional)")),
    workLife(),
    field("What do you enjoy most in your work?", (() => {
      const t = h("textarea", { placeholder: "Optional, but it helps rank the options.", maxlength: 2000 });
      t.value = p.interests;
      return bind("interests", t);
    })(), "(optional)"));

  // ---- Shared constraints ----
  const about = h("div", { class: "card stack" },
    h("h2", {}, "Location and constraints"),
    h("p", { class: "small muted" }, "Pay depends heavily on location, and these answers shape the plan."),
    h("div", { class: "grid-2" },
      field("Location", input("location", { placeholder: "e.g. Chicago, IL", maxlength: 120 }), "(city or region)"),
      field("Work arrangement", select("remote", [["any", "No preference"], ["onsite", "On-site"], ["hybrid", "Hybrid"], ["remote", "Remote"]]))),
    h("div", { class: "grid-2" },
      field("Open to going back to school?", select("school", [["yes", "Yes"], ["maybe", "Maybe, if it pays off"], ["no", "No"]])),
      field("Hours per week for learning", input("learning_hours", { type: "number", min: 0, max: 40, step: 1 }, (v) => num(v) ?? 0))),
    h("label", { class: "check" }, bind("relocate", Object.assign(h("input", { type: "checkbox" }), { checked: !!p.relocate })), "Willing to relocate"));

  const next = h("button", { type: "button", class: "btn primary" }, "Continue");
  next.addEventListener("click", async () => {
    if (p.mode === "explore" && p.interests.trim().length < 5) return banner("Tell us a little about what you like to do.", "error");
    if (p.mode === "start" && !p.current_title.trim() && !p.resume) return banner("Enter a job title or upload a resume.", "error");
    if (p.salary_min && p.salary_max && p.salary_min > p.salary_max) return banner("The earnings range is reversed.", "error");
    invalidateAfter(1);
    p.followups = [];
    view.replaceChildren(loading(["Checking your answers…", "Position Agent is deciding what to ask…"]));
    try {
      const r = await api.questions(p);
      state.questions = r.questions;
      go(2);
    } catch (e) {
      banner(e.message, "error");
      rerender();
    }
  });

  mount(view, 
    pageHead("Where are you starting from?", "Tell us what you enjoy, or where you are today. We'll suggest jobs, map where each can lead, and build a plan to get there."),
    h("div", { class: "choice-cards" },
      modeCard("explore", "I'm exploring", "I don't have a specific job in mind yet."),
      modeCard("start", "I have a starting point", "I have a job, a target role, or a resume.")),
    h("div", { class: "stack", style: { marginTop: "20px" } }, p.mode === "explore" ? explore : start, about),
    h("div", { class: "actions" }, next),
  );
}
