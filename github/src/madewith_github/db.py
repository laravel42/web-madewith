from __future__ import annotations
import json
from contextlib import contextmanager
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any, Iterator
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from .models import Classification, Rule, Technology, TechDetection

class Database:
    def __init__(self, dsn: str):
        self.pool = ConnectionPool(dsn, kwargs={"row_factory": dict_row}, min_size=1, max_size=8)

    @contextmanager
    def connection(self) -> Iterator[Any]:
        with self.pool.connection() as conn:
            yield conn

    def close(self) -> None:
        self.pool.close()

    def get_technology(self, slug: str) -> Technology:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM technologies WHERE slug=%s AND enabled=true", (slug,))
            row = cur.fetchone()
            if not row: raise KeyError(f"Technology not found or disabled: {slug}")
            return self._technology(row)

    @staticmethod
    def _technology(row: dict[str, Any]) -> Technology:
        for key in ("search_topics","search_keywords","excluded_keywords","allowed_project_types","metadata"):
            if isinstance(row[key], str): row[key] = json.loads(row[key])
        return Technology(**{k: row[k] for k in Technology.__dataclass_fields__})

    @staticmethod
    def _rule(r: dict[str, Any]) -> Rule:
        data={k: r[k] for k in Rule.__dataclass_fields__}
        # Postgres numeric columns arrive as Decimal; coerce to the float the
        # model declares so evidence scores stay JSON-serializable.
        data["confidence"]=float(data["confidence"]); data["weight"]=float(data["weight"])
        return Rule(**data)

    def get_rules(self, technology_id: int) -> list[Rule]:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM technology_rules WHERE technology_id=%s AND active=true ORDER BY strong_evidence DESC, weight DESC", (technology_id,))
            return [self._rule(r) for r in cur.fetchall()]

    def get_all_technologies(self) -> list[Technology]:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM technologies WHERE enabled=true ORDER BY slug")
            return [self._technology(row) for row in cur.fetchall()]

    def get_rules_by_technology(self) -> dict[int, list[Rule]]:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM technology_rules WHERE active=true ORDER BY technology_id, strong_evidence DESC, weight DESC")
            grouped: dict[int, list[Rule]] = {}
            for r in cur.fetchall(): grouped.setdefault(r["technology_id"], []).append(self._rule(r))
            return grouped

    def fetch_repositories(self, limit: int | None = None) -> list[dict[str, Any]]:
        """Every scraped repository with its stored manifests and topics, shaped
        for the qualifier — no GitHub calls needed."""
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(f"SELECT id,full_name,description,primary_language FROM repositories ORDER BY stars DESC NULLS LAST{f' LIMIT {int(limit)}' if limit else ''}")
            repos={row["id"]: {**row, "topics": [], "manifests": {}} for row in cur.fetchall()}
            if not repos: return []
            ids=tuple(repos)
            cur.execute("SELECT repository_id,topic FROM repository_topics WHERE repository_id = ANY(%s)", (list(ids),))
            for row in cur.fetchall(): repos[row["repository_id"]]["topics"].append(row["topic"])
            cur.execute("SELECT repository_id,path,content,raw_excerpt FROM repository_manifests WHERE repository_id = ANY(%s)", (list(ids),))
            for row in cur.fetchall():
                content=row["content"]
                if isinstance(content, str):
                    try: content=json.loads(content)
                    except json.JSONDecodeError: content=None
                repos[row["repository_id"]]["manifests"][row["path"]]={"json": content, "raw": row["raw_excerpt"] or ""}
            return list(repos.values())

    def start_run(self, technology_id: int, correlation_id: str, query: str, partition: dict[str, Any]) -> int:
        now = datetime.now(timezone.utc)
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute("""INSERT INTO github_search_runs(technology_id,correlation_id,status,query,partition,started_at,created_at,updated_at)
            VALUES(%s,%s,'running',%s,%s,%s,%s,%s) RETURNING id""", (technology_id,correlation_id,query,json.dumps(partition),now,now,now))
            return cur.fetchone()["id"]

    def finish_run(self, run_id: int, **stats: Any) -> None:
        allowed={"status","page_count","result_count","candidate_count","rate_limit_limit","rate_limit_remaining","rate_limit_used","rate_limit_reset_at","error"}
        fields={k:v for k,v in stats.items() if k in allowed}
        fields["finished_at"]=datetime.now(timezone.utc); fields["updated_at"]=datetime.now(timezone.utc)
        sets=", ".join(f"{k}=%s" for k in fields)
        vals=[json.dumps(v) if k=="error" and v is not None else v for k,v in fields.items()]
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(f"UPDATE github_search_runs SET {sets} WHERE id=%s", (*vals,run_id))

    def latest_partition_end(self, technology_id: int) -> datetime | None:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute("""SELECT partition->>'pushed_to' AS pushed_to FROM github_search_runs
              WHERE technology_id=%s AND status='completed' AND partition ? 'pushed_to'
              ORDER BY finished_at DESC LIMIT 1""", (technology_id,))
            row=cur.fetchone()
            return datetime.fromisoformat(row["pushed_to"]) if row and row["pushed_to"] else None

    def repository_is_fresh(self, github_id: int, refresh_after_days: int) -> bool:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT enriched_at > now()-(%s || ' days')::interval AS fresh FROM repositories WHERE github_repository_id=%s", (refresh_after_days,github_id))
            row=cur.fetchone(); return bool(row and row["fresh"])

    def upsert_repository(self, item: dict[str, Any]) -> int:
        now=datetime.now(timezone.utc)
        values={
          "github_repository_id":item["id"],"github_node_id":item.get("node_id"),"name":item["name"],"full_name":item["full_name"],
          "description":item.get("description"),"repository_url":item["html_url"],"homepage_url":item.get("homepage") or None,
          "owner_login":item["owner"]["login"],"owner_avatar_url":item["owner"].get("avatar_url"),"stars":item.get("stargazers_count",0),
          "forks":item.get("forks_count",0),"watchers":item.get("subscribers_count",item.get("watchers_count",0)),
          "github_created_at":item.get("created_at"),"github_updated_at":item.get("updated_at"),"pushed_at":item.get("pushed_at"),
          "archived":item.get("archived",False),"fork":item.get("fork",False),"template":item.get("is_template",False),
          "mirror":bool(item.get("mirror_url")),"primary_language":item.get("language"),"license_spdx":((item.get("license") or {}).get("spdx_id")),
          "default_branch":item.get("default_branch"),"open_issues":item.get("open_issues_count"),"etag":item.get("_etag"),"discovered_at":now,
          "metadata":json.dumps({"visibility":item.get("visibility"),"size_kb":item.get("size"),"search_score":item.get("score")}),"updated_at":now,"created_at":now}
        cols=list(values); placeholders=','.join(['%s']*len(cols)); updates=','.join(f"{c}=EXCLUDED.{c}" for c in cols if c not in {"created_at","discovered_at"})
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(f"INSERT INTO repositories({','.join(cols)}) VALUES({placeholders}) ON CONFLICT(github_repository_id) DO UPDATE SET {updates} RETURNING id", tuple(values.values()))
            return cur.fetchone()["id"]

    def replace_topics(self, repo_id: int, topics: list[str]) -> None:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM repository_topics WHERE repository_id=%s",(repo_id,))
            cur.executemany("INSERT INTO repository_topics(repository_id,topic,created_at,updated_at) VALUES(%s,%s,now(),now()) ON CONFLICT DO NOTHING",[(repo_id,t) for t in topics])

    def replace_languages(self, repo_id: int, languages: dict[str,int]) -> None:
        total=sum(languages.values()) or 1
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM repository_languages WHERE repository_id=%s",(repo_id,))
            cur.executemany("INSERT INTO repository_languages(repository_id,language,bytes,percentage,created_at,updated_at) VALUES(%s,%s,%s,%s,now(),now())",[(repo_id,k,v,round(v*100/total,3)) for k,v in languages.items()])

    def record_metrics(self, repo_id:int, item:dict[str,Any])->None:
        """One repository_metrics snapshot + one daily repository_star_snapshot
        from a freshly fetched GitHub payload (bucketed to the second so repeated
        enrichment in the same second updates in place)."""
        captured=datetime.now(timezone.utc).replace(microsecond=0)
        stars=item.get("stargazers_count",0) or 0; forks=item.get("forks_count",0) or 0
        watchers=item.get("subscribers_count",item.get("watchers_count",0)) or 0; open_issues=item.get("open_issues_count")
        payload=json.dumps({"stars":stars,"forks":forks,"watchers":watchers,"open_issues":open_issues,
                            "open_pull_requests":item.get("open_pull_requests"),"search_score":item.get("score")})
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute("""INSERT INTO repository_metrics(repository_id,captured_at,stars,forks,watchers,open_issues,source_payload,created_at,updated_at)
              VALUES(%s,%s,%s,%s,%s,%s,%s,now(),now())
              ON CONFLICT(repository_id,captured_at) DO UPDATE SET stars=EXCLUDED.stars,forks=EXCLUDED.forks,watchers=EXCLUDED.watchers,open_issues=EXCLUDED.open_issues,source_payload=EXCLUDED.source_payload,updated_at=now()""",
              (repo_id,captured,stars,forks,watchers,open_issues,payload))
            cur.execute("""INSERT INTO repository_star_snapshots(repository_id,snapshot_date,stars,created_at)
              VALUES(%s,CURRENT_DATE,%s,now()) ON CONFLICT(repository_id,snapshot_date) DO UPDATE SET stars=EXCLUDED.stars""",
              (repo_id,stars))

    def backfill_metrics(self)->tuple[int,int]:
        """Populate repository_metrics and repository_star_snapshots for every
        already-scraped repository from the columns stored on `repositories`,
        without any GitHub calls. Idempotent: keyed on enriched_at so re-runs
        update the same snapshot rather than piling up duplicates."""
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute("""INSERT INTO repository_metrics(repository_id,captured_at,stars,forks,watchers,open_issues,source_payload,created_at,updated_at)
              SELECT id,date_trunc('second',COALESCE(enriched_at,discovered_at,now())),COALESCE(stars,0),COALESCE(forks,0),COALESCE(watchers,0),open_issues,
                     json_build_object('stars',stars,'forks',forks,'watchers',watchers,'open_issues',open_issues,'backfilled',true),now(),now()
              FROM repositories
              ON CONFLICT(repository_id,captured_at) DO UPDATE SET stars=EXCLUDED.stars,forks=EXCLUDED.forks,watchers=EXCLUDED.watchers,open_issues=EXCLUDED.open_issues,source_payload=EXCLUDED.source_payload,updated_at=now()""")
            metrics=cur.rowcount
            cur.execute("""INSERT INTO repository_star_snapshots(repository_id,snapshot_date,stars,created_at)
              SELECT id,COALESCE(enriched_at::date,discovered_at::date,CURRENT_DATE),COALESCE(stars,0),now()
              FROM repositories
              ON CONFLICT(repository_id,snapshot_date) DO UPDATE SET stars=EXCLUDED.stars""")
            return metrics,cur.rowcount

    def upsert_manifest(self, repo_id:int, path:str, sha:str|None, etag:str|None, size:int|None, content:Any, raw_excerpt:str|None, error:dict|None=None)->None:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute("""INSERT INTO repository_manifests(repository_id,path,sha,etag,size,status,content,raw_excerpt,fetched_at,error,created_at,updated_at)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,now(),%s,now(),now()) ON CONFLICT(repository_id,path) DO UPDATE SET sha=EXCLUDED.sha,etag=EXCLUDED.etag,size=EXCLUDED.size,status=EXCLUDED.status,content=EXCLUDED.content,raw_excerpt=EXCLUDED.raw_excerpt,fetched_at=now(),error=EXCLUDED.error,updated_at=now()""",
            (repo_id,path,sha,etag,size,"error" if error else "fetched",json.dumps(content) if content is not None else None,raw_excerpt,json.dumps(error) if error else None))

    def clear_verified(self, repo_id:int)->int:
        """Drop auto-verified technology links for a repository (e.g. once it is
        recognised as a curated list rather than a project)."""
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM repository_technologies WHERE repository_id=%s AND status='verified'",(repo_id,))
            return cur.rowcount

    def save_detection(self, repo_id:int, technology_id:int, d:TechDetection)->None:
        evidence=[asdict(e) for e in d.evidence]
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute("""INSERT INTO repository_technologies(repository_id,technology_id,confidence,status,auto_approved,evidence,verified_at,created_at,updated_at)
            VALUES(%s,%s,%s,%s,%s,%s,now(),now(),now()) ON CONFLICT(repository_id,technology_id) DO UPDATE SET confidence=EXCLUDED.confidence,status=EXCLUDED.status,auto_approved=EXCLUDED.auto_approved,evidence=EXCLUDED.evidence,verified_at=now(),updated_at=now()""",
            (repo_id,technology_id,d.confidence,"verified" if d.accepted else "rejected",d.accepted,json.dumps(evidence)))

    def save_classification(self, repo_id:int, c:Classification)->None:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute("""INSERT INTO repository_classifications(repository_id,project_type,project_type_confidence,categories,category_confidence,deterministic_rules,llm_input_hash,llm_output,classified_at,created_at,updated_at)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,now(),now(),now()) ON CONFLICT(repository_id) DO UPDATE SET project_type=EXCLUDED.project_type,project_type_confidence=EXCLUDED.project_type_confidence,categories=EXCLUDED.categories,category_confidence=EXCLUDED.category_confidence,deterministic_rules=EXCLUDED.deterministic_rules,llm_input_hash=EXCLUDED.llm_input_hash,llm_output=EXCLUDED.llm_output,classified_at=now(),updated_at=now()""",
            (repo_id,c.project_type,c.project_type_confidence,json.dumps(c.categories),c.category_confidence,json.dumps(c.deterministic_rules),c.llm_input_hash,json.dumps(c.llm_output) if c.llm_output else None))
            cur.execute("UPDATE repositories SET status=%s,enriched_at=now(),verified_at=now(),classified_at=now(),updated_at=now() WHERE id=%s",("classified",repo_id))
