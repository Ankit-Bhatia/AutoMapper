import argparse
from pathlib import Path

from .agent import WebScraperAgent


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="scraper_agent",
        description="Crawl a URL and its links; extract data + code snippets.",
    )
    parser.add_argument("start_url", help="Seed URL to start crawling")
    parser.add_argument(
        "--out-dir",
        default="./scrape_out",
        help="Output directory (default: ./scrape_out)",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=200,
        help="Maximum pages to crawl (default: 200)",
    )
    parser.add_argument(
        "--max-depth",
        type=int,
        default=4,
        help="Maximum link depth from seed (default: 4)",
    )
    parser.add_argument(
        "--same-domain-only",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Only crawl same domain as seed (default: true)",
    )
    parser.add_argument(
        "--download-assets",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Download JS/CSS/JSON/image assets referenced by pages (default: true)",
    )
    parser.add_argument(
        "--respect-robots",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Respect robots.txt (default: true)",
    )
    parser.add_argument(
        "--user-agent",
        default="scraper-agent/1.0 (+https://example.invalid)",
        help="User-Agent string",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=20.0,
        help="Request timeout in seconds (default: 20)",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=8,
        help="Concurrent requests (default: 8)",
    )

    args = parser.parse_args(argv)

    agent = WebScraperAgent(
        start_url=args.start_url,
        out_dir=Path(args.out_dir),
        max_pages=args.max_pages,
        max_depth=args.max_depth,
        same_domain_only=args.same_domain_only,
        download_assets=args.download_assets,
        respect_robots=args.respect_robots,
        user_agent=args.user_agent,
        timeout=args.timeout,
        concurrency=args.concurrency,
    )

    summary = agent.run()
    print(summary.to_console_string())
    return 0
