"""Runtime configuration.

The API key is read from the environment only. We look for a .env file in the
project folder first, then in its parent folder (the course submission layout
keeps the teaching staff's .env one level above each project).
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"
DATA_DIR = Path(__file__).resolve().parent / "data"
PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"


def _load_env() -> Path | None:
    """Load the first .env that exists; never override variables already set."""
    for candidate in (PROJECT_ROOT / ".env", PROJECT_ROOT.parent / ".env"):
        if candidate.is_file():
            load_dotenv(candidate, override=False)
            if os.getenv("PORTKEY_API_KEY"):
                return candidate
    return None


ENV_FILE = _load_env()


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    portkey_api_key: str | None
    portkey_base_url: str
    # Model for the Career and Coach Agents; second model
    # for parsing, ranking, safety checks and search summaries.
    model_reasoning: str
    model_fast: str
    # "low" roughly halves response time with little quality loss for these tasks.
    reasoning_effort: str
    max_searches_per_run: int
    max_searches_per_job: int
    max_llm_calls_per_run: int
    max_tokens_per_run: int
    request_timeout_s: int
    max_resume_bytes: int
    host: str
    port: int


def get_settings() -> Settings:
    return Settings(
        portkey_api_key=os.getenv("PORTKEY_API_KEY") or None,
        portkey_base_url=os.getenv("PORTKEY_BASE_URL") or "https://api.portkey.ai/v1",
        model_reasoning=os.getenv("MODEL_REASONING") or "gpt-5.6-luna",
        model_fast=os.getenv("MODEL_FAST") or "gpt-5.6-luna",
        reasoning_effort=os.getenv("REASONING_EFFORT") or "low",
        max_searches_per_run=_int("MAX_SEARCHES_PER_RUN", 15),
        max_searches_per_job=_int("MAX_SEARCHES_PER_JOB", 2),
        max_llm_calls_per_run=_int("MAX_LLM_CALLS_PER_RUN", 80),
        max_tokens_per_run=_int("MAX_TOKENS_PER_RUN", 600_000),
        request_timeout_s=_int("REQUEST_TIMEOUT_S", 180),
        max_resume_bytes=_int("MAX_RESUME_BYTES", 5 * 1024 * 1024),
        host=os.getenv("HOST") or "127.0.0.1",
        port=_int("PORT", 8000),
    )


settings = get_settings()
