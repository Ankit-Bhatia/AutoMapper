from scraper_agent.utils import url_to_site_relpath, word_tokens


def test_url_to_site_relpath_root():
    assert url_to_site_relpath("https://example.com/") == "index.html"


def test_url_to_site_relpath_folderish():
    assert url_to_site_relpath("https://example.com/about-us") == "about-us/index.html"
    assert url_to_site_relpath("https://example.com/about-us/") == "about-us/index.html"


def test_url_to_site_relpath_file():
    assert url_to_site_relpath("https://example.com/a/b/c.html") == "a/b/c.html"


def test_word_tokens_keeps_punctuation():
    assert word_tokens("Hello, world!") == ["Hello", ",", "world", "!"]
