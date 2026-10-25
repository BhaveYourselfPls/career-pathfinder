"""Local occupation data (O*NET 31.0, optionally joined with BLS OEWS wages).

Bundled as CSV files so it works offline, needs no API key, and costs no
search budget. Lookups use simple keyword scoring over titles, alternate
titles and descriptions.
"""
from __future__ import annotations

import csv
import re
from collections import defaultdict
from difflib import SequenceMatcher
from functools import lru_cache
from typing import Any

from ..config import DATA_DIR

_WORD = re.compile(r"[a-z0-9+#]+")
_STOP = {"and", "or", "the", "of", "a", "an", "in", "for", "to", "with", "all", "other", "i", "like", "my"}
_WAGE_COLS = ("median_wage", "p10_wage", "p25_wage", "p75_wage", "p90_wage")


def _tokens(text: str) -> set[str]:
    return {w for w in _WORD.findall((text or "").lower()) if w not in _STOP and len(w) > 1}


def _num(v: str) -> int | None:
    try:
        return int(float(v)) if v not in ("", None) else None
    except ValueError:
        return None


@lru_cache(maxsize=1)
def _load() -> dict[str, Any]:
    occ: dict[str, dict[str, Any]] = {}
    path = DATA_DIR / "occupations.csv"
    if path.is_file():
        with path.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                alts = [a for a in (row.get("alt_titles") or "").split("|") if a]
                rec: dict[str, Any] = {
                    "soc_code": row["soc_code"],
                    "title": row["title"],
                    "description": row.get("description", ""),
                    "alt_titles": alts,
                    "job_zone": _num(row.get("job_zone", "")),
                    "oews_year": _num(row.get("oews_year", "")),
                }
                for c in _WAGE_COLS:
                    rec[c] = _num(row.get(c, ""))
                rec["_names"] = [(n.lower(), _tokens(n)) for n in [row["title"], *alts]]
                rec["_title_tokens"] = set().union(*(t for _, t in rec["_names"]))
                rec["_desc_tokens"] = _tokens(rec["description"])
                occ[rec["soc_code"]] = rec

    skills: dict[str, list[dict[str, Any]]] = defaultdict(list)
    path = DATA_DIR / "skills.csv"
    if path.is_file():
        with path.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                skills[row["soc_code"]].append({
                    "kind": row["kind"], "name": row["name"],
                    "importance": float(row["importance"]), "level": float(row["level"]),
                })

    related: dict[str, list[str]] = defaultdict(list)
    path = DATA_DIR / "related.csv"
    if path.is_file():
        with path.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                related[row["soc_code"]].append(row["related_soc_code"])
    return {"occ": occ, "skills": skills, "related": related}


JOB_ZONES = {
    1: "Little or no preparation (some may need a high school diploma)",
    2: "Some preparation (usually a high school diploma)",
    3: "Medium preparation (vocational school, associate degree or on-the-job experience)",
    4: "Considerable preparation (most need a bachelor's degree)",
    5: "Extensive preparation (most need a graduate degree)",
}


def public(rec: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in rec.items() if not k.startswith("_")}
    out["alt_titles"] = rec["alt_titles"][:6]
    out["preparation"] = JOB_ZONES.get(rec.get("job_zone") or 0, "")
    out["has_wages"] = rec.get("median_wage") is not None
    return out


def search(query: str, k: int = 5) -> list[dict[str, Any]]:
    data = _load()["occ"]
    q = _tokens(query)
    ql = (query or "").lower().strip()
    if not q:
        return []
    scored: list[tuple[float, dict[str, Any]]] = []
    for rec in data.values():
        title_hits = len(q & rec["_title_tokens"])
        desc_hits = len(q & rec["_desc_tokens"])
        if not (title_hits or desc_hits):
            continue
        score = 1.0 * title_hits + 0.4 * desc_hits
        if title_hits:
            # How well the query matches the single best title (official or alternate).
            best = 0.0
            for name, toks in rec["_names"]:
                if name == ql:
                    best = 3.0
                    break
                if q & toks:
                    coverage = len(q & toks) / len(q)
                    precision = len(q & toks) / max(1, len(toks))
                    best = max(best, 2.0 * coverage * precision + SequenceMatcher(None, ql, name).ratio())
            score += 4.0 * best
        if "all other" in rec["title"].lower():
            score -= 1.5
        scored.append((score, rec))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [public(r) for _, r in scored[:k]]


def best_match(title: str) -> dict[str, Any] | None:
    hits = search(title, k=1)
    return hits[0] if hits else None


def get(soc_code: str) -> dict[str, Any] | None:
    rec = _load()["occ"].get(soc_code)
    return public(rec) if rec else None


def skills_for(soc_code: str, top: int = 12) -> list[dict[str, Any]]:
    rows = sorted(_load()["skills"].get(soc_code, []), key=lambda r: r["importance"], reverse=True)
    return rows[:top]


def related_titles(soc_code: str, top: int = 8) -> list[str]:
    occ = _load()["occ"]
    return [occ[s]["title"] for s in _load()["related"].get(soc_code, [])[:top] if s in occ]


def candidates_for_interests(text: str, k: int = 30) -> list[dict[str, Any]]:
    """Broad keyword match used to give the Position Agent real occupations to start from."""
    return [
        {"soc_code": r["soc_code"], "title": r["title"], "median_wage": r["median_wage"],
         "job_zone": r["job_zone"]}
        for r in search(text, k=k)
    ]


def data_status() -> dict[str, Any]:
    occ = _load()["occ"]
    with_wages = sum(1 for r in occ.values() if r.get("median_wage") is not None)
    year = next((r["oews_year"] for r in occ.values() if r.get("oews_year")), None)
    return {"occupations": len(occ), "with_wages": with_wages, "oews_year": year}
