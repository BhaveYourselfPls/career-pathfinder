"""Career Agent: one job -> researched career tree with inflection points.

Speed: the harness runs the agent's two searches (career progression and pay)
at the same time, then the agent builds the tree in a single call. Mapping
starts in the background as soon as the user selects a job (prefetch), and
queries are fixed per job, so re-mapping the same job hits the search cache.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from typing import Any

from ..config import settings
from ..harness import safety
from ..harness.budget import BudgetExceeded, RunSession
from ..harness.untrusted import wrap
from ..harness.validate import normalize_tree, prune_nodes, repeated_titles
from ..llm import LLMError, structured
from ..schemas import InJobPick, InProfile, OutCareerTree
from ..tools import occupations
from ..tools.web_search import web_search
from .common import describe_profile, prompt

log = logging.getLogger("career.agent")


def _queries(p: InProfile, title: str) -> list[tuple[str, str]]:
    where = p.location or "the United States"
    return [
        (f"{title} career progression: typical next job titles, promotions, specialist vs management "
         f"tracks, and years of experience at each level", "careers"),
        (f"{title} salary by experience level, including senior and manager roles, in {where}", "salary"),
    ][: max(0, settings.max_searches_per_job)]


async def _research(session: RunSession, p: InProfile, title: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Run this job's searches in parallel. Returns (results, numbered sources)."""
    outs = await asyncio.gather(
        *(web_search(session, q, group=g) for q, g in _queries(p, title)), return_exceptions=True
    )
    results = [r for r in outs if isinstance(r, dict)]
    for r in outs:
        if isinstance(r, Exception) and not isinstance(r, BudgetExceeded):
            log.warning("Search for %s failed: %s", title, r)
    sources: list[dict[str, Any]] = []
    for r in results:
        r["numbered"] = []
        for s in r["sources"]:
            existing = next((x for x in sources if x["url"] == s["url"]), None)
            if existing is None:
                existing = {"id": len(sources) + 1, **s}
                sources.append(existing)
            r["numbered"].append(existing["id"])
    return results, sources


PREFETCH_RESERVE = 4      # searches kept back for the skills, plan and openings steps
PREFETCH_LLM_RESERVE = 25  # model calls kept back for the later steps
MAX_PREFETCHED_TREES = 6   # per run, so rapid clicking cannot burn the budget


def _tree_key(p: InProfile, title: str) -> str:
    digest = hashlib.sha1(p.model_dump_json().encode()).hexdigest()[:12]
    return f"tree|{title.strip().lower()}|{digest}"


def prefetch(session: RunSession, p: InProfile, job: InJobPick) -> bool:
    """Start mapping a job in the background as soon as the user selects it, so the
    map is ready (or nearly) when they click "Map these careers". The same budget
    limits apply; build_trees picks up the finished or running task."""
    key = _tree_key(p, job.title)
    started = sum(1 for k in session.prefetch if k.startswith("tree|"))
    if (key in session.prefetch or started >= MAX_PREFETCHED_TREES
            or session.searches_left <= PREFETCH_RESERVE
            or session.llm_calls >= settings.max_llm_calls_per_run - PREFETCH_LLM_RESERVE):
        return False
    task = asyncio.ensure_future(build_tree(session, p, job))
    task.add_done_callback(lambda t: t.cancelled() or t.exception())  # never leave errors unobserved
    session.prefetch[key] = task
    return True


async def build_tree(session: RunSession, p: InProfile, job: InJobPick) -> dict[str, Any]:
    results, sources = await _research(session, p, job.title)

    onet = occupations.get(job.soc_code) if job.soc_code else None
    onet = onet or occupations.best_match(job.title)
    context = [describe_profile(p), f"Job to map: {job.title}"]
    if onet:
        related = occupations.related_titles(onet["soc_code"])
        context.append(
            f"Occupation data: {onet['title']}. Preparation: {onet['preparation']}. "
            f"Related occupations people often move into: {', '.join(related)}."
            + (f" BLS median wage ${onet['median_wage']:,} ({onet['oews_year']})." if onet.get("median_wage") else "")
        )
    if results:
        context.append("Research findings:\n" + "\n\n".join(
            wrap(f"web search: {r['query']}", r["findings"]) + f"\nSources for this search: {r['numbered']}"
            for r in results
        ))
        context.append("Numbered sources:\n" + "\n".join(f"[{s['id']}] {s['title']}" for s in sources))
    else:
        context.append("No web research is available (search limit reached). Mark every salary as an estimate.")

    user = "\n\n".join(context)
    out = await structured(session, model=settings.model_reasoning, system=prompt("career"), user=user, schema=OutCareerTree)
    tree = normalize_tree(out, len(sources))

    # Quality gate: a role that repeats an earlier title on its route is a dead step.
    # Give the agent one chance to fix the specific problems; keep the original if it doesn't.
    problems = repeated_titles(tree)
    if problems:
        log.info("Career map for %s has %d repeated titles; asking for a fix", job.title, len(problems))
        fixed = await structured(
            session, model=settings.model_reasoning, system=prompt("career"), schema=OutCareerTree,
            user=f"{user}\n\nYour previous map:\n{out.model_dump_json()}\n\nFix these problems and return the full corrected map:\n- "
                 + "\n- ".join(problems),
        )
        candidate = normalize_tree(fixed, len(sources))
        if len(repeated_titles(candidate)) < len(problems):
            tree = candidate
        tree["repairs"] = len(problems)

    verdicts = await safety.check(session, [n["title"] for n in tree["nodes"]])
    blocked = {n["id"] for n, v in zip(tree["nodes"], verdicts) if not v.allowed}
    if tree["root_id"] in blocked:
        raise LLMError(f"'{job.title}' cannot be mapped: it did not pass the safety check.")
    tree = prune_nodes(tree, blocked)

    tree["sources"] = sources
    tree["searches_used"] = len(results)
    tree["soc_code"] = onet["soc_code"] if onet else ""
    tree["requested_title"] = job.title
    tree["removed_roles"] = len(blocked)
    session.findings[tree["job_title"].lower()] = {
        "results": [{"query": r["query"], "findings": r["findings"]} for r in results],
        "sources": sources,
    }
    return tree


async def build_trees(session: RunSession, p: InProfile, jobs: list[InJobPick]) -> dict[str, Any]:
    async def one(job: InJobPick) -> dict[str, Any]:
        task = session.prefetch.get(_tree_key(p, job.title))
        if task is not None:
            try:
                return {"ok": True, "tree": await asyncio.shield(task)}
            except Exception as e:  # the early attempt failed: try again normally
                log.info("Prefetched map for %s failed (%s); rebuilding", job.title, e)
                session.prefetch.pop(_tree_key(p, job.title), None)
        try:
            return {"ok": True, "tree": await build_tree(session, p, job)}
        except (LLMError, BudgetExceeded, ValueError) as e:
            return {"ok": False, "title": job.title, "error": str(e)}

    results = await asyncio.gather(*(one(j) for j in jobs))
    return {
        "trees": [r["tree"] for r in results if r["ok"]],
        "errors": [{"title": r["title"], "error": r["error"]} for r in results if not r["ok"]],
    }
