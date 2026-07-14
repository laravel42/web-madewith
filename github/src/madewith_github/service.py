from __future__ import annotations
import asyncio,json,logging,uuid
from datetime import datetime,timedelta,timezone
from .classifier import classify
from .config import Settings
from .db import Database
from .detection import qualify
from .github import GitHubClient

log=logging.getLogger("madewith_github.service")

DEFAULT_MANIFESTS=["package.json","composer.json","pyproject.toml","requirements.txt","Cargo.toml","go.mod","Gemfile","pom.xml","build.gradle","README.md","README.rst"]

class DiscoveryService:
    def __init__(self,settings:Settings):
        self.settings=settings; self.db=Database(settings.database_url); self.gh=GitHubClient(settings.github_token,settings.github_api_version,settings.request_timeout_seconds)
    async def close(self): await self.gh.close(); self.db.close()

    def _queries(self,tech,frm,to):
        # GitHub's /search/repositories API ANDs space-separated qualifiers and
        # does NOT support OR / parenthesised grouping (a parenthesised OR
        # silently returns 0 results; a bare OR raises "Validation Failed"). So
        # each topic/keyword must be its own query, with results deduped by id.
        parts=[f"stars:>={tech.minimum_stars}",f"pushed:{frm.date()}..{to.date()}","is:public"]
        if not tech.include_forks:parts.append("fork:false")
        if not tech.include_archived:parts.append("archived:false")
        suffix=" ".join(parts)
        terms=[f"topic:{t}" for t in tech.search_topics]
        terms += [f'"{k}"' if ' ' in k else k for k in tech.search_keywords]
        if not terms:terms=[tech.name]
        return [f"{term} {suffix}" for term in terms]

    async def run(self,window_days:int=30,max_pages:int=10,max_repos:int|None=None)->dict:
        """Discover repositories across *all* enabled technologies and qualify
        each one at runtime — no per-technology argument. Every unique repo is
        enriched once and scored against every technology, so a repo is assigned
        to all the domains it belongs to in a single pass."""
        techs=self.db.get_all_technologies(); rules_by=self.db.get_rules_by_technology()
        allowed=sorted({t for tech in techs for t in (tech.allowed_project_types or [])})
        end=datetime.now(timezone.utc); start=end-timedelta(days=window_days)
        correlation=str(uuid.uuid4())
        # One global, deduplicated search plan across every technology's own
        # search config; qualification is cross-technology, so we never re-scan
        # the same repo per domain.
        plan=[(tech,q) for tech in techs for q in self._queries(tech,start,end)]
        summary=f"{len(techs)} technologies · {len(plan)} queries · pushed {start.date()}..{end.date()}"
        log.info("▶ discovery across %d technologies: %d search queries, up to %d page(s) each, pushed %s..%s%s",
                 len(techs),len(plan),max_pages,start.date(),end.date(),f", max {max_repos} repos" if max_repos else "")
        run_id=self.db.start_run(None,correlation,summary,{"pushed_from":start.isoformat(),"pushed_to":end.isoformat(),"page":1})
        log.debug("run_id=%s correlation=%s",run_id,correlation)
        seen=accepted=results=pages=0; skipped_fresh=dupes=0; seen_ids:set[int]=set(); by_tech:dict[str,int]={}
        try:
            for tech,q in plan:
                if max_repos and seen>=max_repos:
                    log.info("  repo cap reached (%d); stopping",max_repos);break
                log.info("[%s] %s",tech.slug,q)
                async for page,item in self.gh.search(q,max_pages=max_pages):
                    pages=max(pages,page)
                    full=item.get("full_name","?"); stars=item.get("stargazers_count","?")
                    if item["id"] in seen_ids:
                        dupes+=1; log.debug("  · dup %s (already seen this run)",full);continue
                    seen_ids.add(item["id"]);results+=1
                    if max_repos and seen>=max_repos:break
                    if self.db.repository_is_fresh(item["id"],self.settings.refresh_after_days):
                        skipped_fresh+=1; log.debug("  · skip %s (fresh, enriched < %dd ago)",full,self.settings.refresh_after_days);continue
                    seen+=1
                    log.info("  → [%d] processing %s (★%s)",seen,full,stars)
                    hits=await self._process(item,techs,rules_by,allowed)
                    if hits:
                        accepted+=1
                        for slug in hits: by_tech[slug]=by_tech.get(slug,0)+1
            log.info("✓ done: %d results, %d processed, %d assigned to a domain (%d dup, %d fresh) across %d page(s); rate limit %s/%s remaining",
                     results,seen,accepted,dupes,skipped_fresh,pages,self.gh.rate.get("remaining"),self.gh.rate.get("limit"))
            self.db.finish_run(run_id,status="completed",page_count=pages,result_count=results,candidate_count=seen,
                rate_limit_limit=self.gh.rate.get("limit"),rate_limit_remaining=self.gh.rate.get("remaining"),rate_limit_used=self.gh.rate.get("used"))
            return {"correlation_id":correlation,"technologies":len(techs),"queries":len(plan),"results":results,"processed":seen,
                    "assigned_repos":accepted,"by_technology":dict(sorted(by_tech.items(),key=lambda x:-x[1]))}
        except Exception as e:
            log.error("✗ run failed after %d processed: %s: %s",seen,type(e).__name__,e)
            self.db.finish_run(run_id,status="failed",page_count=pages,result_count=results,candidate_count=seen,error={"type":type(e).__name__,"message":str(e)})
            raise

    def _qualify_all(self,repo_id,manifests,manifest_paths,topics,blob,techs,rules_by,dry_run=False):
        """Score one repository against every technology and persist each
        accepted assignment. Shared by discover (runtime) and qualify (stored)."""
        hits=[]
        for tech in techs:
            d=qualify(tech,rules_by.get(tech.id,[]),manifests,manifest_paths,topics,blob)
            if d.accepted:
                hits.append((tech,d))
                if not dry_run: self.db.save_detection(repo_id,tech.id,d)
        return hits

    def qualify_stored(self,limit:int|None=None,dry_run:bool=False)->dict:
        """Repo-centric pass: score every already-scraped repository against all
        enabled technologies and assign each to the domain(s) it qualifies for.
        Runs entirely off stored data — no GitHub search or enrichment."""
        techs=self.db.get_all_technologies(); rules_by=self.db.get_rules_by_technology()
        repos=self.db.fetch_repositories(limit=limit)
        log.info("▶ qualifying %d repositor%s against %d technolog%s%s",
                 len(repos),"y" if len(repos)==1 else "ies",len(techs),"y" if len(techs)==1 else "ies"," (dry run)" if dry_run else "")
        assignments=matched_repos=0; by_tech:dict[str,int]={}
        for repo in repos:
            manifests=repo["manifests"]; topics=repo["topics"]
            blob="\n".join([repo.get("description") or ""," ".join(topics)]
                           +[ (m.get("raw") or "")[:15000] for m in manifests.values() ])
            paths=set(manifests)
            hits=self._qualify_all(repo["id"],manifests,paths,topics,blob,techs,rules_by,dry_run=dry_run)
            if hits:
                matched_repos+=1; assignments+=len(hits)
                for tech,_ in hits: by_tech[tech.slug]=by_tech.get(tech.slug,0)+1
                log.info("  ✓ %s → %s",repo["full_name"],", ".join(f"{t.slug}({d.confidence:.0f})" for t,d in sorted(hits,key=lambda h:-h[1].confidence)))
            else:
                log.debug("  · %s → no domain",repo["full_name"])
        metrics=stars=0
        if not dry_run:
            metrics,stars=self.db.backfill_metrics()
            log.info("  backfilled %d metric snapshot(s) and %d star snapshot(s) from stored data",metrics,stars)
        log.info("✓ done: %d/%d repos assigned, %d total assignment(s) across %d technolog%s%s",
                 matched_repos,len(repos),assignments,len(by_tech),"y" if len(by_tech)==1 else "ies"," (dry run — nothing written)" if dry_run else "")
        return {"repositories":len(repos),"assigned_repos":matched_repos,"assignments":assignments,
                "metrics_snapshots":metrics,"star_snapshots":stars,"by_technology":dict(sorted(by_tech.items(),key=lambda x:-x[1]))}

    async def _process(self,item,techs,rules_by,allowed)->list[str]:
        """Enrich one repository once, then qualify it against every technology."""
        full=item["full_name"]
        log.debug("    fetching repo detail, topics, languages, contents for %s",full)
        detail,topics,languages,root=await asyncio.gather(self.gh.repository(full),self.gh.topics(full),self.gh.languages(full),self.gh.root(full))
        repo_id=self.db.upsert_repository(detail); self.db.replace_topics(repo_id,topics); self.db.replace_languages(repo_id,languages)
        self.db.record_metrics(repo_id,detail)
        log.debug("    upserted repo_id=%s (%d topics, %d languages)",repo_id,len(topics),len(languages))
        root_paths={x.get("path","") for x in root}
        wanted=set(DEFAULT_MANIFESTS); wanted.update(r.manifest_path for rules in rules_by.values() for r in rules if r.manifest_path)
        log.debug("    fetching %d candidate manifest file(s)",len(wanted))
        fetched=await asyncio.gather(*(self.gh.file(full,p) for p in sorted(wanted)))
        manifests={}; text=[]
        for f in fetched:
            if not f:continue
            raw=f["raw"]; parsed=None
            if f["path"].endswith(".json"):
                try:parsed=json.loads(raw)
                except json.JSONDecodeError:pass
            manifests[f["path"]]={"json":parsed,"raw":raw};text.append(raw[:15000])
            self.db.upsert_manifest(repo_id,f["path"],f["sha"],f["etag"],f["size"],parsed,raw[:5000])
        log.debug("    found %d manifest(s): %s",len(manifests),", ".join(sorted(manifests)) or "none")
        blob="\n".join(text+[detail.get("description") or ""," ".join(topics)])
        hits=self._qualify_all(repo_id,manifests,root_paths|set(manifests),topics,blob,techs,rules_by)
        c=classify(detail,topics,blob,allowed); self.db.save_classification(repo_id,c)
        log.info("    %s%s · type=%s",full,
                 " → "+", ".join(f"{t.slug}({d.confidence:.0f})" for t,d in sorted(hits,key=lambda h:-h[1].confidence)) if hits else " → no domain",
                 c.project_type)
        return [t.slug for t,_ in hits]
