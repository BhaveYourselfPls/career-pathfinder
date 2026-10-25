"""Per-run limits, enforced in code rather than in prompts.

A "run" is one browser session working through the five steps. Every web
search, every model call and every token is charged against that run; once a
limit is hit, further calls raise BudgetExceeded and the API answers 429.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from ..config import settings


class BudgetExceeded(Exception):
    pass


@dataclass
class RunSession:
    id: str
    created: float = field(default_factory=time.time)
    searches_used: int = 0
    llm_calls: int = 0
    tokens_used: int = 0
    # Search results gathered by the Career Agent, keyed by job title. The
    # Coach Agent reads these so its prerequisites stay grounded.
    findings: dict[str, dict[str, Any]] = field(default_factory=dict)
    search_cache: dict[str, dict[str, Any]] = field(default_factory=dict)
    # Background searches started early to hide their latency (e.g. learning resources).
    prefetch: dict[str, "asyncio.Task[Any]"] = field(default_factory=dict)
    # Searches currently running, so a duplicate request waits instead of searching twice.
    inflight: dict[str, "asyncio.Future[Any]"] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    # One entry per model call: label, input, cached input, output, reasoning tokens.
    calls: list[dict[str, Any]] = field(default_factory=list)

    @property
    def searches_left(self) -> int:
        return max(0, settings.max_searches_per_run - self.searches_used)

    async def reserve_searches(self, wanted: int) -> int:
        """Reserve up to `wanted` searches; returns how many were granted."""
        async with self.lock:
            granted = min(wanted, self.searches_left)
            if granted <= 0:
                raise BudgetExceeded(
                    f"Search limit reached ({settings.max_searches_per_run} per run)."
                )
            self.searches_used += granted
            return granted

    async def refund_searches(self, n: int) -> None:
        if n > 0:
            async with self.lock:
                self.searches_used = max(0, self.searches_used - n)

    async def charge_llm(self, usage: Any, label: str = "") -> None:
        """Count one model call and its tokens (Chat Completions or Responses usage)."""
        inp = _get(usage, "prompt_tokens", "input_tokens")
        out = _get(usage, "completion_tokens", "output_tokens")
        details_in = getattr(usage, "prompt_tokens_details", None) or getattr(usage, "input_tokens_details", None)
        details_out = getattr(usage, "completion_tokens_details", None) or getattr(usage, "output_tokens_details", None)
        cached = getattr(details_in, "cached_tokens", 0) or 0
        reasoning = getattr(details_out, "reasoning_tokens", 0) or 0
        async with self.lock:
            self.llm_calls += 1
            self.tokens_used += inp + out
            self.calls.append({"label": label, "input": inp, "cached": cached, "output": out, "reasoning": reasoning})

    def check_llm(self) -> None:
        if self.llm_calls >= settings.max_llm_calls_per_run:
            raise BudgetExceeded("Model call limit reached for this run. Start a new run.")
        if self.tokens_used >= settings.max_tokens_per_run:
            raise BudgetExceeded("Token limit reached for this run. Start a new run.")

    def usage(self) -> dict[str, int]:
        return {
            "searches_used": self.searches_used,
            "searches_max": settings.max_searches_per_run,
            "llm_calls": self.llm_calls,
            "llm_calls_max": settings.max_llm_calls_per_run,
            "tokens_used": self.tokens_used,
            "tokens_max": settings.max_tokens_per_run,
            "input_tokens": sum(c["input"] for c in self.calls),
            "cached_input_tokens": sum(c["cached"] for c in self.calls),
            "output_tokens": sum(c["output"] for c in self.calls),
        }


def _get(usage: Any, *names: str) -> int:
    for n in names:
        v = getattr(usage, n, None) if usage is not None else None
        if v:
            return int(v)
    return 0


_SESSIONS: dict[str, RunSession] = {}
_SESSION_TTL_S = 6 * 60 * 60
_MAX_SESSIONS = 500


def new_session() -> RunSession:
    _prune()
    s = RunSession(id=uuid.uuid4().hex)
    _SESSIONS[s.id] = s
    return s


def get_session(session_id: str | None) -> RunSession | None:
    if not session_id:
        return None
    return _SESSIONS.get(session_id)


def _prune() -> None:
    now = time.time()
    for sid in [k for k, v in _SESSIONS.items() if now - v.created > _SESSION_TTL_S]:
        _SESSIONS.pop(sid, None)
    while len(_SESSIONS) >= _MAX_SESSIONS:
        _SESSIONS.pop(next(iter(_SESSIONS)))
