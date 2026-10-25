"""Sanity checks that repair model output instead of trusting it.

The tree must be a single-rooted tree whose children start when their parent
ends, with ordered years, positive salary ranges and citations that point at
real search results.
"""
from __future__ import annotations

import re
from collections import deque
from typing import Any

from ..schemas import OutCareerTree

MAX_NODES = 25
MAX_YEAR = 40
MIN_SALARY, MAX_SALARY = 10_000, 2_000_000


def _salary(lo: int, hi: int) -> tuple[int, int]:
    lo, hi = abs(int(lo or 0)), abs(int(hi or 0))
    # Models occasionally answer in thousands ("85" for $85k).
    if 0 < lo < 1000:
        lo *= 1000
    if 0 < hi < 1000:
        hi *= 1000
    if lo > hi:
        lo, hi = hi, lo
    lo = min(max(lo, MIN_SALARY), MAX_SALARY)
    hi = min(max(hi, lo), MAX_SALARY)
    return lo, hi


def normalize_tree(out: OutCareerTree, n_sources: int) -> dict[str, Any]:
    nodes: dict[str, dict[str, Any]] = {}
    for n in out.nodes:
        nid = (n.id or "").strip() or f"n{len(nodes)}"
        while nid in nodes:
            nid += "_"
        d = n.model_dump()
        d["id"] = nid
        d["source_ids"] = sorted({i for i in n.source_ids if 1 <= i <= n_sources})
        d["salary_low"], d["salary_high"] = _salary(n.salary_low, n.salary_high)
        d["requirements"] = [r for r in n.requirements if r.strip()][:5]
        nodes[nid] = d
    if not nodes:
        raise ValueError("The career map came back empty.")

    roots = [d for d in nodes.values() if not d["parent_id"] or d["parent_id"] not in nodes or d["parent_id"] == d["id"]]
    if not roots:  # every node has a parent: a cycle; take the earliest node
        roots = [min(nodes.values(), key=lambda d: d["start_year"])]
    root = min(roots, key=lambda d: d["start_year"])
    root["parent_id"] = None
    for r in roots:
        if r is not root:
            r["parent_id"] = root["id"]

    children: dict[str, list[str]] = {nid: [] for nid in nodes}
    for d in nodes.values():
        if d["parent_id"]:
            children[d["parent_id"]].append(d["id"])

    # Walk from the root: drops unreachable nodes and breaks any cycle.
    order: list[str] = []
    seen: set[str] = set()
    root["start_year"] = max(0, min(root["start_year"], 5))
    queue = deque([root["id"]])
    while queue and len(order) < MAX_NODES:
        nid = queue.popleft()
        if nid in seen:
            continue
        seen.add(nid)
        order.append(nid)
        d = nodes[nid]
        if d["parent_id"]:
            d["start_year"] = nodes[d["parent_id"]]["end_year"]
        d["start_year"] = min(d["start_year"], MAX_YEAR - 1)
        d["end_year"] = min(max(d["end_year"], d["start_year"] + 1), MAX_YEAR)
        children[nid].sort(key=lambda c: nodes[c]["start_year"])
        queue.extend(c for c in children[nid] if c not in seen)

    kept = {nid: nodes[nid] for nid in order}
    for d in kept.values():
        d["children"] = [c for c in children[d["id"]] if c in kept]

    branching = {nid for nid, d in kept.items() if len(d["children"]) > 1}
    inflections = []
    for inf in out.inflections:
        if inf.node_id in branching:
            item = inf.model_dump()
            item["year"] = kept[inf.node_id]["end_year"]
            inflections.append(item)
            branching.discard(inf.node_id)
    for nid in branching:  # the model forgot to describe this decision point
        inflections.append({
            "node_id": nid, "year": kept[nid]["end_year"],
            "question": f"Where to go after {kept[nid]['title']}?",
            "considerations": "Compare the branches below on pay, day-to-day work and what you enjoy.",
        })

    return {
        "job_title": out.job_title,
        "summary": out.summary,
        "salary_basis": out.salary_basis,
        "root_id": root["id"],
        "nodes": list(kept.values()),
        "inflections": sorted(inflections, key=lambda i: i["year"]),
        "max_year": max(d["end_year"] for d in kept.values()),
    }


def _norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (t or "").lower()).strip()


def repeated_titles(tree: dict[str, Any]) -> list[str]:
    """Roles whose title already appears earlier on the same route (a step that goes nowhere)."""
    by = {n["id"]: n for n in tree["nodes"]}
    problems = []
    for n in tree["nodes"]:
        seen, p = set(), n.get("parent_id")
        while p and p in by:
            seen.add(_norm_title(by[p]["title"]))
            p = by[p].get("parent_id")
        if _norm_title(n["title"]) in seen:
            problems.append(f"Node '{n['id']}' ({n['title']}, years {n['start_year']}-{n['end_year']}) repeats a title "
                            "already earlier on its route. Give it the real next-level title (e.g. Senior Manager of …, Head of …).")
    return problems


def prune_nodes(tree: dict[str, Any], blocked_ids: set[str]) -> dict[str, Any]:
    """Remove blocked nodes and everything below them."""
    if not blocked_ids:
        return tree
    by_id = {n["id"]: n for n in tree["nodes"]}
    drop: set[str] = set()
    stack = list(blocked_ids)
    while stack:
        nid = stack.pop()
        if nid in drop or nid not in by_id:
            continue
        drop.add(nid)
        stack.extend(by_id[nid]["children"])
    nodes = [{**n, "children": [c for c in n["children"] if c not in drop]}
             for n in tree["nodes"] if n["id"] not in drop]
    keep = {n["id"] for n in nodes}
    tree = {**tree, "nodes": nodes}
    tree["inflections"] = [
        i for i in tree["inflections"]
        if i["node_id"] in keep and len(next(n for n in nodes if n["id"] == i["node_id"])["children"]) > 1
    ]
    tree["max_year"] = max((n["end_year"] for n in nodes), default=0)
    return tree


def path_nodes(tree: dict[str, Any], path: list[str]) -> list[dict[str, Any]]:
    """Validate that `path` is a root-to-node chain in `tree`; return its nodes."""
    by_id = {n["id"]: n for n in tree.get("nodes", [])}
    nodes = [by_id[p] for p in path if p in by_id]
    if not nodes or nodes[0]["id"] != tree.get("root_id"):
        raise ValueError("The selected path must start at the first role.")
    for a, b in zip(nodes, nodes[1:]):
        if b["id"] not in a.get("children", []):
            raise ValueError("The selected path is not a connected route through the tree.")
    return nodes
