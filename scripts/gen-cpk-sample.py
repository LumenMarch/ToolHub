import csv
import json

CSV = "/Users/foxlink/Desktop/Export-ID-215213090210608-2026-08-13T14_00_00-2026-08-14T23_59_59-B482-HILO1-3.2.10-3.2.10.csv"
OUT = "frontend/src/pages/tools/cpk-charts/data/sample.ts"

with open(CSV, newline="", encoding="utf-8-sig") as f:
    rows = list(csv.reader(f))

header = rows[1]
upper = rows[4]
lower = rows[5]
units = rows[6]
data = rows[7:]

kept = []
for i in range(12, len(header)):
    valid = 0
    for r in data:
        v = r[i].strip()
        if not v:
            continue
        try:
            float(v)
            valid += 1
        except ValueError:
            pass
    if valid > 0:
        kept.append(i)

cols = []
for i in kept:
    cols.append({
        "name": header[i],
        "unit": units[i].strip() or "NA",
        "upper": upper[i].strip() or "NA",
        "lower": lower[i].strip() or "NA",
    })

rows_out = []
for r in data:
    if not any(c.strip() for c in r):
        continue
    rows_out.append(",".join((r[i].strip() or "NA") for i in kept))

L = []
L.append("// Auto-generated from Export-ID-215213090210608-...-B482-HILO1-3.2.10-3.2.10.csv")
L.append("// Do not edit by hand. Regenerate with scripts/gen-cpk-sample.py")
L.append("")
L.append("export interface SampleColumn {")
L.append("  name: string;")
L.append("  unit: string;")
L.append("  upper: string;")
L.append("  lower: string;")
L.append("}")
L.append("")
L.append("export const SAMPLE_TITLE = 'HILO1 / 3.2.10-3.2.10 / B482 / FLDG_FQ3-4FT-01B_46';")
L.append('export const SAMPLE_ROWS = %d;' % len(rows_out))
L.append("")
L.append("export const SAMPLE_COLUMNS: SampleColumn[] = [")
for c in cols:
    L.append("  { name: %s, unit: %s, upper: %s, lower: %s }," % (
        json.dumps(c["name"], ensure_ascii=False),
        json.dumps(c["unit"], ensure_ascii=False),
        json.dumps(c["upper"], ensure_ascii=False),
        json.dumps(c["lower"], ensure_ascii=False),
    ))
L.append("];")
L.append("")
L.append("export const SAMPLE_DATA_STR: string[] = [")
for r in rows_out:
    L.append("  %s," % json.dumps(r, ensure_ascii=False))
L.append("];")

out = chr(10).join(L) + chr(10)
with open(OUT, "w", encoding="utf-8") as f:
    f.write(out)
print("kept cols:", len(kept), "rows:", len(rows_out), "bytes:", len(out))
