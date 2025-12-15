from __future__ import annotations

import hashlib
import re
from pathlib import PurePosixPath
from urllib.parse import urljoin, urlparse, urlunparse


_DISALLOWED_SCHEMES = {"mailto", "tel", "javascript", "data"}


def normalize_url(url: str, base_url: str | None = None) -> str | None:
    """Resolve relative links and normalize for dedupe.

    - Joins relative URLs against base_url
    - Drops URL fragments
    - Normalizes scheme+host casing
    """
    url = url.strip()
    if not url:
        return None

    if base_url is not None:
        url = urljoin(base_url, url)

    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return None

    if parsed.scheme.lower() in _DISALLOWED_SCHEMES:
        return None

    scheme = parsed.scheme.lower()
    netloc = parsed.netloc.lower()

    # Drop fragment
    parsed = parsed._replace(scheme=scheme, netloc=netloc, fragment="")

    # Normalize trailing slash: keep path as-is except empty path
    if parsed.path == "":
        parsed = parsed._replace(path="/")

    return urlunparse(parsed)


def same_domain(url_a: str, url_b: str) -> bool:
    a = urlparse(url_a)
    b = urlparse(url_b)
    return a.netloc.lower() == b.netloc.lower()


def stable_id(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]


_ws_re = re.compile(r"\s+")


def clean_text(text: str) -> str:
    text = text.replace("\u00a0", " ")
    text = _ws_re.sub(" ", text)
    return text.strip()


_word_re = re.compile(r"\w+|[^\w\s]+", re.UNICODE)


def word_tokens(text: str) -> list[str]:
    """Tokenize text for word-by-word comparisons.

    Keeps punctuation as separate tokens so diffs are more readable.
    """
    text = clean_text(text)
    if not text:
        return []
    return _word_re.findall(text)


def url_to_site_relpath(url: str) -> str:
    """Map a URL to a stable local path inside the mirrored site.

    Examples:
    - https://example.com/               -> index.html
    - https://example.com/about-us       -> about-us/index.html
    - https://example.com/blog/post/     -> blog/post/index.html
    - https://example.com/x.html         -> x.html
    """
    p = urlparse(url)
    path = p.path or "/"
    posix = PurePosixPath(path)

    # Root
    if str(posix) == "/":
        return "index.html"

    # If it looks like a file, keep it
    if posix.suffix:
        return str(posix).lstrip("/")

    # Otherwise treat as folder
    return str(posix).lstrip("/") + "/index.html"
