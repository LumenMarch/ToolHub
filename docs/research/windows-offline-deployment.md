# ToolHub Offline Deployment on Windows — Research Report

> **Date**: 2026-07-31
> **Scope**: Five strategies for deploying ToolHub (FastAPI + SQLAlchemy + SQLite backend, React/Vite frontend) on an air-gapped Windows machine. Includes verified build-machine and target-machine commands, frontend hosting options, a configuration checklist, and upgrade/rollback guidance. External claims are linked to primary sources (official docs); repo facts are marked "repo-verified"; commands marked "live-tested" were executed during this research session.

---

## 1. Current Application State (repo-verified)

### 1.1 Backend

- FastAPI + SQLAlchemy + SQLite, `requires-python = ">=3.13"`, dependency-managed by uv (`backend/pyproject.toml`, `backend/uv.lock`).
- Depends on native/binary packages: `polars`, `pyarrow`, `numpy<2.2`, `fastexcel`, `bcrypt`, plus pure-Python `openpyxl`, `xlrd`, `reportlab`, `fpdf`, `python-multipart`, `uvicorn`, etc.
- `backend/app/core/config.py` — pydantic-settings `Settings` class; env variables map directly to field names (`case_sensitive = True`), no prefix, **no `env_file` configured**.
- `backend/app/main.py` — creates tables, runs an idempotent permission/role seed (`backend/app/seed.py`), mounts all routes under `/api/v1`, and runs background cleanup + asset-comparison job recovery tasks. Root `/` returns a JSON message; **no static file mounting anywhere in `backend/app`** (verified by search for `StaticFiles`/`mount`).
- `backend/README.md` — asset-comparison jobs are designed for **one uvicorn worker** (an internal bounded executor does the comparison work; a single worker does not limit it to one core).

### 1.2 Frontend

- React + Vite + TypeScript, managed by bun (`frontend/package.json`); `bun run build` runs `tsc -b && vite build` and emits `frontend/dist`.
- API client uses a **relative** base URL (`frontend/src/api/axios.ts`: `axios.create({ baseURL: '/api/v1', withCredentials: true })`), so a same-origin production deployment works without any build-time API URL configuration.
- `frontend/index.html` references no external CDNs — the build is fully self-contained (fonts are bundled via `@fontsource/*`).

### 1.3 Current run script

`run.sh` is a dev-only launcher (`uv run uvicorn ... --reload` + `bun run dev`). There is no production launcher for Windows yet.

### 1.4 Wheel availability (repo-verified via `backend/uv.lock` + live-tested)

| Fact | Detail |
|---|---|
| 41 dependency packages | all ship wheels |
| `win_amd64` wheels | present for every binary package (polars, pyarrow, numpy 2.1.3, fastexcel cp310-abi3, bcrypt, greenlet, pydantic-core, …) |
| **`fpdf==1.7.2`** | **the only sdist-only package** (no wheel on PyPI) — breaks `--only-binary=:all:` unless handled (see §3.2) |

---

## 2. Options Overview

| | A. Prebuilt frontend + offline wheelhouse + python.org installer | B. PyInstaller executable | C. Embeddable Python (zip) | D. Docker Desktop (image transfer) | E. Nuitka standalone/onefile bundle (recommended since 2026-08-01) |
|---|---|---|---|---|---|
| Runtime on target | Standard Python 3.13 + venv | Bundled interpreter inside exe | Zip-extracted minimal Python | Linux container via WSL2 VM | **Native binary with embedded CPython — no Python on target** (standalone folder or onefile exe) |
| Network needed on target | No | No | No | No | No |
| Payload size | ~250–350 MB (Python ~25–30 MB + wheelhouse ~200–300 MB + dist) | 300 MB – 1 GB+ (polars/pyarrow/fastexcel/reportlab fonts) | ~30–60 MB + wheelhouse | 0.5–1 GB+ image + WSL2 | ~555 MB standalone folder · ~same onefile (measured, incl. polars runtime + pyarrow dylibs + fonts + frontend dist) |
| Admin rights needed | Optional (per-user install) | No | No | Yes (WSL2 one-time) | No |
| Build machine | Any OS (cross-download) | **Windows only** (no cross-compile) | Any OS | Any OS | Native build per platform — macOS/Linux (clang/gcc) or Windows (**VS2022 Build Tools + Python 3.13**); no cross-compile |
| Upgrade path | Swap dist/wheelhouse, re-pip | Rebuild exe on Windows | Rebuild folder | Rebuild + re-export image | Swap `dist/toolhub/` folder or single onefile file; `data\` survives |
| Update effort | Low | Medium (rebuild per release) | Medium | High | Medium (compile ~11 min per release) |
| Failure modes | None serious | Dynamic-import hooks, AV false positives, `_MEI` temp dirs | No pip/venv, `._pth` fragility | WSL2 requirement, license, hardware virtualization | Long compile time; AV flagging (Nuitka project-acknowledged); MSVC required for Windows builds |
| Fit for "normal user, one machine, offline" | **Best** | Possible but overkill here | Poor | Overkill | **Best** — officially Windows-supported native binary; chosen over PEX on 2026-08-01 (§7) |

Detailed analysis for B, C, D, E in §4–§7; the recommended procedure is §3.

---

## 3. Recommended: Prebuilt Frontend + Offline Wheelhouse + python.org Full Installer

### 3.1 Why this is the recommendation

- Works with the existing project layout as-is (backend runs from source with uvicorn; frontend is static `dist`).
- Standard, well-documented tooling on both sides; no code changes, no build tooling on the target machine.
- Every dependency ships a Windows wheel (except `fpdf`, one line to handle, §3.2), so the target machine **never compiles anything**.
- Upgrades and rollback are directory swaps (§8); the SQLite database and artifact folder live outside the app directory and survive upgrades.
- Python itself is installed with the official python.org full installer, which supports silent install and an offline layout mode.

### 3.2 Build machine (any OS with network; Python 3.13 + uv recommended)

All commands below were **live-tested** against PyPI during this research session (2026-07-31).

#### 3.2.1 Generate a Windows-pinned requirements file with uv

```bash
cd <repo>
uv pip compile backend/pyproject.toml \
  --python-platform windows --python-version 3.13 \
  --no-emit-package backend \
  -o requirements-windows.txt
```

Why uv: `--python-platform windows` resolves **environment markers for Windows**, so the file includes Windows-only dependencies such as `win32-setctime==1.2.0` (pulled by loguru). Plain `pip download` on a Linux/macOS host evaluates markers against the *host*, silently skipping `sys_platform == 'win32'` packages. See [uv resolution docs](https://docs.astral.sh/uv/concepts/resolution/) (`--python-platform` re-evaluates markers for the target platform) and [uv pip compile CLI reference](https://docs.astral.sh/uv/reference/cli/#uv-pip-compile).

> Note: uv 0.12.0 (current, 2026-07) has **no `uv pip download` subcommand** — `uv pip` only offers `compile`, `sync`, `install`, `uninstall`, `freeze`, `list`, `show`, `tree`, `check` (verified against local `uv pip --help` and the [uv CLI reference](https://docs.astral.sh/uv/reference/cli/)). Wheel downloading is done with pip (below); `uv pip install --offline` is an alternative to pip on the target machine.

#### 3.2.2 Download Windows wheels with pip

```bash
python -m pip download \
  --only-binary=:all: \
  --platform win_amd64 \
  --python-version 3.13 \
  --implementation cp \
  --abi cp313 --abi abi3 --abi none \
  -d wheelhouse \
  -r requirements-windows.txt
```

Verified behaviors (live-tested: 41 packages, including `polars_runtime_32-1.43.1-cp310-abi3-win_amd64.whl`, `pydantic_core-2.46.4-cp313-cp313-win_amd64.whl`, numpy 2.1.3, pyarrow, fastexcel, bcrypt — all fetched):

- `--platform`/`--python-version`/`--implementation`/`--abi` require `--only-binary=:all:` (source builds cannot be cross-compiled); see [pip download CLI reference](https://pip.pypa.io/en/stable/cli/pip_download/).
- `--abi cp313 --abi abi3 --abi none` is required because pip's `--abi` defaults to the *host* ABI; `abi3` is needed for e.g. `fastexcel` (`cp310-abi3`) and `polars_runtime_32`.
- Pure-Python universal wheels (`py3-none-any`) match automatically.

#### 3.2.3 Handle the one sdist-only package: fpdf

```bash
python -m pip download --only-binary=:all: ... fpdf==1.7.2   # FAILS — verified live
python -m pip wheel --no-deps -w wheelhouse fpdf==1.7.2       # builds a universal wheel
# -> wheelhouse/fpdf-1.7.2-py2.py3-none-any.whl (verified live)
```

`fpdf==1.7.2` publishes no wheel ([PyPI project page](https://pypi.org/project/fpdf/)), so `--only-binary=:all:` cannot fetch it. Building it once on the build machine produces a **platform-independent** wheel (`py2.py3-none-any`) that installs offline on Windows. Do not download the sdist and build on the target — a fresh 3.13 venv has no build backend available offline.

> Simpler alternative: if the build machine is itself a Windows machine, plain `python -m pip wheel -r requirements-windows.txt -w wheelhouse` builds everything (including fpdf) natively with no special flags.

#### 3.2.4 Build the frontend

```bash
cd frontend
bun install --frozen-lockfile   # exact versions from bun.lock; fails on mismatch — [bun docs](https://bun.sh/docs/cli/install)
bun run build                   # emits frontend/dist
```

#### 3.2.5 Assemble the release bundle

```
ToolHub-<version>/
├── backend/                  # backend source
├── frontend/dist/            # built frontend (or a top-level dist/ copy)
├── wheelhouse/               # ~41 .whl files from 3.2.2 + fpdf wheel
├── requirements-windows.txt  # from 3.2.1
├── start-toolhub.bat         # target-machine launcher (see §3.3.5)
├── .env.example / config notes (see §8)
```

Distribute via USB drive / internal file server.

#### 3.2.6 (Optional) Python offline distribution

Two officially documented ways to carry Python itself:

- **Classic full installer (recommended here)** — `python-3.13.x-amd64.exe` is a self-contained installer; `/layout` pre-downloads all components into a local folder that later installs with no network. Silent install options are documented in [Python 3.13 docs — "Installing Without UI"](https://docs.python.org/3.13/using/windows.html#installing-without-ui). (3.13 is the right series: `uv.lock` wheels are `cp313`; numpy<2.2 and friends do not target 3.14.)
- **Python Install Manager offline index (newer 3.14-doc flow)** — `py install --download=<path> 3.13` on the build machine creates an index directory; `py install --source=<path>\index.json 3.13` installs on the target. See [Python 3.14 docs — "Offline installs"](https://docs.python.org/3/using/windows.html#offline-installs).

### 3.3 Target machine (Windows 10/11, no internet)

#### 3.3.1 Install Python (silent, per-user or all-users)

Per-user (no admin) — default when `InstallAllUsers` is omitted:

```bat
python-3.13.x-amd64.exe /quiet Include_test=0 PrependPath=1
```

System-wide (elevated command prompt), documented example pattern:

```bat
python-3.13.x-amd64.exe /quiet InstallAllUsers=1 PrependPath=1 Include_test=0
```

(`x` = the current 3.13 patch release, e.g. `3.13.9`; check [python.org/downloads](https://www.python.org/downloads/windows/))

Options table and `/layout` offline mode: [Python 3.13 docs](https://docs.python.org/3.13/using/windows.html#installing-without-ui). `Include_pip` defaults to 1, which is what we need.

#### 3.3.2 Create a virtual environment

```bat
py -3.13 -m venv D:\ToolHub\venv
D:\ToolHub\venv\Scripts\python.exe -m pip --version
```

venv on Windows places executables under `Scripts\` ([venv docs](https://docs.python.org/3/library/venv.html); [Python on Windows docs](https://docs.python.org/3/using/windows.html#creating-virtual-environments)).

#### 3.3.3 Install dependencies fully offline

```bat
D:\ToolHub\venv\Scripts\python.exe -m pip install --no-index --find-links D:\ToolHub\wheelhouse -r D:\ToolHub\requirements-windows.txt
```

- `--no-index` — "Ignore package index (only looking at --find-links URLs instead)"; `--find-links` — a local directory is scanned for wheels/sdists ([pip install CLI reference](https://pip.pypa.io/en/stable/cli/pip_install/)). With `--no-index` pip never touches the network.
- Alternative: `uv pip install --offline --no-index --find-links D:\ToolHub\wheelhouse -r ...` (uv `--offline` = "Disable network access"; env var `UV_OFFLINE`) if you ship the standalone `uv.exe` ([uv CLI reference](https://docs.astral.sh/uv/reference/cli/), [uv environment variables](https://docs.astral.sh/uv/configuration/environment/)).

#### 3.3.4 Configure environment (see §8 for full checklist)

pydantic-settings **does not read a `.env` file by default** — `env_file` only takes effect when set on `model_config`/`SettingsConfigDict`, and `backend/app/core/config.py` does not set it (verified in [pydantic-settings source](https://github.com/pydantic/pydantic-settings/blob/main/pydantic_settings/main.py) — `env_file` falls back to `model_config.get('env_file')` → `None` — and in the [dotenv docs](https://docs.pydantic.dev/latest/concepts/pydantic_settings/#dotenv-env-support) where loading requires explicit configuration). Therefore use **real Windows environment variables**: set them in the launcher `.bat` (§3.3.5) or in the service configuration (§3.3.6).

#### 3.3.5 Start the backend

`start-toolhub.bat`:

```bat
@echo off
set SECRET_KEY=<generate-a-long-random-string>
set AUTH_COOKIE_SECURE=false
set SQLALCHEMY_DATABASE_URI=sqlite:///D:/ToolHub/data/toolhub.db
set TASK_ARTIFACT_ROOT=D:\ToolHub\data\task-artifacts
cd /d D:\ToolHub\backend
D:\ToolHub\venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- Run with **one worker** (no `--workers`): the asset-comparison job runner is designed for a single uvicorn worker ([backend/README.md](../../backend/README.md)). uvicorn CLI: `uvicorn <app> --host --port` per [uvicorn docs](https://www.uvicorn.org/).
- Absolute SQLite path: the default `sqlite:///./toolhub.db` is relative to the working directory and would land inside `backend\` (or wherever the service runs). Use an absolute path; for Windows paths SQLAlchemy accepts drive letters with double backslashes, `sqlite:///C:\\path\\to\\database.db` ([SQLAlchemy SQLite docs](https://docs.sqlalchemy.org/en/20/dialects/sqlite.html)) — forward slashes (`sqlite:///D:/ToolHub/data/toolhub.db`) also work and avoid escaping issues.
- `TASK_ARTIFACT_ROOT` default is `tempfile.gettempdir()/toolhub-task-artifacts` (≈ `C:\Users\<user>\AppData\Local\Temp\...`); override it to a stable non-temp directory so Windows disk cleanup / service-context differences don't interfere.
- Smoke test: `curl http://127.0.0.1:8000/api/v1/...` (or open the browser once the frontend is hosted, §5).

#### 3.3.6 Allow LAN access through Windows Defender Firewall

Windows shows a firewall prompt the first time uvicorn listens; for unattended setups add a rule (elevated):

```bat
netsh advfirewall firewall add rule name="ToolHub" protocol=TCP dir=in localport=8000 action=allow
```

This is the officially documented `add rule` form (`name=... protocol=TCP dir=in localport=... action=allow`) — [netsh advfirewall reference](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/netsh-advfirewall). PowerShell equivalent: `New-NetFirewallRule` ([Microsoft Learn](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule)).

#### 3.3.7 Auto-start on boot

**Option 1 — NSSM (recommended for reliability: automatic restart on crash)**

```bat
nssm install ToolHub D:\ToolHub\venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
nssm set ToolHub AppDirectory D:\ToolHub\backend
nssm set ToolHub AppEnvironmentExtra SECRET_KEY=... AUTH_COOKIE_SECURE=false SQLALCHEMY_DATABASE_URI=sqlite:///D:/ToolHub/data/toolhub.db TASK_ARTIFACT_ROOT=D:\ToolHub\data\task-artifacts
nssm start ToolHub
```

`nssm install <servicename> <application> [<options>]`, `AppDirectory`, `AppEnvironmentExtra`, and restart-on-exit behavior (`AppExit Default Restart`) are documented at [nssm.cc/usage](https://nssm.cc/usage). NSSM runs the app as a real Windows service; note that the program registered in the services database is nssm.exe itself, so **do not move/delete nssm.exe after installing a service** (same page).

**Option 2 — Task Scheduler (zero extra software; no auto-restart on crash)**

```bat
schtasks /create /tn ToolHub /tr "D:\ToolHub\start-toolhub.bat" /sc onstart /ru SYSTEM /rl HIGHEST
schtasks /run /tn ToolHub
```

`/create /sc onstart|onlogon /tn /tr /ru /rl` syntax and examples: [schtasks create reference](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-create). A scheduled task starts a process but does not restart it if it crashes — hence NSSM is preferred for a service you want to stay up.

---

## 4. Option B — PyInstaller Single-Executable (not recommended here)

Facts (primary sources):

- **No cross-compilation**: "The output of PyInstaller is specific to the active operating system and the active version of Python. … you run PyInstaller on that OS, under that version of Python." — [PyInstaller — What PyInstaller Does](https://pyinstaller.org/en/stable/operating-mode.html). The build therefore needs a Windows machine/CI.
- **Python 3.13 is supported**: current PyInstaller (6.21.0) requires Python `>=3.8,<3.16` ([PyPI](https://pypi.org/project/PyInstaller/)); supported OSes incl. Windows 8+ ([requirements](https://pyinstaller.org/en/stable/requirements.html)).
- **One-file vs one-folder**: one-folder (default) loads directly and allows shipping only an updated exe for code-only changes; one-file extracts to a temp dir (`_MEIxxxxxx_`) at each start ("a little slower to start up"), and the temp dir leaks if the app is killed — [operating-mode docs](https://pyinstaller.org/en/stable/operating-mode.html).
- **Dynamic imports must be declared**: PyInstaller cannot statically see `__import__()` / `importlib.import_module()` / runtime `sys.path` edits; you must use `--hidden-import`, `--collect-all`, spec files, or hooks — [usage docs](https://pyinstaller.org/en/stable/usage.html). uvicorn, passlib, loguru and the Excel/report engines in this stack all import dynamically, so a spec with `--collect-all uvicorn` etc. is required (community-documented practice; not covered in official docs).
- **Antivirus false positives** on packaged executables are a well-known problem tracked by the project's community wiki — [Antivirus-False-Positives (project wiki)](https://github.com/pyinstaller/pyinstaller/wiki/Antivirus-False-Positives); not addressed in the official docs.

Assessment for ToolHub: the payload (polars, pyarrow, fastexcel, numpy, reportlab, fonts) makes a 300 MB–1 GB+ bundle; every release must be rebuilt on Windows; AV flagging is a real support burden for "normal user" targets; SQLite/artifact paths still need configuration, and a service runner (NSSM/schtasks) is still required. Verdict: **viable only if the goal is a zero-Python-install appliance maintained by IT**; for this project the wheelhouse approach is simpler and more maintainable.

---

## 5. Option C — Embeddable Python (not recommended)

Facts (primary sources, [Python 3.14 — "The embeddable package"](https://docs.python.org/3/using/windows.html#the-embeddable-package)):

- The embedded distribution is a ZIP with a minimal Python: "Tcl/tk (including all dependents, such as Idle), **pip and the Python documentation are not included**."
- "**Using pip to manage dependencies as for a regular Python installation is not supported with this distribution**"; third-party packages are expected to be *vendored* next to the interpreter, and a `._pth` file restricts import search paths (environment variables like `PYTHONPATH` are ignored unless `import site` is enabled in `._pth`).
- No venv support; the docs recommend installing it via `py install 3.14-embed --target=<dir>` and treating packages as part of the application.

Assessment: pip can be bootstrapped (get-pip.py, [pip installation docs](https://pip.pypa.io/en/stable/installation/)) and wheels can be dropped into `Lib\site-packages`, but the `._pth`/site machinery is fragile, there is no venv isolation, and the environment is "almost fully isolated from the user's system" by design — appropriate for embedding inside an installer, not for running a service-oriented app that an admin must update. Strictly worse than Option A for maintenance here.

---

## 6. Option D — Docker Desktop Offline (overkill)

Facts (primary sources):

- Image transfer: `docker save -o toolhub.tar toolhub:1.2.0` → copy → `docker load -i toolhub.tar`. Official syntax and examples: [docker image save](https://docs.docker.com/reference/cli/docker/image/save/), [docker image load](https://docs.docker.com/reference/cli/docker/image/load/).
- Docker Desktop on Windows requires WSL 2 (per-user mode) or WSL 2/Hyper-V (all-users), Windows 10/11 Pro-or-Enterprise class editions, 8 GB RAM, hardware virtualization enabled, WSL 2.1.5+ — [Docker Desktop for Windows requirements](https://docs.docker.com/desktop/install/windows-install/). Docker Desktop itself must also be installed offline, and WSL2 needs a distribution image.
- Licensing: Docker Desktop is free only for small businesses (< 250 employees AND < $10M revenue), personal use, education, and non-commercial OSS; otherwise a paid subscription is required — [Docker Desktop license](https://docs.docker.com/subscription/desktop-license/).
- A Linux image with this stack (python:3.13-slim + polars/pyarrow/numpy wheels) is realistically 0.5–1 GB+, and SQLite + `TASK_ARTIFACT_ROOT` must live in a volume to survive container replacement.

Assessment: heaviest footprint and most prerequisites for a single-machine SQLite app whose "server" is a 100 MB process. Only worth it if the organization already standardizes on Docker/WSL2 everywhere, needs byte-identical environments across many machines, or must also run other containerized services on the same box.

---

## 7. Option E — Nuitka standalone/onefile bundle (recommended, since 2026-08-01)

[Nuitka](https://nuitka.net/) **compiles Python source to C and then to native machine code** (linked against an embedded CPython runtime). Standalone mode follows imports and copies the interpreter, extension modules and DLLs into a `.dist` folder; onefile mode adds a bootstrap executable that unpacks to a temp dir at startup. This section replaces the former PEX-based §7 (kept below, marked deprecated): ToolHub switched to Nuitka as its packaging solution on **2026-08-01**, and the former `scripts/build-bundle.sh` / `scripts/build-bundle.bat` were replaced by the cross-platform `scripts/build-bundle.py`.

### 7.1 What this option is

- **standalone** — a self-contained folder `dist/toolhub/` with a native binary (`toolhub.exe` on Windows, `toolhub` on macOS/Linux) plus every dependency, the CPython runtime and the built frontend. Copy the folder to the target machine and run the binary; **no Python install, no venv, no network**.
- **onefile** — a single executable `dist/toolhub-onefile.exe` (Windows) / `dist/toolhub-onefile.bin` (macOS/Linux); a bootstrap unpacks the payload to a temp dir at startup and runs the same standalone bundle from there. Startup is a little slower (unpack each launch) and the temp dir is deleted on clean exit.
- Both embed the frontend `frontend/dist` (see §7.6 for the runtime mount mechanism).

### 7.2 Status & verified behavior (2026-08-01, live-tested)

- Nuitka **4.1.3** on macOS arm64 (clang, CPython 3.13.14): full standalone compile succeeds in **~11 min**, output **~555 MB** (`__main__.bin` 183 MB incl. the polars runtime 183 MB + pyarrow dylibs 90 MB + fonts 35 MB), cold start to serving in **~3.7 s**, full feature pass.
- Windows builds run natively on a Windows machine with **Visual Studio 2022 Build Tools** (MSVC) — Nuitka requires MSVC for CPython 3.13 on Windows; no cross-compilation from macOS.
- **Key gotcha (verified)**: `rustpy-xlsxwriter` reads `importlib.metadata` at import time, so `--include-distribution-metadata=rustpy-xlsxwriter` is **mandatory** — without it the bundle crashes on startup (same failure class as PyInstaller's `--copy-metadata`).
- **Polars optional deps are invisible to Nuitka (user-verified)**: polars loads its Excel reader lazily via `import_optional("fastexcel")` inside `polars/io/spreadsheet/functions.py` (function-level import, engine `"calamine"` — the default for `pl.read_excel`, reading `.xlsx`/`.xlsb`; `.xls` goes through `xlrd`, statically imported by the app). Nuitka 4.1.3 has **no `polars` plugin** (`nuitka/plugins/standard/` — only an implicit `numpy.core.multiarray` rule plus anti-bloat entries for `polars.*` in `standard.nuitka-package.config.yml`, no optional-dependency collection), so `--enable-plugin=polars` does not exist and these deps are never auto-collected. Without `--include-package=fastexcel` the asset-comparison upload fails at runtime with `required package 'fastexcel' not found`. The calamine engine is backed by **fastexcel itself** (Rust bindings) — polars never imports a Python module named `calamine`, so no `--include-package=calamine` is needed. `write_excel`'s lazy `xlsxwriter` is not exercised by the app (exports use `xlsxwriter`/`openpyxl` directly, statically collected).
- **Minimal explicit include set (updated 2026-08-01)**: Nuitka standalone follows static imports, so only five things stay explicit in `scripts/build-bundle.py`: `--include-package=app --include-package-data=app` (the entry is the string form `uvicorn.run("app.main:app")`, imported via `importlib.import_module`, plus app data files `hitokoto.json`/fonts), `--include-data-dir=frontend/dist=frontend/dist`, `--include-package=sqlalchemy.dialects.sqlite` (SQLAlchemy loads dialects lazily via `__import__("sqlalchemy.dialects.<name>")` — invisible to static analysis, no Nuitka built-in rule; without it `create_engine("sqlite:///...")` raises `NoSuchModuleError` at startup), `--include-distribution-metadata=rustpy-xlsxwriter` (importlib.metadata at import time), and `--include-package=fastexcel` (polars' lazy Excel engine, see previous bullet). Everything else (uvicorn/fastapi/starlette/pydantic/anyio/polars/reportlab/xlsxwriter/openpyxl/bcrypt/xlrd/PyPDF2/dateutil/...) is auto-collected — verified 2026-08-01 with a minimal standalone compile (Nuitka 4.1.3, zero include flags): uvicorn's `try/except ImportError` optional-import fallbacks (httptools/uvloop), `importlib.import_module` on compiled modules, and fastapi's optional ujson/orjson all work; anyio's dynamic backend selection (`anyio._backends._asyncio`) and `fastapi.routing` are covered by Nuitka's built-in package config (`standard.nuitka-package.config.yml`).

### 7.3 Build machine & one-command build

The one-command cross-platform way is `scripts/build-bundle.py` (pure Python stdlib, English output, exit codes 0/1/2):

```bash
python scripts/build-bundle.py           # interactive menu (stdin is a TTY)
python scripts/build-bundle.py -y        # non-interactive: build standalone, no menu
python scripts/build-bundle.py -h        # this help
echo "" | python scripts/build-bundle.py # piped stdin (CI): same as -y
```

The menu is a **keyboard checklist** (no numbered input; pure stdlib ANSI, no curses — Windows cmd has no curses): `↑`/`↓` move the highlight, `Space` toggles an item, `Enter` runs **all checked items in menu order**, `q` or Ctrl-C quits. `Build standalone` and `Exit` are checked by default (pressing Enter builds standalone and exits in one step); `standalone` and `onefile` are mutually exclusive (toggling one automatically deselects the other). After the checked actions finish, the menu is redrawn with the selection reset to the default (`standalone` + `exit`). Items: `Build standalone (default)`, `Build onefile`, `Clean build artifacts`, `Show help`, `Exit` (pressing Enter runs checked items in menu order, so `standalone` builds then `Exit` quits; `Show help` prints this help and returns to the menu). Key reading is cross-platform: `termios` cbreak + byte reads on POSIX (arrow keys `ESC [ A`/`ESC [ B`), `msvcrt.getwch()` on Windows (arrows arrive as a `\x00`/`\xe0` prefix + scan code, two calls in `_read_key()`).

The script is idempotent and runs, in order: `uv venv build/venv --python 3.13` → `uv pip install <backend>` + `nuitka` into that venv → `bun install --frozen-lockfile && bun run build` in `frontend/` → the Nuitka compile (`--output-dir build/nuitka-out`, entry `backend/app/__main__.py`, cwd 为仓库根 REPO_ROOT（用户指定）；Nuitka 崩溃报告落仓库根 `nuitka-crash-report.xml`) → artifact install into `dist/` → a file/size/SHA-256 manifest. Standalone output dir is renamed `__main__.dist` → `dist/toolhub/` and the binary inside is renamed to `toolhub(.exe)`; the onefile binary keeps Nuitka's native naming (`toolhub-onefile.exe` on Windows, `toolhub-onefile.bin` elsewhere).

**Build caching** (Nuitka docs: [Tips — Caching compilation results](https://nuitka.net/user-documentation/tips.html)): Nuitka's compile caches are **enabled by default** — a module cache plus ccache object-file cache under the user cache dir (`~/Library/Caches/Nuitka` on macOS, `%LOCALAPPDATA%\Nuitka` on Windows, `~/.cache/Nuitka` on Linux; override with `NUITKA_CACHE_DIR`). ccache is auto-detected on `PATH`; on macOS arm64 / Windows MinGW64 Nuitka can download its own ccache build into that cache dir (verified live: macOS arm64 auto-download, ccache v4.2.1). MSVC builds use the bundled clcache automatically. `build-bundle.py` checks ccache availability, prints the cache dir, and never passes `--no-cache`/`--disable-cache`. Verified incrementally 2026-08-01: full standalone build ~759 s (~12.7 min); a no-code-change rebuild finished in ~333 s with **1780/1780 C files ccache cache hits** — expect later builds to land in the minutes range, not 11+ min.

Prerequisites on the build machine (network needed at build time): `uv`, `bun`, and a C toolchain (Xcode CLT on macOS, **VS2022 Build Tools** on Windows, gcc/clang + `python3-dev` on Linux). `uv venv --python 3.13` downloads a CPython 3.13 for the venv; the same 3.13 is what Nuitka compiles with.

### 7.4 Target machine (no internet — Windows 10/11, macOS, Linux)

Copy `dist/toolhub/` (standalone) or the single onefile binary to the target and run — no Python install, no venv, no network, no first-boot cache. Entry point is `app/__main__.py` (argparse `--host`/`--port`, boots uvicorn on `app.main:app`, single worker by design, §1.1):

```bat
set SECRET_KEY=<generate-a-long-random-string>
set AUTH_COOKIE_SECURE=false
set SQLALCHEMY_DATABASE_URI=sqlite:///D:/ToolHub/data/toolhub.db
set TASK_ARTIFACT_ROOT=D:\ToolHub\data\task-artifacts
D:\ToolHub\toolhub\toolhub.exe
:: bare run — defaults to 0.0.0.0:8000; optional overrides:
::   D:\ToolHub\toolhub\toolhub.exe --host 127.0.0.1 --port 8015
```

macOS/Linux invocation is identical in shape — run the binary directly. Everything else (§3.3.4 env config, §3.3.6 firewall rule, §3.3.7 NSSM/schtasks) applies unchanged; point the service at the binary. **Upgrade**: stop the service, swap the `toolhub/` folder or onefile binary, restart — `data\` lives outside and survives. Rollback = keep the previous artifact.

### 7.5 Assessment

Feasible and **live-verified end to end** (macOS arm64, 2026-08-01): standalone builds, boots in ~3.7 s and serves the frontend from the bundle (§7.6), `/api/*` unaffected. Chosen over PEX because Nuitka is officially supported on Windows (no #2658-class caveats, no PEX_ROOT cache, no AV file-lock/symlink races) and produces a native binary with the source compiled to machine code. Costs vs PEX: larger payload (~555 MB standalone vs ~183 MB scie), Windows needs a VS2022-equipped machine to build, and compile time is ~11 min per build. For a "normal user, one machine, offline" deployment maintained by a small team, official Windows support outweighs those costs — hence the 2026-08-01 switch.

### 7.6 Frontend embedding & runtime mount mechanism

The frontend is embedded with `--include-data-dir=<frontend>/dist=frontend/dist`, so the built files land at `<bundle>/frontend/dist/...` next to the binary. `backend/app/main.py` (comments in Chinese) resolves the dist dir in priority order:

1. **Repo/dev layout**: `Path(__file__).resolve().parents[2] / "frontend" / "dist"` — used when running from source.
2. **Nuitka frozen layout**: `Path(__file__).resolve().parents[1] / "frontend" / "dist"` — used when the dev path does not exist. (After compilation `app/main.py`'s `__file__` is the virtual path `<bundle>/app/main.py`, so `parents[1]` is the bundle dir — verified experimentally.)
3. Neither exists → API-only mode (no mount; `/` returns JSON).

Frozen-mode detection uses Nuitka's injected module-level pseudo-module `__compiled__` (like `__file__`, available in every compiled module):

```python
try:
    __compiled__  # noqa: B018 - Nuitka-injected; NameError under plain CPython
    _NUITKA_FROZEN = True
except NameError:
    _NUITKA_FROZEN = False
```

**Verified layout facts** (mini-experiment, Nuitka 4.1.3): `import __compiled__` does **not** work (ModuleNotFoundError — it is an attribute, not an importable module), `__compiled__.containing_dir` points at the **parent** of the bundle dir (the `.dist` folder's parent, i.e. `--output-dir`), and a package module's `__file__` is `<bundle>/<pkg>/<mod>.py`, so the data path is derived from `__file__`'s `parents[1]` (the bundle dir), not from `containing_dir`. Mounting uses FastAPI's `app.frontend("/", fallback="auto")` — SPA routes fall back to `index.html`, API routes (`/api/v1/*`) take precedence, missing assets 404.

### 7.7 PEX single-file bundle — DEPRECATED (kept for history, 2026-08-01)

> **Deprecated 2026-08-01**: ToolHub switched from PEX to Nuitka (this section's parent). The PEX recipe, scripts (`build-bundle.sh`/`.bat`, now deleted) and runtime facts below are preserved for historical reference only; do not use for new builds. The PEX frontend-extraction code was removed from `backend/app/main.py` in the same change.

### 7.7.1 What this option is

[pex](https://github.com/pex-tool/pex) builds `.pex` files — "self-contained executable Python virtual environments": a carefully constructed zipapp ([PEP 441](https://peps.python.org/pep-0441/)) with a `__main__.py`, the full dependency set embedded as wheels, and a bootstrapper ([What are .pex files?](https://docs.pex-tool.org/whatispex.html)). Deployment is copying one file. Three flavors matter for this project:

- **Traditional zipapp PEX** — a `.pex` run with `python toolhub.pex ...`. The target machine must have a compatible Python (CPython 3.13) installed and discoverable; PEX searches `$PATH` and can be pointed at a specific interpreter with `PEX_PYTHON` ([Building .pex files](https://docs.pex-tool.org/buildingpex.html)).
- **`--rc` native runtime** (Pex ≥ 2.95.0) — injects a native launcher into the PEX; on Windows this adds console/gui `.exe` proxies (`python-proxy-*.exe` / `python-proxyw-*.exe`, verified inside the Windows PEX below), so the PEX runs natively (direct invocation from a `.bat`/service, no `python app.pex`). A compatible Python interpreter is still required on the target ([pex.rc README](https://github.com/pex-tool/pex.rc)).
- **`--scie eager` PEX scie** — a native executable that embeds a full Python distribution (Python Standalone Builds CPython) next to the PEX payload; runs on a machine with **no Python installed at all** ([PEX with included Python interpreter](https://docs.pex-tool.org/scie.html)).

### 7.7.2 Windows support status (the caveat that decides fit)

- Pex does **not officially support Windows**: CHANGES for 2.43.1, 2.44.0 and 2.45.3 all repeat "Windows is still not officially supported!" ([CHANGES.md](https://github.com/pex-tool/pex/blob/main/CHANGES.md)), and the maintainer's tracking issue [#2658 "Windows Support"](https://github.com/pex-tool/pex/issues/2658) is still open (updated 2026-07-19), listing open Windows gaps (path-length limits, symlink/hardlink degradation — symlink creation at first boot needs Developer Mode or an elevated run on the target, §7.4 —, `py --list` interpreter discovery, antivirus file-lock races).
- What *is* supported per the maintainer (2026-05-26 comment in #2658): **building a PEX on Windows is not supported** (may work in some cases); **cross-building a PEX for Windows from another OS or WSL is supported**; **running a cross-built PEX on Windows now works** via the pexrc native runtime.
- All of the above was **live-verified during this session** (2026-07-31, on a macOS build machine): cross-builds for Windows succeed for the full ToolHub dependency set (41 wheels, incl. abi3), with and without `--rc`, and with `--scie eager` (which produces a genuine PE32+ x86-64 Windows executable).

### 7.7.3 Build machine (native build per platform)

The build runs **natively on the machine that will host the artifact** — there is no cross-compilation anymore. On Windows there are two supported ways to run it: the bash script under **Git Bash or WSL**, or the native batch counterpart `scripts\build-bundle.bat` from a plain **cmd.exe** prompt (no Git Bash/WSL needed). On macOS/Linux run `build-bundle.sh` directly. It always builds for the current platform:

- Windows → `dist/toolhub.pex` + `dist/toolhub.exe`; macOS/Linux → `dist/toolhub.pex` + `dist/toolhub` — the scie binary is automatic on all three, named per platform: `.exe` is appended **only on Windows** (a-scie/lift rule). The binary is a native PE32+ (Windows) / Mach-O (macOS) / ELF (Linux) executable with an embedded CPython, so the target needs no Python at all

Prerequisite: `uv tool install pex` (or `pip install pex`); Pex 2.99.0 used here (verified on Python 3.9 and 3.13). The build machine needs network access at build time.

> **Windows build caveat**: pex does **not officially support building on Windows** — per the maintainer in [#2658](https://github.com/pex-tool/pex/issues/2658) (2026-05-26): *"building a PEX on Windows is not supported (may work in some cases)"* (§7.2). The native Windows build below therefore *may* fail; if it does, fall back to **Option A (§3, wheelhouse + python.org installer)**, which uses only officially supported Windows tooling.

The one-command way is `scripts/build-bundle.sh`, which pins the host's requirements, pre-builds the fpdf wheel, stages backend + frontend and builds the native PEX (verified on macOS arm64; on Windows it runs under Git Bash/WSL):

```bash
./scripts/build-bundle.sh                # CURRENT platform:
                                         #   win   -> dist/toolhub.pex + dist/toolhub.exe
                                         #   macos -> dist/toolhub.pex + dist/toolhub
                                         #   linux -> dist/toolhub.pex + dist/toolhub
```

**Windows without Git Bash/WSL** — use the native batch counterpart `scripts\build-bundle.bat`, maintained in lockstep with `build-bundle.sh`: same steps (tool checks → `uv pip compile` → fpdf wheel with skip-if-present → `bun install --frozen-lockfile && bun run build` → stage under `build\pex-web` → PEX → scie), same zip-layout contract (`frontend/dist/` prefix, §7.6), same `__pycache__` cleanup and same artifact names `dist\toolhub.pex` + `dist\toolhub.exe`. It defaults to the full build (equivalent to `build-bundle.sh -y`), is idempotent, and prints the same file/size/SHA-256 manifest via `certutil`. All comments/output are English on purpose — no `chcp`/encoding issues:

```bat
scripts\build-bundle.bat          # full build: dist\toolhub.pex + dist\toolhub.exe
scripts\build-bundle.bat -y       # same as default (build-bundle.sh -y parity)
scripts\build-bundle.bat -h       # this help
```

The `.bat` runs the identical pex commands, so the §7.2 Windows-build caveat applies to it exactly as to the bash script.

Artifact naming: unsuffixed, backward compatible with the pre-`-p` names:

| Invocation | Artifacts in `dist/` |
|---|---|
| on Windows | `toolhub.pex` + `toolhub.exe` (the scie binary — `.exe` is appended only on Windows) |
| on macOS / Linux | `toolhub.pex` + `toolhub` (the scie binary, plain name, no extension) |
- **Build with `-Z deflated`**: Pex 2.99 re-compresses native PEX zip entries with **zstd** (compress method 93) by default, which CPython 3.13's `zipfile` cannot decompress — that breaks the §7.6 frontend extraction (`NotImplementedError`, live-observed). `-Z deflated` keeps the zip readable by the runtime stdlib. A native build could omit it (the PEX runtime reads its own zip), but deflated is kept so the §7.6 extraction and tooling stay stdlib-readable.

Equivalent manual commands (what the script runs, kept for reference; 4b runs on every platform, natively):

```bash
# 1) pinned requirements for the host (no --python-platform: markers resolve for the host OS)
uv pip compile backend/pyproject.toml --python-version 3.13 \
  --no-emit-package backend -o build/requirements.txt

# 2) pre-build the one sdist-only package (fpdf publishes no wheel; same trick as §3.2.3)
mkdir -p build/wheelhouse && python -m pip wheel --no-deps -w build/wheelhouse fpdf==1.7.2

# 3) stage backend source + built frontend so the zip gets a stable layout:
#    zip root will hold app/ (from backend/app) and frontend/dist/ — do NOT
#    -D backend directly, it would embed backend/.venv (~450 MB), toolhub.db
#    and .ruff_cache into the PEX (measured: 264 MB vs 129 MB clean, §7.6).
rm -rf build/pex-web && mkdir -p build/pex-web
cp -R backend/app build/pex-web/app
cp -R frontend/dist build/pex-web/frontend/dist   # requires §3.2.4 (bun run build)

# 4) native app PEX: backend + frontend + app entry point (app/__main__.py → uvicorn) (+ native launcher)
pex -r build/requirements.txt \
    --no-build -f build/wheelhouse -Z deflated \
    -D build/pex-web -m app --rc \
    -o dist/toolhub.pex          # ≈135 MB incl. frontend dist — live-tested

# 4b) zero-Python variant — same command on every platform (native build; run it on the
#     target OS). For a native single-platform build science adds NO platform suffix and
#     appends `.exe` only on Windows: `-o dist/toolhub` yields dist/toolhub.exe on Windows
#     and plain dist/toolhub on macOS/Linux — the output name is final, no renaming.
#     (A name like toolhub-windows-x86_64.exe appears only when cross-building, which the
#     script no longer does.)
pex -r build/requirements.txt \
    --no-build -f build/wheelhouse -Z deflated \
    -D build/pex-web -m app \
    --scie eager -o dist/toolhub   # ≈183 MB: PE32+ (win) / Mach-O (mac) / ELF (linux)

# sanity-check the zip layout (the runtime extraction expects the frontend/dist/ prefix, §7.6):
unzip -l dist/toolhub.pex | grep 'frontend/dist'   # expect ~236 entries (234 files + dirs)
```

Live-verified behaviors and gotchas:

- `--no-build` forbids building sdists; `fpdf` must therefore already exist as a wheel and be reachable via `-f`/`--find-links` (live-tested; pex honors pip-style `-f` + `--no-index`).
- Pick a 3.13 patch that actually exists in [Python Standalone Builds](https://github.com/astral-sh/python-build-standalone) for `--scie` (3.13.12 at research time); an older patch fails the embedded-interpreter download (live-observed).
- All native wheels resolve correctly on the host platform, including abi3 (`fastexcel` cp310-abi3, `polars_runtime_32`, `bcrypt` cp39-abi3) — verified inside the built PEX (Windows wheels, macOS arm64/universal2, Linux manylinux).
- The same recipe on the host (macOS) was smoke-tested end to end with the frontend embedded (§7.6): the `-m app` entry (`app/__main__.py`) boots uvicorn on `app.main:app` from inside the PEX, extracts the embedded `frontend/dist` to the cache dir, serves `GET /` → `index.html`, `GET /assets/*` → 200 (bytes identical to the cache file), `GET /api/v1/users/me` → 401, reuses the cache on restart, and serves everything with `HTTP(S)_PROXY`/`ALL_PROXY` pointed at a dead port (no network at runtime). On macOS the PEX must be run with a Python 3.13 of the same architecture as the bundle (arm64 bundle + arm64 interpreter); a PATH where `python3.13` resolves to an x86_64 build fails with a mach-o "incompatible architecture" ImportError (live-observed on a host with an x86_64 `~/.local/bin/python3.13`). The **scie binary** variant was smoke-tested the same way on macOS arm64 (2026-08-01): `file dist/toolhub` → `Mach-O 64-bit executable arm64`, and `./dist/toolhub app.main:app --host 127.0.0.1 --port 8014` (no `python` prefix) served `GET /` → 200 index.html, `GET /assets/*` → 200, `GET /api/v1/users/me` → 401 from the embedded CPython 3.13.
- **If the native Windows PEX build fails** (pex does not officially support building on Windows, §7.2), fall back to **Option A (§3)** — wheelhouse + python.org installer; the §7.4 target-machine commands are unchanged either way.

### 7.7.4 Target machine (no internet — Windows 10/11, macOS, Linux)

**PEX scie** (the zero-Python binary — `toolhub.exe` on Windows, plain `toolhub` on macOS/Linux): built for **all three platforms** (PE32+ / Mach-O / ELF; the `.exe` extension is appended only on Windows, a-scie/lift rule), so every target gets it. Copy the single file anywhere and run — no Python install, no venv, and (since §7.6) the frontend is embedded too, so this one file is the *entire* application. The entry point is the bundle's `-m app` (`app/__main__.py`), which boots uvicorn on `app.main:app` with a single worker (the asset-comparison job runner is single-worker by design, §1.1/[backend/README.md](../../backend/README.md)); run the binary **bare** (defaults to `0.0.0.0:8000`) or override with `--host`/`--port`:

```bat
set PEX_ROOT=C:\Users\weilee\.pex
set TOOLHUB_FRONTEND_DIST_CACHE=D:\ToolHub\.toolhub-cache\frontend-dist
set SECRET_KEY=<generate-a-long-random-string>
set AUTH_COOKIE_SECURE=false
set SQLALCHEMY_DATABASE_URI=sqlite:///D:/ToolHub/data/toolhub.db
set TASK_ARTIFACT_ROOT=D:\ToolHub\data\task-artifacts
D:\ToolHub\toolhub.exe
:: bare run — defaults to 0.0.0.0:8000; optional overrides:
::   D:\ToolHub\toolhub.exe --host 127.0.0.1 --port 8015
```

On macOS/Linux the invocation is identical in shape — the binary is executed directly (no `python` prefix; the interpreter is embedded in the binary, verified live on macOS arm64):

```bash
./toolhub                          # bare run — defaults to 0.0.0.0:8000
./toolhub --host 127.0.0.1 --port 8015   # optional overrides
```

**Traditional PEX** (`toolhub.pex`): install Python 3.13 first (§3.3.1), then run `D:\ToolHub\venv\Scripts\python.exe D:\ToolHub\toolhub.pex` — bare run with the same defaults (`0.0.0.0:8000`), `--host`/`--port` overrides accepted (with `--rc` the PEX can also be invoked directly, as it finds the interpreter itself). The single file contains backend code, all wheels **and** the frontend — no separate dist delivery (§7.6).

- **Windows runtime prerequisite — symlink creation (Developer Mode)**: on first boot PEX unpacks the zip and `safe_symlink`s the cached bootstrap/wheels into `$PEX_ROOT\unzipped_pexes\...` ([layout.py, v2.99.0](https://github.com/pex-tool/pex/blob/v2.99.0/pex/layout.py)). On Windows, `pex.fs.safe_symlink` is plain `os.symlink` — **pex 2.99.0 has no fallback to copy/hardlink** (that graceful degradation is still an open issue, [#2659](https://github.com/pex-tool/pex/issues/2659)) and **no environment variable disables symlinks** (`PEX_FORCE_LOCAL`/`PEX_UNZIP` are deprecated no-ops — [variables.py, v2.99.0](https://github.com/pex-tool/pex/blob/v2.99.0/pex/variables.py)). A non-elevated normal user therefore dies with `OSError: [WinError 1314] 客户端没有所需的特权` (ERROR_PRIVILEGE_NOT_HELD) unless unprivileged symlink creation is allowed. CPython ≥ 3.8 — the scie embeds 3.13.12 — passes `SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE` ([CPython `win_symlink`](https://github.com/python/cpython/blob/v3.13.0/Modules/posixmodule.c)), so per [CreateSymbolicLinkW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createsymboliclinkw) symlinks work without elevation **once Developer Mode is enabled** (maintainer confirms in [#2659](https://github.com/pex-tool/pex/issues/2659)). Enable it: **Settings → Privacy & security → For developers → Developer Mode → On** (one-time, requires an admin click; on Windows 11 25H2+ it lives under **Settings → System → Advanced → For developers** — [Windows settings for developers](https://learn.microsoft.com/en-us/windows/advanced-settings/developer-mode)). Alternatives: run the exe once from an elevated prompt and then delete the partial `PEX_ROOT` so the cache is rebuilt as the normal user, or grant the user `SeCreateSymbolicLinkPrivilege` (secpol.msc → 本地策略 → 用户权限分配 → 创建符号链接 → add the user).
- **Runtime cache**: PEX unpacks the embedded wheels into `PEX_ROOT` on first boot. The 2.99.0 default is the platform cache dir from pex's vendored appdirs ([cache/root.py, v2.99.0](https://github.com/pex-tool/pex/blob/v2.99.0/pex/cache/root.py)) — on a clean Windows that is `%LOCALAPPDATA%\pex\Cache`, **not** `~/.pex`. A PEX_ROOT like `C:\Users\weilee\Library\Caches\pex` (macOS-shaped) therefore means a `PEX_ROOT` env var or a `.pexrc` (`C:\Users\weilee\.pexrc`, `C:\etc\pexrc`, or `<exe-dir>\.pexrc`) is overriding the default — pex `~`-expands the value, so `~/Library/Caches/pex` becomes exactly that path. Set `PEX_ROOT=C:\Users\weilee\.pex` (or `D:\ToolHub\.pex`) explicitly in the launcher (bat above), remove/override any stale `.pexrc`/env var, and delete the leftover partial cache dir before retrying — important when running as a service (the SYSTEM profile is a poor cache location) and for predictable maintenance (`pex3 cache prune`). First boot extracts ~135 MB and needs write access; the maintainer documents intermittent `WinError 5` file-lock races caused by antivirus scanning that production code must retry ([#2658](https://github.com/pex-tool/pex/issues/2658)) — a low-frequency but real operational hazard to expect. On top of that, the app extracts the embedded `frontend/dist` once to `TOOLHUB_FRONTEND_DIST_CACHE` (default `~/.cache/toolhub/frontend-dist`, i.e. `%USERPROFILE%\.cache\toolhub\frontend-dist`) — set `TOOLHUB_FRONTEND_DIST_CACHE=D:\ToolHub\.toolhub-cache\frontend-dist` for a stable, writable location (note: `PEX_ROOT` is not visible to app code under pex 2.99.0, see §7.6).
- **No network at runtime**: all dependencies are embedded; PEX only unpacks them locally. (`--scie lazy` is the only flavor that downloads an interpreter, and it is not used here.)
- Everything else (§3.3.4 env config, §3.3.6 firewall rule, §3.3.7 NSSM/schtasks) applies unchanged — point the service at `toolhub.exe` or `python.exe toolhub.pex`.
- **Upgrade**: copy the new single file over the old; `data\` lives outside and survives. Rollback = keep the previous file.

### 7.7.5 Assessment

Feasible and **live-verified end to end** — every platform (Windows / macOS / Linux) is built natively on its own OS and ships `toolhub.pex` plus the zero-Python scie binary: `toolhub.exe` on Windows, plain `toolhub` on macOS/Linux (since 2026-08-01 the scie is no longer Windows-only: the macOS arm64 binary was verified live as a Mach-O that serves the app standalone, §7.3/§7.4). Since 2026-07-31 the single file also embeds and serves the frontend (§7.6), so the PEX path needs **no separate dist delivery at all** — no pip, no venv, no wheelhouse, no dist: one file to copy and run, and the scie variant removes even the Python install. Listed as an *alternative* rather than the recommendation because:

- Windows is explicitly **not officially supported** by Pex (open tracking issue [#2658](https://github.com/pex-tool/pex/issues/2658); repeated CHANGES disclaimers), whereas Option A uses only officially supported Windows tooling (python.org installer + pip). For a "normal user, one machine" deployment maintained by a small team, official support is worth a lot.
- `--scie eager` embeds CPython from [Python Standalone Builds](https://github.com/astral-sh/python-build-standalone), not the standard python.org build — a third-party supply chain for the interpreter itself.
- The pexrc native runtime is recent (2025–2026); Windows-specific bugs are still being filed and fixed (e.g. #3216/#3217 scie platform bugs, fixed in 2.98.2).

If a **zero-Python-install appliance** is ever wanted, the PEX scie is the best way to get it (built natively on each platform — Windows/macOS/Linux; PyInstaller cannot cross-compile — §4); otherwise Option A remains the low-risk default and PEX the upgrade-friendly single-file alternative.

### 7.7.6 Frontend embedding (single-file)

Implemented 2026-07-31 in `backend/app/main.py` (code comments in Chinese). The PEX now contains the backend code, all wheels **and** `frontend/dist`, so deployment is exactly one file for the frontend too — no separate dist delivery.

**Runtime mechanism** (why it is needed and how it works):

- Starlette's `StaticFiles`/`FileResponse` need a real OS directory, but inside a PEX the source files live in a zip. The backend therefore *extracts* the embedded dist to a real cache directory at startup and mounts that.
- Detection uses the official PEX mechanism: `os.environ.get("PEX")` is set by the PEX runtime to the absolute path of the running PEX archive ([Recipes — PEX-aware application](https://docs.pex-tool.org/recipes.html)); verified present (pointing at the `.pex` file) inside user code.
- **`PEX_ROOT` is scrubbed** from the environment visible to app code by pex 2.99.0 — verified empirically: of all `PEX_*` vars, only `PEX` survives into user code. So the fallback cache path below is the one that actually applies; `$PEX_ROOT/frontend-dist` is kept for compatibility with other PEX versions.
- Because pex 2.99.0 unzips the whole PEX to `$PEX_ROOT/unzipped_pexes` + `$PEX_ROOT/user_code` (with symlinks) and re-execs, `Path(__file__).resolve()` follows the symlink and the repo-style `parents[2]/frontend/dist` check does **not** match inside a PEX — the extraction path is taken on every first boot (verified even with the unzipped `frontend/` present). The repo/dev layout check runs first and is unchanged when running from source.
- Extraction: open the PEX zip (path from `PEX`), enumerate every member with prefix `frontend/dist/` (no hardcoded filenames — keeps `index.html`, `assets/*`, favicon and future files, preserving directory structure), write to a temp dir in the same parent, then `os.replace()` into place (atomic; a concurrent first boot can never serve a half-written tree). If the cache dir exists and is non-empty, extraction is skipped — restarts reuse the cache.
- Cache location precedence: `TOOLHUB_FRONTEND_DIST_CACHE` > `$PEX_ROOT/frontend-dist` > `~/.cache/toolhub/frontend-dist` (`%USERPROFILE%\.cache\toolhub\frontend-dist` on Windows). Set `TOOLHUB_FRONTEND_DIST_CACHE` explicitly when running as a service (stable, writable, outside temp).
- Failure degrades gracefully: no mount, `/` returns the JSON API response, server still boots (verified with a PEX built without the frontend — it logs `PEX zip 内未找到 frontend/dist/ 前缀的前端文件` once and serves the API only).

**Build** — the §7.3 commands (or `scripts/build-bundle.sh`) already embed the dist via the `build/pex-web` staging; the zip prefix `frontend/dist/` is a contract with `_PEX_FRONTEND_ZIP_PREFIX` in `backend/app/main.py`:

```bash
unzip -l toolhub.pex | grep frontend/dist   # expect 234 files + dirs, e.g. index.html, assets/*, favicon.svg, icons.svg
```

Note: the bundle must be built with `-Z deflated` (§7.3) — a zstd-compressed PEX (pex 2.99 default) raises `NotImplementedError` in CPython 3.13's `zipfile` and the extraction silently degrades to API-only mode (live-observed).

**Live verification 2026-07-31** (host macOS PEX, Pex 2.99.0, port 8010/8012; user's dev server on 8000 untouched):

1. First boot extracts 234 files into the cache dir (`~/.cache/toolhub/frontend-dist` when `TOOLHUB_FRONTEND_DIST_CACHE` is unset).
2. `GET /` → `index.html`; `GET /assets/<real asset>` → 200 with bytes identical to the cache file; `GET /favicon.svg` → 200; browser-style SPA route (`Accept: text/html`) → 200 via `fallback="auto"`.
3. `GET /api/v1/users/me` → 401 — API routing and auth unaffected.
4. Restart with the same `PEX_ROOT`: cache reused, no re-extraction (a marker file placed in the cache survived; boot ~1.4 s vs ~9 s cold).
5. Runtime needs **no network**: restart with `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` set to a dead port served everything normally.
6. Windows build (`toolhub.pex`) inspected via `unzip -l`: Windows wheels (incl. abi3) + `frontend/dist` (236 entries) + `app/` all present. `--scie eager` output is a genuine PE32+ x86-64 console exe whose embedded payload contains `frontend/dist` (236 entries) and all wheels as chroots under `.deps/`.

**Re-verified 2026-08-01** with the build script (§7.3):

- Host (macOS arm64) build `dist/toolhub.pex` (`-Z deflated`): same smoke test passes end to end — `GET /` serves `index.html`, `GET /assets/<real asset>` → 200 (467 KB), `GET /favicon.svg` → 200, `GET /api/v1/users/me` → 401, and the embedded dist is extracted to `TOOLHUB_FRONTEND_DIST_CACHE` on first boot. Run it with an **arm64 Python 3.13** (an x86_64 `python3.13` on PATH fails with a mach-o "incompatible architecture" ImportError).
- Windows build: `toolhub.pex` contains Windows wheels + `frontend/dist` (236 entries); `toolhub.exe` is a PE32+ console x86-64 binary; no `*-windows-x86_64.exe` intermediates remain.
- Host (macOS arm64) scie binary `dist/toolhub` (`--scie eager`): `file` → `Mach-O 64-bit executable arm64`; run directly with **no `python` prefix** — `./dist/toolhub --host 127.0.0.1 --port 8014` — serves `GET /` → 200 `index.html`, `GET /assets/<real asset>` → 200 (467 KB), `GET /api/v1/users/me` → 401. The serving process is the embedded CPython 3.13 (Python Standalone Builds); no system Python is involved.
- The script builds only the current platform (no `-p` / multi-target anymore): Windows → `dist/toolhub.pex` + `dist/toolhub.exe`; macOS/Linux → `dist/toolhub.pex` + `dist/toolhub` — both with the `frontend/dist` prefix (236 entries).

**Gotchas:**

- Never `-D backend` directly for the app PEX — it embeds `backend/.venv` (~450 MB), `backend/toolhub.db` and `.ruff_cache` (measured: 264 MB vs 129 MB clean). Stage `app/` + `frontend/dist` under `build/pex-web` (see §7.3 step 3).
- Native `--scie eager` naming: for a single local target platform science adds **no platform suffix** and appends `.exe` **only on Windows** — `-o toolhub` yields plain `toolhub` on macOS/Linux (Mach-O/ELF) and `toolhub.exe` on Windows (verified on macOS arm64 with pex 2.99.0 / science 0.21.0). The suffixed name `toolhub-windows-x86_64.exe` appears only when **cross-building** (target ≠ host), which the script no longer does. `scripts/build-bundle.sh` keeps the native name as-is (`dist/toolhub.exe` on Windows, `dist/toolhub` on macOS/Linux) — no renaming.
- The dist is extracted to the *cache*, not re-read from the zip per request; a stale cache after an upgrade is harmless because extraction is skipped only when the dir is non-empty — to force a refresh, delete the cache dir (or the whole `TOOLHUB_FRONTEND_DIST_CACHE`) once after upgrading.

---

## 8. Configuration Checklist

All names/defaults repo-verified from `backend/app/core/config.py` and `backend/README.md`; **set them as real environment variables** (pydantic-settings does not auto-read `.env` — §3.3.4).

| Variable | Default | Windows deployment value / note |
|---|---|---|
| `SECRET_KEY` | **hardcoded dev key** | **Must override** with a long random string; used to sign JWTs (`pyjwt`) |
| `ALGORITHM` | `HS256` | leave |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `10080` (7 d) | leave |
| `AUTH_COOKIE_NAME` | `toolhub_session` | leave |
| `AUTH_COOKIE_SECURE` | `false` | keep `false` while serving plain HTTP on LAN (cookie is `HttpOnly` + `SameSite=Strict`); set `true` only if fronted by HTTPS — [backend/README.md](../../backend/README.md) |
| `SQLALCHEMY_DATABASE_URI` | `sqlite:///./toolhub.db` (CWD-relative) | `sqlite:///D:/ToolHub/data/toolhub.db` (absolute; §3.3.5) |
| `TASK_ARTIFACT_ROOT` | `%TEMP%\toolhub-task-artifacts` | `D:\ToolHub\data\task-artifacts` (temp dir is cleaned by Windows and user-dependent) |
| `TASK_ARTIFACT_BLOB_TTL_HOURS` | `168` | leave |
| `TASK_ARTIFACT_BLOB_MAX_DISK_RATIO` | `0.2` | leave |
| `TASK_ARTIFACT_CLEANUP_INTERVAL_HOURS` | `6` | leave |
| `ASSET_COMPARISON_MAX_ACTIVE_JOBS` | `1` | leave (single-worker design) |
| `ASSET_COMPARISON_JOB_TTL_HOURS` | `24` | leave |
| `ASSET_COMPARISON_MAX_STORED_JOBS` | `20` | leave |
| `ASSET_COMPARISON_MAX_STORAGE_BYTES` | `1073741824` (1 GiB) | leave |
| `TOOLHUB_FRONTEND_DIST_CACHE` | `~/.cache/toolhub/frontend-dist` | **Deprecated (PEX-only)**: where the PEX-embedded `frontend/dist` used to be extracted (§7.7.6). Not used by the Nuitka bundle — the frontend is served directly from `<bundle>/frontend/dist` (§7.6) |

Recommended on-disk layout on the target:

```
D:\ToolHub\
├── app-1.2.0\        # backend source + frontend/dist (versioned; swap on upgrade)
├── venv\             # created once; refreshed in place by pip
├── data\             # toolhub.db + task-artifacts  (never touched by upgrades)
├── wheelhouse\       # copied per release
└── requirements-windows.txt
```

---

## 9. Frontend Delivery & Hosting

**Repo-verified: the backend serves `frontend/dist` when the directory exists** — `backend/app/main.py` mounts it with `app.frontend("/", fallback="auto")` (regular repo layout), returns JSON at `/` when it is missing, and since 2026-08-01 also serves it from inside the Nuitka bundle via the frozen-mode path (`<bundle>/frontend/dist`, §7.6).

Because the frontend calls the **relative** path `/api/v1` with credentials (`frontend/src/api/axios.ts`), the cleanest deployment is to serve `dist` **from the same origin** as the backend on port 8000.

Recommended (official FastAPI support, no extra dependencies):

```python
# in backend/app/main.py (implemented; §7.6 adds the Nuitka frozen-mode path)
app.frontend("/", directory=str(Path(__file__).resolve().parents[2] / "frontend" / "dist"))
```

`app.frontend()` is FastAPI's documented way to host a built frontend: it sits on top of `StaticFiles` and adds client-side-routing fallback (`fallback="auto"` serves `index.html` for browser navigations to non-file paths, keeps 404 for missing assets, and API routes take precedence) — [FastAPI — Frontend tutorial](https://fastapi.tiangolo.com/tutorial/frontend/), [Static Files tutorial](https://fastapi.tiangolo.com/tutorial/static-files/). Verified present in the pinned `fastapi>=0.140.0` line: `def frontend(...)` exists in fastapi 0.141.1 ([source, tag 0.141.1](https://github.com/fastapi/fastapi/blob/0.141.1/fastapi/applications.py)).

Fallback (if `app.frontend()` is unavailable): mount `StaticFiles(directory="frontend/dist", html=True)` — `html=True` auto-serves `index.html` for directories ([Starlette StaticFiles](https://www.starlette.io/staticfiles/)) — plus a catch-all GET route returning `index.html` for SPA routes (community-standard pattern; not an official recipe). Alternative without touching the backend: any static file server on the same machine/origin (e.g., IIS, or `python -m http.server` for quick tests — no SPA fallback, so browser refresh on a route 404s; see [Vite — Deploying a Static Site](https://vite.dev/guide/static-deploy), which notes `dist` is deployable to any static host).

---

## 10. Upgrade & Rollback

Assumes the layout in §8 (versioned `app-<version>`, shared `data\`, one venv).

**Upgrade (offline):**

1. On the build machine: `git pull` → repeat §3.2 (`uv pip compile` + `pip download` into a fresh `wheelhouse/`, rebuild `frontend/dist` if the frontend changed, re-handle fpdf).
2. Copy `app-<newversion>\` + new `wheelhouse\` + `requirements-windows.txt` to the target.
3. Stop the service/task (`nssm stop ToolHub` or `schtasks /end /tn ToolHub`).
4. Back up data (§ below).
5. Update dependencies in place: `python -m pip install --no-index --find-links D:\ToolHub\wheelhouse -r D:\ToolHub\requirements-windows.txt` (upgrades only the changed wheels; offline-safe).
6. Point the launcher/service `AppDirectory` to `app-<newversion>` (frontend-only changes need only a `dist` swap).
7. Start and smoke-test.

**Rollback:**

- Keep the previous `app-<version>` directory; flip the service/launcher target back and restart. `data\` is untouched by both operations, so the database and artifacts survive either direction.

**Backup (SQLite):**

- Stop the service, then copy `D:\ToolHub\data\toolhub.db` (single-file database) plus the `task-artifacts` folder. Copying a live SQLite file risks a torn copy; SQLite's own backup API (`VACUUM INTO` / the `sqlite3` backup functions, [sqlite.org/backup.html](https://www.sqlite.org/backup.html)) avoids stopping the service if downtime is undesirable. [INFERENCE: recommended practice — not verified against ToolHub code].

**Version pinning note:** `requirements-windows.txt` pins exact versions (uv compile output) and the wheelhouse is immutable per release — record a release manifest (wheel filenames + SHA-256) so rebuilds are reproducible.

---

## 11. Sources

Official / primary sources verified during this research (2026-07-31):

- pip — Downloading files: https://pip.pypa.io/en/stable/cli/pip_download/ · Install (--no-index, --find-links): https://pip.pypa.io/en/stable/cli/pip_install/ · Bootstrapping (get-pip.py): https://pip.pypa.io/en/stable/installation/
- Python on Windows — 3.13 full installer / Installing Without UI / /layout: https://docs.python.org/3.13/using/windows.html · 3.14 Python install manager + Offline installs: https://docs.python.org/3/using/windows.html#offline-installs · Embeddable package: https://docs.python.org/3/using/windows.html#the-embeddable-package · venv: https://docs.python.org/3/library/venv.html
- uv — CLI reference (pip compile/sync/install, --offline, UV_OFFLINE): https://docs.astral.sh/uv/reference/cli/ · Resolution (--python-platform): https://docs.astral.sh/uv/concepts/resolution/ · pip compatibility (--only-binary/--no-binary): https://docs.astral.sh/uv/pip/compatibility/ · Environment variables: https://docs.astral.sh/uv/configuration/environment/
- PyInstaller — Operating mode (no cross-compile, onefile/onedir): https://pyinstaller.org/en/stable/operating-mode.html · Requirements: https://pyinstaller.org/en/stable/requirements.html · Usage (hidden imports, --collect-all, hooks): https://pyinstaller.org/en/stable/usage.html · Version support: https://pypi.org/project/PyInstaller/ · Antivirus false positives (project wiki): https://github.com/pyinstaller/pyinstaller/wiki/Antivirus-False-Positives
- Docker — image save: https://docs.docker.com/reference/cli/docker/image/save/ · image load: https://docs.docker.com/reference/cli/docker/image/load/ · Desktop for Windows requirements (WSL 2): https://docs.docker.com/desktop/install/windows-install/ · License: https://docs.docker.com/subscription/desktop-license/
- PEX — What are .pex files (zipapp/PEP 441): https://docs.pex-tool.org/whatispex.html · Building .pex files (-f/--find-links, --no-index, --python-shebang): https://docs.pex-tool.org/buildingpex.html · PEX scie (--scie eager/lazy, embedded interpreter): https://docs.pex-tool.org/scie.html · Runtime env vars (PEX_ROOT, PEX_PYTHON): https://docs.pex-tool.org/api/vars.html · Pex repo/README: https://github.com/pex-tool/pex · CHANGES (Windows disclaimers, Python 3.13, --rc): https://github.com/pex-tool/pex/blob/main/CHANGES.md · Windows Support tracking issue #2658: https://github.com/pex-tool/pex/issues/2658 · symlink-degradation issue #2659: https://github.com/pex-tool/pex/issues/2659 · pex 2.99.0 sources — safe_symlink/install logic: https://github.com/pex-tool/pex/blob/v2.99.0/pex/fs/__init__.py · https://github.com/pex-tool/pex/blob/v2.99.0/pex/layout.py · env vars (no symlink knob; PEX_ROOT default): https://github.com/pex-tool/pex/blob/v2.99.0/pex/variables.py · https://github.com/pex-tool/pex/blob/v2.99.0/pex/cache/root.py · pex.rc native runtime: https://github.com/pex-tool/pex.rc · Python Standalone Builds: https://github.com/astral-sh/python-build-standalone
- FastAPI / Starlette — Frontend hosting (app.frontend): https://fastapi.tiangolo.com/tutorial/frontend/ · Static Files: https://fastapi.tiangolo.com/tutorial/static-files/ · app.frontend present in 0.141.1: https://github.com/fastapi/fastapi/blob/0.141.1/fastapi/applications.py · Starlette StaticFiles (html=True): https://www.starlette.io/staticfiles/
- SQLAlchemy — SQLite dialect / Windows paths: https://docs.sqlalchemy.org/en/20/dialects/sqlite.html
- pydantic-settings — Source (env_file default): https://github.com/pydantic/pydantic-settings/blob/main/pydantic_settings/main.py · Dotenv docs: https://docs.pydantic.dev/latest/concepts/pydantic_settings/#dotenv-env-support
- Windows ops — NSSM usage: https://nssm.cc/usage · schtasks create: https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-create · netsh advfirewall: https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/netsh-advfirewall · New-NetFirewallRule: https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule · CreateSymbolicLinkW (SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE requires Developer Mode): https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createsymboliclinkw · Windows settings for developers (Developer Mode): https://learn.microsoft.com/en-us/windows/advanced-settings/developer-mode · CPython os.symlink on Windows (win_symlink passes ALLOW_UNPRIVILEGED_CREATE): https://github.com/python/cpython/blob/v3.13.0/Modules/posixmodule.c
- Others — uvicorn: https://www.uvicorn.org/ · Vite static deploy: https://vite.dev/guide/static-deploy · bun install (--frozen-lockfile): https://bun.sh/docs/cli/install · SQLite backup: https://www.sqlite.org/backup.html · fpdf (sdist-only): https://pypi.org/project/fpdf/
