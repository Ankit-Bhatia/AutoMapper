from __future__ import annotations

import json
import os
import shutil
from dataclasses import asdict
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from .models import SiteBuildSummary
from .utils import normalize_url, url_to_site_relpath


class SiteBuilder:
    """Build a locally browsable mirror from an existing crawl output."""

    def __init__(self, out_dir: Path, site_dir: Path, *, start_url: str | None = None) -> None:
        self.out_dir = out_dir
        self.site_dir = site_dir
        self.start_url = start_url

        self.pages_dir = out_dir / "pages"
        self.raw_dir = out_dir / "raw"
        self.assets_dir = out_dir / "assets"

        self.site_pages_dir = site_dir
        self.site_assets_dir = site_dir / "assets"

        self.site_pages_dir.mkdir(parents=True, exist_ok=True)
        self.site_assets_dir.mkdir(parents=True, exist_ok=True)

    def build(self) -> SiteBuildSummary:
        pages = self._load_pages()
        if not pages:
            raise RuntimeError(f"No pages found under: {self.pages_dir}")

        # Determine seed domain from the first page
        seed_url = pages[0]["url"]
        seed_domain = urlparse(seed_url).netloc

        # Map URL -> local html path
        url_to_local: dict[str, Path] = {}
        for p in pages:
            requested = normalize_url(p.get("url") or "")
            final = normalize_url(p.get("final_url") or "") or requested
            if not final and not requested:
                continue
            rel = url_to_site_relpath(final or requested)  # type: ignore[arg-type]
            local_path = self.site_pages_dir / rel
            if requested:
                url_to_local[requested] = local_path
            if final:
                url_to_local[final] = local_path

        # Copy assets into site/assets (we reference these by filename)
        assets_copied = 0
        if self.assets_dir.exists():
            for asset_file in self.assets_dir.iterdir():
                if asset_file.is_file():
                    shutil.copy2(asset_file, self.site_assets_dir / asset_file.name)
                    assets_copied += 1

        pages_written = 0
        for p in pages:
            requested = normalize_url(p.get("url") or "")
            final = normalize_url(p.get("final_url") or "") or requested
            u = final or requested
            if not u:
                continue

            raw_path = self.raw_dir / (p["id"] + ".html")
            if not raw_path.exists():
                # Fallback: try stable-id of url if present
                # (Older crawls might not have id injected)
                continue

            html = raw_path.read_text(encoding="utf-8", errors="replace")
            rewritten = self._rewrite_html(
                html,
                current_url=u,
                seed_domain=seed_domain,
                url_to_local=url_to_local,
            )

            target = url_to_local.get(u)
            if not target:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(rewritten, encoding="utf-8")
            pages_written += 1

        summary = SiteBuildSummary(
            out_dir=str(self.out_dir),
            site_dir=str(self.site_dir),
            pages_written=pages_written,
            assets_copied=assets_copied,
        )

        self._write_root_index()

        (self.out_dir / "site_build_summary.json").write_text(
            json.dumps(asdict(summary), indent=2),
            encoding="utf-8",
        )
        return summary

    def _write_root_index(self) -> None:
        if not self.start_url:
            return
        start = normalize_url(self.start_url)
        if not start:
            return

        target = url_to_site_relpath(start)
        index_path = self.site_dir / "index.html"
        index_path.write_text(
            f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0; url={target}" />
    <title>Local mirror</title>
  </head>
  <body>
    <p>Redirecting to <a href="{target}">{target}</a></p>
  </body>
</html>
""",
            encoding="utf-8",
        )

    def _load_pages(self) -> list[dict[str, Any]]:
        pages: list[dict[str, Any]] = []
        if not self.pages_dir.exists():
            return pages

        for fp in sorted(self.pages_dir.glob("*.json")):
            data = json.loads(fp.read_text(encoding="utf-8"))
            # Inject the stable page id used by the crawler filenames.
            data["id"] = fp.stem
            pages.append(data)
        return pages

    def _rewrite_html(
        self,
        html: str,
        *,
        current_url: str,
        seed_domain: str,
        url_to_local: dict[str, Path],
    ) -> str:
        soup = BeautifulSoup(html, "lxml")
        current_local = url_to_local.get(current_url)
        if current_local is None:
            return html

        def make_relative(target: Path) -> str:
            # Relative URL from current page folder
            return os.path.relpath(str(target), start=str(current_local.parent))

        # Rewrite internal page links
        for a in soup.find_all("a", href=True):
            href = a.get("href")
            if not href:
                continue
            abs_u = normalize_url(href, base_url=current_url)
            if not abs_u:
                continue
            if urlparse(abs_u).netloc != seed_domain:
                continue
            target = url_to_local.get(abs_u)
            if target is None:
                continue
            a["href"] = make_relative(target)

        # Rewrite asset URLs (point to site/assets/<original downloaded filename>)
        # Note: downloaded assets are named "<stableid>-<basename>"; we match by basename.
        asset_files_by_basename: dict[str, str] = {}
        for fp in self.site_assets_dir.iterdir():
            if fp.is_file():
                # split once on '-' because prefix is stable_id
                parts = fp.name.split("-", 1)
                if len(parts) == 2:
                    asset_files_by_basename[parts[1]] = fp.name

        def rewrite_asset_attr(tag_name: str, attr: str) -> None:
            for t in soup.find_all(tag_name):
                val = t.get(attr)
                if not val:
                    continue
                abs_u = normalize_url(val, base_url=current_url)
                if not abs_u:
                    continue
                if urlparse(abs_u).netloc != seed_domain:
                    continue
                basename = Path(urlparse(abs_u).path).name
                if not basename:
                    continue
                mapped = asset_files_by_basename.get(basename)
                if not mapped:
                    continue
                # from current page dir to site/assets
                asset_target = self.site_assets_dir / mapped
                t[attr] = make_relative(asset_target)

        rewrite_asset_attr("script", "src")
        rewrite_asset_attr("link", "href")
        rewrite_asset_attr("img", "src")
        rewrite_asset_attr("source", "src")

        return str(soup)