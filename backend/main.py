"""FastAPI app: serves the frontend and the agent endpoints.

Every endpoint is tied to a run (X-Run-Id header). Unknown or missing ids get
a fresh run; the new id is returned in the response header.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, File, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .agents import career, coach, position, resume
from .config import ENV_FILE, FRONTEND_DIR, settings
from .harness import safety
from .harness.budget import BudgetExceeded, RunSession, get_session, new_session
from .llm import LLMError, safe_error
from .schemas import InCareers, InCoachPlan, InCoachSkills, InJobPick, InOpenings, InPositions, InProfile
from .tools import occupations
from .tools.resume_extract import ResumeError

log = logging.getLogger("career.api")

app = FastAPI(title="Career Pathfinder", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.middleware("http")
async def no_stale_frontend(request: Request, call_next):
    """Always revalidate the frontend files so an updated app is never mixed with cached code."""
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


def run_for(request: Request, response: Response) -> RunSession:
    s = get_session(request.headers.get("x-run-id"))
    if s is None:
        s = new_session()
    response.headers["X-Run-Id"] = s.id
    return s


def ok(session: RunSession, payload: dict) -> dict:
    return {**payload, "usage": session.usage()}


@app.exception_handler(BudgetExceeded)
async def _budget(_: Request, e: BudgetExceeded):
    return JSONResponse({"error": str(e), "kind": "budget"}, status_code=429)


@app.exception_handler(position.UnsafeInput)
async def _unsafe(_: Request, e: position.UnsafeInput):
    return JSONResponse({"error": str(e), "kind": "safety"}, status_code=422)


@app.exception_handler(LLMError)
async def _llm(_: Request, e: LLMError):
    return JSONResponse({"error": str(e), "kind": "ai"}, status_code=502)


@app.exception_handler(ResumeError)
async def _resume(_: Request, e: ResumeError):
    return JSONResponse({"error": str(e), "kind": "resume"}, status_code=400)


@app.exception_handler(ValueError)
async def _value(_: Request, e: ValueError):
    return JSONResponse({"error": str(e)[:300], "kind": "input"}, status_code=400)


@app.exception_handler(Exception)
async def _other(_: Request, e: Exception):
    log.exception("Unhandled error: %s", safe_error(e))
    return JSONResponse({"error": "Something went wrong. Please try again.", "kind": "server"}, status_code=500)


@app.get("/")
async def index():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/api/status")
async def status(request: Request, response: Response):
    s = run_for(request, response)
    return ok(s, {
        "key_configured": bool(settings.portkey_api_key),
        "env_file": ENV_FILE.name if ENV_FILE else None,
        "models": {"reasoning": settings.model_reasoning, "fast": settings.model_fast},
        "data": occupations.data_status(),
    })


@app.post("/api/resume")
async def parse_resume(request: Request, response: Response, file: UploadFile = File(...)):
    s = run_for(request, response)
    data = await file.read(settings.max_resume_bytes + 1)
    if len(data) > settings.max_resume_bytes:
        raise ResumeError("That file is too large (5 MB maximum).")
    return ok(s, await resume.parse_resume(s, file.filename or "", data))


@app.post("/api/positions/questions")
async def questions(body: InPositions, request: Request, response: Response):
    s = run_for(request, response)
    return ok(s, {"questions": await position.follow_up_questions(s, body.profile)})


@app.post("/api/positions")
async def positions(body: InPositions, request: Request, response: Response):
    s = run_for(request, response)
    return ok(s, await position.suggest(s, body.profile))


class InCustomTitle(BaseModel):
    title: str = Field(min_length=2, max_length=120)


@app.post("/api/positions/custom")
async def custom_title(body: InCustomTitle, request: Request, response: Response):
    s = run_for(request, response)
    return ok(s, await position.check_custom_title(s, body.title.strip()))


class InPrefetch(BaseModel):
    profile: InProfile
    job: InJobPick


@app.post("/api/careers/prefetch")
async def careers_prefetch(body: InPrefetch, request: Request, response: Response):
    """Start mapping a job the user just selected, in the background (same limits apply)."""
    s = run_for(request, response)
    if safety.blocklist_reason(body.job.title):
        return ok(s, {"started": False})
    return ok(s, {"started": career.prefetch(s, body.profile, body.job)})


@app.post("/api/careers")
async def careers(body: InCareers, request: Request, response: Response):
    s = run_for(request, response)
    return ok(s, await career.build_trees(s, body.profile, body.jobs))


@app.post("/api/coach/skills")
async def coach_skills(body: InCoachSkills, request: Request, response: Response):
    s = run_for(request, response)
    return ok(s, await coach.list_skills(s, body))


@app.post("/api/coach/plan")
async def coach_plan(body: InCoachPlan, request: Request, response: Response):
    s = run_for(request, response)
    return ok(s, await coach.build_plan(s, body))


@app.post("/api/openings")
async def openings(body: InOpenings, request: Request, response: Response):
    s = run_for(request, response)
    return ok(s, await coach.find_openings(s, body.title, body.location, body.notes))
