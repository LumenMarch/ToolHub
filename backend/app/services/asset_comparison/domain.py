from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModuleDefinition:
    key: str
    label: str


class AssetComparisonCancelledError(RuntimeError):
    pass


MODULES = (
    ModuleDefinition("ff", "【财务-财务】"),
    ModuleDefinition("nn", "【Notes-Notes】"),
    ModuleDefinition("sfc", "【SFC-SFC】"),
    ModuleDefinition("cc", "【客户-客户】"),
    ModuleDefinition("fn", "【财务比Notes】"),
    ModuleDefinition("ns", "【Notes比SFC】"),
    ModuleDefinition("cn", "【客户比Notes】"),
)
MODULE_ORDER = [module.key for module in MODULES]
MODULE_BY_KEY = {module.key: module for module in MODULES}

JOB_ACTIVE_STATUSES = {
    "queued",
    "validating",
    "running",
    "finalizing",
    "cancel_requested",
}
JOB_TERMINAL_STATUSES = {"complete", "failed", "cancelled", "expired"}
MODULE_TERMINAL_STATUSES = {"ready", "failed"}
ARTIFACT_TERMINAL_STATUSES = {"ready", "failed", "stale", "expired"}

ALLOWED_JOB_TRANSITIONS = {
    "queued": {"validating", "cancel_requested", "cancelled", "failed", "expired"},
    "validating": {
        "queued",
        "running",
        "cancel_requested",
        "cancelled",
        "failed",
        "expired",
    },
    "running": {
        "queued",
        "base_ready",
        "partial_failed",
        "cancel_requested",
        "cancelled",
        "failed",
        "expired",
    },
    "base_ready": {
        "running",
        "finalizing",
        "complete",
        "cancelled",
        "partial_failed",
        "expired",
    },
    "finalizing": {
        "queued",
        "base_ready",
        "complete",
        "partial_failed",
        "cancel_requested",
        "cancelled",
        "failed",
        "expired",
    },
    "complete": {"base_ready", "partial_failed", "expired"},
    "partial_failed": {"running", "cancelled", "failed", "expired"},
    "failed": {"expired"},
    "cancel_requested": {"cancelled", "expired"},
    "cancelled": {"expired"},
    "expired": set(),
}


def initial_module_results() -> list[dict]:
    return [
        {
            "key": module.key,
            "label": module.label,
            "status": "pending",
            "has_diff": False,
            "msg": "等待核对",
        }
        for module in MODULES
    ]


def normalize_module_results(results: list[dict]) -> list[dict]:
    by_key = {
        result.get("key"): dict(result)
        for result in results
        if result.get("key") in MODULE_BY_KEY
    }
    normalized = []
    for module in MODULES:
        result = by_key.get(module.key)
        if result is None:
            result = initial_module_results()[MODULE_ORDER.index(module.key)]
        else:
            result.setdefault("label", module.label)
            result.setdefault("status", "pending")
            result.setdefault("has_diff", False)
            result.setdefault("msg", "")
        normalized.append(result)
    return normalized


def initial_artifacts() -> dict:
    return {
        **{
            f"module_{module.key}": {
                "status": "blocked",
                "moduleKey": module.key,
            }
            for module in MODULES
        },
        "raw_data_xlsx": {"status": "blocked"},
        "final_bundle": {"status": "blocked"},
    }


def initial_progress() -> dict:
    results = initial_module_results()
    artifacts = initial_artifacts()
    return calculate_progress(
        results,
        artifacts,
        validation_status="pending",
    )


def calculate_progress(
    results: list[dict],
    artifacts: dict,
    *,
    validation_status: str,
) -> dict:
    normalized_results = normalize_module_results(results)
    comparison_statuses = [result["status"] for result in normalized_results]
    module_artifact_statuses = [
        artifacts.get(f"module_{key}", {}).get("status", "blocked")
        for key in MODULE_ORDER
    ]
    raw_artifact = artifacts.get("raw_data_xlsx", {})
    return {
        "validation": {"status": validation_status},
        "comparison": {
            "completed": sum(
                status in MODULE_TERMINAL_STATUSES for status in comparison_statuses
            ),
            "ready": comparison_statuses.count("ready"),
            "failed": comparison_statuses.count("failed"),
            "total": len(MODULE_ORDER),
        },
        "moduleArtifacts": {
            "completed": sum(
                status in ARTIFACT_TERMINAL_STATUSES
                for status in module_artifact_statuses
            ),
            "ready": module_artifact_statuses.count("ready"),
            "failed": module_artifact_statuses.count("failed"),
            "total": len(MODULE_ORDER),
        },
        "rawData": {
            "status": raw_artifact.get("status", "blocked"),
            **({"error": raw_artifact["error"]} if raw_artifact.get("error") else {}),
        },
    }


def derive_job_status(results: list[dict], artifacts: dict) -> str:
    normalized_results = normalize_module_results(results)
    result_statuses = [result["status"] for result in normalized_results]
    artifact_statuses = [
        artifacts.get(f"module_{key}", {}).get("status") for key in MODULE_ORDER
    ]
    artifact_statuses.append(artifacts.get("raw_data_xlsx", {}).get("status"))
    if all(status == "ready" for status in result_statuses) and all(
        status == "ready" for status in artifact_statuses
    ):
        return "base_ready"
    if "failed" in result_statuses or "failed" in artifact_statuses:
        return "partial_failed"
    return "running"


def transition_allowed(current_status: str, next_status: str) -> bool:
    return current_status == next_status or next_status in ALLOWED_JOB_TRANSITIONS.get(
        current_status, set()
    )
