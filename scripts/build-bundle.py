#!/usr/bin/env python3
# /// script
# requires-python = ">=3.13"
# dependencies = ["rich>=15.0.0"]
# ///
"""ToolHub bundle builder — Nuitka standalone/onefile, cross-platform.

Replaces the former PEX-based scripts/build-bundle.sh / build-bundle.bat
(deprecated 2026-08-01; see docs/research/windows-offline-deployment.md §7).
Declares its dependency on rich in a PEP 723 inline script metadata block —
`uv run` installs it automatically, no manual pip install. All output is
rendered with rich (rules, panels, tables, a live Nuitka build view); the
keyboard input layer stays on the standard library (termios/msvcrt — rich
has no key-capture support). External tools (uv, bun) are invoked via
subprocess with their output passed through unchanged. All output is
English on purpose (cross-platform encoding safety).

Prerequisites (build machine, network access required at build time):
  - uv      (environment creation / dependency install / script runner)
  - bun     (frontend build)
  - a C compiler toolchain for Nuitka:
      macOS      Xcode command line tools (clang)
      Windows    Visual Studio 2022 Build Tools (MSVC) + Python 3.13
      Linux      gcc/clang + python3-dev

Usage (from the repo root):
  uv run scripts/build-bundle.py                # interactive menu (stdin is a TTY)
  uv run scripts/build-bundle.py -y             # non-interactive: build standalone, no menu
  uv run scripts/build-bundle.py -h             # this help
  uv run scripts/build-bundle.py --arch x86_64  # build for x86_64 (arm64 hosts only)
  echo "" | uv run scripts/build-bundle.py      # stdin not a TTY (pipe): same as -y

Architecture (--arch arm64|x86_64):
  By default the bundle targets the host architecture (platform.machine()
  normalized via _canonical_arch(): arm64/aarch64 -> arm64, x86_64/AMD64 ->
  x86_64) — no --arch behaves exactly as before (build/venv, host arch).
  --arch switches ONLY the Python interpreter architecture: uv fetches a
  CPython 3.13 build for the target platform and Nuitka follows the
  interpreter — no compiler flags, no universal binaries. Cross builds are
  supported only on arm64 hosts (macOS arm64 / Windows ARM64 / Linux arm64);
  on any other host --arch is a usage error (exit 2). Running an x86_64
  interpreter on an arm64 host requires a compatibility layer: Rosetta 2 on
  macOS, the built-in x64 emulation on Windows ARM64, qemu-user + binfmt_misc
  on Linux arm64 — the script executes the created venv's interpreter and
  verifies it reports the requested architecture, failing with exit 1 when it
  cannot run or reports the wrong arch. Cross-arch venvs live in
  build/venv-<arch> (host builds keep build/venv). In the interactive menu an
  arch row ("Arch: arm64  (Space toggles arm64/x86_64)", arm64 hosts only)
  toggles the target between redraws; the arch row is not an action — Space
  on it switches BUILD_ARCH, it never joins the checked set and Enter never
  runs it. After the checked actions finish the selection resets but the
  architecture persists.

Nuitka download confirmation:
  Builds pass Nuitka's --assume-yes-for-downloads for unattended dependency downloads.

Menu (interactive, stdin is a TTY) - a rich-rendered keyboard checklist, no
numbered input; rendered as a Panel (title "ToolHub Bundle Builder") with the
cursor row highlighted and redrawn in place via rich.live.Live:
    [x] Build standalone (default)   checked by default (mutually exclusive with onefile)
    [ ] Build onefile                (mutually exclusive with standalone)
    [ ] Clean artifacts
    [ ] Show help
    [x] Exit                         checked by default
  On arm64 hosts the menu additionally shows an architecture row above the
  action items (not rendered elsewhere):
    Arch: arm64  (Space toggles arm64/x86_64)
  The cursor can land on the arch row; Space on it toggles the target
  architecture (arm64 <-> x86_64). It is NOT an action: it never gets
  checked and Enter never runs it.
  up/down move - Space toggle - Enter run selected (menu order) - q/Ctrl-C quit
  (the on-screen menu shows up/down arrow + middle-dot glyphs; this help
  text stays ASCII so that piped -h output never hits a narrow legacy codepage)
  After the checked actions finish the menu is redrawn with the selection
  reset to the default (standalone + exit); the architecture selected via
  the arch row is kept.
  Non-interactive paths are unchanged: -y builds standalone directly and
  piped stdin (not a TTY) is treated as -y.

Artifacts (land in dist/, gitignored):
  standalone -> dist/toolhub/            (renamed from build/nuitka-out/__main__.dist)
  onefile    -> dist/toolhub-onefile(.exe|.bin)   (Nuitka's native naming)

Caching: Nuitka's compile caches (module cache + ccache object files) are
enabled by default and live under the user cache dir (~/Library/Caches/Nuitka
on macOS, %LOCALAPPDATA%\\Nuitka on Windows, ~/.cache/Nuitka on Linux);
override with NUITKA_CACHE_DIR. ccache is auto-detected on PATH (or Nuitka's
bundled download on macOS arm64 / Windows MinGW64); MSVC builds use the
bundled clcache. First full build ~11 min; later incremental builds reuse
cached modules/objects and finish in seconds-to-minutes. Never pass
--no-cache / --disable-cache.

Exit codes: 0 success, 1 build failure, 2 usage error.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import platform
import re
import shutil
import subprocess
import sys
import threading
import time
from collections import deque
from collections.abc import Callable, Iterator
from pathlib import Path

try:
    from rich.console import Console, Group, RenderableType
    from rich.live import Live
    from rich.markdown import Markdown
    from rich.panel import Panel
    from rich.spinner import Spinner
    from rich.table import Table
    from rich.text import Text
except ImportError:
    print(
        "This script needs the 'rich' library (PEP 723 dependency). "
        "Run with: uv run scripts/build-bundle.py",
        file=sys.stderr,
    )
    raise SystemExit(1)

console = Console()

if os.name == "nt":
    import msvcrt  # noqa: F401 — referenced only by _read_key() on Windows
else:
    import errno
    import fcntl
    import pty
    import select
    import struct
    import termios
    import tty

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
FRONTEND_DIR = REPO_ROOT / "frontend"
BUILD_DIR = REPO_ROOT / "build"
NUITKA_OUT = BUILD_DIR / "nuitka-out"
DIST_DIR = REPO_ROOT / "dist"

# The Nuitka binary name follows the entry script name plus the platform
# suffix (.exe on Windows, .bin elsewhere) — verified with Nuitka 4.1.3 on
# macOS arm64 (see OutputDirectories.getResultFullpath).
ENTRY = BACKEND_DIR / "app" / "__main__.py"
ENTRY_BASE = ENTRY.stem

IS_WINDOWS = os.name == "nt"


def _canonical_arch(machine: str) -> str:
    """Normalize platform.machine() output to 'arm64' | 'x86_64'.

    Real-world values: macOS arm64='arm64' / Intel='x86_64', Windows
    ARM64='ARM64' / x64='AMD64', Linux aarch64='aarch64' / x86_64='x86_64'.
    Any unrecognized value is returned as-is (lowercased); it is never
    'arm64', so ARCH_SUPPORTED stays False and --arch is rejected on it.
    """
    machine = machine.lower()
    if machine in ("arm64", "aarch64"):
        return "arm64"
    if machine in ("x86_64", "amd64"):
        return "x86_64"
    return machine


# Build-target architecture, normalized. HOST_ARCH and ARCH_SUPPORTED are
# fixed per process; BUILD_ARCH is the module-global target, set by --arch
# (main) or by the menu's arch row (Space), defaulting to the host arch.
HOST_ARCH = _canonical_arch(platform.machine())
# Cross builds (--arch, and the menu arch row) are available only on arm64
# hosts: macOS arm64, Windows ARM64, Linux arm64. On every other host the
# option is rejected with a usage error and the menu renders no arch row.
ARCH_SUPPORTED = HOST_ARCH == "arm64"
BUILD_ARCH: str = HOST_ARCH


def venv_dir() -> Path:
    """The venv directory for BUILD_ARCH. Host builds keep the historical
    build/venv; cross builds use build/venv-<arch> so both can coexist."""
    if BUILD_ARCH == HOST_ARCH:
        return BUILD_DIR / "venv"
    return BUILD_DIR / f"venv-{BUILD_ARCH}"


def venv_python() -> Path:
    """The venv interpreter path for BUILD_ARCH (Scripts/python.exe on
    Windows, bin/python elsewhere). Computed per call: BUILD_ARCH can change
    at runtime via the menu arch row."""
    venv = venv_dir()
    return venv / "Scripts" / "python.exe" if IS_WINDOWS else venv / "bin" / "python"


# Minimal Nuitka include set (verified with Nuitka 4.1.3 on macOS arm64,
# CPython 3.13.14). Nuitka standalone follows static imports automatically, so
# the app's whole dependency tree (uvicorn/fastapi/starlette/pydantic/anyio/
# polars/reportlab/xlsxwriter/openpyxl/bcrypt/xlrd/PyPDF2/dateutil/... ) is
# collected without explicit --include-package entries — confirmed with a
# minimal standalone compile (zero include flags): uvicorn's try/except
# optional-import fallbacks (httptools/uvloop), importlib.import_module on
# compiled modules (uvicorn.run("app.main:app")), anyio's dynamic backend
# selection (auto-covered by Nuitka's built-in package config:
# anyio._backends._asyncio, fastapi.routing) and fastapi's optional
# ujson/orjson all work.
#
# Five things MUST stay explicit:
# - app (+ package data): the entry is the string form "app.main:app"
#   (uvicorn imports it via importlib.import_module), and app/ ships data
#   files (hitokoto.json, reportlab fonts) picked up by --include-package-data.
# - frontend dist: embedded as frontend (see main.py's frozen layout).
# - sqlalchemy.dialects.sqlite: SQLAlchemy loads dialects lazily via
#   __import__("sqlalchemy.dialects.<name>") (util.PluginLoader) — Nuitka
#   cannot follow that and has no built-in rule for it; without this,
#   create_engine("sqlite:///...") raises NoSuchModuleError at startup
#   (verified: the dialect package alone is sufficient).
# - rustpy-xlsxwriter distribution metadata: its __init__ calls
#   importlib.metadata at import time; without the metadata the bundle
#   crashes on startup (verified twice, same failure class as PyInstaller's
#   --copy-metadata).
# - fastexcel: polars' Excel reader (pl.read_excel, the default "calamine"
#   engine) loads it lazily via import_optional("fastexcel") inside
#   polars.io.spreadsheet.functions — a function-level import that Nuitka's
#   static analysis cannot see, so polars itself being collected does NOT
#   pull fastexcel in. Without it, reading .xlsx/.xlsb at runtime raises
#   "required package 'fastexcel' not found" (user-verified). --enable-
#   plugin=polars does NOT exist (checked nuitka/plugins/standard/ in Nuitka
#   4.1.3: only implicit numpy.core.multiarray + anti-bloat rules for polars;
#   no optional-dependency collection), so the explicit include is the way.
#   Note: the calamine *engine* is backed by fastexcel itself (Rust bindings);
#   polars never imports a Python module named 'calamine', so no such include
#   is needed. .xls input goes through xlrd, which the app imports statically
#   and Nuitka collects automatically.
NUITKA_BASE_ARGS = [
    "--assume-yes-for-downloads",
    "--include-package=app",
    "--include-package-data=app",
    f"--include-data-dir={FRONTEND_DIR / 'dist'}=frontend",
    "--include-distribution-metadata=rustpy-xlsxwriter",
    "--include-package=fastexcel",
]


def log(message: str) -> None:
    """Print a plain (markup-free) line via the global console."""
    console.print(Text(message))


def log_error(message: str) -> None:
    """Print an error line in red. The canonical error display is the red
    Panel(title="ERROR") printed by run_step / _fail_with_tail; these lines
    carry the detail alongside it."""
    console.print(Text(message, style="red"))


def _cmd_line(cmd: list[str]) -> str:
    return " ".join(cmd) if len(cmd) <= 3 else f"{cmd[0]} ... ({len(cmd)} args)"


def _format_duration(seconds: float) -> str:
    """HH:MM:SS for >=1 h, 'Xm Ys' for >=1 min, 'Xs' otherwise."""
    seconds = int(seconds)
    if seconds >= 3600:
        return f"{seconds // 3600:02d}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"
    if seconds >= 60:
        return f"{seconds // 60}m {seconds % 60}s"
    return f"{seconds}s"


def _error_panel(message: str) -> Panel:
    return Panel(Text(message, style="red"), title="ERROR", border_style="red")


def run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> int:
    """Run a command with inherited stdio (uv/bun keep their own progress
    bars), stream output, return exit code (or raise on failure)."""
    log(f"==> {_cmd_line(cmd)}")
    try:
        result = subprocess.run(cmd, cwd=cwd, check=False)
    except FileNotFoundError:
        log_error(f"ERROR: command not found: {cmd[0]}")
        raise SystemExit(1)
    if check and result.returncode != 0:
        log_error(f"ERROR: command failed with exit code {result.returncode}: {cmd[0]}")
        raise SystemExit(1)
    return result.returncode


@contextlib.contextmanager
def run_step(name: str) -> Iterator[None]:
    """Wrap a build step: rich rule header, elapsed-time tracking, and a
    green '✓ done in …' line on success or a red ERROR panel on failure
    (SystemExit keeps the 0/1/2 exit-code contract)."""
    console.rule(f"[bold]{name}[/bold]")
    start = time.perf_counter()
    try:
        yield
    except BaseException as exc:
        if isinstance(exc, SystemExit):
            code = exc.code if isinstance(exc.code, int) else 1
            console.print(_error_panel(f"Step '{name}' failed (exit code {code})"))
        else:
            console.print(_error_panel(f"Step '{name}' failed: {type(exc).__name__}"))
        raise
    console.print(
        Text(f"✓ done in {_format_duration(time.perf_counter() - start)}", style="green")
    )


# --- Environment preparation (idempotent) ----------------------------------


def ensure_tools() -> None:
    missing = [tool for tool in ("uv", "bun") if shutil.which(tool) is None]
    if missing:
        log_error(f"ERROR: missing tools: {', '.join(missing)}")
        log("  install uv:  https://docs.astral.sh/uv/")
        log("  install bun: https://bun.sh/docs/installation")
        raise SystemExit(1)


def ensure_ccache() -> None:
    """Check the C-compiler object cache that Nuitka uses to speed up repeated
    builds. Nuitka finds ccache automatically when it is on PATH (and on macOS
    arm64 / Windows MinGW64 it can download its own build into its cache dir);
    clcache (MSVC) is bundled and used automatically. We only warn here — the
    build proceeds either way (slower when no cache is available).

    Nuitka docs: https://nuitka.net/user-documentation/tips.html ("Caching
    compilation results" / "Controlling Cache Storage Locations").
    """
    if shutil.which("ccache"):
        log(f"==> ccache found on PATH: {shutil.which('ccache')}")
        return
    # Nuitka's own downloaded ccache (macOS arm64 / Windows MinGW64).
    nuitka_cache = (
        Path(os.environ.get("NUITKA_CACHE_DIR", ""))
        if os.environ.get("NUITKA_CACHE_DIR")
        else None
    )
    if nuitka_cache is None:
        if IS_WINDOWS:
            nuitka_cache = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Nuitka"
        elif sys.platform == "darwin":
            nuitka_cache = Path.home() / "Library" / "Caches" / "Nuitka"
        else:
            nuitka_cache = Path.home() / ".cache" / "Nuitka"
    bundled = (
        sorted((nuitka_cache / "downloads" / "ccache").glob("*/ccache*"))
        if (nuitka_cache / "downloads" / "ccache").is_dir()
        else []
    )
    if bundled:
        log(
            f"==> ccache: using Nuitka-bundled build ({bundled[0].parent.name}); install ccache"
            " on PATH for a shared/global cache"
        )
        return
    console.print(
        Text(
            "==> ccache not found — repeated builds will be slower (full C recompile).",
            style="yellow",
        )
    )
    if sys.platform == "darwin":
        log("    install it with: brew install ccache")
    elif IS_WINDOWS:
        log("    install it with: scoop install ccache  |  choco install ccache")
        log(
            "    (MSVC builds use the bundled clcache automatically and need no ccache)"
        )
    else:
        log("    install it with: sudo apt install ccache  (or your distro's package)")


def log_cache_info() -> None:
    """Print where Nuitka keeps its compile caches (module cache + ccache)."""
    base = os.environ.get("NUITKA_CACHE_DIR")
    if base:
        log(f"==> Nuitka cache dir (from NUITKA_CACHE_DIR): {base}")
    elif IS_WINDOWS:
        log(
            f"==> Nuitka cache dir: {Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'Nuitka'}"
            "  (override with NUITKA_CACHE_DIR)"
        )
    elif sys.platform == "darwin":
        log(
            f"==> Nuitka cache dir: {Path.home() / 'Library' / 'Caches' / 'Nuitka'}"
            "  (override with NUITKA_CACHE_DIR)"
        )
    else:
        log(
            f"==> Nuitka cache dir: {Path.home() / '.cache' / 'Nuitka'}"
            "  (override with NUITKA_CACHE_DIR)"
        )
    log("    Nuitka reuses compiled modules and ccache object files across builds;")
    log("    first build ~11 min, later incremental builds seconds-to-minutes.")


def _uv_python_request() -> str:
    """uv-managed CPython 3.13 request string for a cross-arch BUILD_ARCH.

    uv 0.12.1 request format: <impl>-<version>-<os>-<arch>-<libc>, e.g.
    cpython-3.13.14-macos-x86_64-none (verified live on macOS arm64: the
    venv it produces is a genuine x86_64 Mach-O that reports x86_64). The
    old-style triples (x86_64-apple-darwin, aarch64-unknown-linux-gnu, ...)
    are NOT accepted by uv 0.12.1. Per-OS mapping:
      macOS   macos-aarch64-none / macos-x86_64-none
      Windows windows-aarch64-none / windows-x86_64-none
      Linux   linux-aarch64-gnu / linux-x86_64-gnu
    The Windows arm64 and Linux branches follow the same documented uv
    naming (windows-aarch64-none, linux-*-gnu are present in the uv download
    manifest) but were not executable on this macOS arm64 build host.
    """
    if sys.platform == "darwin":
        os_key, libc = "macos", "none"
    elif IS_WINDOWS:
        os_key, libc = "windows", "none"
    else:
        os_key, libc = "linux", "gnu"
    arch_key = "aarch64" if BUILD_ARCH == "arm64" else "x86_64"
    return f"cpython-3.13.14-{os_key}-{arch_key}-{libc}"


def _cross_arch_hint() -> str:
    """Platform-specific guidance when a cross-arch interpreter cannot run."""
    if sys.platform == "darwin":
        return (
            "On macOS, x86_64 interpreters need Rosetta 2: install it with "
            "'softwareupdate --install-rosetta' (check with 'arch -x86_64 true')."
        )
    if IS_WINDOWS:
        return (
            "On Windows ARM64, x86_64 interpreters run through the built-in "
            "x64 emulation layer (Windows 11 ARM64); if that is disabled the "
            "interpreter cannot start."
        )
    return (
        "On Linux arm64, x86_64 interpreters need qemu-user + binfmt_misc: "
        "install with 'sudo apt install qemu-user binfmt-support'."
    )


def _verify_venv_arch(python: Path) -> None:
    """Execute the venv interpreter and confirm it reports BUILD_ARCH.

    Only cross-arch venvs are checked (a host-arch interpreter obviously
    runs). A failed exec means the host lacks the compatibility layer
    (Rosetta 2 on macOS, Windows ARM64 emulation, qemu/binfmt on Linux
    arm64) — the exact scenario this check exists to surface; a wrong
    reported architecture is equally fatal. Both fail with a red ERROR
    panel and exit 1.
    """
    if BUILD_ARCH == HOST_ARCH:
        return
    try:
        result = subprocess.run(
            [str(python), "-c", "import platform; print(platform.machine())"],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        console.print(
            _error_panel(
                f"Cross-architecture interpreter ({BUILD_ARCH}) failed to run: {exc}\n"
                f"{_cross_arch_hint()}"
            )
        )
        raise SystemExit(1)
    machine = result.stdout.strip()
    if result.returncode != 0 or _canonical_arch(machine) != BUILD_ARCH:
        console.print(
            _error_panel(
                f"Cross-architecture venv interpreter reports '{machine or '(no output)'}', "
                f"expected {BUILD_ARCH}.\n{_cross_arch_hint()}"
            )
        )
        raise SystemExit(1)


def ensure_venv() -> None:
    """Create the build venv (Python 3.13, BUILD_ARCH) and install backend
    deps + Nuitka. Host builds keep the historical `uv venv --python 3.13`
    form into build/venv; cross builds (--arch, arm64 hosts only) use an
    explicit uv-managed CPython request for the target platform into
    build/venv-<arch>. uv auto-downloads a missing managed interpreter, as it
    already does for the host `--python 3.13` form."""
    python = venv_python()
    if not python.exists():
        if BUILD_ARCH == HOST_ARCH:
            log(f"==> uv venv ({venv_dir()}, Python 3.13)")
            run(["uv", "venv", str(venv_dir()), "--python", "3.13"])
        else:
            log(f"==> uv venv ({venv_dir()}, Python 3.13 {BUILD_ARCH})")
            run(["uv", "venv", str(venv_dir()), "--python", _uv_python_request()])
    _verify_venv_arch(python)
    run(["uv", "pip", "install", "--python", str(python), str(BACKEND_DIR)])
    run(["uv", "pip", "install", "--python", str(python), "nuitka"])


def build_frontend() -> None:
    """Build the frontend bundle (frontend/dist is required by the data-dir contract)."""
    run(["bun", "install", "--frozen-lockfile"], cwd=FRONTEND_DIR)
    run(["bun", "run", "build"], cwd=FRONTEND_DIR)
    dist = FRONTEND_DIR / "dist"
    if not (dist / "index.html").is_file():
        log_error(f"ERROR: frontend build produced no {dist / 'index.html'}")
        raise SystemExit(1)


# --- Nuitka build -----------------------------------------------------------

# Escape sequences stripped from child output before it enters the tail:
# OSC (window title, hyperlinks, …), CSI (SGR colors, cursor motion, …),
# and one-character ESC sequences.
_ANSI_ESCAPE_RE = re.compile(
    r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)"  # OSC, terminated by BEL or ST
    r"|\x1b\[[0-9;?]*[A-Za-z]"           # CSI (params + final byte)
    r"|\x1b[=>@-Z\\^_`a-z{|}~]"          # single-char ESC sequences (not [ or ])
)

# Nuitka redraws tqdm-style progress lines with a bare \r, e.g.
# "PASS 1:   0.0%|▏                        | 2/300 modules - zipfile._path".
# The percentage is left-padded to a fixed width ("  0.0%" .. "100.0%")
# and the label before ":" names the progress family — PASS 1, PASS 2,
# C Source Generation, Detecting used DLLs, Copying used DLLs, Backend C.
# The first redraw of a family omits the label and the final redraw is a
# spaces-only clear of the line; both carry no information and are
# skipped. Labeled redraws are collapsed to the newest line per family,
# so e.g. PASS 1 and PASS 2 never overwrite each other in the tail. The
# percent may be truncated when the pty is very narrow (e.g. "  0" with
# no "%" or "|"), so the digit part is tolerant of a missing decimal/%.
_PROGRESS_RE = re.compile(r"^([^:\r\n]+):\s*\d+(?:\.\d+)?%?(?:\||$)")
_UNLABELED_PROGRESS_RE = re.compile(r"^\s*\d+(?:\.\d+)?%?\|")


def _feed_output(
    data: bytes, pending: list[str], tail: deque[str], eof: bool = False
) -> None:
    """Decode one chunk of child output into complete, sanitized lines.

    ANSI escape sequences are stripped and line endings normalized to \n.
    Chunk boundaries can land anywhere — mid-line, inside an escape
    sequence, or between the \r and \n of a CRLF — so incomplete input is
    kept in `pending` until the next chunk completes it; at EOF the
    remainder is emitted as a final (possibly unterminated) line.
    """
    pending.append(data.decode("utf-8", errors="replace"))
    if eof and pending:
        pending.append("\n")  # terminate whatever is still pending
    text = "".join(pending)
    pending.clear()
    text = _ANSI_ESCAPE_RE.sub("", text)
    lines: list[str] = []
    line = ""
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch == "\n":
            lines.append(line)  # blank lines are meaningful
            line = ""
            i += 1
        elif ch == "\r":
            if i + 1 < n and text[i + 1] == "\n":
                i += 2  # CRLF is a single terminator
                lines.append(line)
                line = ""
            elif i + 1 < n:
                i += 1  # bare CR: redraw boundary
                if line:
                    lines.append(line)
                    line = ""
                # A bare CR at the start of a line is a cursor-home no-op
                # (progress redraws usually begin each write this way).
            else:
                # Trailing CR: may be the first half of a CRLF whose LF
                # arrives in the next chunk — keep it with the line.
                line += "\r"
                i += 1
        else:
            line += ch
            i += 1
    if lines:
        last_was_progress = False

        def _emit(line: str) -> None:
            nonlocal last_was_progress
            if _UNLABELED_PROGRESS_RE.match(line):
                # The first redraw of a family omits the label; the
                # labeled redraw that immediately follows carries the
                # same bar, so the unlabeled one is discarded.
                last_was_progress = True
                return
            m = _PROGRESS_RE.match(line)
            if m:
                # Nuitka progress lines are rewritten in place (each \r
                # redraw), so collapse them to the single newest line per
                # family in the tail and trim the trailing
                # "[elapsed<left, rate]it/s]" segment (when present) plus
                # tqdm's end-of-line space padding, which the panel width
                # would truncate.
                line = re.sub(r"\s*\[[^\]]*\]\s*$", "", line).rstrip()
                key = m.group(1)
                for i in range(len(tail) - 1, -1, -1):
                    previous = _PROGRESS_RE.match(tail[i])
                    if previous and previous.group(1) == key:
                        tail[i] = line
                        break
                else:
                    tail.append(line)
                last_was_progress = True
                return
            if not line.strip() and last_was_progress:
                # The final redraw of a family clears the line with a
                # spaces-only write; discard it.
                return
            last_was_progress = False
            tail.append(line)

        for completed in lines:
            _emit(completed)
    if line:
        pending.append(line)


def _run_live(
    cmd: list[str], cwd: Path | None = None, description: str = "command"
) -> None:
    """Run a long command with its output captured into a bounded tail
    buffer and rendered as a rich Live view: spinner + elapsed time + the
    last few output lines inside a Panel, refreshed while the child runs.

    On POSIX the child is attached to a pseudo-terminal, so its output is
    line-buffered and arrives in real time; on Windows the output is
    captured from a pipe (no native pty). Captured output is sanitized
    (ANSI escapes stripped, line endings normalized) before it enters the
    tail. The Live panel is rebuilt from scratch on every refresh — the
    tail and the elapsed time update continuously, not just at exit.

    Non-TTY stdout (CI/pipes) and dumb terminals (TERM=dumb/unknown) skip
    Live entirely: the child inherits stdio and its output passes through
    byte-for-byte. On failure the captured tail is shown in a red ERROR
    panel; Ctrl-C kills the child and aborts with a nonzero exit.
    """
    if not console.is_terminal or console.is_dumb_terminal:
        run(cmd, cwd=cwd)
        return
    log(f"==> {_cmd_line(cmd)}")
    tail: deque[str] = deque(maxlen=12)
    start = time.perf_counter()
    # Created once so its animation frame advances across Live refreshes;
    # a fresh Spinner per refresh would sit frozen on frame 0.
    spinner = Spinner("dots", text="")

    def _view() -> Panel:
        spinner.update(
            text=f"{description} — running for {_format_duration(time.perf_counter() - start)}"
        )
        body: list[RenderableType] = [spinner]
        body.append(Text("\n".join(tail)) if tail else Text("(no output yet)", style="dim"))
        return Panel(Group(*body), title=description, border_style="blue")

    live = Live(_view(), console=console, refresh_per_second=10)
    proc: subprocess.Popen[bytes] | None = None
    master_fd: int | None = None
    try:
        if os.name == "nt":
            proc = subprocess.Popen(
                cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
            )

            def _reader() -> None:
                assert proc is not None and proc.stdout is not None
                pending: list[str] = []
                while True:
                    data = os.read(proc.stdout.fileno(), 65536)
                    if not data:
                        break
                    _feed_output(data, pending, tail)
                _feed_output(b"", pending, tail, eof=True)

        else:
            master_fd, slave_fd = pty.openpty()
            try:
                columns, lines = console.size  # ConsoleDimensions is (width, height)
                fcntl.ioctl(
                    slave_fd,
                    termios.TIOCSWINSZ,
                    struct.pack("HHHH", lines, columns, 0, 0),
                )
                env = None
                term = os.environ.get("TERM")
                if not term or term in ("dumb", "unknown"):
                    env = {**os.environ, "TERM": "xterm-256color"}
                proc = subprocess.Popen(
                    cmd,
                    cwd=cwd,
                    stdin=subprocess.DEVNULL,
                    stdout=slave_fd,
                    stderr=slave_fd,
                    start_new_session=True,
                    close_fds=True,
                    env=env,
                )
            except BaseException:
                os.close(master_fd)
                raise
            finally:
                os.close(slave_fd)

            def _reader() -> None:
                assert proc is not None and master_fd is not None
                pending: list[str] = []
                while True:
                    try:
                        readable, _, _ = select.select([master_fd], [], [], 0.2)
                    except OSError as exc:
                        if exc.errno == errno.EINTR:
                            continue  # transient (e.g. SIGCHLD); retry
                        break  # master closed — nothing more to read
                    except ValueError:
                        break
                    if not readable:
                        continue
                    try:
                        data = os.read(master_fd, 65536)
                    except OSError as exc:
                        if exc.errno in (errno.EIO, errno.EBADF):
                            break  # child exited; the pty master is drained
                        if exc.errno == errno.EINTR:
                            continue
                        raise
                    if not data:
                        break
                    _feed_output(data, pending, tail)
                _feed_output(b"", pending, tail, eof=True)

        reader = threading.Thread(target=_reader, daemon=True)
        reader.start()

        with live:
            try:
                while proc.poll() is None:
                    live.update(_view())
                    time.sleep(0.1)
                returncode = proc.poll()
            except KeyboardInterrupt:
                proc.kill()
                proc.wait()
                live.stop()
                console.print("Aborted", style="bold red")
                raise SystemExit(1)
            reader.join(timeout=10)  # drain whatever is still buffered
            live.update(_view())
    except KeyboardInterrupt:
        # Ctrl-C can land during Popen / Live setup, not just in the loop.
        if proc is not None:
            proc.kill()
            proc.wait()
        if live.is_started:
            live.stop()
        console.print("Aborted", style="bold red")
        raise SystemExit(1)
    if returncode != 0:
        body: list[RenderableType] = [
            Text(f"command failed with exit code {returncode}", style="bold red")
        ]
        if tail:
            body.append(Text(""))
            body.append(Text("\n".join(tail)))
        console.print(Panel(Group(*body), title="ERROR", border_style="red"))
        raise SystemExit(1)
    console.print(
        Text(
            f"✓ {description} done in {_format_duration(time.perf_counter() - start)}",
            style="green",
        )
    )


def nuitka_build(mode: str) -> None:
    """mode: 'standalone' or 'onefile'. Outputs into build/nuitka-out."""
    assert mode in ("standalone", "onefile")
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    NUITKA_OUT.mkdir(parents=True, exist_ok=True)
    args = [
        str(venv_python()),
        "-m",
        "nuitka",
        f"--{mode}",
        *NUITKA_BASE_ARGS,
        f"--output-dir={NUITKA_OUT}",
    ]
    args.append(str(ENTRY))
    log(f"==> Nuitka {mode} build (this takes several minutes on first run)")
    # Nuitka 崩溃报告位置无法用 CLI 参数控制（Nuitka 无此专用参数），其在发生未捕获异常时
    # 会将 'nuitka-crash-report.xml' 写入运行时的 cwd。按用户要求，此处 cwd 置于仓库根
    # REPO_ROOT 且不指定 --report 参数。若发生编译崩溃，崩溃报告将落在仓库根目录
    # nuitka-crash-report.xml。
    _run_live(args, cwd=REPO_ROOT, description=f"Nuitka {mode} build")


def _exe_name() -> str:
    return f"{ENTRY_BASE}.exe" if IS_WINDOWS else f"{ENTRY_BASE}.bin"


def install_standalone() -> None:
    """Rename <nuitka-out>/__main__.dist -> dist/toolhub/, and the binary inside
    to toolhub(.exe) so the folder ships a self-explanatory executable name."""
    src = NUITKA_OUT / f"{ENTRY_BASE}.dist"
    if not src.is_dir():
        log_error(f"ERROR: expected Nuitka output directory not found: {src}")
        log("  (did the standalone build succeed?)")
        raise SystemExit(1)
    target = DIST_DIR / "toolhub"
    if target.exists():
        shutil.rmtree(target)
    shutil.move(str(src), str(target))
    # Nuitka names the binary after the entry script (__main__.bin|.exe); rename
    # it to toolhub(.exe) — verified with Nuitka 4.1.3 (getResultFullpath).
    binary = target / _exe_name()
    if binary.is_file():
        renamed = target / ("toolhub.exe" if IS_WINDOWS else "toolhub")
        if renamed.exists():
            renamed.unlink()
        os.replace(str(binary), str(renamed))
    log(f"==> standalone bundle -> {target}")


def install_onefile() -> None:
    """Move <nuitka-out>/__main__.bin|.exe -> dist/toolhub-onefile(.bin|.exe)."""
    src = NUITKA_OUT / _exe_name()
    if not src.is_file():
        log_error(f"ERROR: expected Nuitka onefile binary not found: {src}")
        log("  (did the onefile build succeed?)")
        raise SystemExit(1)
    target = DIST_DIR / f"toolhub-onefile{src.suffix}"
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        target.unlink()
    shutil.move(str(src), str(target))
    log(f"==> onefile bundle -> {target}")


# --- Manifest ----------------------------------------------------------------


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def human_size(num: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if num < 1024 or unit == "GB":
            return f"{num:.1f} {unit}" if unit != "B" else f"{num} {unit}"
        num /= 1024
    return f"{num:.1f} GB"


def manifest(paths: list[Path]) -> None:
    log("")
    table = Table(show_header=True, header_style="bold")
    table.add_column("Path")
    table.add_column("Size")
    table.add_column("SHA256")
    for path in paths:
        if path.is_dir():
            size = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
            table.add_row(str(path), f"{human_size(size)} total", "")
            for f in sorted(path.rglob("*")):
                if f.is_file():
                    table.add_row(str(f.relative_to(path)), human_size(f.stat().st_size), "")
        elif path.is_file():
            table.add_row(str(path), human_size(path.stat().st_size), sha256_of(path))
    console.print(Panel(table, title="ToolHub bundle manifest"))
    console.print()
    console.print(Text("Notes:", style="bold"))
    console.print(
        Text("  - standalone: copy dist/toolhub/ to the target machine and run toolhub(.exe)")
    )
    console.print(
        Text("  - onefile:    copy the single file and run it; unpacks to a temp dir at startup")
    )
    console.print(
        Text("  - The frontend dist is embedded (served from <bundle>/frontend, main.py).")
    )


# --- Cleanup ----------------------------------------------------------------


def clean_artifacts() -> None:
    log("==> Cleaning build artifacts")
    log(f"    removing: {BUILD_DIR}/  (venv, nuitka-out)")
    log(f"    removing: {DIST_DIR / 'toolhub'}/")
    log(f"    removing: {DIST_DIR / 'toolhub-onefile'}(.exe|.bin)")
    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR, ignore_errors=True)
    for name in (
        "toolhub",
        "toolhub-onefile",
        "toolhub-onefile.exe",
        "toolhub-onefile.bin",
    ):
        candidate = DIST_DIR / name
        if candidate.exists():
            if candidate.is_dir():
                shutil.rmtree(candidate, ignore_errors=True)
            else:
                try:
                    candidate.unlink()
                except OSError:
                    pass
    log("    Done.")


# --- Actions ----------------------------------------------------------------


def build_standalone() -> int:
    log(f"==> target arch: {BUILD_ARCH} (host {HOST_ARCH})")
    with run_step("ensure_ccache"):
        ensure_ccache()
    with run_step("log_cache_info"):
        log_cache_info()
    with run_step("ensure_venv"):
        ensure_venv()
    with run_step("build_frontend"):
        build_frontend()
    with run_step("nuitka_build"):
        nuitka_build("standalone")
    with run_step("install_standalone"):
        install_standalone()
    with run_step("manifest"):
        manifest([DIST_DIR / "toolhub"])
    return 0


def build_onefile() -> int:
    log(f"==> target arch: {BUILD_ARCH} (host {HOST_ARCH})")
    with run_step("ensure_ccache"):
        ensure_ccache()
    with run_step("log_cache_info"):
        log_cache_info()
    with run_step("ensure_venv"):
        ensure_venv()
    with run_step("build_frontend"):
        build_frontend()
    with run_step("nuitka_build"):
        nuitka_build("onefile")
    with run_step("install_onefile"):
        install_onefile()
    with run_step("manifest"):
        manifest([DIST_DIR / f"toolhub-onefile{Path(_exe_name()).suffix}"])
    return 0


# --- Help & menu ------------------------------------------------------------


def usage() -> None:
    console.print(Markdown(__doc__))


MENU_ITEMS: list[tuple[str, str]] = [
    ("standalone", "Build standalone (default)"),
    ("onefile", "Build onefile"),
    ("clean", "Clean build artifacts"),
    ("help", "Show help"),
    ("exit", "Exit"),
]
DEFAULT_SELECTED: frozenset[str] = frozenset(
    ("standalone", "exit")
)

# Arrow-key escape sequences on POSIX terminals (ESC [ A / ESC [ B).
_ESC_KEYS = {b"\x1b[A": "up", b"\x1b[B": "down"}


def _esc_byte_available(timeout: float = 0.05) -> bool:
    """True when another byte of an escape sequence is already queued.
    Distinguishes a bare ESC from the 3-byte arrow-key sequences."""
    return bool(select.select([sys.stdin.fileno()], [], [], timeout)[0])


def _read_key() -> str:
    """Read one keypress and map it to a semantic token.

    Tokens: 'up' / 'down' / 'enter' / 'space' / 'quit'. Any other
    printable key is returned as-is and callers ignore it, so a stray
    keystroke has no side effects. q and Ctrl-C both map to 'quit'.

    POSIX: stdin is in termios cbreak (see _raw_mode) — read one byte at
    a time, no echo; arrow keys arrive as the 3-byte ESC [ A / ESC [ B.
    Windows: msvcrt.getwch(); arrow keys arrive as two calls — a '\x00'
    or '\xe0' prefix followed by the scan code ('H' up, 'P' down).
    """
    if IS_WINDOWS:
        try:
            ch = msvcrt.getwch()
        except KeyboardInterrupt:  # Ctrl-C
            return "quit"
        if ch in ("\x00", "\xe0"):  # extended-key prefix (arrows)
            try:
                ch2 = msvcrt.getwch()
            except KeyboardInterrupt:
                return "quit"
            return {"H": "up", "P": "down"}.get(ch2, "")
        if ch in ("\r", "\n"):
            return "enter"
        if ch == " ":
            return "space"
        if ch in ("q", "Q", "\x03"):
            return "quit"
        return ch

    ch = os.read(sys.stdin.fileno(), 1)
    if ch == b"\x03":  # Ctrl-C delivered as a raw byte (ISIG off terminals)
        return "quit"
    if ch == b"\x1b":  # arrow keys: ESC [ A / ESC [ B
        seq = b"\x1b"
        for _ in range(2):
            if not _esc_byte_available():
                break
            seq += os.read(sys.stdin.fileno(), 1)
        return _ESC_KEYS.get(seq, "")
    if ch in (b"\r", b"\n"):
        return "enter"
    if ch == b" ":
        return "space"
    if ch in (b"q", b"Q"):
        return "quit"
    return ch.decode("utf-8", "replace")


@contextlib.contextmanager
def _raw_mode() -> Iterator[None]:
    """Per-keypress terminal mode for the menu's key loop.

    POSIX: termios cbreak — no echo, no line buffering, but output
    processing (OPOST) stays on so plain \n newlines still render
    correctly, and ISIG stays on so Ctrl-C raises KeyboardInterrupt.
    The previous mode is always restored, including on exceptions.
    Windows: msvcrt.getwch() needs no console mode change.
    """
    if IS_WINDOWS:
        yield
        return
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setcbreak(fd)
        yield
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)


def _menu_panel(checked: set[str], cursor: int) -> Panel:
    """The interactive checklist as a rich Panel; the cursor row is
    highlighted with a reverse-video style.

    On arm64 hosts (ARCH_SUPPORTED) a navigable architecture row is rendered
    above the action items: the cursor can land on it and Space toggles
    BUILD_ARCH (see _toggle_arch), but it is NOT an action — it never joins
    `checked`, so Enter never runs it. When absent, cursor indexing is
    identical to the historical menu (row i <-> MENU_ITEMS[i])."""
    rows: list[RenderableType] = [
        Text("standalone / onefile mutually exclusive", style="dim"),
        Text("↑/↓ move · Space toggle · Enter run selected · q quit", style="dim"),
        Text(""),
    ]
    arch_offset = 1 if ARCH_SUPPORTED else 0
    if ARCH_SUPPORTED:
        style = "bold reverse" if cursor == 0 else ""
        rows.append(
            Text(f"Arch: {BUILD_ARCH}  (Space toggles arm64/x86_64)", style=style)
        )
    for i, (item_id, label) in enumerate(MENU_ITEMS):
        row = i + arch_offset
        mark = "[x]" if item_id in checked else "[ ]"
        prefix = "  > " if cursor == row else "    "
        style = "bold reverse" if cursor == row else ""
        rows.append(Text(f"{prefix}{mark} {label}", style=style))
    return Panel(Group(*rows), title="ToolHub Bundle Builder")


def _toggle_arch() -> None:
    """Flip BUILD_ARCH between arm64 and x86_64 (menu Space on the arch row).

    The module global is reassigned, so the next draw and every subsequent
    build pick up the new target; the toggle persists across menu redraws
    (only the checked selection resets after actions run)."""
    global BUILD_ARCH
    BUILD_ARCH = "x86_64" if BUILD_ARCH == "arm64" else "arm64"


@contextlib.contextmanager
def _menu_live(panel: Callable[[], Panel]) -> Iterator[Callable[[], None]]:
    """Yield a draw callable that renders the current menu in place.

    Uses rich.live.Live when stdout is a real terminal (Live only clears
    its own region, so build output printed earlier stays visible); with a
    non-terminal or dumb terminal (TERM=dumb/unknown) it degrades to a
    plain static print per redraw — rich refuses to render Live there.
    """
    if console.is_terminal and not console.is_dumb_terminal:
        with Live(panel(), console=console, auto_refresh=False) as live:
            def draw() -> None:
                live.update(panel(), refresh=True)
            yield draw
    else:
        def draw() -> None:
            console.print(panel())
        yield draw


def menu_loop() -> None:
    while True:
        checked = set(DEFAULT_SELECTED)
        cursor = 0
        quit_requested = False
        # Cursor navigates every rendered row: on arm64 hosts the arch row
        # (index 0) is first, then the MENU_ITEMS actions — the same
        # arch_offset _menu_panel uses for its cursor mapping.
        row_count = len(MENU_ITEMS) + (1 if ARCH_SUPPORTED else 0)
        with _raw_mode():
            try:
                with _menu_live(lambda: _menu_panel(checked, cursor)) as draw:
                    draw()  # first paint (Live renders on enter; static needs it)
                    while True:
                        try:
                            key = _read_key()
                        except KeyboardInterrupt:  # Ctrl-C anywhere in the key loop
                            key = "quit"
                        if key == "up":
                            cursor = (cursor - 1) % row_count
                        elif key == "down":
                            cursor = (cursor + 1) % row_count
                        elif key == "space":
                            if ARCH_SUPPORTED and cursor == 0:
                                # Arch row: switch the build target. Not an
                                # action — it never enters `checked` — and it
                                # persists across menu redraws (the checked
                                # selection resets after actions run).
                                _toggle_arch()
                            else:
                                item_id = MENU_ITEMS[cursor - (1 if ARCH_SUPPORTED else 0)][0]
                                if item_id in checked:
                                    checked.remove(item_id)
                                else:
                                    checked.add(item_id)
                                    if item_id == "standalone":
                                        checked.discard("onefile")
                                    elif item_id == "onefile":
                                        checked.discard("standalone")
                        elif key == "enter":
                            break
                        elif key == "quit":
                            quit_requested = True
                            break
                        draw()
            except KeyboardInterrupt:  # Ctrl-C outside the key read
                quit_requested = True
        if quit_requested:
            log("Bye.")
            return
        # ---- Run every checked item, in menu order (terminal restored) ----
        actions = [
            item_id
            for item_id, _label in MENU_ITEMS
            if item_id in checked
        ]
        if not actions:
            console.print(Text("Nothing selected — menu reset.", style="yellow"))
            continue
        for item_id in actions:
            if item_id == "standalone":
                try:
                    build_standalone()
                except SystemExit:
                    log("ERROR: build failed — see output above.")
            elif item_id == "onefile":
                try:
                    build_onefile()
                except SystemExit:
                    log("ERROR: build failed — see output above.")
            elif item_id == "clean":
                with run_step("clean_artifacts"):
                    clean_artifacts()
            elif item_id == "help":
                usage()
            elif item_id == "exit":
                log("Bye.")
                return
        log("")


def _usage_error(message: str) -> None:
    console.print(_error_panel(message))
    console.print("usage: build-bundle.py [-y] [--arch arm64|x86_64] [-h]")


def main() -> int:
    global BUILD_ARCH
    args = sys.argv[1:]
    run_default = False
    arch_arg: str | None = None

    if "--" in args:
        _usage_error("unknown option '--'")
        return 2
    i = 0
    while i < len(args):
        arg = args[i]
        if arg in ("-h", "--help"):
            usage()
            return 0
        if arg in ("-y", "--yes"):
            run_default = True
            i += 1
            continue
        if arg == "--arch":
            if i + 1 >= len(args):
                _usage_error("option '--arch' requires a value (arm64 or x86_64)")
                return 2
            arch_arg = args[i + 1]
            i += 2
            continue
        _usage_error(f"unknown option '{arg}'")
        return 2

    if arch_arg is not None:
        if arch_arg not in ("arm64", "x86_64"):
            _usage_error(
                f"invalid --arch value '{arch_arg}' (expected 'arm64' or 'x86_64')"
            )
            return 2
        if not ARCH_SUPPORTED:
            _usage_error(
                f"--arch is only supported on arm64 hosts (this host: {HOST_ARCH})"
            )
            return 2
        BUILD_ARCH = arch_arg

    # No args on a TTY -> interactive menu; piped stdin (CI) -> default build.
    # In menu mode the --arch value is the arch row's initial value (the row
    # is hidden on non-arm64 hosts, where --arch already errored above).
    if not run_default and sys.stdin.isatty():
        menu_loop()
        return 0

    return build_standalone()


if __name__ == "__main__":
    sys.exit(main())
