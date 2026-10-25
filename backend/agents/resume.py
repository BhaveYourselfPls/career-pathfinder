"""Resume Agent: resume file -> structured profile."""
from __future__ import annotations

from typing import Any

from ..config import settings
from ..harness.budget import RunSession
from ..harness.pii import redact
from ..harness.untrusted import clean_snippet, wrap
from ..llm import structured
from ..schemas import OutResume
from ..tools.resume_extract import extract_text
from .common import prompt


async def parse_resume(session: RunSession, filename: str, data: bytes) -> dict[str, Any]:
    text = extract_text(filename, data)
    redacted, removed = redact(text)
    out = await structured(
        session, model=settings.model_fast, system=prompt("resume"),
        user=wrap("resume", clean_snippet(redacted, 20_000)), schema=OutResume,
    )
    return {"profile": out.model_dump(), "redacted": removed}
