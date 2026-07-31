from __future__ import annotations

import os
import threading
from concurrent.futures import Future
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
from typing import Any

import polars as pl


@dataclass(frozen=True)
class FileIdentity:
    path: str
    device: int
    inode: int
    size: int
    modified_ns: int


def _file_identity(path: str | os.PathLike[str]) -> FileIdentity:
    resolved = Path(path).resolve(strict=True)
    stat = resolved.stat()
    return FileIdentity(
        path=str(resolved),
        device=stat.st_dev,
        inode=stat.st_ino,
        size=stat.st_size,
        modified_ns=stat.st_mtime_ns,
    )


def _freeze_option(value: Any) -> Any:
    if isinstance(value, dict):
        return tuple(
            sorted((str(key), _freeze_option(item)) for key, item in value.items())
        )
    if isinstance(value, list | tuple):
        return tuple(_freeze_option(item) for item in value)
    if isinstance(value, set):
        return tuple(sorted(_freeze_option(item) for item in value))
    if isinstance(value, Path):
        return str(value)
    try:
        hash(value)
    except TypeError:
        return repr(value)
    return value


class InputCatalog:
    """在单次核对任务内共享不可变输入的读取结果。"""

    def __init__(self, paths: list[str]) -> None:
        self._identities = {
            identity.path: identity
            for path in paths
            if str(path).strip()
            for identity in [_file_identity(path)]
        }
        self._cache: dict[tuple[Any, ...], Future[Any]] = {}
        self._lock = threading.Lock()
        self._hits = 0
        self._misses = 0
        self._excel_hits = 0
        self._excel_misses = 0
        self._text_hits = 0
        self._text_misses = 0
        self._load_seconds = 0.0

    def _identity(self, path: str | os.PathLike[str]) -> FileIdentity:
        identity = _file_identity(path)
        expected = self._identities.get(identity.path)
        if expected is None:
            raise ValueError(f"输入文件不在本次核对目录中: {identity.path}")
        if identity != expected:
            raise RuntimeError(f"核对期间输入文件发生变化: {identity.path}")
        return identity

    def _get_or_load(self, key: tuple[Any, ...], loader, kind: str) -> Any:
        with self._lock:
            future = self._cache.get(key)
            is_owner = future is None
            if is_owner:
                future = Future()
                self._cache[key] = future
                self._misses += 1
                if kind == "excel":
                    self._excel_misses += 1
                else:
                    self._text_misses += 1
            else:
                self._hits += 1
                if kind == "excel":
                    self._excel_hits += 1
                else:
                    self._text_hits += 1

        if is_owner:
            started_at = perf_counter()
            try:
                result = loader()
            except BaseException as exc:
                future.set_exception(exc)
            else:
                future.set_result(result)
            finally:
                with self._lock:
                    self._load_seconds += perf_counter() - started_at

        return future.result()

    def read_excel(
        self,
        path: str | os.PathLike[str],
        **options: Any,
    ) -> pl.DataFrame:
        identity = self._identity(path)
        profile = tuple(
            sorted((name, _freeze_option(value)) for name, value in options.items())
        )
        key = ("polars-excel", identity, profile)

        def load() -> pl.DataFrame:
            frame = pl.read_excel(identity.path, **options)
            if _file_identity(identity.path) != identity:
                raise RuntimeError(f"读取期间输入文件发生变化: {identity.path}")
            return frame

        frame = self._get_or_load(key, load, "excel")
        return frame.clone()

    def read_text(
        self,
        path: str | os.PathLike[str],
        *,
        encoding: str = "utf-8",
        errors: str = "strict",
    ) -> str:
        identity = self._identity(path)
        key = ("text", identity, encoding, errors)

        def load() -> str:
            content = Path(identity.path).read_text(encoding=encoding, errors=errors)
            if _file_identity(identity.path) != identity:
                raise RuntimeError(f"读取期间输入文件发生变化: {identity.path}")
            return content

        return self._get_or_load(key, load, "text")

    def read_text_lines(
        self,
        path: str | os.PathLike[str],
        *,
        encoding: str = "utf-8",
    ) -> list[str]:
        return [
            line.strip()
            for line in self.read_text(path, encoding=encoding).splitlines()
        ]

    def stats(self) -> dict[str, int | float]:
        with self._lock:
            return {
                "input_count": len(self._identities),
                "hits": self._hits,
                "misses": self._misses,
                "excel_hits": self._excel_hits,
                "excel_misses": self._excel_misses,
                "text_hits": self._text_hits,
                "text_misses": self._text_misses,
                "load_seconds": round(self._load_seconds, 6),
            }
