# ToolHub Packaging Comparison: PEX vs PyInstaller vs Nuitka — Research Report

> **Date**: 2026-08-01
> **Scope**: A read-only comparison (no code changes) of the three viable single-artifact packaging strategies for ToolHub (FastAPI + SQLAlchemy + SQLite backend with polars/pyarrow/fastexcel/bcrypt native deps, React/Vite frontend embedded) targeting air-gapped Windows 10/11 machines maintained by ordinary users. PEX facts are taken from the repo's existing research (`docs/research/windows-offline-deployment.md`, §4/§7, marked "repo-verified"); PyInstaller and Nuitka facts come from their official documentation (linked in §8); measurements made during this session are marked "local-measured" (host: macOS 27 arm64, Python 3.13.14, /tmp venv — nothing was touched inside the repo).

---

## 1. TL;DR

- **All three tools satisfy the hard requirements** (zero Python on target, single-file replace, offline, frontend embeddable). The decision is about **Windows official support**, **build-machine cost**, and **maintenance risk** — not raw capability.
- **PEX/scie (former)**: smallest conceptual fit and least build-machine friction, but its Windows support is **officially not supported** (issue #2658) and the repo has already hit real Windows pain (WinError 1314, PEX_ROOT cache, AV file locks). **Deprecated 2026-08-01** — see the decision note in §7.
- **PyInstaller**: the **most officially supported and battle-tested on Windows** of the three; single-file (118 MB local-measured) with zero-dep target; costs a Windows build machine, AV whitelisting, and a small `main.py` change for the frozen-mode frontend path.
- **Nuitka**: the **only real source-protection and performance play** (compiles to machine code), but the highest build cost (C compiler; MSVC 2022 mandatory for Python 3.13 on Windows), long compile times (~11 min standalone on M1, local-measured), AV flagging acknowledged by the project itself, and the most dynamic-import setup work (one `importlib.metadata` failure reproduced and fixed — §4).
- **Recommendation order for this project**: ① **stay on PEX/scie** (already invested, working); ② **PyInstaller onefile** as the drop-in fallback the moment PEX's Windows issues bite again; ③ **Nuitka** only if source protection or CPU performance becomes a requirement.

> **2026-08-01 decision: ToolHub adopted Nuitka as its packaging solution.** The PEX scripts (`build-bundle.sh`/`.bat`) were deleted and replaced by the cross-platform `scripts/build-bundle.py` (Nuitka standalone/onefile); `backend/app/main.py` now mounts the embedded frontend via the Nuitka frozen-mode path (`__compiled__` detection, `<bundle>/frontend`). Nuitka 4.1.3 standalone was live-verified end to end on macOS arm64 (§4; full build ~11 min, boot ~3.7 s, frontend served from the bundle). See `docs/research/windows-offline-deployment.md` §7 for the current procedure; the PEX material there is kept as deprecated history.

---

## 2. How Each Tool Works (one sentence each + mechanism differences)

| | Principle | Startup mechanism on target | Cache/temp behavior |
|---|---|---|---|
| **PEX** | A self-contained executable Python venv: a zipapp (PEP 441) with `__main__.py`, all deps as embedded wheels, and a bootstrapper | Interpreter boots (target-installed CPython for `.pex`; embedded Python Standalone Builds CPython for `--scie eager`), bootstrapper **installs embedded wheels into `PEX_ROOT`** (~`%USERPROFILE%\.pex`), then runs the app | First run unpacks wheels into PEX_ROOT; later runs reuse the cache. scie extracts its embedded Python + PEX payload on each launch |
| **PyInstaller** | Static analysis of the entry script's import graph (modulegraph), then a C **bootloader** + archived modules/data/binaries + the CPython interpreter itself | onedir: bootloader starts Python directly from the dist folder. onefile: bootloader **unpacks the embedded archive into a `_MEIxxxxxx_` temp dir** each launch, then starts Python from there | `_MEI` dir per launch; deleted on clean exit, **leaks on crash/kill**; location controllable with `--runtime-tmpdir` |
| **Nuitka** | Actually **compiles Python source to C and then to native machine code** (linked against an embedded CPython runtime); standalone mode follows imports and copies the interpreter + extension modules + DLLs into a `.dist` folder | standalone: native binary starts directly (no unpack). onefile: a **bootstrap executable unpacks to a temp path** (`{TEMP}/onefile_{PID}_{TIME}`, configurable to a cached dir) then execs the program | Unique temp dir deleted after run by default; `--onefile-tempdir-spec` can switch to a permanent cached unpack |

Key difference worth stating explicitly: **PEX runs Python code from a zip (zipapp)**, **PyInstaller runs precompiled `.pyc` from an embedded archive behind a bootloader**, and **Nuitka runs machine code with no Python bytecode at all** for everything it compiled. Only Nuitka's compiled functions have no `co_code` (see §3.2), which is what makes its source-protection claim real.

---

## 3. Facts from Primary Sources

### 3.1 PyInstaller (pyinstaller.org — current stable 6.21.0)

- **Python 3.13 support**: yes. PyPI: "Works out-of-the-box with any Python version 3.8–3.15" (`requires-python <3.16, >=3.8`); requirements page: Windows 8+ officially supported (Windows 32/64/ARM64 listed on PyPI), macOS 10.15+.
- **No cross-compilation**: "The output of PyInstaller is specific to the active operating system and the active version of Python… you run PyInstaller on that OS, under that version of Python" (operating-mode doc). A Windows build therefore needs a Windows machine/VM/CI (we have a borrowable Windows VM).
- **onedir vs onefile** (operating-mode doc): onedir is the default — bootloader runs Python directly from the folder, easier to debug, and allows shipping only the updated exe when the import set doesn't change. onefile — a single exe whose bootloader unpacks the embedded archive to a `_MEIxxxxxx_` temp folder each start: "a little slower to start up", multi-instance runs each unpack (disk cost), and "the `_MEIxxxxxx_` folder is not removed if the program crashes or is killed". `--runtime-tmpdir` relocates the unpack dir.
- **Dynamic-import collection** (operating-mode + usage docs): analysis is static; `__import__()`/`importlib.import_module()`/runtime `sys.path` edits are invisible and must be covered by `--hidden-import`, `--collect-all`/`--collect-submodules`/`--collect-binaries`/`--collect-data`, spec files, or hooks. `--add-data SOURCE:DEST` embeds data files (our frontend dist), `--copy-metadata`/`--recursive-copy-metadata` bundle package metadata (needed by `importlib.metadata` users — this bit us locally, see §4).
- **Binary extensions**: bundled as-is and loaded by the OS: "Uses the OS support to load the dynamic libraries, thus ensuring full compatibility"; "Correctly bundles the major Python packages such as numpy…" (PyPI). Community hooks live in `pyinstaller-hooks-contrib` (polars and pyarrow both have hooks; pyarrow's Windows DLL collection is a known failure class — community issues report `pyarrow.lib` DLL-load failures in onefile builds, mitigated by hook updates and preferring onedir).
- **Source protection**: only `.pyc` files are bundled — "These could in principle be decompiled to reveal the logic of your code"; the docs suggest Cython-compiling sensitive modules for stronger hiding.
- **Antivirus**: false positives on packaged executables are tracked by the project's own community wiki (Antivirus-False-Positives).
- **Windows service**: PyInstaller itself is silent on services; the standard pattern is to run the exe under NSSM/schtasks (already covered in `windows-offline-deployment.md` §3.3.7).

### 3.2 Nuitka (nuitka.net — current stable 4.1.3)

- **Python 3.13/Windows support**: manual: Python 3.4–3.14 supported; OS: "Linux, FreeBSD, NetBSD, macOS, and Windows (32 bits/64 bits/ARM)". Verified locally: 4.1.3 runs on CPython 3.13.14 (macOS arm64, Clang).
- **Build requirements** (manual, "Requirements"): a C11-capable compiler is mandatory — on **Windows**: MinGW64 (auto-downloaded) **or** Visual Studio 2022+; **"MinGW64 does not work with Python 3.13 or higher"** → for our `>=3.13` backend a Windows build needs **MSVC 2022** (English language pack recommended). On **macOS**: clang. Not supported: Windows-Store Python, macOS pyenv (use Homebrew/CPython). MSVC 14.3 (2022) redist corresponds to CPython 3.11–3.14; standalone mode copies the dependent DLLs from the build machine, and on Windows 10+ `ucrt.dll` is already in the OS.
- **Modes**: `--mode=standalone` (folder; follows imports by default) and `--mode=onefile` (single binary with bootstrap unpack); "Onefile startup itself is not slow" (official manual, Splash screen section); default onefile unpack is a unique temp dir deleted afterwards, switchable to a cached path via `--onefile-tempdir-spec="{CACHE_DIR}/{COMPANY}/{PRODUCT}/{VERSION}"`.
- **Dynamic imports** (manual + official common-issue-solutions page): `--include-module`/`--include-package` (recursively includes submodules, and in recent versions extension modules too) for anything hidden behind `__import__`/importlib/variables; `--include-plugin-directory` for directory-based dynamic loading; `--include-package-data` for non-code data; `--nofollow-import-to` to prune. Non-deployment mode rewrites misleading `pip install …` errors into actionable `--include-module` hints. FastAPI/uvicorn-specific practice (community + manual patterns): pass the **app object** to `uvicorn.run(app, …)` instead of the string `"app.main:app"`, use `--include-package` for uvicorn/fastapi/starlette/pydantic/anyio, and run **one worker** — the multiprocessing/worker-re-exec path is the known unstable area (Nuitka's fork-bomb self-execution guard exists precisely because `sys.executable` is the compiled binary). Nuitka's package configuration (YAML) covers NumPy, SciPy, Tkinter and "practically all popular packages" for DLL/extension collection.
- **Binary extensions (polars/pyarrow)**: **not recompiled** — "You can use all Python library modules and all extension modules freely"; standalone mode copies the existing `.so`/`.pyd` wheels as-is (they are treated as dependencies, never as data files — the manual's data-files table lists `.so`/`.dylib` as "ignored" for data purposes and handled through package config dll sections). So polars/pyarrow/fastexcel/bcrypt remain their original prebuilt binaries; Nuitka only compiles the Python-level code.
- **Compile time**: genuinely heavy for large stacks. Manual's common-issue-solutions page warns about "dependency creep" (single imports pulling in "more than a thousand packages" → "substantial compilation times"). Community experience for numpy/pandas/pyarrow-class apps is tens of minutes per build; local baseline: a trivial stdlib-only standalone build took ~28 s including toolchain init (§4); the full ToolHub backend measured **~11 min** on M1 (§4).
- **Performance claims**: official pystone figures show ~3.3–3.7× (LTO/PGO) on a CPU-bound microbenchmark. These are throughput numbers, not startup numbers; for a FastAPI server the practical win is on CPU-heavy app code, not on I/O.
- **Source protection**: compiled functions have **no bytecode** — "The `co_code` attribute of code objects… is empty for native compiled functions. There is no bytecode with Nuitka's compiled function objects"; PDB tracing of compiled functions is unsupported. This is the strongest anti-decompilation story of the three.
- **Antivirus**: official "Windows Virus Scanners" section — "Some Antivirus Vendors may flag compile[d] binaries using Nuitka's default settings on Windows as malware… You can avoid this by purchasing the Nuitka Commercial plan… but there are no guarantees." AV flagging is acknowledged as a real issue by the project itself.
- **License**: AGPL v3 with a runtime exception (`LICENSE-RUNTIME.txt`); the tool is AGPL, the generated program can be distributed under your own terms per the runtime exception. Worth reading the exception text before shipping, but Nuitka is widely used commercially under this model.

### 3.3 PEX (recap from `windows-offline-deployment.md` §7 — repo-verified, no re-research needed)

- zipapp per PEP 441; `.pex` needs a target CPython 3.13; `--scie eager` produces a native PE/Mach-O/ELF binary embedding a Python Standalone Builds CPython → **zero-Python target** (this is what ToolHub ships: `dist/toolhub.exe` / `dist/toolhub`).
- **Windows is not officially supported**: maintainer's #2658 open; "building a PEX on Windows is not supported (may work in some cases)"; running cross-built PEX on Windows "now works" via the pexrc native runtime. The user has already **cancelled cross-compilation**, so Windows releases must be built natively on Windows — where PEX's own support is the weakest.
- Known Windows runtime issues (repo-verified live): WinError 1314 (symlink creation needs Developer Mode or elevation; pex 2.99 has no symlink fallback, #2659), PEX_ROOT cache management, AV file-lock races on first boot.
- Measured sizes (repo): `dist/toolhub.pex` ≈ 131–143 MB (needs target Python), scie `dist/toolhub`/`toolhub.exe` ≈ 155–183 MB (zero-dep).

---

## 4. Empirical Measurements (local-measured, this session)

Host: macOS 27 arm64 (Apple M1), CPython 3.13.14 in a throwaway `/tmp` venv. **PyInstaller 6.21.0** was installed there, the real ToolHub backend `app/` + `frontend/dist` (8.7 MB) were staged, and a one-line launcher (`uvicorn.run(app, host, port, workers=1)` — app **object**, not the string form) was built in both modes. **Nuitka 4.1.3** was additionally given a **full-project compile + runtime verification** of the real backend entry `app/__main__.py` — kept unchanged, including its string-form `uvicorn.run("app.main:app", …)` — staged in a `/tmp` copy of the repo (`/tmp/nk-repo`, built with the repo's own `frontend/dist`). Nothing inside the repo was modified.

| Metric | Result |
|---|---|
| PyInstaller onedir build time | ~40 s (macOS arm64) |
| PyInstaller onedir bundle size | **369 MB** folder (exe + `_internal/`, incl. 8.7 MB frontend) |
| PyInstaller onefile build time | ~59 s |
| PyInstaller onefile size | **118 MB** single executable |
| PyInstaller onedir startup → serving | **~1.4 s** (HTTP 200, `{"message":"Welcome to ToolHub API"}`) |
| PyInstaller onefile startup → serving | **~9.3 s** (HTTP 200); `_MEIxxxxxx_` dir observed in `$TMPDIR` |
| Frontend in PyInstaller bundle | **not served** (`/index.html` → 404) — see below |
| Required dynamic-import flags (PyInstaller) | `--collect-all uvicorn passlib loguru` + `--copy-metadata rustpy-xlsxwriter` (+ preemptively `polars`, `pyarrow`); the first build failed with `importlib.metadata.PackageNotFoundError: rustpy-xlsxwriter` until metadata was copied |
| Nuitka 4.1.3 on Python 3.13.14 | installs & runs (`--version` OK, Clang) |
| Nuitka minimal standalone build (hello world) | ~28 s; `hello.dist` = 21 MB (stdlib-only baseline); binary runs, prints version |
| Nuitka full-project build time (standalone) | **~11.1 min** (665 s wall / 2563 s user, clang 2×; first attempt 12.1 min before the metadata fix below) |
| Nuitka full-project bundle size | **555 MB** `__main__.dist` folder; main binary `__main__.bin` = **183 MB** (arm64 Mach-O, embedded `libpython3.13.dylib`); incl. embedded frontend data |
| Nuitka startup → serving | **~3.7 s** (HTTP 200 on `/api/v1/openapi.json`); idle RSS ~64 MB |
| Frontend in Nuitka bundle | **not served** (`/index.html` → 404) — dist data *is* embedded (234 files via `--include-data-dir`), but `main.py`'s PEX-only path logic doesn't locate it (see below) |
| Required dynamic-import flags (Nuitka) | **Trimmed 2026-08-01 to a minimal set** (Nuitka 4.1.3 auto-follows static imports): `--include-package app` + `--include-package-data app` (string entry `uvicorn.run("app.main:app")`) + `--include-data-dir frontend/dist=frontend` + `--include-package sqlalchemy.dialects.sqlite` (lazy dialect `__import__`) + `--include-distribution-metadata rustpy-xlsxwriter`. The original full list (uvicorn/fastapi/starlette/pydantic/anyio/polars/pyarrow/loguru/passlib/reportlab/xlsxwriter/openpyxl/bcrypt/sqlalchemy/rustpy_xlsxwriter/xlrd/pydantic_settings/PyPDF2/dateutil + 16 more dists) proved redundant — incl. uvicorn's try/except optional-import fallbacks and anyio's dynamic backend (built-in package config). **First build failed** with `importlib.metadata.PackageNotFoundError: rustpy-xlsxwriter` until metadata was added — same failure class as PyInstaller's `--copy-metadata` |
| Nuitka runtime verification | `/` 200 JSON welcome · `/api/v1/openapi.json` 200 (41 paths incl. `/api/v1/tools/asset/*`) · `/api/v1/users/me` 401 unauthenticated · `POST /api/v1/auth/token` admin/admin 200 (JWT) · `/users/me` with Bearer 200 (roles+permissions) · `POST /api/v1/auth/session` sets `toolhub_session` cookie → `/users/me` with cookie 200 · `/api/v1/tools/sixty-seconds/hitokoto` 200 (packaged `hitokoto.json`) · `/api/v1/tools/asset/jobs/{id}` business 404 “核对任务不存在” (route+DB alive, no 500) |

**Interpretation notes**

- **Size**: PyInstaller onefile (118 MB local-measured, macOS) is the same order as the repo's PEX/scie numbers (131–143 / 155–183 MB) — the bundle is dominated by the same wheel payloads (polars/pyarrow/fastexcel/numpy) plus an embedded CPython either way. The 369 MB onedir folder is the uncompressed working set (measured, matches the existing doc's "300 MB–1 GB+" estimate band). The Nuitka standalone folder measured **555 MB** — larger than PyInstaller's onedir 369 MB, driven by the same payload (libarrow dylibs ~90 MB, `_polars_runtime_32` 183 MB, numpy/pyarrow ~16 MB) plus a 183 MB main binary that embeds the compiled app and CPython; the stdlib-only 21 MB baseline confirms the fixed overhead is small, so the delta vs PyInstaller is mostly the polars runtime payload and Nuitka keeping more wheel internals around.
- **Startup**: the onefile extraction tax is real and large on this payload (9.3 s vs 1.4 s). PEX's first-run PEX_ROOT install and scie's per-launch extraction are the analogous costs in the current scheme; PEX later runs are cached.
- **Frontend gap (important for switch cost)**: the current `backend/app/main.py` frontend-embedding logic is PEX-specific — it detects `os.environ.get("PEX")`, treats `sys.argv[0]`/`__file__` as a zipapp, and extracts `frontend/dist/` from the archive into `TOOLHUB_FRONTEND_DIST_CACHE`. Under PyInstaller there is no PEX env var and the files land in `sys._MEIPASS/frontend/dist`, so the bundle boots **API-only** (verified: root returns the JSON message, `/index.html` → 404). Under Nuitka the dist folder layout differs again (compiled modules' `__file__` maps into `dist/app/…` pseudo-paths, so `main.py`'s `parents[2]` lands *outside* the dist and misses the embedded `dist/frontend/dist` — verified: 404 even though the data is in the bundle). **Both alternatives require a small, well-understood addition to `main.py`** (a `sys.frozen`/`sys._MEIPASS` branch for PyInstaller, a `__compiled__`-based path for Nuitka); the code change is a few lines but must be written, tested, and re-released.
- **Dynamic imports**: the local PyInstaller build reproduced the exact failure class the docs warn about (`rustpy-xlsxwriter` reads `importlib.metadata` at import time → needed `--copy-metadata`; the app's real entry `app/__main__.py` uses the string form `uvicorn.run("app.main:app", …)`, which additionally needs the `app.main` module handled). **Verified locally on the full Nuitka build: it hits the identical failure** — `rustpy-xlsxwriter`'s `__init__.py` calls `importlib.metadata` at import time, so the first build crashed at startup with `PackageNotFoundError: rustpy-xlsxwriter`. Nuitka's fix is its counterpart of `--copy-metadata`: **`--include-distribution-metadata=rustpy-xlsxwriter`** (plus the same flag for the other main dists, cheap). With that plus the `--include-package` set above, the **string-form `uvicorn.run("app.main:app", …)` works unmodified** (no app-object change required — `--include-package=app` covers `app.main`), and all extension modules (polars, rustpy_xlsxwriter, bcrypt, xlrd…) load at startup: the bundle boots and serves all 41 routes. Nuitka also warns to pass the containing directory (`app`) instead of `app/__main__.py` when a package has a `__main__`; the file form still built and ran correctly.

---

## 5. Requirement-by-Requirement Fit for ToolHub

### ① Zero dependency on the target machine
- **PEX/scie**: ✓ for scie (embedded Python Standalone Builds); ✗ for plain `.pex` (needs CPython 3.13). Repo ships the scie, so this is currently satisfied.
- **PyInstaller**: ✓ both modes bundle the interpreter; nothing needed on target (Windows 10/11 ship the VC runtime the bootloader needs).
- **Nuitka**: ✓ standalone/onefile embed the CPython runtime; on Windows 10/11 the VC++ 14.3 redist DLLs are copied into the dist or already present via `ucrt.dll`.

### ② Windows stability / official support
- **PyInstaller**: **officially tested on Windows 8+** — the strongest official position of the three.
- **Nuitka**: officially supports Windows, but (a) Python 3.13 **forces MSVC 2022** (MinGW64 excluded), (b) the project itself acknowledges AV flagging of default builds.
- **PEX**: **not officially supported** on Windows (issue #2658 open; build-on-Windows unsupported per maintainer; user cancelled cross-compilation); the repo has already hit WinError 1314, PEX_ROOT cache and AV-lock issues on Windows (§3.3).

### ③ Build-machine requirements (our reality: macOS arm64 + borrowable Windows VM)
All three must be built **on Windows for Windows** (no cross-compile: PyInstaller explicitly, Nuitka per toolchain/OS, PEX per the user's decision). Differences:
- **PyInstaller**: needs only the Windows VM + CPython 3.13 (no C compiler required — bootloader ships prebuilt).
- **PEX**: needs the Windows VM + CPython + Git Bash/WSL (`build-bundle.bat` exists for plain cmd); building on Windows is the least-supported path in its ecosystem.
- **Nuitka**: needs the Windows VM + **Visual Studio 2022** installed — the heaviest build toolchain; on macOS clang is fine for mac builds.

### ④ Artifact size (measured / estimate)
- PEX 131–143 MB; scie 155–183 MB (repo-measured, Windows).
- PyInstaller onefile 118 MB; onedir 369 MB (local-measured, macOS host — same wheels, same CPython, so Windows numbers will be the same order).
- Nuitka: standalone folder **555 MB** / main binary 183 MB (local-measured, macOS host — same wheels, same CPython, so Windows numbers will be the same order); the earlier ~250–400 MB estimate was low — the polars runtime payload (`_polars_runtime_32` 183 MB) alone explains the difference.

### ⑤ Startup speed
- PEX/scie: interpreter boot + PEX_ROOT install (first run) / scie payload extraction; no local timing available this session.
- PyInstaller: onedir **1.4 s** vs onefile **9.3 s** to first serving (local-measured M1) — the onefile unpack of 118 MB is the whole delta.
- Nuitka: standalone **~3.7 s** to first serving (local-measured M1; no unpack cost — direct native start; slower than PyInstaller onedir's 1.4 s, faster than onefile's 9.3 s, same order as a plain interpreter + uvicorn cold start). Onefile would add its unpack step; official claim is "onefile startup itself is not slow" with optional cached unpack.

### ⑥ Upgrade complexity (single-file replace)
- PEX/scie: **already implemented** — swap one file (`dist/toolhub` / `toolhub.exe`), versioned app dir + external SQLite/artifacts per §8 of the existing doc.
- PyInstaller onefile: swap one exe — equally simple for users; every release still requires a full rebuild on the Windows VM (onefile has no incremental exe swap; onedir does).
- Nuitka onefile: swap one binary; standalone mode = folder swap. Also fine.

### ⑦ Decompilation / source protection
- PEX/PyInstaller: bundled `.pyc` — decompilable in principle (PyInstaller docs admit it; scie's payload is the same zipapp).
- Nuitka: compiled to machine code; `co_code` empty; no PDB tracing — the only option here with genuine protection of the Python-level logic (note: third-party pure-Python deps that are followed are compiled too; extension modules stay as prebuilt binaries either way).

### ⑧ Frontend dist embedding
- PEX: done, PEX-specific zip-extraction in `main.py` (`TOOLHUB_FRONTEND_DIST_CACHE`).
- PyInstaller: `--add-data "frontend/dist:frontend/dist"` embeds it, but the frozen-mode mount needs a `sys._MEIPASS` branch in `main.py` (verified missing today → API-only bundle).
- Nuitka: `--include-data-dir=frontend/dist=frontend` (or `--include-package-data` if it were a package) + a `__compiled__.containing_dir`-based path in `main.py`.

### ⑨ Maintenance risk
- **PEX**: highest — unofficial Windows, symlink/Developer-Mode edge, PEX_ROOT cache lifecycle, AV file locks (all observed in-repo); upstream interest in Windows is slow-moving (issue open since 2021-era, still open).
- **PyInstaller**: AV false positives (community wiki, whitelisting per target machine); `_MEI` temp leaks on crash/kill; onefile startup tax; hook freshness matters for pyarrow-class packages.
- **Nuitka**: AV flagging acknowledged by the project itself; long compile times and MSVC toolchain burden on every release; package-config coverage can lag new versions of binary packages ("sometimes, newer versions of packages… can be unsupported" — official); AGPL+runtime-exception license to review.

---

## 6. Multi-Dimension Comparison Table

| Dimension | PEX / scie (current) | PyInstaller | Nuitka |
|---|---|---|---|
| Principle | zipapp + bootstrapper (+ embedded CPython in scie) | bootloader + analyzed module archive (+ bundled CPython) | compiles Python → C → native machine code (+ embedded runtime) |
| Target zero-dependency | ✓ scie (repo: 155–183 MB) / ✗ `.pex` (needs Python) | ✓ onefile/onedir | ✓ standalone/onefile |
| Windows official support | **✗** (issue #2658 open, build-on-Windows unsupported) | **✓✓** officially tested Win 8+ | ✓ officially listed; Python 3.13 ⇒ **MSVC 2022 required** |
| Build machine for Win release | Windows VM + Python + Git Bash/WSL (least-supported path) | Windows VM + Python only (no C compiler) | Windows VM + **Visual Studio 2022** (heaviest) |
| Artifact size | 131–143 MB (.pex) / 155–183 MB (scie) — repo-measured | 118 MB onefile / 369 MB onedir — local-measured (macOS host) | standalone folder **555 MB** / binary 183 MB — local-measured (macOS host) |
| Startup (to serving) | first-run PEX_ROOT install / scie extraction; cached after | onefile **~9.3 s** vs onedir **~1.4 s** (local, M1) | standalone **~3.7 s** (local, M1); onefile adds unpack, cached option exists |
| Dynamic imports | none (wheels import normally) | `--hidden-import`/`--collect-all`/`--copy-metadata`/hooks; real failure reproduced locally (`rustpy-xlsxwriter`) | `--include-package`/`--include-package-data`/`--include-distribution-metadata` — trimmed 2026-08-01 to the minimal set (app + `sqlalchemy.dialects.sqlite` + rustpy-xlsxwriter metadata; the rest auto-followed); same `rustpy-xlsxwriter` failure reproduced and fixed; string `uvicorn.run("app.main:app")` works unmodified (verified) |
| Frontend dist embedding | implemented (PEX zip extraction, `TOOLHUB_FRONTEND_DIST_CACHE`) | `--add-data` works, but frozen mount needs a `sys._MEIPASS` code branch (verified missing → API-only today) | `--include-data-dir` embeds dist (234 files in bundle), but `main.py` path logic doesn't locate it → API-only (verified 404); needs a `__compiled__`-based branch |
| Upgrade (single-file) | ✓ already the shipped model | ✓ onefile (full rebuild per release) | ✓ onefile (full rebuild per release) |
| AV / security-tool risk | AV file locks, PEX_ROOT cache, Dev-Mode/symlinks (observed) | AV false positives (wiki) + `_MEI` leak on kill | AV flagging acknowledged by the project; no guarantees |
| Source protection | none (`.pyc` in zip) | weak (`.pyc` decompilable; docs suggest Cython) | **strong** (machine code, no `co_code`, no PDB) |
| Maintenance cost | low release tooling (scripts exist); high Windows incident risk | medium: spec/hook maintenance + Windows VM per release | high: MSVC toolchain, long compiles, package-config tracking; AGPL+runtime-exception to review |

---

## 7. Conclusions and Recommendation

### Per-scenario verdicts
- **If Windows official support and stability are the top priority** → **PyInstaller (onefile)**. It is the only one of the three that is *officially* tested on Windows, needs no C compiler on the build VM, and produces a comparable single file (118 MB local-measured). The costs: AV whitelisting per target machine, a small `main.py` frozen-path branch, and a full rebuild per release on the Windows VM.
- **If single-file elegance, size, and the current investment matter most** → **keep PEX/scie**. Sizes are comparable to PyInstaller, the upgrade story (swap one file) is already shipped, the build scripts exist, and the frontend embedding is done. The price is living with officially-unsupported Windows behavior and the incident classes already seen (1314/AV locks/PEX_ROOT).
- **If performance and source protection matter** → **Nuitka** (onefile or standalone). It is the only option that compiles the application to machine code (real anti-decompilation; faster CPU-bound paths), at the cost of the heaviest build chain (MSVC 2022 for Python 3.13 on Windows), long compiles, AV-flagging exposure, and the most manual dynamic-import work for uvicorn/FastAPI.

### Overall recommendation (ranking for ToolHub today)
1. **Stay on PEX/scie** — it satisfies every hard requirement and is already invested (build scripts, extraction logic, docs, measured sizes). Don't switch for its own sake.
2. **Adopt PyInstaller onefile as the designated fallback** — the switch cost is modest (below) and the trigger is well-defined: the *next* Windows incident on PEX (1314/AV/PEX_ROOT) that costs a support ticket. It is the lowest-risk Windows-supported path that preserves the single-file UX.
3. **Nuitka only on a future need** — source protection or measurable CPU-bound wins; not worth the toolchain/compile/licensing overhead today.

> **UPDATE (2026-08-01) — this ranking is superseded**: ToolHub has adopted **Nuitka** as its packaging solution, replacing the PEX-based §7 of `windows-offline-deployment.md` (build scripts and runtime extraction logic replaced by `scripts/build-bundle.py` + the `__compiled__` frozen-mode mount). The Nuitka path was chosen over PEX for its official Windows support and native-binary delivery, and live-verified end to end (standalone, macOS arm64, §4). PyInstaller remains the documented fallback if Nuitka's Windows/AV issues ever bite; PEX is deprecated.

### Switch cost from the current PEX solution
What **changes** if we move to PyInstaller onefile (the realistic fallback):
- **Build pipeline**: replace/augment `scripts/build-bundle.sh` + `build-bundle.bat` with a `pyinstaller` spec (`--onefile`, `--add-data frontend/dist`, `--collect-all uvicorn passlib loguru`, `--copy-metadata rustpy-xlsxwriter/polars/pyarrow`); every release must run on the Windows VM (no more cross-build, same as today's native-per-OS rule).
- **`backend/app/main.py`**: add a `sys.frozen`/`sys._MEIPASS` branch so the embedded frontend is served from `_MEIPASS/frontend/dist` (currently the bundle boots API-only — local-measured). PEX-only env vars (`TOOLHUB_FRONTEND_DIST_CACHE`, `PEX_ROOT` handling) become dead code on the PyInstaller path (can be left as the PEX branch).
- **Docs**: `windows-offline-deployment.md` §7 (PEX) gets a companion PyInstaller section; the frontend-embedding note (§7.6) needs the new frozen-mode paragraph; config checklist and NSSM/schtasks parts carry over unchanged.
- **What is given up**: the scie's tiny single-binary simplicity (same UX kept), PEX's wheel-reuse model, and the cross-platform script symmetry (three OSes share one script; PyInstaller needs one spec but it is per-OS anyway).
- **What is kept**: single-file replacement, zero-Python target, external SQLite + `TASK_ARTIFACT_ROOT` layout, env-var configuration, versioned `app-<version>` upgrade model.
- **Effort estimate**: a few hours of build-script + `main.py` work plus one Windows-VM validation pass — small relative to the PEX investment already made, which is exactly why it is a cheap insurance fallback rather than an immediate switch.

---

## 8. Sources

Primary / official (all verified 2026-08-01):

- PyInstaller — Operating mode (no cross-compile; onefile `_MEI` extraction; startup; leaks): https://pyinstaller.org/en/stable/operating-mode.html · Requirements (Windows 8+, macOS 10.15+): https://pyinstaller.org/en/stable/requirements.html · Usage (`--hidden-import`, `--collect-all`, `--add-data`, `--copy-metadata`, `--runtime-tmpdir`): https://pyinstaller.org/en/stable/usage.html · PyPI (6.21.0, Python 3.8–3.15, Windows 32/64/ARM64, "uses the OS support to load the dynamic libraries"): https://pypi.org/project/PyInstaller/ · Hiding source (`.pyc` decompilable, Cython): https://pyinstaller.org/en/stable/operating-mode.html#hiding-the-source-code · AV false positives (project wiki): https://github.com/pyinstaller/pyinstaller/wiki/Antivirus-False-Positives · Hooks repo: https://github.com/pyinstaller/pyinstaller-hooks-contrib (pyarrow DLL issues: https://github.com/pyinstaller/pyinstaller-hooks-contrib/issues/739)
- Nuitka — User manual (requirements/compilers incl. "MinGW64 does not work with Python 3.13 or higher"; Python 3.4–3.14; modes; `--include-package`/`--include-package-data`; data-files table: `.so`/`.dylib` ignored as data; MSVC redist table; extension modules used freely): https://nuitka.net/user-documentation.html · Common issue solutions (Windows Virus Scanners — AV flagging; missing data/DLLs; dynamic sys.path; extension modules): https://nuitka.net/user-documentation/common-issue-solutions.html · Performance chapter (pystone, no `co_code` / PDB unsupported): https://nuitka.net/user-documentation.html#performance · PyPI (4.1.3, AGPL-3.0): https://pypi.org/project/Nuitka/ · Release notes: https://nuitka.net/posts/nuitka-release-41.html
- PEX — repo-verified recap from `docs/research/windows-offline-deployment.md` §4/§7 (sizes, Windows status, WinError 1314, PEX_ROOT, AV locks, #2658/#2659); upstream: https://github.com/pex-tool/pex/issues/2658 · https://docs.pex-tool.org/scie.html · https://docs.pex-tool.org/whatispex.html
- FastAPI/uvicorn + Nuitka practice (community, cross-checked against official manual patterns): https://blog.thoughtparameters.com/post/nuitka_packaging_for_web_frameworks/ — its "pass the app object instead of the string form" advice was re-evaluated 2026-08-01 on Nuitka 4.1.3: with `--include-package=app` the string `uvicorn.run("app.main:app")` works unmodified (verified in the full build and a zero-flag minimal compile), so no `--include-package` for uvicorn/fastapi/starlette/pydantic/anyio is needed; the blog's `workers=1` recommendation matches this app already.
- Local measurements this session (macOS 27 arm64, CPython 3.13.14, PyInstaller 6.21.0, Nuitka 4.1.3, throwaway `/tmp` venvs; repo untouched).
