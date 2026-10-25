"""Data shapes.

`Out*` models are what agents must return (OpenAI strict JSON schema, so every
field is required and there are no defaults). `In*` models are API request
bodies sent by the browser.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- #
# Agent outputs
# --------------------------------------------------------------------------- #


class OutRole(BaseModel):
    title: str
    years: float | None
    highlights: str


class OutResume(BaseModel):
    current_title: str
    years_experience: float | None
    highest_education: Literal["none", "high_school", "some_college", "associate", "bachelor", "master", "doctorate", "professional", "unknown"]
    education_detail: str
    skills: list[str]
    industries: list[str]
    recent_roles: list[OutRole]
    summary: str


class OutQuestion(BaseModel):
    id: str
    question: str
    options: list[str]
    why: str


class OutQuestions(BaseModel):
    questions: list[OutQuestion]


class OutJob(BaseModel):
    title: str
    soc_code: str
    fit_score: int
    why_fit: str
    drawback: str
    day_to_day: str
    salary_low: int
    salary_high: int
    salary_basis: str
    education_needed: str
    work_life: int
    outlook: str
    entry_path: str


class OutPositions(BaseModel):
    jobs: list[OutJob]
    ranking_note: str


class OutNode(BaseModel):
    id: str
    parent_id: str | None
    title: str
    start_year: int
    end_year: int
    salary_low: int
    salary_high: int
    description: str
    requirements: list[str]
    branch_label: str
    commonness: Literal["typical", "common", "less common"]
    source_ids: list[int]


class OutInflection(BaseModel):
    node_id: str
    year: int
    question: str
    considerations: str


class OutCareerTree(BaseModel):
    job_title: str
    summary: str
    salary_basis: str
    nodes: list[OutNode]
    inflections: list[OutInflection]


class OutSkill(BaseModel):
    id: str
    name: str
    type: Literal["hard", "soft"]
    category: Literal["technical", "education", "certification", "experience", "interpersonal", "leadership", "communication", "business", "other"]
    description: str
    needed_by_year: int
    needed_for: str
    # "yes_no" for things you either have or don't (a degree, licence, certification).
    measure: Literal["level", "yes_no"]
    target_level: int
    # Best guess from the profile/resume: 0-4 for levels; 0 or 4 for yes_no.
    estimated_have: int
    evidence: str
    importance: Literal["essential", "helpful"]
    source: str


class OutSkills(BaseModel):
    skills: list[OutSkill]


class OutAction(BaseModel):
    title: str
    detail: str
    skill_ids: list[str]
    effort: str
    source_ids: list[int]


class OutPhase(BaseModel):
    label: str
    start_year: int
    end_year: int
    target_role: str
    goal: str
    actions: list[OutAction]


# The plan is written in two halves at the same time (faster than one long answer).
class OutPlanNow(BaseModel):
    headline: str
    # Things to do inside the person's current job (or current situation) to move toward the path.
    current_job_heading: str
    current_job_moves: list[OutAction]
    next_90_days: list[OutAction]


class OutPlanLater(BaseModel):
    phases: list[OutPhase]
    deferred_note: str
    watch_outs: list[str]


class OutOpening(BaseModel):
    title: str
    company: str
    location: str
    source_id: int


class OutOpenings(BaseModel):
    openings: list[OutOpening]


# --------------------------------------------------------------------------- #
# Request bodies
# --------------------------------------------------------------------------- #


class InFollowUp(BaseModel):
    question: str = Field(max_length=500)
    answer: str = Field(max_length=500)


class InProfile(BaseModel):
    mode: Literal["explore", "start"] = "explore"
    interests: str = Field("", max_length=2000)
    salary_min: int | None = None
    salary_max: int | None = None
    work_life: int = 3
    education: str = Field("", max_length=200)
    location: str = Field("", max_length=120)
    remote: Literal["any", "onsite", "hybrid", "remote"] = "any"
    relocate: bool = False
    school: Literal["yes", "maybe", "no"] = "maybe"
    learning_hours: int = 5
    current_title: str = Field("", max_length=120)
    years_experience: float | None = None
    current_salary: int | None = None
    resume: dict | None = None
    followups: list[InFollowUp] = Field(default_factory=list, max_length=5)


class InJobPick(BaseModel):
    title: str = Field(max_length=120)
    soc_code: str = Field("", max_length=12)


class InPositions(BaseModel):
    profile: InProfile


class InCareers(BaseModel):
    profile: InProfile
    jobs: list[InJobPick] = Field(min_length=1, max_length=3)


class InCoachSkills(BaseModel):
    profile: InProfile
    tree: dict
    path: list[str] = Field(min_length=1, max_length=20)
    notes: str = Field("", max_length=600)   # e.g. "I want to work at Samsung GSG"


class InSkillRating(BaseModel):
    id: str
    have: int = 0          # 0 = none ... 4 = expert
    want: bool = False


class InCoachPlan(BaseModel):
    profile: InProfile
    tree: dict
    path: list[str] = Field(min_length=1, max_length=20)
    skills: list[dict] = Field(max_length=40)
    ratings: list[InSkillRating] = Field(max_length=40)
    notes: str = Field("", max_length=600)


class InOpenings(BaseModel):
    title: str = Field(max_length=120)
    location: str = Field("", max_length=120)
    notes: str = Field("", max_length=600)
