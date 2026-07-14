"""Unit tests for normalize.categorize_repo against the Laravel ground truth.

Run:
    ./scraper/.venv/bin/python scraper/tests/test_categorize_laravel.py

Loads the 70+ ground-truth cases from the live Postgres DB (raw repo data)
and verifies the rule's decisions against the hand-labeled truth table.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

from madewith_scraper.domains import load_domains  # noqa: E402
from madewith_scraper.normalize import categorize_repo  # noqa: E402

# Hand-labeled ground truth: full_name → expected to be Laravel
GROUND_TRUTH: dict[str, bool] = {
    # True = should be on /laravel/
    "laravel/laravel": True,
    "coollabsio/coolify": True,
    "laravel/framework": True,
    "filamentphp/filament": True,
    "bagisto/bagisto": True,
    "monicahq/monica": True,
    "krayin/laravel-crm": True,
    "fruitcake/laravel-debugbar": True,
    "BookStackApp/BookStack": True,
    "koel/koel": True,
    "flarum/flarum": True,
    "cachethq/cachet": True,
    "barryvdh/laravel-ide-helper": True,
    "roots/sage": True,
    "spatie/laravel-permission": True,
    "SpartnerNL/Laravel-Excel": True,
    "octobercms/october": True,
    "invoiceninja/invoiceninja": True,
    "akaunting/akaunting": True,
    "themsaid/wink": True,
    "tighten/ziggy": True,
    "tighten/jigsaw": True,
    "inovector/mixpost": True,
    "aimeos/aimeos": True,
    "aimeos/aimeos-headless": True,
    "aimeos/aimeos-docs": True,
    "laravel/breeze": True,
    "laravel/sail": True,
    "laravel/echo": True,
    "jeremykenedy/laravel-auth": True,
    "spatie/laravel-web-tinker": True,
    "laravel-mix/laravel-mix": True,
    "thedevdojo/wave": True,
    "shufo/vscode-blade-formatter": True,
    "amir9480/vscode-laravel-extra-intellisense": True,
    "microweber/microweber": True,
    "nicoverbruggen/phpmon": True,
    "serversideup/financial-freedom": True,
    "serversideup/docker-php": True,
    "serversideup/spin": True,
    "tuandm/laravue": True,
    "avored/laravel-ecommerce": True,
    "mtolhuys/laravel-schematics": True,
    "tmdh/laravel-kit": True,
    "NativePHP/mobile-air": True,
    "summerblue/larabbs": True,
    "Bottelet/DaybydayCRM": True,
    "ucan-lab/docker-laravel": True,
    # False = should NOT be on /laravel/
    "shadcn-ui/ui": False,
    "webhooksite/webhook.site": False,
    "ecrmnn/collect.js": False,
    "goravel/goravel": False,
    "ddev/ddev": False,
    "marcj/deepkit": False,
    "endoflife-date/endoflife.date": False,
    "colinlet/PHP-Interview-QA": False,
    "viest/php-ext-xlswriter": False,
    "tookit/vue-material-admin": False,
    "mikeerickson/validatorjs": False,
    "chiraggude/awesome-laravel": False,
    "alexeymezenin/laravel-best-practices": False,
    "TimothyDJones/awesome-laravel": False,
    "OussamaMater/Laravel-Tips": False,
    "lando/lando": False,
    "unicodeveloper/awesome-opensource-apps": False,
    "dreamfactorysoftware/dreamfactory": False,
    "goforj/godump": False,
    "robsontenorio/vue-api-query": False,
    "justjavac/Flarum": False,
    "phodal/iot": False,
    "gohouse/gorose": False,
    "cipi-sh/cipi": False,
    "buggregator/server": False,
    "shipping-docker/vessel": False,
    "gaarason/database-all": False,
    "cioraneanu/firefly-pico": False,
    "exaco/laravel-docktane": False,
    "michael-rubel/livewire-best-practices": False,
    "todayqq/PHPerInterviewGuide": False,
    "beckenrode/mysql-workbench-export-laravel-5-migrations": False,
    "intentjs/intent": False,
    "beromir/Servas": False,
    "tweakphp/tweakphp": False,
    "GDGAhmedabad/Awesome-Learning-Resources": False,
    "gilbitron/laravel-vue-pagination": False,
    "lerd-env/lerd": False,
}


def _load_real_repos(names: list[str]) -> dict[str, dict]:
    """Fetch real raw repo data from Postgres for the given full_names."""
    import psycopg
    from psycopg.rows import dict_row
    conn = psycopg.connect(os.environ["DATABASE_URL"])  # type: ignore[arg-type]
    try:
        cur = conn.cursor(row_factory=dict_row)
        cur.execute(
            """SELECT r.full_name, r.owner_login, r.primary_language,
                      r.description,
                      r.metadata->'raw' AS raw
               FROM repositories r
               WHERE r.full_name = ANY(%s)""",
            (names,),
        )
        rows = list(cur)
    finally:
        conn.close()
    out: dict[str, dict] = {}
    for r in rows:
        raw = r.get("raw") or {}
        if isinstance(raw, str):
            import json
            raw = json.loads(raw)
        repo = dict(raw) if raw else {}
        # Ensure the fields the categorizer reads are populated from the
        # top-level column too, since some rows have raw.metadata stripped.
        repo.setdefault("full_name", r["full_name"])
        repo.setdefault("name", r["full_name"].split("/")[-1])
        repo.setdefault("owner_login", r["owner_login"])
        repo.setdefault("primary_language", r["primary_language"])
        repo.setdefault("language", r["primary_language"])
        repo.setdefault("description", r["description"] or "")
        if not repo.get("topics"):
            repo["topics"] = []
        out[r["full_name"]] = repo
    return out


def test_catalog_loaded() -> None:
    domains = load_domains()
    laravel = next((d for d in domains if d["slug"] == "laravel"), None)
    assert laravel is not None, "laravel entry missing from domain-catalog.json"
    assert laravel.get("categorize", {}).get("kind") == "laravel", "laravel categorize block missing"


def test_ground_truth() -> None:
    domains = load_domains()
    laravel = next(d for d in domains if d["slug"] == "laravel")
    repos = _load_real_repos(list(GROUND_TRUTH.keys()))
    keep = drop = wrong = 0
    failures: list[str] = []
    for name, expected in GROUND_TRUTH.items():
        repo = repos.get(name)
        if repo is None:
            failures.append(f"  {name}: not found in DB")
            wrong += 1
            continue
        got = categorize_repo(repo, laravel)
        if got == expected:
            if got:
                keep += 1
            else:
                drop += 1
        else:
            wrong += 1
            failures.append(f"  {name}: expected={expected} got={got}")
    total = keep + drop + wrong
    print(f"\nLaravel categorization: {keep + drop}/{total} correct")
    print(f"  KEEP: {keep}   DROP: {drop}   WRONG: {wrong}")
    if failures:
        print(f"\nFAILURES:")
        for f in failures:
            print(f)
    assert wrong == 0, f"{wrong} categorization mismatches:\n" + "\n".join(failures)


if __name__ == "__main__":
    test_catalog_loaded()
    test_ground_truth()
    print("\n✓ All Laravel categorization tests passed")
