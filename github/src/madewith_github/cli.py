import asyncio,json,logging,sys
import typer
from .config import Settings
from .service import DiscoveryService
app=typer.Typer(no_args_is_help=True)


def _setup_logging(verbose:bool)->None:
    handler=logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-5s %(message)s","%H:%M:%S"))
    root=logging.getLogger("madewith_github")
    root.handlers.clear(); root.addHandler(handler)
    root.setLevel(logging.DEBUG if verbose else logging.WARNING)
    root.propagate=False


@app.command()
def discover(window_days:int=30,max_pages:int=10,
             max_repos:int=typer.Option(None,"--max-repos",help="Stop after processing this many unique repositories."),
             verbose:bool=typer.Option(True,"--verbose/--quiet","-v/-q",help="Log progress to stderr as it runs.")):
    """Discover repositories across all enabled technologies and qualify each at
    runtime — every repo is assigned to the domain(s) it belongs to in one pass."""
    _setup_logging(verbose)
    async def main():
        svc=DiscoveryService(Settings())
        try: print(json.dumps(await svc.run(window_days,max_pages,max_repos),indent=2,default=str))
        finally: await svc.close()
    asyncio.run(main())


@app.command()
def qualify(limit:int=typer.Option(None,"--limit",help="Only process the top-N repositories (by stars)."),
            dry_run:bool=typer.Option(False,"--dry-run",help="Score and report without writing assignments."),
            verbose:bool=typer.Option(True,"--verbose/--quiet","-v/-q",help="Log progress to stderr as it runs.")):
    """Assign every already-scraped repository to the technology domain(s) it
    qualifies for. Runs entirely off stored data — no GitHub calls."""
    _setup_logging(verbose)
    async def main():
        svc=DiscoveryService(Settings())
        try: print(json.dumps(svc.qualify_stored(limit=limit,dry_run=dry_run),indent=2,default=str))
        finally: await svc.close()
    asyncio.run(main())
