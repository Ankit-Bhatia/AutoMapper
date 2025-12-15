from __future__ import annotations

import difflib
import html
import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

from .models import CompareSummary
from .utils import clean_text, word_tokens, url_to_site_relpath


class SiteComparator:
    """Compare remote-extracted page text to locally mirrored page text."""

    def __init__(self, out_dir: Path, site_dir: Path) -> None:
        self.out_dir = out_dir
        self.site_dir = site_dir
        self.pages_dir = out_dir / "pages"

        self.compare_dir = out_dir / "compare"
        self.compare_dir.mkdir(parents=True, exist_ok=True)

    def compare(self) -> CompareSummary:
        pages = self._load_pages()

        pages_compared = 0
        pages_with_diffs = 0
        per_page: list[dict[str, Any]] = []

        for p in pages:
            url = p.get("final_url") or p.get("url")
            if not url:
                continue

            local_html_path = self.site_dir / url_to_site_relpath(url)
            if not local_html_path.exists():
                continue

            remote_text = p.get("text") or ""
            local_text = self._extract_visible_text(local_html_path.read_text(encoding="utf-8", errors="replace"))

            remote_tokens = word_tokens(remote_text)
            local_tokens = word_tokens(local_text)

            sm = difflib.SequenceMatcher(a=remote_tokens, b=local_tokens)
            opcodes = sm.get_opcodes()

            diffs = [op for op in opcodes if op[0] != "equal"]
            pages_compared += 1
            if diffs:
                pages_with_diffs += 1

            stats = _opcode_stats(opcodes)

            per_page.append(
                {
                    "url": url,
                    "local_path": str(local_html_path.relative_to(self.site_dir)),
                    "remote_words": len(remote_tokens),
                    "local_words": len(local_tokens),
                    "diff_ops": len(diffs),
                    "stats": stats,
                    "diff_preview": _preview_diffs(remote_tokens, local_tokens, diffs, limit=8),
                }
            )

        report = {
            "out_dir": str(self.out_dir),
            "site_dir": str(self.site_dir),
            "pages_compared": pages_compared,
            "pages_with_diffs": pages_with_diffs,
            "pages": per_page,
        }

        (self.compare_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        (self.site_dir / "compare.html").write_text(self._render_html(report), encoding="utf-8")

        return CompareSummary(
            out_dir=str(self.out_dir),
            site_dir=str(self.site_dir),
            pages_compared=pages_compared,
            pages_with_diffs=pages_with_diffs,
        )

    def _load_pages(self) -> list[dict[str, Any]]:
        pages: list[dict[str, Any]] = []
        if not self.pages_dir.exists():
            return pages
        for fp in sorted(self.pages_dir.glob("*.json")):
            pages.append(json.loads(fp.read_text(encoding="utf-8")))
        return pages

    def _extract_visible_text(self, html_text: str) -> str:
        soup = BeautifulSoup(html_text, "lxml")
        for tag in soup(["script", "style", "noscript", "template"]):
            tag.decompose()
        return clean_text(soup.get_text(" ", strip=True))

    def _render_html(self, report: dict[str, Any]) -> str:
        pages = report.get("pages", [])
        pages_sorted = sorted(pages, key=lambda x: (-x.get("diff_ops", 0), x.get("url", "")))

        rows = []
        for p in pages_sorted:
            url = html.escape(p["url"])
            lp = html.escape(p["local_path"])
            diff_ops = int(p.get("diff_ops", 0))
            cls = "ok" if diff_ops == 0 else "diff"
            preview = "".join(
                f"<div class='preview'><code>{html.escape(line)}</code></div>" for line in p.get("diff_preview", [])
            )
            rows.append(
                f"<tr class='{cls}'>"
                f"<td><a href='{lp}' target='_blank' rel='noreferrer'>{lp}</a></td>"
                f"<td><a href='{url}' target='_blank' rel='noreferrer'>{url}</a></td>"
                f"<td>{diff_ops}</td>"
                f"<td>{preview}</td>"
                f"</tr>"
            )

        return (
            "<!doctype html>"
            "<html><head><meta charset='utf-8'/>"
            "<meta name='viewport' content='width=device-width, initial-scale=1'/>"
            "<title>Word-by-word comparison report</title>"
            "<style>"
            "body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial; margin:24px;}"
            "h1{font-size:20px;margin:0 0 8px 0}"
            ".meta{color:#555;margin-bottom:16px}"
            "table{border-collapse:collapse;width:100%;}"
            "th,td{border:1px solid #e5e7eb;padding:8px;vertical-align:top;font-size:13px;}"
            "th{background:#f9fafb;text-align:left;}"
            "tr.ok{background:#f0fdf4}"
            "tr.diff{background:#fff7ed}"
            ".preview{margin-top:4px}"
            "code{background:#111827;color:#f9fafb;padding:2px 6px;border-radius:6px;display:inline-block}"
            "</style></head><body>"
            f"<h1>Word-by-word comparison report</h1>"
            f"<div class='meta'>pages_compared: <b>{report.get('pages_compared')}</b> | pages_with_diffs: <b>{report.get('pages_with_diffs')}</b></div>"
            "<table><thead><tr><th>Local page</th><th>Remote URL</th><th>Diff ops</th><th>Preview</th></tr></thead>"
            f"<tbody>{''.join(rows)}</tbody></table>"
            "</body></html>"
        )


def _opcode_stats(opcodes: list[tuple[str, int, int, int, int]]) -> dict[str, int]:
    stats = {"equal": 0, "replace": 0, "delete": 0, "insert": 0}
    for tag, i1, i2, j1, j2 in opcodes:
        if tag not in stats:
            continue
        if tag == "equal":
            stats[tag] += (i2 - i1)
        elif tag == "replace":
            stats[tag] += max(i2 - i1, j2 - j1)
        else:
            stats[tag] += (i2 - i1) if tag == "delete" else (j2 - j1)
    return stats


def _preview_diffs(
    a: list[str],
    b: list[str],
    diffs: list[tuple[str, int, int, int, int]],
    *,
    limit: int,
) -> list[str]:
    out: list[str] = []
    for tag, i1, i2, j1, j2 in diffs[:limit]:
        left = " ".join(a[i1:i2])
        right = " ".join(b[j1:j2])
        out.append(f"{tag}: REMOTE[{i1}:{i2}]={left} | LOCAL[{j1}:{j2}]={right}")
    return out