"""Build bundled occupation CSVs from O*NET text release (+ optional BLS OEWS xlsx).

Usage: python -I build_data.py <onet_text_dir> <out_dir> [<oews_national_xlsx> <oews_year>]
"""
import csv
import os
import sys
from collections import defaultdict

onet_dir, out_dir = sys.argv[1], sys.argv[2]
oews_path = sys.argv[3] if len(sys.argv) > 3 else None
oews_year = sys.argv[4] if len(sys.argv) > 4 else ""
TOP_CODE = {"2023": 239200, "2024": 239200}  # BLS annual top-code values ('#')


def read_tsv(name):
    with open(os.path.join(onet_dir, name), encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE))


def trunc(s, n):
    s = " ".join(s.split())
    if len(s) <= n:
        return s
    cut = s[: n - 3].rsplit(" ", 1)[0].rstrip(",;:")
    return cut + "..."


# ---- skills / knowledge ----
def collect(files, kind):
    by = defaultdict(dict)  # (soc, element_name) -> {IM: row, LV: row}
    for fn in files:
        for r in read_tsv(fn):
            if r["Scale ID"] in ("IM", "LV"):
                by[(r["O*NET-SOC Code"], r["Element Name"])][r["Scale ID"]] = r
    out = []
    for (soc, name), sc in by.items():
        im, lv = sc.get("IM"), sc.get("LV")
        if im is None:
            continue
        if any(x is not None and (x.get("Recommend Suppress") == "Y" or x.get("Not Relevant") == "Y") for x in (im, lv)):
            continue
        imp = float(im["Data Value"])
        if imp < 3.0:
            continue
        out.append({"soc_code": soc, "kind": kind, "name": name,
                    "importance": round(imp, 2),
                    "level": round(float(lv["Data Value"]), 2) if lv else ""})
    return out


skill_rows = collect(["Essential Skills.txt", "Transferable Skills.txt"], "skill") + collect(["Knowledge.txt"], "knowledge")
skill_rows.sort(key=lambda r: (r["soc_code"], r["kind"] != "skill", -r["importance"], r["name"]))
has_ratings = {r["O*NET-SOC Code"] for fn in ("Essential Skills.txt", "Transferable Skills.txt", "Knowledge.txt") for r in read_tsv(fn)}

# ---- occupations ----
occ = read_tsv("Occupation Data.txt")
keep = [o for o in occ if o["O*NET-SOC Code"].endswith(".00") or o["O*NET-SOC Code"] in has_ratings]
keep_codes = {o["O*NET-SOC Code"] for o in keep}
skill_rows = [r for r in skill_rows if r["soc_code"] in keep_codes]

jz = {r["O*NET-SOC Code"]: r["Job Zone"] for r in read_tsv("Job Zones.txt")}

# alt titles: reported titles shown in My Next Move first, then other reported, then short titles, then job titles by length
cands = defaultdict(list)  # soc -> [(priority, title)]
for r in read_tsv("Sample of Reported Titles.txt"):
    cands[r["O*NET-SOC Code"]].append((0 if r["Shown in My Next Move"] == "Y" else 1, r["Reported Job Title"]))
for r in read_tsv("Job Titles.txt"):
    st = r.get("Short Title", "n/a")
    if st and st != "n/a":
        cands[r["O*NET-SOC Code"]].append((2, st))
    cands[r["O*NET-SOC Code"]].append((3, r["Job Title"]))


def alt_titles(soc, title):
    seen = {title.lower()}
    out = []
    for _, t in sorted(cands.get(soc, []), key=lambda x: (x[0], len(x[1]), x[1])):
        t = t.replace("|", "/").strip()
        if not t or t.lower() in seen or len(t) > 60:
            continue
        seen.add(t.lower())
        out.append(t)
        if len(out) == 40:  # more titles = better matching of everyday job titles
            break
    return "|".join(out)


# ---- OEWS wages (optional) ----
wages = {}
if oews_path:
    import openpyxl
    wb = openpyxl.load_workbook(oews_path, read_only=True)
    ws = wb.worksheets[0]
    it = ws.iter_rows(values_only=True)
    hdr = [str(h).strip().upper() if h is not None else "" for h in next(it)]
    ix = {h: i for i, h in enumerate(hdr)}
    top = TOP_CODE.get(oews_year)

    def val(v):
        if v is None:
            return ""
        s = str(v).strip()
        if s == "#":
            return top if top else ""
        if s in ("*", "**", "", "~"):
            return ""
        try:
            return int(round(float(s.replace(",", ""))))
        except ValueError:
            return ""

    for row in it:
        g = lambda c: row[ix[c]] if c in ix else None
        if "O_GROUP" in ix and str(g("O_GROUP")).lower() != "detailed":
            continue
        if "NAICS" in ix and str(g("NAICS")) not in ("000000", "None"):
            continue
        if "AREA_TYPE" in ix and str(g("AREA_TYPE")) not in ("1", "None"):
            continue
        wages[str(g("OCC_CODE")).strip()] = {
            "median_wage": val(g("A_MEDIAN")), "p10_wage": val(g("A_PCT10")),
            "p25_wage": val(g("A_PCT25")), "p75_wage": val(g("A_PCT75")), "p90_wage": val(g("A_PCT90"))}

os.makedirs(out_dir, exist_ok=True)
WCOLS = ["median_wage", "p10_wage", "p25_wage", "p75_wage", "p90_wage"]
OCOLS = ["soc_code", "title", "description", "alt_titles", "job_zone"] + WCOLS + ["oews_year"]
occ_rows = []
for o in keep:
    soc = o["O*NET-SOC Code"]
    w = wages.get(soc[:7], {})
    row = {"soc_code": soc, "title": o["Title"], "description": trunc(o["Description"], 400),
           "alt_titles": alt_titles(soc, o["Title"]), "job_zone": jz.get(soc, "")}
    for c in WCOLS:
        row[c] = w.get(c, "")
    row["oews_year"] = oews_year if w else ""
    occ_rows.append(row)


def write(name, cols, rows):
    p = os.path.join(out_dir, name)
    with open(p, "w", encoding="utf-8", newline="") as f:
        wr = csv.DictWriter(f, fieldnames=cols)
        wr.writeheader()
        wr.writerows(rows)
    return p


# ---- related ----
rel = defaultdict(list)
for r in read_tsv("Related Occupations.txt"):
    if r["O*NET-SOC Code"] in keep_codes:
        rel[r["O*NET-SOC Code"]].append(r)
rel_rows = []
for soc, rs in rel.items():
    rs.sort(key=lambda r: int(r["Index"]))
    for r in rs[:10]:
        rel_rows.append({"soc_code": soc, "related_soc_code": r["Related O*NET-SOC Code"],
                         "rank": int(r["Index"]), "tier": r.get("Relatedness Tier", "")})

paths = [write("occupations.csv", OCOLS, occ_rows),
         write("skills.csv", ["soc_code", "kind", "name", "importance", "level"], skill_rows),
         write("related.csv", ["soc_code", "related_soc_code", "rank", "tier"], rel_rows)]
counts = [len(occ_rows), len(skill_rows), len(rel_rows)]
total = 0
for p, n in zip(paths, counts):
    sz = os.path.getsize(p)
    total += sz
    print(f"{os.path.basename(p)}: {n} rows, {sz/1024:.1f} KB")
print(f"total: {total/1024/1024:.2f} MB")
print("occupations total in O*NET:", len(occ), "kept:", len(occ_rows))
print("with median wage:", sum(1 for r in occ_rows if r["median_wage"] != ""))
print("with job zone:", sum(1 for r in occ_rows if r["job_zone"] != ""))
print("with skills rows:", len({r["soc_code"] for r in skill_rows}))
print("skill names:", len({r["name"] for r in skill_rows if r["kind"] == "skill"}),
      "knowledge names:", len({r["name"] for r in skill_rows if r["kind"] == "knowledge"}))
for t in ("Software Developers", "Registered Nurses", "Accountants and Auditors"):
    for r in occ_rows:
        if r["title"] == t:
            print(r)
