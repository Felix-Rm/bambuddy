"""Resolve live/snapshot camera source from the optional query override."""

from types import SimpleNamespace

from backend.app.api.routes.camera import (
    _fanout_key,
    _parse_stop_sources,
    _resolve_live_camera_source,
)


def _printer(*, enabled: bool = False, url: str | None = None):
    return SimpleNamespace(external_camera_enabled=enabled, external_camera_url=url)


class TestResolveLiveCameraSource:
    def test_default_without_external_is_builtin(self):
        assert _resolve_live_camera_source(_printer(), None) == "builtin"

    def test_default_with_external_enabled_is_external(self):
        printer = _printer(enabled=True, url="http://cam.local/mjpeg")
        assert _resolve_live_camera_source(printer, None) == "external"

    def test_configured_but_disabled_external_is_builtin(self):
        printer = _printer(enabled=False, url="http://cam.local/mjpeg")
        assert _resolve_live_camera_source(printer, None) == "builtin"

    def test_explicit_builtin_skips_enabled_external(self):
        printer = _printer(enabled=True, url="http://cam.local/mjpeg")
        assert _resolve_live_camera_source(printer, "builtin") == "builtin"
        assert _resolve_live_camera_source(printer, "built-in") == "builtin"
        assert _resolve_live_camera_source(printer, "internal") == "builtin"

    def test_explicit_external_uses_external_when_available(self):
        printer = _printer(enabled=True, url="rtsp://cam.local/stream")
        assert _resolve_live_camera_source(printer, "external") == "external"

    def test_explicit_external_falls_back_when_not_configured(self):
        assert _resolve_live_camera_source(_printer(), "external") == "builtin"

    def test_unknown_source_follows_printer_setting(self):
        enabled = _printer(enabled=True, url="http://cam.local/mjpeg")
        assert _resolve_live_camera_source(enabled, "something-else") == "external"
        assert _resolve_live_camera_source(_printer(), "something-else") == "builtin"

    def test_source_is_case_insensitive(self):
        printer = _printer(enabled=True, url="http://cam.local/mjpeg")
        assert _resolve_live_camera_source(printer, "BUILTIN") == "builtin"
        assert _resolve_live_camera_source(printer, " External ") == "external"


def test_fanout_keys_are_per_source():
    assert _fanout_key(3, "builtin") == "printer-3"
    assert _fanout_key(3, "external") == "printer-3-external"


def test_parse_stop_sources():
    assert _parse_stop_sources(None) == ["builtin", "external"]
    assert _parse_stop_sources("") == ["builtin", "external"]
    assert _parse_stop_sources("builtin") == ["builtin"]
    assert _parse_stop_sources("external") == ["external"]
    assert _parse_stop_sources("INTERNAL") == ["builtin"]
