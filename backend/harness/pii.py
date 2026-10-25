"""Remove contact details from resume text before it is sent to the model.

The Resume Agent only needs work history, education and skills. Name, email,
phone, street address and profile links are stripped locally first.
"""
from __future__ import annotations

import re

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+")
_PHONE = re.compile(r"(\+?\d{1,3}[\s.-]?)?(\(\d{2,4}\)|\d{2,4})[\s.-]?\d{3,4}[\s.-]?\d{3,4}")
_URL = re.compile(r"(https?://\S+|www\.\S+|linkedin\.com/\S+|github\.com/\S+)", re.IGNORECASE)
_STREET = re.compile(
    r"\b\d{1,6}\s+([A-Z][a-z]+\s){1,4}(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|"
    r"Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Parkway|Pkwy)\b\.?(,?\s*(Apt|Unit|Suite|#)\s*\w+)?",
)
_ZIP = re.compile(r"\b\d{5}(-\d{4})?\b")
_NAME_LINE = re.compile(r"^[A-Z][A-Za-z'’.-]+(\s+[A-Z][A-Za-z'’.-]*){1,3}$")  # allows middle initials


def redact(text: str) -> tuple[str, list[str]]:
    """Return (redacted_text, list of what was removed)."""
    removed: list[str] = []
    lines = [ln.strip() for ln in (text or "").splitlines()]
    # The candidate's name is almost always the first non-empty line.
    for i, ln in enumerate(lines):
        if not ln:
            continue
        if _NAME_LINE.match(ln) and len(ln) <= 40:
            lines[i] = "[name]"
            removed.append("name")
        break
    out = "\n".join(lines)
    for pattern, label in ((_EMAIL, "email"), (_URL, "links"), (_STREET, "address"),
                           (_PHONE, "phone"), (_ZIP, "zip code")):
        out, n = pattern.subn(f"[{label}]", out)
        if n:
            removed.append(label)
    return out, sorted(set(removed))
