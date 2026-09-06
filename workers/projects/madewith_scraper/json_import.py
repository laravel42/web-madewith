#!/usr/bin/env python3
"""Convert site project cards (src/data/*.json) back into scraper raw repo dicts."""
from __future__ import annotations


def project_to_raw(project: dict) -> dict | None:
    full_name = project.get("fullName") or project.get("full_name")
    if not full_name:
        return None

    license = project.get("license")
    langs = project.get("langs") or []
    return {
        "name": project.get("name"),
        "full_name": full_name,
        "description": project.get("desc") or project.get("description"),
        "stargazers_count": project.get("stars") or project.get("stargazers_count") or 0,
        "html_url": project.get("repoUrl") or project.get("html_url"),
        "homepage": project.get("demo") or project.get("homepage"),
        "owner": {
            "login": project.get("author") or (project.get("owner") or {}).get("login"),
            "avatar_url": project.get("avatar") or (project.get("owner") or {}).get("avatar_url"),
        },
        "topics": project.get("topics") or [],
        "_langs": langs,
        "_versions": project.get("versions") or [],
        "license": {
            "spdx_id": license if license and license not in ("—", "-", "NOASSERTION") else None,
        },
        "language": langs[0].get("name") if langs else project.get("language"),
        "fork": bool(project.get("fork", False)),
        "archived": bool(project.get("archived", False)),
        "pushed_at": project.get("pushed_at"),
        "databaseId": project.get("databaseId"),
        "_import_source": "json-migrate",
    }
