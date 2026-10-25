from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from ..config import PROMPTS_DIR
from ..harness.untrusted import UNTRUSTED_NOTE
from ..schemas import InProfile

WORK_LIFE = {
    1: "will work very long hours for career growth",
    2: "accepts long hours at times",
    3: "wants a normal balance",
    4: "values balance highly",
    5: "needs strong work/life balance and predictable hours",
}


@lru_cache(maxsize=None)
def prompt(name: str) -> str:
    text = (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")
    return f"{text}\n\n{UNTRUSTED_NOTE}"


def describe_profile(p: InProfile) -> str:
    """Plain-text profile for prompts. Typed fields are wrapped as user data."""
    lines = [f"Mode: {'exploring (no starting point)' if p.mode == 'explore' else 'has a starting point'}"]
    if p.interests:
        lines.append(f"What they like to do: {p.interests}")
    if p.salary_min or p.salary_max:
        lines.append(f"Ideal earnings (USD/year): {p.salary_min or '?'} to {p.salary_max or '?'}")
    lines.append(f"Work/life balance: {p.work_life}/5 ({WORK_LIFE.get(p.work_life, '')})")
    if p.education:
        lines.append(f"Education: {p.education}")
    if p.current_title:
        lines.append(f"Current/starting job title: {p.current_title}")
    if p.years_experience is not None:
        lines.append(f"Years of experience: {p.years_experience}")
    if p.current_salary:
        lines.append(f"Current salary (USD): {p.current_salary}")
    lines.append(f"Location: {p.location or 'not given (assume US national figures)'}")
    lines.append(f"Work arrangement preference: {p.remote}")
    lines.append(f"Willing to relocate: {'yes' if p.relocate else 'no'}")
    lines.append(f"Open to going back to school: {p.school}")
    lines.append(f"Hours per week available for learning: {p.learning_hours}")
    if p.resume:
        r = p.resume
        lines.append("Resume (parsed): " + json.dumps({
            k: r.get(k) for k in ("current_title", "years_experience", "highest_education", "education_detail",
                                  "summary", "skills", "industries", "recent_roles")
        }, ensure_ascii=False)[:3500])
    for f in p.followups:
        lines.append(f"Q: {f.question} A: {f.answer}")
    return "<untrusted_data source=\"user profile\">\n" + "\n".join(lines) + "\n</untrusted_data>"


def numbered_sources(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flatten search results into a single numbered source list (1-based)."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for r in results:
        for s in r.get("sources", []):
            if s["url"] not in seen:
                seen.add(s["url"])
                out.append({"id": len(out) + 1, **s})
    return out
