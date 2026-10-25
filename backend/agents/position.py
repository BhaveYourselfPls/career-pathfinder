"""Position Agent: profile -> follow-up questions -> 10 ranked jobs."""
from __future__ import annotations

import asyncio
from typing import Any

from ..config import settings
from ..harness import safety
from ..harness.budget import RunSession
from ..llm import structured
from ..schemas import InProfile, OutPositions, OutQuestions
from ..tools import occupations
from ..tools.onet_map import map_titles
from .common import describe_profile, prompt

SHOW = 10


UnsafeInput = safety.UnsafeInput


def check_profile(session: RunSession, p: InProfile):
    """Refuse if the user asks for a harmful career (run alongside the agent call)."""
    texts = [p.current_title, p.interests] + [f.answer for f in p.followups]
    return safety.require_safe(session, texts)


async def follow_up_questions(session: RunSession, p: InProfile) -> list[dict[str, Any]]:
    _, out = await asyncio.gather(check_profile(session, p), structured(
        session, model=settings.model_fast, system=prompt("position_questions"),
        user=describe_profile(p), schema=OutQuestions,
    ))
    return [q.model_dump() for q in out.questions[:3] if len(q.options) >= 2]


def _candidates(p: InProfile) -> list[dict[str, Any]]:
    seeds = [p.interests, p.current_title, p.education]
    if p.resume:
        seeds.append(" ".join(p.resume.get("skills") or []))
        seeds.append(p.resume.get("current_title") or "")
    found: dict[str, dict[str, Any]] = {}
    for seed in seeds:
        for c in occupations.candidates_for_interests(seed or "", k=15):
            found.setdefault(c["soc_code"], c)
    if p.current_title:
        match = occupations.best_match(p.current_title)
        if match:
            for title in occupations.related_titles(match["soc_code"]):
                for c in occupations.candidates_for_interests(title, k=1):
                    found.setdefault(c["soc_code"], c)
    return list(found.values())[:40]


async def suggest(session: RunSession, p: InProfile) -> dict[str, Any]:
    cands = _candidates(p)
    listing = "\n".join(
        f"- {c['soc_code']} {c['title']}"
        + (f" (BLS median ${c['median_wage']:,})" if c.get("median_wage") else "")
        for c in cands
    ) or "(no close matches in local data)"
    _, out = await asyncio.gather(check_profile(session, p), structured(
        session, model=settings.model_fast, system=prompt("position"),
        user=f"{describe_profile(p)}\n\nCandidate occupations from O*NET:\n{listing}",
        schema=OutPositions,
    ))

    jobs = out.jobs[:16]
    titles = [j.title for j in jobs]
    # Safety check and O*NET mapping are independent: run them together.
    verdicts, socs = await asyncio.gather(safety.check(session, titles), map_titles(session, titles))
    removed = [{"title": v.text, "reason": v.reason} for v in verdicts if not v.allowed]

    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for job, v in zip(jobs, verdicts):
        key = job.title.lower().strip()
        if not v.allowed or key in seen:
            continue
        seen.add(key)
        d = job.model_dump()
        d["fit_score"] = max(0, min(100, d["fit_score"]))
        d["work_life"] = max(1, min(5, d["work_life"]))
        lo, hi = sorted((abs(d["salary_low"]), abs(d["salary_high"])))
        d["salary_low"], d["salary_high"] = lo, hi
        soc = socs.get(job.title.strip()) or ""
        onet = occupations.get(soc) if soc else None
        d["soc_code"] = onet["soc_code"] if onet else ""
        d["onet"] = _onet_brief(onet) if onet else None
        result.append(d)

    result.sort(key=lambda j: j["fit_score"], reverse=True)
    return {"jobs": result[:SHOW], "removed": removed, "ranking_note": out.ranking_note}


def _onet_brief(onet: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": onet["title"], "preparation": onet["preparation"],
        "median_wage": onet["median_wage"], "p25_wage": onet["p25_wage"],
        "p75_wage": onet["p75_wage"], "oews_year": onet["oews_year"],
        "url": f"https://www.onetonline.org/link/summary/{onet['soc_code']}",
    }


async def check_custom_title(session: RunSession, title: str) -> dict[str, Any]:
    # Safety check and occupation mapping run at the same time (one round trip).
    _, socs = await asyncio.gather(safety.require_safe(session, [title]), map_titles(session, [title]))
    soc = socs.get(title, "")
    onet = occupations.get(soc) if soc else None
    return {
        "title": title, "soc_code": soc,
        "description": onet["description"] if onet else "",
        "preparation": onet["preparation"] if onet else "",
    }
