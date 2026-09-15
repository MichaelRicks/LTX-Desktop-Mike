"""Verify a built python-embed's git-sourced packages match the uv lockfile.

Why this exists: the release's ``python-deps-hash.txt`` is computed from ``uv
export`` (the lockfile) at *package* time, not from what is really installed in
``python-embed/``. So a stale embed — e.g. a leftover build with an old
``ltx_core`` commit while the lock has moved on — sails through the hash check
and ships broken (the backend then crashes on first launch with an ImportError,
as happened with ltx_core 1.1.1 vs 1.2.0). This closes that hole.

Scope: only the **git-sourced** dependencies are checked (ltx-core,
ltx-pipelines — the fork's own fast-moving packages, and the ones that actually
go stale). PyPI deps are deliberately skipped: the embed installs torch and the
CUDA wheels from the cu128 index, and the lockfile is multi-platform, so those
versions legitimately differ from a plain ``uv export`` and can't be compared
1:1. Git deps carry a recorded commit and have none of that noise.

Usage:
    python-embed/python.exe scripts/verify_python_embed.py <requirements.txt>

where <requirements.txt> is the output of
    uv export --frozen --no-hashes --no-editable --no-emit-project
Exits non-zero and prints the drift if any git dep's installed commit differs
from the lockfile's, or a git dep is missing entirely.
"""

from __future__ import annotations

import json
import re
import sys
from importlib import metadata


def _norm(name: str) -> str:
    """PEP 503 normalization so 'ltx_core' and 'ltx-core' compare equal."""
    return re.sub(r"[-_.]+", "-", name).lower()


def _parse_git_deps(path: str) -> dict[str, str]:
    """Return {name: commit} for every ``name @ git+...@<commit>`` line."""
    gitref: dict[str, str] = {}
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            line = line.split(";", 1)[0].strip()  # drop environment markers
            line = re.sub(r"\[[^\]]*\]", "", line)  # drop extras: pkg[extra] @ ...
            m = re.match(r"^([A-Za-z0-9._-]+)\s*@\s*git\+.*?@([0-9a-fA-F]{7,40})", line)
            if m:
                gitref[_norm(m.group(1))] = m.group(2).lower()
    return gitref


def _installed_commit(name: str) -> str | None:
    """Git commit a package was installed from, per its dist-info direct_url.json."""
    try:
        raw = metadata.distribution(name).read_text("direct_url.json")
    except Exception:
        raw = None
    if not raw:
        return None
    try:
        return (json.loads(raw).get("vcs_info", {}).get("commit_id") or "").lower() or None
    except Exception:
        return None


def _installed(name: str) -> bool:
    try:
        metadata.version(name)
        return True
    except metadata.PackageNotFoundError:
        return False


def _commits_agree(a: str, b: str) -> bool:
    return a.startswith(b) or b.startswith(a)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python verify_python_embed.py <requirements.txt>", file=sys.stderr)
        return 2

    gitref = _parse_git_deps(sys.argv[1])
    if not gitref:
        print("WARNING: no git-sourced deps found in the export — nothing to verify.", file=sys.stderr)
        return 0

    problems: list[str] = []
    for name, want in sorted(gitref.items()):
        if not _installed(name):
            problems.append(f"  MISSING  {name}  (lock git @ {want[:12]})")
            continue
        got = _installed_commit(name)
        if got is None:
            problems.append(f"  NO-VCS   {name}  (installed, but no git commit recorded; lock @ {want[:12]})")
        elif not _commits_agree(got, want):
            problems.append(f"  COMMIT   {name}  installed@{got[:12]}  lock@{want[:12]}")

    names = ", ".join(sorted(gitref))
    if problems:
        print(f"python-embed is STALE vs the lockfile ({len(problems)} of {len(gitref)} git deps drifted):")
        print("\n".join(problems))
        print("\nRebuild the embed before packaging:  scripts\\prepare-python.ps1")
        return 1

    print(f"python-embed git deps match the lockfile ({len(gitref)} checked: {names}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
