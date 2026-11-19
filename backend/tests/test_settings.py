import pytest

from app.settings import ConfigurationError, database_url


def test_database_url_precedence(tmp_path, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    (tmp_path / ".env").write_text("DATABASE_URL=sqlite:///root.db", encoding="utf-8")
    assert database_url(tmp_path).database == "root.db"
    local = tmp_path / ".local"
    local.mkdir()
    (local / "dev.env").write_text("DATABASE_URL=sqlite:///local.db", encoding="utf-8")
    assert database_url(tmp_path).database == "local.db"
    monkeypatch.setenv("DATABASE_URL", "sqlite:///explicit.db")
    assert database_url(tmp_path).database == "explicit.db"


@pytest.mark.parametrize("value", ["", "invalid://private-value", "not a connection URL"])
def test_invalid_database_url_does_not_disclose_value(tmp_path, monkeypatch, value):
    monkeypatch.setenv("DATABASE_URL", value)
    with pytest.raises(ConfigurationError, match="DATABASE_URL") as caught:
        database_url(tmp_path)
    if value:
        assert value not in str(caught.value)

