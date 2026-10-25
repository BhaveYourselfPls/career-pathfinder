// Sideways career tree. X axis = years into the career; each box is a role,
// each fork (black "?" marker) is an inflection point.
import { money, s } from "./ui.js";

const LEFT = 18;
const TOP = 44;
const ROW = 80;
const NODE_H = 58;
const GAP = 30;          // horizontal space between a role and the next, for connectors
const CHAR_W = 6.9;      // approx width of one character at 12.5px

export function drawTree(tree, { year = 0, path = [], focusId = null, onNode = () => {} } = {}) {
  const by = Object.fromEntries(tree.nodes.map((n) => [n.id, n]));
  const onPath = new Set(path);
  const hasPath = path.length > 0;

  // Vertical layout: leaves get their own row; parents sit between their children.
  const rowOf = {};
  let leaf = 0;
  const place = (id) => {
    const n = by[id];
    if (!n.children.length) { rowOf[id] = leaf++; return rowOf[id]; }
    const rows = n.children.map(place);
    rowOf[id] = (Math.min(...rows) + Math.max(...rows)) / 2;
    return rowOf[id];
  };
  place(tree.root_id);

  // Scale to the typical role length so most boxes fit their text; very short
  // roles get truncated labels (full text on hover) instead of stretching the map.
  const durs = tree.nodes.map((n) => Math.max(1, n.end_year - n.start_year)).sort((a, b) => a - b);
  const typical = durs[Math.floor(durs.length / 2)];
  const ppy = Math.max(48, Math.min(110, Math.ceil((170 + GAP) / typical)));
  const maxYear = tree.max_year;
  const X = (y) => LEFT + y * ppy;
  const Y = (r) => TOP + r * ROW + 8;
  const width = X(maxYear) + 30;
  const height = TOP + leaf * ROW + 10;

  const svg = s("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `Career tree for ${tree.job_title}` });

  // Axis
  const axis = s("g", { class: "axis" });
  const step = ppy >= 40 ? 1 : 2;
  for (let y = 0; y <= maxYear; y += step) {
    axis.append(
      s("line", { class: "grid", x1: X(y), x2: X(y), y1: TOP - 6, y2: height }),
      s("text", { x: X(y), y: 18, "text-anchor": "middle" }, y === 0 ? "Year 0" : String(y)),
    );
  }
  axis.append(s("line", { x1: X(0), x2: X(maxYear), y1: 26, y2: 26, stroke: "#cfcfd6" }));
  svg.append(axis);

  const box = (n) => {
    const x = X(n.start_year) + 2;
    const w = Math.max(28, X(n.end_year) - X(n.start_year) - GAP);
    const y = Y(rowOf[n.id]);
    return { x, y, w, cy: y + NODE_H / 2, right: x + w };
  };

  // Edges
  const edges = s("g");
  for (const n of tree.nodes) {
    const a = box(n);
    for (const cid of n.children) {
      const b = box(by[cid]);
      const mid = (a.right + b.x) / 2;
      const cls = onPath.has(n.id) && onPath.has(cid) ? "edge onpath" : "edge";
      edges.append(s("path", { class: cls, d: `M${a.right},${a.cy} C${mid},${a.cy} ${mid},${b.cy} ${b.x},${b.cy}` }));
    }
  }
  svg.append(edges);

  // Nodes
  for (const n of tree.nodes) {
    const b = box(n);
    const cls = ["node"];
    if (n.commonness === "less common") cls.push("lesscommon");
    if (onPath.has(n.id)) cls.push("onpath");
    else if (hasPath) cls.push("dim");
    if (n.id === focusId) cls.push("focus");
    const maxChars = Math.max(3, Math.floor((b.w - 16) / CHAR_W));
    const title = n.title.length > maxChars ? `${n.title.slice(0, maxChars - 1)}…` : n.title;
    const yrs = `Yr ${n.start_year}–${n.end_year}`;
    const pay = `${money(n.salary_low)}–${money(n.salary_high)}`;
    const sub = b.w > 150 ? `${yrs} · ${pay}` : b.w > 70 ? pay : "";
    const g = s("g", { class: cls.join(" "), tabindex: 0, role: "button", onclick: () => onNode(n.id),
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNode(n.id); } } },
    s("title", {}, `${n.title}\n${yrs} · ${pay}\n${n.description}`),
    s("rect", { class: "box", x: b.x, y: b.y, width: b.w, height: NODE_H, rx: 8 }),
    s("text", { class: "t", x: b.x + 9, y: b.y + 23 }, title),
    sub ? s("text", { class: "s", x: b.x + 9, y: b.y + 42 }, sub) : null);
    svg.append(g);
    if (n.branch_label) {
      svg.append(s("text", { class: "branch-label", x: b.x + 2, y: b.y - 5 }, n.branch_label));
    }
  }

  // Decision markers at every fork
  for (const inf of tree.inflections) {
    const n = by[inf.node_id];
    if (!n) continue;
    const b = box(n);
    svg.append(s("g", { class: "decision" },
      s("title", {}, `Decision point, year ${inf.year}: ${inf.question}`),
      s("circle", { cx: b.right + 2, cy: b.cy, r: 10 }),
      s("text", { x: b.right + 2, y: b.cy + 4, "text-anchor": "middle" }, "?")));
  }

  // Year marker controlled by the slider
  const line = s("line", { class: "yearline", y1: 28, y2: height });
  const label = s("text", { class: "yearlabel", y: 38, "text-anchor": "middle" });
  svg.append(line, label);
  const setYear = (yr) => {
    const x = X(Math.min(yr, maxYear));
    line.setAttribute("x1", x); line.setAttribute("x2", x);
    label.setAttribute("x", Math.min(Math.max(x, 24), width - 24));
    label.textContent = `Year ${yr}`;
  };
  setYear(year);

  return { svg, setYear, xOf: X };
}

// Roles someone could hold at year `yr`, one per branch. A branch that has
// already ended keeps showing its final role.
export function rolesAt(tree, yr) {
  const by = Object.fromEntries(tree.nodes.map((n) => [n.id, n]));
  const out = new Map();
  const walk = (id) => {
    const n = by[id];
    if (!n) return;
    if (yr < n.end_year || !n.children.length) { out.set(n.id, n); return; }
    n.children.forEach(walk);
  };
  walk(tree.root_id);
  return [...out.values()];
}
