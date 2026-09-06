from __future__ import annotations
import hashlib,re
from collections import defaultdict
from typing import Any
from .models import Classification

PROJECT_TYPES={
 "application":["dashboard","platform","application","self-hosted","saas","workspace"],
 "website":["website","landing page","portfolio","blog","documentation site"],
 "library":["library","sdk","package","module","component library"],
 "plugin":["plugin","extension","adapter","integration"],
 "developer-tool":["cli","developer tool","code generator","linter","compiler","debugger"],
 "starter":["starter","boilerplate","scaffold","template"],
}
CATEGORIES={
 "cms":["cms","content management","headless cms","content editor"],"crm":["crm","customer relationship","sales pipeline","leads"],
 "ecommerce":["ecommerce","e-commerce","shopping cart","storefront","commerce"],"analytics":["analytics","business intelligence","dashboard","metrics"],
 "authentication":["authentication","identity","oauth","sso","auth"],"database":["database","postgres","mysql","orm","vector database"],
 "devops":["devops","deployment","kubernetes","docker","infrastructure","observability"],"ai-ml":["ai agent","machine learning","llm","inference","rag"],
 "communication":["chat","messaging","video conference","email"],"project-management":["project management","tasks","kanban","issue tracker"],
 "security":["security","vulnerability","scanner","secrets"],"education":["learning management","education","course","lms"],
 "finance":["finance","accounting","invoice","billing","payment"],"media":["video","audio","photo","media server"],
}
NEGATIVE=["awesome list","curated list","tutorial","course examples","interview questions"]

def classify(repo:dict[str,Any],topics:list[str],manifest_text:str,allowed:list[str])->Classification:
    text=" ".join([repo.get("name") or "",repo.get("description") or ""," ".join(topics),manifest_text[:12000]]).lower()
    rules=[]; type_scores=defaultdict(float); cat_scores=defaultdict(float)
    for typ,terms in PROJECT_TYPES.items():
        for term in terms:
            if re.search(rf"\b{re.escape(term)}\b",text): type_scores[typ]+=18; rules.append({"kind":"project_type","label":typ,"term":term,"score":18})
    if repo.get("is_template"):type_scores["starter"]+=50;rules.append({"kind":"github_flag","label":"starter","score":50})
    for cat,terms in CATEGORIES.items():
        for term in terms:
            if re.search(rf"\b{re.escape(term)}\b",text):cat_scores[cat]+=20;rules.append({"kind":"category","label":cat,"term":term,"score":20})
    penalty=sum(20 for n in NEGATIVE if n in text)
    typ=max(type_scores,key=type_scores.get) if type_scores else "unknown"
    if typ not in allowed:typ="unknown"
    type_conf=max(0,min(99,type_scores.get(typ,25)-penalty))
    ranked=sorted(cat_scores.items(),key=lambda x:x[1],reverse=True)
    cats=[k for k,v in ranked if v>=20][:5]; cat_conf=max(0,min(99,(ranked[0][1] if ranked else 20)-penalty))
    return Classification(typ,round(type_conf,2),cats,round(cat_conf,2),rules,llm_input_hash=hashlib.sha256(text.encode()).hexdigest())
