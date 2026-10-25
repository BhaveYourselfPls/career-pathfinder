"""OpenAI client (through the Portkey gateway) and structured calls.

structured() makes one call that must return JSON matching a Pydantic schema.
Agents never call the web themselves: the harness runs their searches (in
parallel, within the budget) and hands them the results.
"""
from __future__ import annotations

import json
import logging
from typing import Any, TypeVar

import openai
from openai import AsyncOpenAI
from pydantic import BaseModel, ValidationError

from .config import settings
from .harness.budget import RunSession

log = logging.getLogger("career.llm")

T = TypeVar("T", bound=BaseModel)


class LLMError(Exception):
    pass


_client: AsyncOpenAI | None = None


def client() -> AsyncOpenAI:
    global _client
    if _client is None:
        key = settings.portkey_api_key
        if not key:
            raise LLMError(
                "PORTKEY_API_KEY is not set. Add it to a .env file in this folder "
                "or its parent folder (see .env.example)."
            )
        _client = AsyncOpenAI(
            api_key=key,
            base_url=settings.portkey_base_url,
            default_headers={"x-portkey-api-key": key},
            timeout=settings.request_timeout_s,
            max_retries=2,
        )
    return _client


def safe_error(e: Exception) -> str:
    """Error text that is safe to show or log: never contains the key."""
    msg = f"{type(e).__name__}: {e}"
    key = settings.portkey_api_key
    if key:
        msg = msg.replace(key, "[redacted]")
    return msg[:300]


async def structured(
    session: RunSession,
    *,
    model: str,
    system: str,
    user: str,
    schema: type[T],
    effort: str | None = None,
    retries: int = 1,
) -> T:
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    kwargs: dict[str, Any] = {}
    effort = effort or settings.reasoning_effort
    if effort and effort != "default":
        kwargs["reasoning_effort"] = effort
    last: Exception | None = None
    for _ in range(retries + 1):
        session.check_llm()
        try:
            resp = await client().chat.completions.parse(
                model=model, messages=messages, response_format=schema, **kwargs
            )
        except (ValidationError, openai.LengthFinishReasonError, json.JSONDecodeError) as e:
            last = e
            continue
        except openai.APIError as e:
            log.warning("LLM call failed: %s", safe_error(e))
            raise LLMError("The AI service returned an error. Please try again.") from e
        await session.charge_llm(resp.usage, label=schema.__name__)
        msg = resp.choices[0].message
        if msg.parsed is not None:
            return msg.parsed
        if msg.refusal:
            raise LLMError("The AI declined this request.")
    raise LLMError(f"The AI returned malformed output ({safe_error(last) if last else 'empty'}).")
