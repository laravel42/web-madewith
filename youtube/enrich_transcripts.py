#!/usr/bin/env python3
"""Turn raw YouTube captions into the published transcript v3 JSON schema.

Raw caption files live in youtube/data/transcripts/<videoId>.json. Published,
AI-structured files live in src/data/transcripts/<videoId>.json. Each published
file carries four artifacts generated from the raw speech:

  1. `chapters`   — intelligent topic segmentation (title, description, start/end
                    seconds, anchor slug) so viewers can skip to relevant parts.
  2. `seoDescription` — a cohesive, SEO-focused ~500-character summary of the
                    video's topics.
  3. `summary`    — an elegant, scannable Markdown "key concepts" document.
  4. `transcription` — the full literal speech, reorganised as Markdown split
                    into one `## <chapter>` section per chapter (anchors align
                    with `chapters[].slug`, so a floating nav links straight in).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
import unicodedata
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = Path(__file__).resolve().parent / "data" / "transcripts"
OUT_DIR = ROOT / "src" / "data" / "transcripts"

SCHEMA_VERSION = 3
# Output-token reservation. Kept modest: tutorial transcriptions need ~6-10k
# tokens, and providers like OpenRouter reserve credits up-front against this
# value, so an over-large cap can 402 on a credit-limited account.
MAX_OUTPUT_TOKENS = 16_000
SEO_MIN, SEO_TARGET, SEO_MAX = 300, 500, 560


def clock(seconds: float) -> str:
    total = max(0, int(seconds))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}" if hours else f"{minutes:02d}:{secs:02d}"


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-") or "section"


def unique_slugs(titles: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    out: list[str] = []
    for title in titles:
        base = slugify(title)
        n = seen.get(base, 0) + 1
        seen[base] = n
        out.append(base if n == 1 else f"{base}-{n}")
    return out


def raw_text_for_range(raw: dict[str, Any], start: float, end: float) -> str:
    """Literal caption text whose segments fall in [start, end) — used as a
    fallback when the model leaves a chapter's transcript empty (which happens
    on long videos where one response can't hold the whole cleaned transcript)."""
    parts = [
        str(seg.get("text", "")).strip()
        for seg in raw.get("segments", [])
        if start <= float(seg.get("start", -1)) < end and str(seg.get("text", "")).strip()
    ]
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def timestamped_source(raw: dict[str, Any]) -> str:
    return "\n".join(
        f"[{clock(float(segment['start']))}] {str(segment['text']).strip()}"
        for segment in raw.get("segments", [])
        if str(segment.get("text", "")).strip()
    )


def parse_model_json(raw: str) -> dict[str, Any]:
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    result = json.loads(cleaned)
    if not isinstance(result, dict):
        raise ValueError("Model output must be a JSON object")
    return result


def trim_seo(text: str) -> str:
    """Tidy the SEO description to ~500 chars, cutting on a sentence/word edge."""
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(text) <= SEO_MAX:
        return text
    window = text[:SEO_MAX]
    cut = max(window.rfind(". "), window.rfind("! "), window.rfind("? "))
    if cut >= SEO_MIN:
        return window[: cut + 1].strip()
    cut = window.rfind(" ")
    return (window[:cut] if cut >= SEO_MIN else window).strip().rstrip(",;:") + "…"


def normalize_result(raw: dict[str, Any], generated: dict[str, Any], duration_seconds: float) -> dict[str, Any]:
    chapters = generated.get("chapters")
    summary = generated.get("summary")
    seo = generated.get("seoDescription")
    if not isinstance(chapters, list) or not chapters:
        raise ValueError("chapters must be a non-empty array")
    if not isinstance(summary, str) or len(summary.strip()) < 20:
        raise ValueError("summary must be meaningful Markdown")
    if not isinstance(seo, str) or len(seo.strip()) < 40:
        raise ValueError("seoDescription must be a meaningful sentence")

    slugs = unique_slugs([str(c.get("title", "")).strip() for c in chapters])
    normalized: list[dict[str, Any]] = []
    body_sections: list[str] = []
    previous_end = 0.0
    for index, chapter in enumerate(chapters):
        if not isinstance(chapter, dict):
            raise ValueError(f"chapter {index} must be an object")
        title = str(chapter.get("title", "")).strip()
        description = str(chapter.get("description", "")).strip()
        transcript = str(chapter.get("transcript", "")).strip()
        try:
            start = float(chapter["startTime"])
            end = float(chapter["endTime"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"chapter {index} requires numeric startTime and endTime") from exc
        if not title or not description:
            raise ValueError(f"chapter {index} requires title and description")
        if len(transcript) < 20:
            # Model returned an empty/stub transcript for this chapter (common on
            # long videos) — rebuild it from the raw captions in its time window.
            transcript = raw_text_for_range(raw, start, end) or transcript or f"_{description}_"
        if start < 0 or end <= start:
            raise ValueError(f"chapter {index} endTime must be greater than startTime")
        if start < previous_end - 1:
            raise ValueError(f"chapter {index} overlaps the previous chapter")
        normalized.append({
            "title": title,
            "description": description,
            "startTime": round(start, 3),
            "endTime": round(min(end, duration_seconds), 3),
            "slug": slugs[index],
        })
        body_sections.append(f"## {title}\n\n{transcript}")
        previous_end = end

    if normalized[-1]["startTime"] >= duration_seconds:
        raise ValueError("final chapter starts after the video ends")
    normalized[-1]["endTime"] = round(duration_seconds, 3)

    return {
        "schemaVersion": SCHEMA_VERSION,
        "videoId": str(raw["videoId"]),
        "language": str(raw.get("language") or "unknown"),
        "source": str(raw.get("source") or "unknown"),
        "seoDescription": trim_seo(seo),
        "chapters": normalized,
        "summary": summary.strip(),
        "transcription": "\n\n".join(body_sections),
    }


def prompt_for(raw: dict[str, Any], title: str, duration_seconds: float, include_transcripts: bool = True) -> str:
    if include_transcripts:
        chapter_schema = """{"title": "Chapter title", "description": "One sentence on what this chapter covers.",
      "startTime": 0, "endTime": 60.5, "transcript": "Markdown of the literal speech in this chapter."}"""
        transcript_rule = """- chapter `transcript`: the literal speech-to-text for that chapter as clean, readable Markdown
  (short paragraphs). Fix punctuation, capitalization, and obvious caption errors, and drop non-speech
  noise like isolated [Music] markers and duplicated fragments — but do NOT summarize, invent, reorder,
  or omit substantive content. Together the chapter transcripts are the complete transcription.
"""
        transcript_field = "and a `transcript` field"
    else:
        # Structure-only mode for videos whose full cleaned transcript can't fit
        # in one response: the literal transcription is rebuilt from the raw
        # captions per chapter window instead (see normalize_result).
        chapter_schema = """{"title": "Chapter title", "description": "One sentence on what this chapter covers.",
      "startTime": 0, "endTime": 60.5}"""
        transcript_rule = ""
        transcript_field = "and numeric times only — do NOT include the speech text"
    return f"""You are an expert technical video editor and SEO writer. Read the timestamped
transcript and return JSON ONLY (no prose, no code fence) with exactly these keys:

{{
  "seoDescription": "One cohesive paragraph.",
  "chapters": [
    {chapter_schema}
  ],
  "summary": "Markdown key-concepts document."
}}

Requirements:
- chapters: segment the ENTIRE video into coherent topic/argument chunks in chronological
  order. Each needs a specific, descriptive title, a useful one-sentence description, numeric
  startTime and endTime in seconds, {transcript_field}. Cover the full {duration_seconds:.0f}-second
  runtime with no gaps or overlaps (first startTime 0; each startTime equals the previous endTime).
{transcript_rule}- seoDescription: a single cohesive, natural paragraph of ~450-520 characters describing what the
  video teaches and its value. Weave in the core topics/technologies as keywords. No clickbait, no
  "in this video", no hashtags, no emojis.
- summary: an elegant, scannable Markdown "key concepts" document. Use `##` section headings, **bold**
  for key terms, bullet lists, and GitHub-style callouts (> [!TIP], > [!NOTE], > [!IMPORTANT]) where
  they add value. Capture the most important concepts, decisions, examples, warnings, and takeaways.
  Be substantive but do not pad; add no facts absent from the speech.

Video title: {title}
Language: {raw.get('language', 'unknown')}

TIMESTAMPED RAW CAPTIONS
{timestamped_source(raw)}
""".strip()


class TruncatedOutput(RuntimeError):
    """The model ran out of output tokens before finishing the JSON."""


def generate(client: Any, model: str, prompt: str, max_output_tokens: int = MAX_OUTPUT_TOKENS) -> dict[str, Any]:
    import openai

    # Misconfiguration fails the same way on every retry — surface it at once.
    fatal = (openai.AuthenticationError, openai.PermissionDeniedError, openai.NotFoundError, openai.BadRequestError)
    kwargs: dict[str, Any] = {"model": model, "input": prompt, "max_output_tokens": max_output_tokens}
    if model.startswith("gpt-5"):
        # Reasoning models spend max_output_tokens on hidden reasoning *before*
        # the visible JSON; at the default effort a long transcript exhausts the
        # cap and the response comes back incomplete/empty.
        kwargs["reasoning"] = {"effort": "low"}
        # Constrained JSON decoding — long transcript fields otherwise pick up
        # unescaped quotes/newlines that json.loads rejects.
        kwargs["text"] = {"format": {"type": "json_object"}}
    print(f"    → {model} ({len(prompt):,} chars in"
          + (", reasoning=low" if "reasoning" in kwargs else "")
          + f", max_output_tokens={max_output_tokens:,})")
    for attempt in range(5):
        try:
            t0 = time.time()
            response = client.responses.create(**kwargs)
            dt = time.time() - t0
            usage = getattr(response, "usage", None)
            if usage is not None:
                reasoning = getattr(getattr(usage, "output_tokens_details", None), "reasoning_tokens", 0) or 0
                print(f"    ← {dt:.1f}s — tokens: {usage.input_tokens:,} in, {usage.output_tokens:,} out"
                      f" ({reasoning:,} reasoning, {usage.output_tokens - reasoning:,} visible)")
            else:
                print(f"    ← {dt:.1f}s")
            if getattr(response, "status", None) == "incomplete":
                reason = getattr(getattr(response, "incomplete_details", None), "reason", None) or "unknown"
                raise TruncatedOutput(f"response incomplete ({reason}, max_output_tokens={max_output_tokens})")
            return parse_model_json(response.output_text)
        except (TruncatedOutput, *fatal):
            raise
        except Exception as exc:
            if attempt == 4:
                raise
            wait = min(30, 2 ** attempt)
            print(f"    attempt {attempt + 1}/5 {type(exc).__name__}: {str(exc)[:120]} — retrying in {wait}s")
            time.sleep(wait)
    raise RuntimeError("unreachable")


def metadata() -> dict[str, tuple[str, float, str]]:
    import psycopg

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn, conn.cursor() as cur:
        cur.execute("SELECT youtube_video_id, title, COALESCE(duration_seconds, 0), COALESCE(catalog_slug, '') "
                    "FROM youtube_videos")
        return {video_id: (title, float(duration), slug) for video_id, title, duration, slug in cur.fetchall()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default=str(RAW_DIR), help="Raw-caption directory")
    parser.add_argument("--out", default=str(OUT_DIR), help="Published transcript directory")
    parser.add_argument("--video-id", help="Process one YouTube video ID")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--model", help="OpenAI model; defaults to OPENAI_MODEL or gpt-5-mini")
    parser.add_argument("--max-output-tokens", type=int, default=MAX_OUTPUT_TOKENS,
                        help=f"Output-token reservation per request (default {MAX_OUTPUT_TOKENS})")
    parser.add_argument("--force", action="store_true", help="Replace an existing up-to-date output")
    parser.add_argument("--dry-run", action="store_true", help="Validate inputs without calling OpenAI")
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    input_dir, out_dir = Path(args.input), Path(args.out)
    raw_files = sorted(input_dir.glob("*.json"))
    if args.video_id:
        raw_files = [input_dir / f"{args.video_id}.json"]
    raw_files = [path for path in raw_files if path.exists()]

    def already_enriched(path: Path) -> bool:
        """Raw and published files share the <videoId>.json name."""
        output = out_dir / path.name
        if not output.exists():
            return False
        try:
            return json.loads(output.read_text()).get("schemaVersion") == SCHEMA_VERSION
        except (OSError, json.JSONDecodeError):
            return False

    # Apply --limit to videos that still NEED work, not to raw files: otherwise
    # already-enriched files consume the limit and repeated runs re-scan the
    # same alphabetical prefix forever instead of advancing through the queue.
    skipped = 0
    candidates: list[Path] = []
    for path in raw_files:
        if not args.force and already_enriched(path):
            skipped += 1
        elif len(candidates) < args.limit:
            candidates.append(path)
    if args.dry_run:
        for path in candidates:
            raw = json.loads(path.read_text())
            print(f"{raw['videoId']}: {len(raw.get('segments', []))} segments")
        return 0
    if not os.getenv("OPENAI_API_KEY"):
        raise SystemExit("OPENAI_API_KEY is required")

    from openai import OpenAI

    info = metadata()
    model = args.model or os.getenv("OPENAI_MODEL", "gpt-5-mini")
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    out_dir.mkdir(parents=True, exist_ok=True)
    beyond_limit = len(raw_files) - skipped - len(candidates)
    print(f"model={model}  max_output_tokens={args.max_output_tokens:,}")
    print(f"raw:  {input_dir}  ({len(raw_files)} file(s): {skipped} already enriched (v{SCHEMA_VERSION}), "
          f"{len(candidates)} to process"
          + (f", {beyond_limit} beyond --limit {args.limit}" if beyond_limit > 0 else "") + ")")
    print(f"out:  {out_dir}")
    print(f"db:   {len(info)} videos with metadata\n")
    written = failed = 0
    t_start = time.time()
    for index, path in enumerate(candidates, 1):
        raw = json.loads(path.read_text())
        video_id = str(raw["videoId"])
        output = out_dir / f"{video_id}.json"
        title, db_duration, slug = info.get(video_id, (video_id, 0.0, "?"))
        segments = raw.get("segments", [])
        inferred_duration = float(segments[-1]["start"]) + 5 if segments else 0.0
        duration = max(db_duration, inferred_duration)
        print(f"[{index:>3}/{len(candidates)}] {video_id}  {slug}  \"{title[:60]}\""
              f"  ({clock(duration)}, {len(segments)} segments)")
        t_video = time.time()
        try:
            try:
                generated = generate(client, model, prompt_for(raw, title, duration), args.max_output_tokens)
            except TruncatedOutput as exc:
                # The full cleaned transcript doesn't fit in one response. Ask
                # for structure only; normalize_result rebuilds each chapter's
                # transcription from the raw captions in its time window.
                print(f"    {exc} — retrying structure-only (transcription will be rebuilt from raw captions)")
                generated = generate(client, model,
                                     prompt_for(raw, title, duration, include_transcripts=False),
                                     args.max_output_tokens)
            result = normalize_result(raw, generated, duration)
            output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
            written += 1
            print(f"    ok in {time.time() - t_video:.1f}s — {len(result['chapters'])} chapters, "
                  f"seo {len(result['seoDescription'])} chars, summary {len(result['summary']):,} chars, "
                  f"transcription {len(result['transcription']):,} chars → {output.name}")
        except Exception as exc:
            failed += 1
            print(f"    FAIL in {time.time() - t_video:.1f}s — {type(exc).__name__}: {exc}")
            import openai
            if isinstance(exc, (openai.AuthenticationError, openai.PermissionDeniedError, openai.NotFoundError)):
                raise SystemExit(
                    f"Aborting: {type(exc).__name__} — every video would fail the same way. "
                    "Check OPENAI_API_KEY and the model name "
                    f"(model={model}; override with OPENAI_MODEL or --model).")
        processed = written + failed
        remaining = len(candidates) - index
        if processed and remaining:
            eta = (time.time() - t_start) / processed * remaining
            print(f"    elapsed {clock(time.time() - t_start)}, ~{clock(eta)} remaining for {remaining} video(s)")
    print(f"\nDone in {clock(time.time() - t_start)} — written={written} skipped={skipped} failed={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
