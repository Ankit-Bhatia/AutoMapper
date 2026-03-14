#!/usr/bin/env python3
"""Run Salesforce org-model extraction and convert outputs into AutoMapper catalog format.

This integrates the Codex skill `salesforce-org-model-analyzer` with the
AutoMapper connector catalog expected by `salesforceMockCatalog.ts`.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract Salesforce org metadata and sync it into AutoMapper catalog format."
    )
    parser.add_argument("--target-org", help="Salesforce CLI alias/username used by extractor.")
    parser.add_argument("--instance-url", help="Salesforce instance URL.")
    parser.add_argument("--access-token", help="Salesforce OAuth access token.")
    parser.add_argument("--api-version", help="Salesforce API version (for example 62.0).")
    parser.add_argument("--include", help="Regex include filter for object API names.")
    parser.add_argument("--exclude", help="Regex exclude filter for object API names.")
    parser.add_argument("--max-objects", type=int, help="Limit number of objects after filtering.")
    parser.add_argument("--workers", type=int, default=8, help="Parallel describe workers.")
    parser.add_argument(
        "--infer-external-id-fk",
        action="store_true",
        help="Enable extractor external-id FK inference.",
    )
    parser.add_argument(
        "--out-dir",
        default="output/salesforce-model",
        help="Extractor output directory (default: output/salesforce-model).",
    )
    parser.add_argument(
        "--catalog-out",
        default="backend/data/salesforce-object-reference.json",
        help="AutoMapper Salesforce catalog output path.",
    )
    parser.add_argument(
        "--summary-out",
        default="backend/data/salesforce-model-summary.json",
        help="AutoMapper summary output path.",
    )
    parser.add_argument(
        "--extractor-script",
        help="Path to extract_salesforce_model.py (auto-detected when omitted).",
    )
    parser.add_argument(
        "--skip-extract",
        action="store_true",
        help="Skip extractor run and only convert existing files in --out-dir.",
    )
    return parser.parse_args()


def detect_extractor_script(explicit_path: Optional[str]) -> Path:
    if explicit_path:
        candidate = Path(explicit_path).expanduser().resolve()
        if not candidate.exists():
            raise RuntimeError(f"Extractor script not found at {candidate}")
        return candidate

    candidates: List[Path] = []
    codex_home = os.environ.get("CODEX_HOME")
    if codex_home:
        candidates.append(
            Path(codex_home)
            / "skills"
            / "salesforce-org-model-analyzer"
            / "scripts"
            / "extract_salesforce_model.py"
        )

    candidates.append(
        Path.home()
        / ".codex"
        / "skills"
        / "salesforce-org-model-analyzer"
        / "scripts"
        / "extract_salesforce_model.py"
    )

    for candidate in candidates:
        resolved = candidate.expanduser().resolve()
        if resolved.exists():
            return resolved

    raise RuntimeError(
        "Could not locate extract_salesforce_model.py. "
        "Pass --extractor-script or install the salesforce-org-model-analyzer skill."
    )


def run_extractor(script_path: Path, args: argparse.Namespace, out_dir: Path) -> None:
    cmd = [sys.executable, str(script_path), "--out-dir", str(out_dir)]

    passthrough: Dict[str, Any] = {
        "--target-org": args.target_org,
        "--instance-url": args.instance_url,
        "--access-token": args.access_token,
        "--api-version": args.api_version,
        "--include": args.include,
        "--exclude": args.exclude,
        "--max-objects": args.max_objects,
        "--workers": args.workers,
    }

    for flag, value in passthrough.items():
        if value is None:
            continue
        cmd.extend([flag, str(value)])

    if args.infer_external_id_fk:
        cmd.append("--infer-external-id-fk")

    print(f"[salesforce-model] Running extractor: {' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"Extractor failed with exit code {result.returncode}")


def parse_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    return text in {"1", "true", "yes", "y"}


def build_field_properties(row: Dict[str, Any]) -> List[str]:
    properties: List[str] = []
    is_required = parse_bool(row.get("is_required"))
    if not is_required:
        properties.append("Nillable")
    if parse_bool(row.get("is_external_id")):
        properties.append("External ID")
    if parse_bool(row.get("is_unique")):
        properties.append("Unique")
    if parse_bool(row.get("is_calculated")):
        properties.append("Calculated")
    if parse_bool(row.get("is_reference")):
        properties.append("Reference")
    if parse_bool(row.get("is_custom_field")):
        properties.append("Custom")
    if parse_bool(row.get("is_audit_field")):
        properties.append("Audit")
    return properties


def split_reference_targets(raw: Any) -> List[str]:
    value = str(raw or "").strip()
    if not value:
        return []
    return [chunk for chunk in value.split("|") if chunk]


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_rows(path: Path) -> List[Dict[str, Any]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        return list(reader)


def convert_catalog(out_dir: Path, catalog_out: Path, summary_out: Path) -> None:
    summary_path = out_dir / "metadata-summary.json"
    object_catalog_path = out_dir / "object-catalog.json"
    field_catalog_path = out_dir / "field-catalog.csv"

    if not summary_path.exists():
        raise RuntimeError(f"Missing extractor output: {summary_path}")
    if not object_catalog_path.exists():
        raise RuntimeError(f"Missing extractor output: {object_catalog_path}")
    if not field_catalog_path.exists():
        raise RuntimeError(f"Missing extractor output: {field_catalog_path}")

    summary = load_json(summary_path)
    object_catalog = load_json(object_catalog_path)
    field_rows = load_rows(field_catalog_path)

    label_by_object = {
        str(row.get("name", "")): str(row.get("label", ""))
        for row in object_catalog
        if isinstance(row, dict)
    }

    fields_by_object: Dict[str, List[Dict[str, Any]]] = {}
    for row in field_rows:
        object_name = str(row.get("object_name", "")).strip()
        field_name = str(row.get("field_name", "")).strip()
        if not object_name or not field_name:
            continue

        entry = {
            "name": field_name,
            "type": str(row.get("field_type", "string") or "string"),
            "properties": build_field_properties(row),
            "description": str(row.get("field_label", "") or ""),
            "relationshipName": "",
            "refersTo": split_reference_targets(row.get("reference_targets")),
        }
        bucket = fields_by_object.setdefault(object_name, [])
        bucket.append(entry)

    objects_payload = []
    for object_name in sorted(fields_by_object.keys()):
        object_fields = sorted(fields_by_object[object_name], key=lambda field: str(field.get("name", "")))
        title = label_by_object.get(object_name) or object_name
        objects_payload.append(
            {
                "name": object_name,
                "href": "",
                "title": title,
                "fieldCount": len(object_fields),
                "fields": object_fields,
            }
        )

    normalized_payload = {
        "source": "salesforce-org-model-analyzer",
        "fetchedAt": summary.get("generated_at_utc")
        or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "docId": "salesforce-org-model",
        "deliverable": "object-catalog+field-catalog",
        "locale": "en-us",
        "docVersion": f"v{summary.get('api_version', '')}",
        "versionText": f"Salesforce API {summary.get('api_version', 'unknown')}",
        "instanceUrl": summary.get("instance_url"),
        "objectCount": len(objects_payload),
        "objects": objects_payload,
    }

    catalog_out.parent.mkdir(parents=True, exist_ok=True)
    summary_out.parent.mkdir(parents=True, exist_ok=True)
    catalog_out.write_text(json.dumps(normalized_payload, indent=2) + "\n", encoding="utf-8")
    summary_out.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    print(f"[salesforce-model] Wrote normalized catalog: {catalog_out}")
    print(f"[salesforce-model] Wrote summary: {summary_out}")
    print(
        f"[salesforce-model] Objects: {len(objects_payload)}, "
        f"Fields: {sum(len(obj['fields']) for obj in objects_payload)}"
    )


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    catalog_out = Path(args.catalog_out).resolve()
    summary_out = Path(args.summary_out).resolve()

    try:
        if not args.skip_extract:
            script_path = detect_extractor_script(args.extractor_script)
            run_extractor(script_path, args, out_dir)

        convert_catalog(out_dir, catalog_out, summary_out)
        return 0
    except Exception as exc:  # pragma: no cover - operational wrapper
        print(f"[salesforce-model] ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
