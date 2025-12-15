from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class PageRecord:
    url: str
    final_url: str
    status_code: int | None
    fetched_at: str
    title: str | None
    text: str
    code_blocks: list[str]
    links: list[str]
    assets: list[str]
    headers: dict[str, str]
    error: str | None = None


@dataclass
class CrawlSummary:
    start_url: str
    out_dir: str
    started_at: str
    finished_at: str
    pages_ok: int = 0
    pages_failed: int = 0
    assets_saved: int = 0
    pages: list[dict[str, Any]] = field(default_factory=list)

    def to_console_string(self) -> str:
        return (
            f"Crawl complete\n"
            f"- start_url: {self.start_url}\n"
            f"- out_dir: {self.out_dir}\n"
            f"- pages_ok: {self.pages_ok}\n"
            f"- pages_failed: {self.pages_failed}\n"
            f"- assets_saved: {self.assets_saved}\n"
            f"- finished_at: {self.finished_at}\n"
        )


@dataclass
class SiteBuildSummary:
    out_dir: str
    site_dir: str
    pages_written: int
    assets_copied: int

    def to_console_string(self) -> str:
        return (
            f"Local site build complete\n"
            f"- out_dir: {self.out_dir}\n"
            f"- site_dir: {self.site_dir}\n"
            f"- pages_written: {self.pages_written}\n"
            f"- assets_copied: {self.assets_copied}\n"
        )


@dataclass
class CompareSummary:
    out_dir: str
    site_dir: str
    pages_compared: int
    pages_with_diffs: int

    def to_console_string(self) -> str:
        return (
            f"Word-by-word comparison complete\n"
            f"- out_dir: {self.out_dir}\n"
            f"- site_dir: {self.site_dir}\n"
            f"- pages_compared: {self.pages_compared}\n"
            f"- pages_with_diffs: {self.pages_with_diffs}\n"
        )


def now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
