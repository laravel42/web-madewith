from __future__ import annotations
import asyncio, base64, logging, time
from typing import Any, AsyncIterator
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

log=logging.getLogger("madewith_github.github")

class GitHubError(RuntimeError): pass
# Raised when the primary GitHub rate limit is exhausted with a long reset. It is
# deliberately NOT a GitHubError, so tenacity does not retry it — it propagates
# straight up so the caller can terminate the run instead of sleeping for minutes.
class RateLimitExceeded(RuntimeError): pass

class GitHubClient:
    def __init__(self, token:str, api_version:str, timeout:float=30, rate_limit_max_wait:float=120):
        self.client=httpx.AsyncClient(base_url="https://api.github.com", timeout=timeout, headers={"Accept":"application/vnd.github+json","Authorization":f"Bearer {token}","X-GitHub-Api-Version":api_version,"User-Agent":"madewith-github-discovery/0.1"})
        self.rate:dict[str,Any]={}
        self.max_rate_wait=rate_limit_max_wait
    async def close(self): await self.client.aclose()

    @retry(stop=stop_after_attempt(5),wait=wait_exponential(min=1,max=30),retry=retry_if_exception_type((httpx.TransportError,httpx.TimeoutException,GitHubError)))
    async def get(self,path:str,params:dict[str,Any]|None=None,headers:dict[str,str]|None=None,allow_404=False)->httpx.Response:
        r=await self.client.get(path,params=params,headers=headers)
        self.rate={"limit":r.headers.get("x-ratelimit-limit"),"remaining":r.headers.get("x-ratelimit-remaining"),"used":r.headers.get("x-ratelimit-used"),"reset":r.headers.get("x-ratelimit-reset")}
        if r.status_code==404 and allow_404:return r
        if r.status_code in (403,429):
            remaining=r.headers.get("x-ratelimit-remaining"); reset=r.headers.get("x-ratelimit-reset")
            wait=max(0,int(reset)-int(time.time())) if reset else 0
            # Exhausted primary limit with a long reset (e.g. the 5,000/hr core
            # quota): stop the run rather than sleep for minutes. A short reset
            # (the per-minute search quota) still gets a brief sleep + retry.
            if remaining=="0" and wait>self.max_rate_wait:
                raise RateLimitExceeded(f"GitHub rate limit exhausted; resets in {wait}s")
            if reset: await asyncio.sleep(min(60,max(1,wait)))
            raise GitHubError(f"Rate limited: {r.text[:200]}")
        if r.status_code>=500: raise GitHubError(f"GitHub {r.status_code}")
        r.raise_for_status(); return r

    async def search(self,query:str,start_page:int=1,max_pages:int=10)->AsyncIterator[tuple[int,dict[str,Any]]]:
        for page in range(start_page,max_pages+1):
            items=await self.search_page(query,page)
            for item in items: yield page,item
            if len(items)<100:return

    async def search_page(self,query:str,page:int)->list[dict[str,Any]]:
        r=await self.get("/search/repositories",{"q":query,"sort":"updated","order":"desc","per_page":100,"page":page})
        data=r.json(); items=data.get("items",[])
        log.debug("    page %d: %d result(s) (total_count=%s, rate %s/%s)",page,len(items),data.get("total_count"),self.rate.get("remaining"),self.rate.get("limit"))
        return items

    async def repository(self,full_name:str)->dict[str,Any]:
        r=await self.get(f"/repos/{full_name}"); data=r.json(); data["_etag"]=r.headers.get("etag"); return data
    async def topics(self,full_name:str)->list[str]: return (await self.get(f"/repos/{full_name}/topics")).json().get("names",[])
    async def languages(self,full_name:str)->dict[str,int]: return (await self.get(f"/repos/{full_name}/languages")).json()
    async def root(self,full_name:str)->list[dict[str,Any]]: return (await self.get(f"/repos/{full_name}/contents")).json()
    async def file(self,full_name:str,path:str)->dict[str,Any]|None:
        r=await self.get(f"/repos/{full_name}/contents/{path}",allow_404=True)
        if r.status_code==404:return None
        data=r.json(); raw=base64.b64decode(data.get("content","")).decode("utf-8","replace") if data.get("encoding")=="base64" else ""
        return {"path":path,"sha":data.get("sha"),"size":data.get("size"),"etag":r.headers.get("etag"),"raw":raw}
