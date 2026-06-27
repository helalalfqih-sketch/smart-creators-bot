from __future__ import annotations

import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from core.config import (
    COOKIES_DIR,
    DOUYIN_COOKIES_PATH,
    EXTRACTOR_BROWSER,
    EXTRACTOR_RETRIES,
    MOBILE_USER_AGENT,
    TIKTOK_COOKIES_PATH,
)

logger = logging.getLogger("engine.extractors")

LineCallback = Callable[[str], None]


@dataclass
class ExtractResult:
    output_lines: list[str]
    mode: str


def normalize_douyin_url(url: str) -> str:
    """Strip tracking params from Douyin short/share links."""
    if "v.douyin.com" in url or "douyin.com" in url:
        return url.split("?")[0].rstrip("/")
    return url


def is_cookie_error(stderr: str) -> bool:
    lower = stderr.lower()
    markers = (
        "cookies",
        "login required",
        "authentication",
        "fresh cookies",
        "cookie",
        "please log in",
    )
    return any(marker in lower for marker in markers)


def _is_douyin_url(url: str) -> bool:
    return any(host in url for host in ("douyin.com", "iesdouyin.com"))


def _is_tiktok_url(url: str) -> bool:
    return "tiktok.com" in url


def _resolve_cookies_path(url: str) -> Path | None:
    candidates: list[Path] = []

    if _is_douyin_url(url):
        candidates.append(DOUYIN_COOKIES_PATH)
    if _is_tiktok_url(url):
        candidates.append(TIKTOK_COOKIES_PATH)

    candidates.append(COOKIES_DIR / "default.txt")

    for path in candidates:
        if path.exists() and path.stat().st_size > 0:
            return path

    return None


class SmartExtractor:
    """Multi-strategy yt-dlp extractor with cookies and browser fallbacks."""

    def __init__(
        self,
        *,
        cookies_path: Path | None = None,
        browser: str = EXTRACTOR_BROWSER,
    ):
        self.cookies_path = cookies_path
        self.browser = browser

    def extract(
        self,
        url: str,
        *,
        out_template: str,
        format_string: str,
        max_bytes: int,
        on_line: LineCallback | None = None,
    ) -> ExtractResult:
        normalized_url = normalize_douyin_url(url)
        cookies_path = self.cookies_path or _resolve_cookies_path(normalized_url)

        strategies: list[tuple[str, list[str]]] = [
            (
                "primary",
                self._build_primary_cmd(
                    normalized_url,
                    out_template,
                    format_string,
                    max_bytes,
                    cookies_path,
                ),
            ),
        ]

        if _is_douyin_url(normalized_url) or cookies_path is not None:
            strategies.append(
                (
                    "retry",
                    self._build_retry_cmd(
                        normalized_url,
                        out_template,
                        format_string,
                        max_bytes,
                        cookies_path,
                    ),
                )
            )

        strategies.append(
            (
                "browser",
                self._build_browser_cmd(
                    normalized_url,
                    out_template,
                    format_string,
                    max_bytes,
                ),
            )
        )

        last_lines: list[str] = []
        last_mode = "primary"

        for mode, cmd in strategies:
            last_mode = mode
            logger.info("Smart extractor trying mode=%s url=%s", mode, normalized_url)
            returncode, lines = self._run_cmd(cmd, on_line=on_line)
            last_lines = lines

            if returncode == 0:
                logger.info("Smart extractor succeeded with mode=%s", mode)
                return ExtractResult(output_lines=lines, mode=mode)

            combined = "\n".join(lines)
            if mode == "primary" and not is_cookie_error(combined) and not _is_douyin_url(normalized_url):
                break

            if mode == "retry" and not is_cookie_error(combined):
                logger.warning("Retry mode failed with non-cookie error for %s", normalized_url)

        tail = "\n".join(last_lines[-15:])
        raise RuntimeError(f"Smart extractor failed ({last_mode}):\n{tail[:800]}")

    def _common_args(
        self,
        url: str,
        out_template: str,
        format_string: str,
        max_bytes: int,
    ) -> list[str]:
        cmd = [
            "yt-dlp",
            "--no-playlist",
            "--no-warnings",
            "--newline",
            "--progress",
            "-f",
            format_string,
            "-S",
            "ext:mp4:m4a",
            "--max-filesize",
            str(max_bytes),
            "--merge-output-format",
            "mp4",
            "-o",
            out_template,
        ]

        if _is_douyin_url(url):
            cmd += [
                "--user-agent",
                MOBILE_USER_AGENT,
                "--extractor-args",
                "douyin:force_generic_extractor=true",
            ]
        else:
            cmd += ["--impersonate", "chrome"]

        return cmd

    def _build_primary_cmd(
        self,
        url: str,
        out_template: str,
        format_string: str,
        max_bytes: int,
        cookies_path: Path | None,
    ) -> list[str]:
        cmd = self._common_args(url, out_template, format_string, max_bytes)

        if cookies_path is not None:
            cmd[1:1] = ["--cookies", str(cookies_path)]

        cmd.append(url)
        return cmd

    def _build_retry_cmd(
        self,
        url: str,
        out_template: str,
        format_string: str,
        max_bytes: int,
        cookies_path: Path | None,
    ) -> list[str]:
        cmd = self._build_primary_cmd(
            url,
            out_template,
            format_string,
            max_bytes,
            cookies_path,
        )
        cmd[1:1] = ["--extractor-retries", str(EXTRACTOR_RETRIES)]
        return cmd

    def _build_browser_cmd(
        self,
        url: str,
        out_template: str,
        format_string: str,
        max_bytes: int,
    ) -> list[str]:
        cmd = self._common_args(url, out_template, format_string, max_bytes)
        cmd[1:1] = ["--cookies-from-browser", self.browser]
        cmd.append(url)
        return cmd

    @staticmethod
    def _run_cmd(cmd: list[str], on_line: LineCallback | None = None) -> tuple[int, list[str]]:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )

        output_lines: list[str] = []

        while True:
            line = proc.stdout.readline()
            if not line:
                break
            line = line.rstrip()
            output_lines.append(line)
            if on_line is not None:
                on_line(line)

        proc.wait()
        return proc.returncode, output_lines
