from scraper_agent.utils import normalize_url, same_domain


def test_normalize_url_drops_fragment_and_resolves_relative():
    base = "https://example.com/about/"
    assert normalize_url("/x#y", base_url=base) == "https://example.com/x"


def test_normalize_url_rejects_mailto_and_empty():
    assert normalize_url("") is None
    assert normalize_url("mailto:test@example.com") is None


def test_same_domain():
    assert same_domain("https://a.com/x", "https://a.com/y")
    assert not same_domain("https://a.com/x", "https://b.com/y")
