#!/usr/bin/env python3
"""ToolHub bundle builder — Nuitka standalone/onefile, cross-platform.

Replaces the former PEX-based scripts/build-bundle.sh / build-bundle.bat
(deprecated 2026-08-01; see docs/research/windows-offline-deployment.md §7).
Built with Python's standard library only; external tools (uv, bun) are
invoked via subprocess. All output is English on purpose (cross-platform
encoding safety).

Prerequisites (build machine, network access required at build time):
  - uv      (environment creation / dependency install)
  - bun     (frontend build)
  - a C compiler toolchain for Nuitka:
      macOS      Xcode command line tools (clang)
      Windows    Visual Studio 2022 Build Tools (MSVC) + Python 3.13
      Linux      gcc/clang + python3-dev

Usage (from the repo root):
  python scripts/build-bundle.py                # interactive menu (stdin is a TTY)
  python scripts/build-bundle.py -y             # non-interactive: build standalone, no menu
  python scripts/build-bundle.py -h             # this help
  echo "" | python scripts/build-bundle.py      # stdin not a TTY (pipe): same as -y

Menu (interactive, stdin is a TTY) - a keyboard checklist, no numbered input:
    [x] Build standalone (default)   checked by default (mutually exclusive with onefile)
    [ ] Build onefile                (mutually exclusive with standalone)
    [ ] Clean artifacts
    [ ] Show help
    [x] Exit                         checked by default
  up/down move - Space toggle - Enter run selected (menu order) - q/Ctrl-C quit
  (the on-screen menu shows up/down arrow + middle-dot glyphs; this help
  text stays ASCII so that piped -h output never hits a narrow legacy codepage)
  After the checked actions finish the menu is redrawn with the selection
  reset to the default (standalone + exit). Non-interactive paths are unchanged:
  -y builds standalone directly and piped stdin (not a TTY) is treated as -y.

Artifacts (land in dist/, gitignored):
  standalone -> dist/toolhub/            (renamed from <nuitka-out>/__main__.dist)
  onefile    -> dist/toolhub-onefile(.exe|.bin)   (Nuitka's native naming)

Caching: Nuitka's compile caches (module cache + ccache object files) are
enabled by default and live under the user cache dir (~/Library/Caches/Nuitka
on macOS, %LOCALAPPDATA%\\Nuitka on Windows, ~/.cache/Nuitka on Linux);
override with NUITKA_CACHE_DIR. ccache is auto-detected on PATH (or Nuitka's
bundled download on macOS arm64 / Windows MinGW64); MSVC builds use the
bundled clcache. First full build ~11 min; later incremental builds reuse
cached modules/objects and finish in seconds-to-minutes. Never pass
--no-cache / --disable-cache.Exit codes: 0 success, 1 build failure, 2 usage error.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import shutil
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

if os.name == "nt":
    import msvcrt  # noqa: F401 — referenced only by _read_key() on Windows
else:
    import select
    import termios
    import tty

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
FRONTEND_DIR = REPO_ROOT / "frontend"
BUILD_DIR = REPO_ROOT / "build"
VENV_DIR = BUILD_DIR / "venv"
NUITKA_OUT = BUILD_DIR / "nuitka-out"
DIST_DIR = REPO_ROOT / "dist"

# The Nuitka binary name follows the entry script name plus the platform
# suffix (.exe on Windows, .bin elsewhere) — verified with Nuitka 4.1.3 on
# macOS arm64 (see OutputDirectories.getResultFullpath).
ENTRY = BACKEND_DIR / "app" / "__main__.py"
ENTRY_BASE = ENTRY.stem

IS_WINDOWS = os.name == "nt"
VENV_PYTHON = (
    VENV_DIR / "Scripts" / "python.exe" if IS_WINDOWS else VENV_DIR / "bin" / "python"
)

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
# - frontend dist: embedded as frontend/dist (see main.py's frozen layout).
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
    "--include-package=app",
    "--include-package-data=app",
    f"--include-data-dir={FRONTEND_DIR / 'dist'}=frontend/dist",
    "--include-distribution-metadata=rustpy-xlsxwriter",
    "--include-package=fastexcel",
]


def log(message: str) -> None:
    print(message, flush=True)


def run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> int:
    """Run a command, stream output, return exit code (or raise on failure)."""
    log(
        f"==> {' '.join(cmd)}"
        if len(cmd) <= 3
        else f"==> {cmd[0]} ... ({len(cmd)} args)"
    )
    try:
        result = subprocess.run(cmd, cwd=cwd, check=False)
    except FileNotFoundError:
        log(f"ERROR: command not found: {cmd[0]}")
        raise SystemExit(1)
    if check and result.returncode != 0:
        log(f"ERROR: command failed with exit code {result.returncode}: {cmd[0]}")
        raise SystemExit(1)
    return result.returncode


# --- Environment preparation (idempotent) ----------------------------------


def ensure_tools() -> None:
    missing = [tool for tool in ("uv", "bun") if shutil.which(tool) is None]
    if missing:
        log(f"ERROR: missing tools: {', '.join(missing)}")
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
    log("==> ccache not found — repeated builds will be slower (full C recompile).")
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


def ensure_venv() -> None:
    """Create build/venv (Python 3.13) and install backend deps + Nuitka."""
    if not VENV_PYTHON.exists():
        log("==> uv venv (build/venv, Python 3.13)")
        run(["uv", "venv", str(VENV_DIR), "--python", "3.13"])
    run(["uv", "pip", "install", "--python", str(VENV_PYTHON), str(BACKEND_DIR)])
    run(["uv", "pip", "install", "--python", str(VENV_PYTHON), "nuitka"])


def build_frontend() -> None:
    """Build the frontend bundle (frontend/dist is required by the data-dir contract)."""
    run(["bun", "install", "--frozen-lockfile"], cwd=FRONTEND_DIR)
    run(["bun", "run", "build"], cwd=FRONTEND_DIR)
    dist = FRONTEND_DIR / "dist"
    if not (dist / "index.html").is_file():
        log(f"ERROR: frontend build produced no {dist / 'index.html'}")
        raise SystemExit(1)


# --- Nuitka build -----------------------------------------------------------


def nuitka_build(mode: str) -> None:
    """mode: 'standalone' or 'onefile'. Outputs into build/nuitka-out."""
    assert mode in ("standalone", "onefile")
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    NUITKA_OUT.mkdir(parents=True, exist_ok=True)
    args = [
        str(VENV_PYTHON),
        "-m",
        "nuitka",
        f"--{mode}",
        *NUITKA_BASE_ARGS,
        f"--output-dir={NUITKA_OUT}",
        str(ENTRY),
    ]
    log(f"==> Nuitka {mode} build (this takes several minutes on first run)")
    # Nuitka 崩溃报告位置无法用 CLI 参数控制（Nuitka 无此专用参数），其在发生未捕获异常时
    # 会将 'nuitka-crash-report.xml' 写入运行时的 cwd。按用户要求，此处 cwd 置于仓库根
    # REPO_ROOT 且不指定 --report 参数。若发生编译崩溃，崩溃报告将落在仓库根目录
    # nuitka-crash-report.xml。
    run(args, cwd=REPO_ROOT)

def _exe_name() -> str:
    return f"{ENTRY_BASE}.exe" if IS_WINDOWS else f"{ENTRY_BASE}.bin"


def install_standalone() -> None:
    """Rename <nuitka-out>/__main__.dist -> dist/toolhub/, and the binary inside
    to toolhub(.exe) so the folder ships a self-explanatory executable name."""
    src = NUITKA_OUT / f"{ENTRY_BASE}.dist"
    if not src.is_dir():
        log(f"ERROR: expected Nuitka output directory not found: {src}")
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
        log(f"ERROR: expected Nuitka onefile binary not found: {src}")
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
    log("=== ToolHub bundle manifest ===")
    for path in paths:
        if path.is_dir():
            size = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
            log(f"{path}  ({human_size(size)} total)")
            for f in sorted(path.rglob("*")):
                if f.is_file():
                    log(f"  {f.relative_to(path)}  ({human_size(f.stat().st_size)})")
        elif path.is_file():
            log(f"{path}  ({human_size(path.stat().st_size)})")
            log(f"  sha256 {sha256_of(path)}")
    log("")
    log("Notes:")
    log(
        "  - standalone: copy dist/toolhub/ to the target machine and run toolhub(.exe)"
    )
    log(
        "  - onefile:    copy the single file and run it; unpacks to a temp dir at startup"
    )
    log(
        "  - The frontend dist is embedded (served from <bundle>/frontend/dist, main.py)."
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
    ensure_ccache()
    log_cache_info()
    ensure_venv()
    build_frontend()
    nuitka_build("standalone")
    install_standalone()
    manifest([DIST_DIR / "toolhub"])
    return 0


def build_onefile() -> int:
    ensure_ccache()
    log_cache_info()
    ensure_venv()
    build_frontend()
    nuitka_build("onefile")
    install_onefile()
    manifest([DIST_DIR / f"toolhub-onefile{Path(_exe_name()).suffix}"])
    return 0


# --- Help & menu ------------------------------------------------------------


def usage() -> None:
    log(__doc__)


MENU_ITEMS: list[tuple[str, str]] = [
    ("standalone", "Build standalone (default)"),
    ("onefile", "Build onefile"),
    ("clean", "Clean build artifacts"),
    ("help", "Show help"),
    ("exit", "Exit"),
]
DEFAULT_SELECTED: frozenset[str] = frozenset(("standalone", "exit"))

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


def _menu_lines(checked: set[str], cursor: int) -> list[str]:
    lines = [
        "  ToolHub Bundle Builder (standalone / onefile mutually exclusive)",
        "  \u2191/\u2193 move \u00b7 Space toggle \u00b7 Enter run selected \u00b7 q quit",
        "",
    ]
    for i, (item_id, label) in enumerate(MENU_ITEMS):
        mark = "[x]" if item_id in checked else "[ ]"
        if i == cursor:
            lines.append(f"\x1b[7m  > {mark} {label}\x1b[0m")  # reverse video
        else:
            lines.append(f"    {mark} {label}")
    return lines


def _render_menu(checked: set[str], cursor: int, move_up: bool) -> None:
    """Draw the menu. With move_up, redraw in place by moving the cursor up
    the menu height first (used for key navigation). The first draw of a
    session prints at the current cursor position instead, so build output
    printed above stays visible when the menu is re-shown after actions.
    """
    lines = _menu_lines(checked, cursor)
    out = [f"\x1b[{len(lines)}A"] if move_up else []
    for line in lines:
        out.append(f"\x1b[2K{line}\n")
    sys.stdout.write("".join(out))
    sys.stdout.flush()


def menu_loop() -> None:
    # The checklist renders ↑/↓/· glyphs. On a real console these are safe
    # (WriteConsoleW / UTF-8), but with stdout redirected to a narrow legacy
    # codepage (e.g. cp1252) they would raise UnicodeEncodeError — degrade
    # to '?' instead of crashing.
    try:
        sys.stdout.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass
    while True:
        checked = set(DEFAULT_SELECTED)
        cursor = 0
        first = True
        with _raw_mode():
            while True:
                try:
                    _render_menu(checked, cursor, move_up=not first)
                    first = False
                    key = _read_key()
                except KeyboardInterrupt:  # Ctrl-C anywhere in the key loop
                    key = "quit"
                if key == "up":
                    cursor = (cursor - 1) % len(MENU_ITEMS)
                elif key == "down":
                    cursor = (cursor + 1) % len(MENU_ITEMS)
                elif key == "space":
                    item_id = MENU_ITEMS[cursor][0]
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
                    log("Bye.")
                    return
                # Unknown keys change nothing; the loop re-renders the same
                # menu (harmless, matches the "redraw after every key" rule).
        # ---- Run every checked item, in menu order (terminal restored) ----
        actions = [item_id for item_id, _label in MENU_ITEMS if item_id in checked]
        if not actions:
            log("Nothing selected — menu reset.")
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
                clean_artifacts()
            elif item_id == "help":
                usage()
            elif item_id == "exit":
                log("Bye.")
                return
        log("")


def main() -> int:
    args = sys.argv[1:]
    run_default = False

    if "--" in args:
        log("ERROR: unknown option '--'")
        return 2
    for arg in args:
        if arg in ("-h", "--help"):
            usage()
            return 0
        if arg in ("-y", "--yes"):
            run_default = True
            continue
        log(f"ERROR: unknown option '{arg}'")
        log("usage: build-bundle.py [-y] [-h]")
        return 2

    # No args on a TTY -> interactive menu; piped stdin (CI) -> default build.
    if not run_default and sys.stdin.isatty():
        menu_loop()
        return 0

    return build_standalone()


if __name__ == "__main__":
    sys.exit(main())
