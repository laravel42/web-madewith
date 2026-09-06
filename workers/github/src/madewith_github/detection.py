from __future__ import annotations
import re
from typing import Any
from .models import Evidence,Rule,TechDetection,Technology

# repository_technologies.confidence is numeric(4,2) → it cannot store 100.00.
MAX_CONFIDENCE=99.99

# Point weights on a 0-100 confidence scale, paired with whether the signal is
# strong enough to justify an assignment on its own. A single strong signal
# clears the default quality_threshold (65); weak signals only corroborate.
# (The threshold lives on the same 0-100 scale as these points — the previous
# engine mixed a 0-1 rule scale with a 65-point threshold, so nothing ever
# passed.)
SIGNALS:dict[str,tuple[float,bool]]={
 "dependency":       (70.0,True),   # exact package/dependency declared in a manifest — the gold signal
 "dependency_prefix":(70.0,True),   # scoped-package family, e.g. "@nuxt/"
 "config_file":      (68.0,True),   # framework config file present (next.config.js, ...)
 "manifest_value":   (58.0,True),   # some other manifest selector matched
 "topic":            (66.0,True),   # repo self-declares the technology's GitHub topic — strong catalog evidence
 "runtime_signal":   (40.0,False),  # code-level hint in README/manifests
 "text":             (14.0,False),  # technology name/keyword mentioned in text (weak)
}
# Legacy technology_rules.rule_type values mapped onto the signal kinds above,
# so hand-authored rules and auto-derived signals share one scoring scale.
RULE_KIND={
 "dependency":"dependency","runtime_dependency":"dependency","dependency_prefix":"dependency_prefix",
 "config_file":"config_file","file_exists":"config_file","path_exists":"config_file",
 "manifest_value":"manifest_value","script":"manifest_value",
 "topic":"topic","runtime_signal":"runtime_signal",
 "readme_regex":"text","content_regex":"text","keyword":"text",
}
# Dependency sections across the ecosystems whose manifests parse as JSON
# (package.json, composer.json). Matched case-insensitively.
DEP_SECTIONS={"dependencies","devdependencies","peerdependencies","optionaldependencies","require","require-dev"}
# Non-JSON manifests whose raw text is a dependency declaration. Only these feed
# the token-based dependency fallback — matching against a README (also stored
# as a "manifest") would spuriously match common words like "next" or "react".
DEP_MANIFESTS_NONJSON={"requirements.txt","pyproject.toml","go.mod","gemfile","cargo.toml","pom.xml","build.gradle","build.gradle.kts","setup.py","pipfile"}

# Curated lists / learning resources are not projects "made with" a technology,
# even when they carry its topic. Patterns are deliberately tight so real
# libraries (e.g. "Collection of essential Vue utilities") are NOT matched.
NON_PROJECT=[re.compile(p,re.I) for p in (
    r"\bawesome[-\s]\w",
    r"\binterview\s+questions?\b",
    r"\bcheat[-\s]?sheets?\b",
    r"\bfree[-\s]programming[-\s]books?\b",
    r"\bcurated\s+(list|collection)\b",
    r"\b(developer|frontend|back[-\s]?end|web|coding)\s+roadmap\b",
    r"\blist\s+of\s+(payloads?|useful|awesome|resources|links|tools|libraries|frameworks|tutorials?|books|examples|cheat)",
    r"\bcollection\s+of\s+(resources|links|awesome|tutorials?|examples|cheat\w*)",
)]

def is_non_project(name:str,text:str)->bool:
    """True for curated lists / learning resources that shouldn't be assigned a
    domain even if they carry the topic (awesome lists, interview questions, ...)."""
    hay=f"{name or ''} {text or ''}"
    return any(p.search(hay) for p in NON_PROJECT)

def _ev(kind:str,location:str)->Evidence:
    score,strong=SIGNALS[kind]
    return Evidence(rule_id=None,kind=kind,location=location,value=location,score=score,strong=strong)

def _select(data:Any,path:str|None)->Any:
    if not path:return data
    cur=data
    for part in path.strip("$. ").split('.'):
        if isinstance(cur,dict):cur=cur.get(part)
        else:return None
    return cur

def _dep_keys(manifests:dict[str,dict[str,Any]])->set[str]:
    """Exact dependency names declared in any parsed JSON manifest."""
    keys:set[str]=set()
    for m in manifests.values():
        data=m.get("json")
        if not isinstance(data,dict):continue
        for section,val in data.items():
            if section.lower() in DEP_SECTIONS and isinstance(val,dict):
                keys.update(str(k).lower() for k in val)
    return keys

def _dep_manifest_text(manifests:dict[str,dict[str,Any]])->str:
    """Raw text of the non-JSON dependency manifests (requirements.txt, go.mod,
    Gemfile, ...) so dependency names can be matched there too. Restricted to
    real dependency files — not every stored blob (a README would false-match)."""
    return "\n".join((m.get("raw") or "") for p,m in manifests.items()
                     if p.rsplit("/",1)[-1].lower() in DEP_MANIFESTS_NONJSON).lower()

def _token(text:str,needle:str)->bool:
    return bool(needle) and re.search(rf"(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])",text) is not None

# Vendors whose package namespace is shared plumbing across the whole ecosystem:
# depending on symfony/yaml does NOT make a repo a Symfony app (every large
# Laravel/Drupal project pulls symfony/* components). For these slugs the bare
# vendor-family match is disabled and only the canonical framework packages
# count as the gold dependency signal.
SHARED_COMPONENT_VENDORS:dict[str,set[str]]={
 "symfony":{"symfony/framework-bundle","symfony/symfony"},
}

# A repo whose topics span this many catalog technologies is a multi-tech tool
# (deploy platform, admin for many stacks, boilerplate hub) — its topics
# advertise what it SUPPORTS, not what it's MADE WITH, so a topic alone stops
# being strong evidence. Genuine multi-framework projects still qualify through
# manifest dependency evidence. (Real-world case: coolify tags nextjs/nodejs/
# svelte/laravel and was published into all four galleries.)
TOPIC_BREADTH_LIMIT=3

def _slug_candidates(tech:Technology)->set[str]:
    # Best-effort package names for technologies that carry no metadata/rules:
    # a repo whose manifest depends on a package literally named after the slug
    # is almost certainly using that technology.
    s=tech.slug.lower()
    return {c for c in (s,s.replace("-",""),s.replace("-",".")) if c}

def _match_dependency(candidates:set[str],dep_keys:set[str],dep_text:str)->str|None:
    for c in sorted(candidates):
        c=c.lower()
        if not c:continue
        # exact key, vendor family (composer "vendor/pkg"), or a token in a
        # non-JSON manifest (requirements.txt "Django", go.mod ".../gin").
        if any(k==c or k.startswith(c+"/") for k in dep_keys) or _token(dep_text,c):
            return c
    return None

def qualify(tech:Technology,rules:list[Rule],manifests:dict[str,dict[str,Any]],
            manifest_paths:set[str],topics:list[str],text_blob:str,
            topic_breadth:int=1)->TechDetection:
    """Score a single repository against a single technology, combining
    auto-derived signals (from the technology's slug/name/topics/metadata) with
    any hand-authored technology_rules. Accepts when the confidence clears the
    technology's quality_threshold AND at least one strong signal is present."""
    meta=tech.metadata or {}
    dep_keys=_dep_keys(manifests)
    dep_text=_dep_manifest_text(manifests)
    topics_l={t.lower() for t in topics}
    paths_l={p.lower() for p in manifest_paths}
    text=text_blob.lower()
    ev:list[Evidence]=[]

    # dependency — exact package / vendor family
    dep_cands=set(meta.get("dependencies") or [])|_slug_candidates(tech)
    dep_cands|={r.expected_value for r in rules if RULE_KIND.get(r.rule_type)=="dependency" and r.expected_value}
    if tech.slug.lower() in SHARED_COMPONENT_VENDORS:
        # drop the bare-slug candidates (family match would claim every consumer
        # of the shared components) and require the canonical framework packages
        dep_cands-= _slug_candidates(tech)
        dep_cands|=SHARED_COMPONENT_VENDORS[tech.slug.lower()]
    if (hit:=_match_dependency(dep_cands,dep_keys,dep_text)):
        ev.append(_ev("dependency",f"dependency:{hit}"))

    # dependency prefix — scoped families like "@nuxt/"
    pref_cands=set(meta.get("dependency_prefixes") or [])
    pref_cands|={r.expected_value for r in rules if r.rule_type=="dependency_prefix" and r.expected_value}
    if (ph:=next((p for p in sorted(pref_cands) if p and (any(k.startswith(p.lower()) for k in dep_keys) or p.lower() in dep_text)),None)):
        ev.append(_ev("dependency_prefix",f"prefix:{ph}"))

    # config file present (from rules)
    for r in rules:
        if RULE_KIND.get(r.rule_type)=="config_file":
            target=(r.manifest_path or r.selector or r.expected_value or "").lower()
            if target and any(p==target or p.startswith(target.rstrip('/')+'/') for p in paths_l):
                ev.append(_ev("config_file",f"file:{target}"));break

    # other manifest selector rules
    for r in rules:
        if RULE_KIND.get(r.rule_type)=="manifest_value":
            val=_select((manifests.get(r.manifest_path or "") or {}).get("json"),r.selector)
            if val is not None and ((r.expected_value or "").lower() in str(val).lower() if r.expected_value else True):
                ev.append(_ev("manifest_value",f"{r.manifest_path}:{r.selector}"));break

    # topic — repo self-declares the technology
    topic_cands={t.lower() for t in (tech.search_topics or [])}|{tech.slug.lower()}
    topic_cands|={r.expected_value.lower() for r in rules if r.rule_type=="topic" and r.expected_value}
    if (thit:=topic_cands&topics_l):
        e=_ev("topic",f"topic:{sorted(thit)[0]}")
        # Multi-tech tools (topics spanning >= TOPIC_BREADTH_LIMIT catalog techs)
        # keep the topic's score but lose its standalone accepting power.
        if topic_breadth>=TOPIC_BREADTH_LIMIT:e.strong=False
        ev.append(e)

    # runtime-signal rules (code-level hints in the text)
    for r in rules:
        if RULE_KIND.get(r.rule_type)=="runtime_signal" and (pat:=(r.expected_value or r.selector)):
            if re.search(pat,text_blob,re.I|re.M):ev.append(_ev("runtime_signal",f"runtime:{pat[:40]}"));break

    # weak text mention — technology name, keywords, or text/regex rules
    text_cands={tech.name.lower()}|{k.lower() for k in (tech.search_keywords or [])}
    if any(_token(text,c) for c in text_cands) or any(
        RULE_KIND.get(r.rule_type)=="text" and (r.expected_value or r.selector)
        and re.search(r.expected_value or r.selector,text_blob,re.I|re.M) for r in rules):
        ev.append(_ev("text","mention"))

    confidence=round(min(MAX_CONFIDENCE,sum(e.score for e in ev)),2)
    strong=any(e.strong for e in ev)
    threshold=tech.quality_threshold or 65
    accepted=strong and confidence>=threshold
    # Technologies flagged as runtimes (e.g. Node) match too loosely on a single
    # signal, so require corroboration before assigning them.
    if accepted and meta.get("requires_runtime_verification") and len(ev)<2:
        accepted=False
    return TechDetection(confidence=confidence,accepted=accepted,evidence=ev)
