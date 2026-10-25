"""Map everyday job titles to O*NET occupations.

Keyword search finds candidates; one fast model call picks the right one for
each title (e.g. "Data Analyst" -> Data Scientists, not Database Architects).
"""
from __future__ import annotations

from pydantic import BaseModel

from ..config import settings
from ..harness.budget import RunSession
from . import occupations


class _Pick(BaseModel):
    index: int
    soc_code: str


class _Picks(BaseModel):
    picks: list[_Pick]


_SYSTEM = (
    "Map each numbered job title to the single best-matching O*NET occupation from its candidate "
    "list. Answer with the candidate's soc_code, or \"\" if none of the candidates is a reasonable "
    "match. Judge by the actual work, not by shared words."
)


async def map_titles(session: RunSession, titles: list[str]) -> dict[str, str]:
    from ..llm import structured  # local import avoids a cycle

    unique = list(dict.fromkeys(t.strip() for t in titles if t.strip()))
    if not unique:
        return {}
    cands = {t: occupations.search(t, k=6) for t in unique}
    lines = []
    for i, t in enumerate(unique):
        options = "; ".join(f"{c['soc_code']} {c['title']}" for c in cands[t]) or "(none)"
        lines.append(f"{i}. {t}\n   candidates: {options}")
    out = await structured(
        session, model=settings.model_fast, system=_SYSTEM, user="\n".join(lines), schema=_Picks,
    )
    result: dict[str, str] = {}
    for p in out.picks:
        if 0 <= p.index < len(unique):
            title = unique[p.index]
            valid = {c["soc_code"] for c in cands[title]}
            result[title] = p.soc_code if p.soc_code in valid else ""
    for t in unique:  # anything the model skipped falls back to keyword search
        if t not in result:
            result[t] = cands[t][0]["soc_code"] if cands[t] else ""
    return result
