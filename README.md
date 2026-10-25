# Career Pathfinder

An AI app that shows people what a career could look like over the next 15–25 years, including the **inflection points** where they will have to choose between paths (for example, management or specialist), and builds a timed plan to get there.

MGT 409 (AI Foundations for Managers), final project by Amin Duncan-Pope. The project report is [`report.html`](report.html), a single file that opens in any browser and prints to 13 letter pages.

---

## How to run it (for graders)

You need **Python 3.10 or newer** and an internet connection. Nothing else: no Node.js, no database, no build step.

### 1. Check Python

```bash
python --version
```

It should print `Python 3.10` or higher. On macOS/Linux you may need `python3` instead of `python`; on Windows, `py` also works. If Python is missing, install it from <https://www.python.org/downloads/>. On Windows, tick "Add Python to PATH" in the installer.

### 2. Get the code

```bash
git clone <repository-url> career-pathfinder
cd career-pathfinder
```

Or download the ZIP from GitHub, unzip it and open a terminal in that folder.

### 3. Provide the API key

The app needs `PORTKEY_API_KEY`. It reads it from a `.env` file and checks **this folder first, then the parent folder**, so the course submission layout works with no extra steps:

```
submissions/
├── .env                  ← PORTKEY_API_KEY=...   (found automatically)
└── career-pathfinder/    ← this repository
```

If your key lives somewhere else, copy the template and fill it in:

```bash
cp .env.example .env          # Windows: copy .env.example .env
```

Then edit `.env` so it contains `PORTKEY_API_KEY=your-key`. The key is only used by the local server; it is never sent to the browser, logged or committed (`.env` is in `.gitignore`).

### 4. Install the dependencies

Use a virtual environment so nothing is installed globally.

**macOS / Linux**

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

**Windows (PowerShell or Command Prompt)**

```bash
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
```

Installation takes about a minute.

### 5. Start the app

**macOS / Linux** (with the virtual environment active):

```bash
python app.py
```

**Windows:**

```bash
.venv\Scripts\python app.py
```

The terminal prints `Career Pathfinder running at http://127.0.0.1:8000` and your browser opens to it. If the browser doesn't open, paste that address into it. If port 8000 is busy, the app picks the next free port and prints it. Press **Ctrl+C** in the terminal to stop.

### 6. Try it (about 3 minutes)

The bar at the top shows which of the five steps you're on.

1. **Starting point.** Choose **"I'm exploring"** and describe what you like to do, or choose **"I have a starting point"** and upload a resume. A fictional one is in [`samples/sample_resume.txt`](samples/sample_resume.txt). Add a location (e.g. *Atlanta, GA*) and click **Continue**.
2. **Positions.** Answer the follow-up questions (several options can be picked), then review 10 ranked jobs. Select up to 3. You can also type your own job title. While you read, the app starts mapping the jobs you've selected in the background.
3. **Career paths.** Each job becomes a sideways tree: years run left to right, and black **?** markers are decision points. Drag the **year slider** to see where you might be in each career. Click **Choose this career**, pick a direction at each decision point, and optionally add notes (e.g. *"I want to work at Samsung GSG"*).
4. **Skills.** Hard and soft requirements, each tagged with when you'll need it and pre-filled from your resume/profile. Adjust your level (None → Expert, target marked) or Yes/No for degrees and certifications, and tick what you want to work on.
5. **Your plan.** Trajectory, salary projection, what to do in your current job, next 90 days, a phased plan, skill gaps, and **Find current openings** (LinkedIn, Indeed and other boards; read-only).

Typical wait times: questions ~3 s, job matches ~15 s, career maps ~15 s (often instant if you spent a few seconds choosing), skills ~13 s, plan ~14 s. Progress autosaves in the browser. **Start over** (bottom right) resets everything, including the search budget.

### Troubleshooting

| Symptom | Fix |
|---|---|
| Red banner: "PORTKEY_API_KEY is missing" | The `.env` file isn't in this folder or its parent, or the variable name is misspelled. Fix it and restart the app. |
| `python: command not found` | Use `python3` (macOS/Linux) or `py` (Windows). |
| `No module named fastapi` (or similar) | The virtual environment isn't being used: repeat step 4 and start the app with the same Python. |
| "Search limit reached for this run" | Each run allows 15 web searches. Click **Start over** for a fresh run. |
| An AI step shows "The AI service returned an error" | Usually temporary (gateway or network). Click the button again. |

---

## What's inside

### Agents and tools

| Agent | Model | Tools |
|---|---|---|
| Resume Agent | `gpt-5.6-luna` | Local text extraction (PDF/DOCX/TXT), PII redaction |
| Position Agent | `gpt-5.6-luna` | Bundled O\*NET occupation data, O\*NET title mapping |
| Career Agent | `gpt-5.6-luna` | `web_search` (2 parallel searches per job: progression and pay), O\*NET related occupations |
| Coach Agent | `gpt-5.6-luna` | `web_search` for courses/certifications, O\*NET skill ratings, the Career Agent's research |

All AI calls use OpenAI `gpt-5.6-luna` through the Portkey gateway, with low reasoning effort for speed. (`MODEL_REASONING`, `MODEL_FAST` and `REASONING_EFFORT` in `.env` can change this.) Agents return JSON that must match a strict schema (`backend/schemas.py`); the prompts are in `backend/prompts/`.

**Speed.** The harness runs each agent's searches in parallel and caches them per run. Re-mapping the same job is instant. A job selected on step 2 for 2 seconds starts mapping in the background, so maps are usually ready when you click "Map these careers"; otherwise step 3 opens as soon as the first map is done. The learning-resources search for the plan runs while you rate your skills. The plan's near-term and long-term halves are written in parallel.

**Web search** uses OpenAI's hosted `web_search` tool, restricted to allowlisted domains (BLS, O\*NET, CareerOneStop, LinkedIn, Indeed, Glassdoor, PayScale, Salary.com, Levels.fyi, plus course and certification sites). It does not scrape LinkedIn or Indeed directly. Job-opening searches cover LinkedIn and Indeed first, then Glassdoor, ZipRecruiter, USAJobs, Built In, SimplyHired and Dice, because many LinkedIn/Indeed postings are not in the search index. The plan page also gives direct LinkedIn and Indeed search links.

### Harness (safety and limits)

The limits are enforced in code (`backend/harness/`), not just in prompts.

- **Career safety filter** (`safety.py`) runs on typed job titles, interests and notes, every suggested job, every role in the career trees, and the job-openings search. It has two layers: a deterministic blocklist (gambling, betting, violence, trafficking, scams…) and a model classifier. If the classifier skips an item, that item is blocked. Legitimate roles such as penetration tester, police officer or pharmacist are allowed.
- **Search budget** (`budget.py`): 15 searches per run and 2 per career by default. Searches are reserved before they run, and results are cached and de-duplicated, so a search already running is awaited, not repeated. The top bar shows the count. Background mapping stops early to keep searches in reserve for later steps, and is capped at 6 maps per run. There are also caps on model calls (80) and tokens per run; past the limit, the API answers 429.
- **Read-only by design:** the only outbound connection is the Portkey gateway. There is no browser automation, no form filling and no tool that can POST anywhere. Job links are plain links the user opens themselves.
- **Untrusted data** (`untrusted.py`): search results, resumes and notes are wrapped as data, common prompt-injection phrases are stripped, and the agents are told never to follow instructions inside them. Every source URL comes from the search tool's own citations; the model can only refer to sources by number.
- **Resume privacy** (`pii.py`): the file is read in memory on your computer and never saved. Name, email, phone, address, ZIP code and links are removed before the text goes to the AI.
- **Output checks** (`validate.py`): career trees are repaired into a single-rooted tree with ordered years and sane salary ranges. Paths sent back from the browser are re-validated. Plan items for skills you won't need for years are moved out of "next 90 days" unless you asked for them or they need a long lead time.
- **Fairness:** no protected characteristics are collected, and the prompts forbid using them.
- **Rendering:** all AI and web text is inserted with `textContent`, never `innerHTML`, and links are limited to http(s).

### Project layout

```
app.py                  start here: python app.py
requirements.txt        Python dependencies
.env.example            template for the API key and optional settings
samples/                fictional resume for testing the upload
backend/
  main.py               FastAPI routes
  config.py             .env loading (./.env, then ../.env), models, limits
  llm.py                OpenAI/Portkey client, structured (schema-checked) calls
  schemas.py            agent output schemas + request bodies
  agents/               resume.py, position.py, career.py, coach.py
  harness/              safety, budget, pii, untrusted, validate
  tools/                web_search.py, occupations.py, onet_map.py, resume_extract.py
  prompts/              agent prompts
  data/                 bundled O*NET CSVs (occupations, skills, related occupations)
frontend/               index.html, css/, js/ (plain JavaScript, no build step)
scripts/build_data.py   rebuilds backend/data from O*NET (and optional BLS wages)
tests/                  offline tests
```

### Tests

```bash
pip install pytest
python -m pytest
```

The tests are offline (no API key needed). They cover the safety blocklist, PII redaction, tree repair, the search budget, timing enforcement, yes/no requirements and the O\*NET lookup.

### Data and attribution

- Occupation data: **O\*NET 31.0 Database** (August 2026) by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA), used under the [CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/). The data has been trimmed and reformatted. O\*NET® is a trademark of USDOL/ETA.
- **BLS wages (optional):** the bundled data has no wage columns, because BLS blocks automated downloads. Salaries come from the Career Agent's web searches and are labeled as estimates. To add BLS medians, download `oesm24nat.zip` (or newer) from <https://www.bls.gov/oes/tables.htm> in a browser, unzip it, then run:

  ```bash
  python scripts/build_data.py <onet_text_dir> backend/data <path>/national_M2024_dl.xlsx 2024
  ```

  `onet_text_dir` is the unzipped O\*NET text release from <https://www.onetcenter.org/database.html>. Adding wages requires `pip install openpyxl`.

## Disclaimer

Guidance only, not professional career or financial advice. Salaries are estimates and vary by employer, location and year; check the linked sources.
