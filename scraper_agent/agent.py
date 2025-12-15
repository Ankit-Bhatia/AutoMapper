from __future__ import annotations

import json
import mimetypes
import os
from collections import deque
from dataclasses import asdict
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup
from rich.progress import Progress, SpinnerColumn, TextColumn

from .models import CrawlSummary, PageRecord, now_iso
from .utils import clean_text, normalize_url, same_domain, stable_id


class WebScraperAgent:
    """A polite crawler that extracts page text + code blocks and downloads assets."""

    def __init__(
        self,
        start_url: str,
        out_dir: Path,
        *,
        max_pages: int = 200,
        max_depth: int = 4,
        same_domain_only: bool = True,
        download_assets: bool = True,
        respect_robots: bool = True,
        user_agent: str = "scraper-agent/1.0",
        timeout: float = 20.0,
        concurrency: int = 8,
    ) -> None:
        self.start_url = normalize_url(start_url)
        if not self.start_url:
            raise ValueError(f"Invalid start_url: {start_url}")

        self.out_dir = out_dir
        self.max_pages = max_pages
        self.max_depth = max_depth
        self.same_domain_only = same_domain_only
        self.download_assets = download_assets
        self.respect_robots = respect_robots
        self.user_agent = user_agent
        self.timeout = timeout
        self.concurrency = max(1, concurrency)

        self._seed_domain = urlparse(self.start_url).netloc

        self._pages_dir = self.out_dir / "pages"
        self._assets_dir = self.out_dir / "assets"
        self._raw_dir = self.out_dir / "raw"

        self._pages_dir.mkdir(parents=True, exist_ok=True)
        self._assets_dir.mkdir(parents=True, exist_ok=True)
        self._raw_dir.mkdir(parents=True, exist_ok=True)

        self._robots: RobotFileParser | None = None

    def run(self) -> CrawlSummary:
        started_at = now_iso()

        q: deque[tuple[str, int]] = deque([(self.start_url, 0)])
        seen: set[str] = set()
        seen_assets: set[str] = set()

        pages_ok = 0
        pages_failed = 0
        assets_saved = 0
        page_summaries: list[dict] = []

        self._robots = self._init_robots() if self.respect_robots else None

        limits = httpx.Limits(max_connections=self.concurrency, max_keepalive_connections=self.concurrency)
        headers = {"User-Agent": self.user_agent, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}

        with httpx.Client(
            timeout=httpx.Timeout(self.timeout),
            follow_redirects=True,
            headers=headers,
            limits=limits,
        ) as client:
            with Progress(SpinnerColumn(), TextColumn("{task.description}")) as progress:
                task = progress.add_task("Crawling...", total=None)

                while q and (pages_ok + pages_failed) < self.max_pages:
                    url, depth = q.popleft()
                    if url in seen:
                        continue
                    seen.add(url)

                    if depth > self.max_depth:
                        continue

                    if self.same_domain_only and urlparse(url).netloc != self._seed_domain:
                        continue

                    if self._robots is not None and not self._robots.can_fetch(self.user_agent, url):
                        continue

                    progress.update(task, description=f"Fetching ({pages_ok + pages_failed + 1}) {url}")

                    record = self._fetch_and_extract(client, url)
                    if record.error is None:
                        pages_ok += 1
                    else:
                        pages_failed += 1

                    page_summaries.append(
                        {
                            "url": record.url,
                            "final_url": record.final_url,
                            "status_code": record.status_code,
                            "title": record.title,
                            "links_count": len(record.links),
                            "code_blocks_count": len(record.code_blocks),
                            "assets_count": len(record.assets),
                            "error": record.error,
                        }
                    )

                    # Enqueue discovered links
                    for link in record.links:
                        if link not in seen:
                            q.append((link, depth + 1))

                    # Download assets referenced by the page
                    if self.download_assets and record.error is None:
                        for asset_url in record.assets:
                            if asset_url in seen_assets:
                                continue
                            if self.same_domain_only and urlparse(asset_url).netloc != self._seed_domain:
                                continue
                            if self._robots is not None and not self._robots.can_fetch(self.user_agent, asset_url):
                                continue
                            if self._download_asset(client, asset_url):
                                assets_saved += 1
                                seen_assets.add(asset_url)

        finished_at = now_iso()
        summary = CrawlSummary(
            start_url=self.start_url,
            out_dir=str(self.out_dir),
            started_at=started_at,
            finished_at=finished_at,
            pages_ok=pages_ok,
            pages_failed=pages_failed,
            assets_saved=assets_saved,
            pages=page_summaries,
        )

        (self.out_dir / "summary.json").write_text(json.dumps(asdict(summary), indent=2), encoding="utf-8")
        return summary

    def _init_robots(self) -> RobotFileParser | None:
        parsed = urlparse(self.start_url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"

        rp = RobotFileParser()
        rp.set_url(robots_url)
        try:
            rp.read()
        except Exception:
            # If robots is unavailable, default to allow (common in many small sites)
            return None
        return rp

    def _fetch_and_extract(self, client: httpx.Client, url: str) -> PageRecord:
        fetched_at = now_iso()
        try:
            resp = client.get(url)
            status = resp.status_code
            final_url = str(resp.url)
            headers = {k: v for k, v in resp.headers.items()}

            content_type = resp.headers.get("content-type", "")
            if "text/html" not in content_type and "application/xhtml+xml" not in content_type:
                # Still persist raw response for non-html, but skip HTML parsing.
                raw_path = self._raw_dir / f"{stable_id(url)}.bin"
                raw_path.write_bytes(resp.content)
                return PageRecord(
                    url=url,
                    final_url=final_url,
                    status_code=status,
                    fetched_at=fetched_at,
                    title=None,
                    text="",
                    code_blocks=[],
                    links=[],
                    assets=[],
                    headers=headers,
                    error=f"Non-HTML content-type: {content_type}",
                )

            html = resp.text
            raw_path = self._raw_dir / f"{stable_id(url)}.html"
            raw_path.write_text(html, encoding=resp.encoding or "utf-8", errors="replace")

            soup = BeautifulSoup(html, "lxml")
            title = soup.title.get_text(strip=True) if soup.title else None

            # Extract links/assets from the original DOM (before removing scripts/styles).
            links = list(self._extract_links(soup, base_url=final_url))
            assets = list(self._extract_assets(soup, base_url=final_url))

            # Remove non-content
            for tag in soup(["script", "style", "noscript", "template"]):
                tag.decompose()

            code_blocks = []
            for pre in soup.find_all(["pre", "code"]):
                txt = pre.get_text("\n", strip=True)
                txt = clean_text(txt)
                if txt:
                    code_blocks.append(txt)

            # Page text
            text = clean_text(soup.get_text(" ", strip=True))

            record = PageRecord(
                url=url,
                final_url=final_url,
                status_code=status,
                fetched_at=fetched_at,
                title=title,
                text=text,
                code_blocks=code_blocks,
                links=links,
                assets=assets,
                headers=headers,
                error=None,
            )

            page_path = self._pages_dir / f"{stable_id(url)}.json"
            page_path.write_text(json.dumps(asdict(record), ensure_ascii=False, indent=2), encoding="utf-8")
            return record
        except Exception as e:
            record = PageRecord(
                url=url,
                final_url=url,
                status_code=None,
                fetched_at=fetched_at,
                title=None,
                text="",
                code_blocks=[],
                links=[],
                assets=[],
                headers={},
                error=str(e),
            )
            page_path = self._pages_dir / f"{stable_id(url)}.json"
            page_path.write_text(json.dumps(asdict(record), ensure_ascii=False, indent=2), encoding="utf-8")
            return record

    def _extract_links(self, soup: BeautifulSoup, *, base_url: str) -> Iterable[str]:
        for a in soup.find_all("a", href=True):
            href = a.get("href")
            if not href:
                continue
            u = normalize_url(href, base_url=base_url)
            if not u:
                continue
            yield u

    def _extract_assets(self, soup: BeautifulSoup, *, base_url: str) -> Iterable[str]:
        # Common asset attributes
        candidates: list[str] = []

        for tag in soup.find_all("script", src=True):
            candidates.append(tag.get("src"))
        for tag in soup.find_all("link", href=True):
            rel = " ".join(tag.get("rel") or []).lower()
            if "stylesheet" in rel or "icon" in rel or "preload" in rel:
                candidates.append(tag.get("href"))
        for tag in soup.find_all("img", src=True):
            candidates.append(tag.get("src"))
        for tag in soup.find_all("source", src=True):
            candidates.append(tag.get("src"))
        for tag in soup.find_all("source", srcset=True):
            candidates.extend([s.split()[0] for s in (tag.get("srcset") or "").split(",") if s.strip()])
        for tag in soup.find_all("img", srcset=True):
            candidates.extend([s.split()[0] for s in (tag.get("srcset") or "").split(",") if s.strip()])

        for c in candidates:
            if not c:
                continue
            u = normalize_url(c, base_url=base_url)
            if not u:
                continue
            yield u

    def _download_asset(self, client: httpx.Client, url: str) -> bool:
        try:
            resp = client.get(url)
            if resp.status_code >= 400:
                return False

            content_type = resp.headers.get("content-type", "").split(";")[0].strip().lower()
            ext = mimetypes.guess_extension(content_type) if content_type else None

            parsed = urlparse(url)
            basename = os.path.basename(parsed.path) or "asset"
            if "." not in basename and ext:
                basename = basename + ext

            asset_path = self._assets_dir / f"{stable_id(url)}-{basename}"
            asset_path.write_bytes(resp.content)
            return True
        except Exception:
            return False
