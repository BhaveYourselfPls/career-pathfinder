// Small DOM helpers. All text goes through textContent, never innerHTML,
// so nothing from the AI or the web can inject markup.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

// Append children to an existing element, skipping null/false placeholders.
export function mount(el, ...children) {
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function money(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "?";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${n}`;
}

export const range = (lo, hi) => `${money(lo)}–${money(hi)}`;

export function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

export function extLink(url, text) {
  const href = safeUrl(url);
  return href ? h("a", { href, target: "_blank", rel: "noopener noreferrer nofollow" }, text || url) : h("span", {}, text || "");
}

export function loading(messages, compact = false) {
  const msg = h("div", { class: "msg" }, messages[0]);
  const sub = h("div", { class: "muted small" }, "");
  const box = h("div", { class: compact ? "loading compact" : "loading" }, h("div", { class: "spinner" }), msg, sub);
  let i = 0;
  const start = Date.now();
  const timer = setInterval(() => {
    if (!box.isConnected) return clearInterval(timer);
    const secs = Math.round((Date.now() - start) / 1000);
    if (secs % 6 === 0 && secs > 0) msg.textContent = messages[++i % messages.length];
    sub.textContent = `${secs}s`;
  }, 1000);
  return box;
}

export function dots(n, max = 5) {
  return h("span", { class: "dots", title: `${n} of ${max}` }, Array.from({ length: max }, (_, i) => h("i", { class: i < n ? "on" : "" })));
}

export function field(label, input, hint) {
  return h("label", { class: "field" }, h("span", {}, label, hint ? h("span", { class: "hint" }, ` ${hint}`) : null), input);
}

export function pageHead(title, sub) {
  return h("div", { class: "page-head" }, h("h1", {}, title), sub ? h("p", {}, sub) : null);
}

let bannerTimer;
export function banner(text, kind = "info") {
  const el = document.getElementById("banner");
  clearTimeout(bannerTimer);
  if (!text) { el.hidden = true; return; }
  el.className = `banner ${kind === "error" ? "error" : ""}`;
  el.textContent = text;
  el.hidden = false;
  if (kind !== "error") bannerTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

export const WORK_LIFE = ["", "Long hours are fine", "Sometimes long hours", "Balanced", "Strong balance", "Predictable hours"];
export const LEVELS = ["None", "Basic", "Working", "Strong", "Expert"];
