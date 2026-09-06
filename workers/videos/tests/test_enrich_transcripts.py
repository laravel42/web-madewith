from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).parents[1] / "enrich_transcripts.py"
SPEC = importlib.util.spec_from_file_location("enrich_transcripts", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def _generated():
    return {
        "seoDescription": (
            "A hands-on Laravel tutorial that walks through building a REST API from scratch: "
            "routing, Eloquent models, controllers, validation, and authentication with Sanctum, "
            "plus testing and deployment tips for shipping a production-ready backend."
        ),
        "chapters": [
            {
                "title": "Introduction",
                "description": "What the tutorial covers and who it is for.",
                "startTime": 0,
                "endTime": 119.9,
                "transcript": "Welcome to the tutorial. Today we build a REST API with Laravel.",
            },
            {
                "title": "Wrap-up",
                "description": "The final takeaway and next steps.",
                "startTime": 120,
                "endTime": 125,
                "transcript": "That is the whole build. Deploy it and keep iterating.",
            },
        ],
        "summary": "## Key idea\n\n**Laravel** makes REST APIs fast to build.\n\n- Routing\n- Eloquent",
    }


class EnrichTranscriptTests(unittest.TestCase):
    def test_builds_timestamped_source_for_model(self) -> None:
        raw = {
            "videoId": "abc123",
            "segments": [
                {"start": 0.0, "text": "Welcome to the tutorial."},
                {"start": 65.2, "text": "Now configure the database."},
            ],
        }
        source = MODULE.timestamped_source(raw)
        self.assertEqual(source, "[00:00] Welcome to the tutorial.\n[01:05] Now configure the database.")

    def test_slugify_is_stable_and_deduped(self) -> None:
        self.assertEqual(MODULE.slugify("Getting Started with Laravel!"), "getting-started-with-laravel")
        self.assertEqual(MODULE.unique_slugs(["Setup", "Setup", "Setup"]), ["setup", "setup-2", "setup-3"])

    def test_normalizes_model_output_to_v3_schema(self) -> None:
        raw = {"videoId": "abc123", "language": "en", "source": "manual", "segments": []}
        result = MODULE.normalize_result(raw, _generated(), duration_seconds=125)

        self.assertEqual(result["schemaVersion"], 3)
        self.assertEqual(result["videoId"], "abc123")
        self.assertEqual(result["chapters"][0]["slug"], "introduction")
        self.assertEqual(result["chapters"][-1]["endTime"], 125)
        # transcription is assembled from per-chapter transcripts, anchored by title
        self.assertIn("## Introduction", result["transcription"])
        self.assertIn("## Wrap-up", result["transcription"])
        self.assertTrue(40 <= len(result["seoDescription"]) <= MODULE.SEO_MAX)
        self.assertNotIn("segments", result)
        self.assertNotIn("transcript", result["chapters"][0])  # folded into transcription

    def test_seo_description_is_trimmed_to_length(self) -> None:
        gen = _generated()
        gen["seoDescription"] = "This sentence repeats. " * 60  # ~1380 chars
        result = MODULE.normalize_result({"videoId": "x", "segments": []}, gen, duration_seconds=125)
        self.assertLessEqual(len(result["seoDescription"]), MODULE.SEO_MAX)
        self.assertGreaterEqual(len(result["seoDescription"]), MODULE.SEO_MIN)

    def test_rejects_invalid_chapter_ranges(self) -> None:
        gen = _generated()
        gen["chapters"] = [{"title": "Bad", "description": "Bad range.", "startTime": 10, "endTime": 5, "transcript": "x"}]
        with self.assertRaisesRegex(ValueError, "endTime"):
            MODULE.normalize_result({"videoId": "x", "segments": []}, gen, duration_seconds=20)

    def test_empty_transcript_falls_back_to_raw_captions(self) -> None:
        # When the model leaves a chapter's transcript empty, it is rebuilt from
        # the raw captions in that chapter's time window rather than failing.
        gen = _generated()
        gen["chapters"][0]["transcript"] = ""
        raw = {
            "videoId": "x",
            "segments": [
                {"start": 5.0, "text": "This is the intro"},
                {"start": 30.0, "text": "still the intro"},
                {"start": 121.0, "text": "the wrap up"},
            ],
        }
        result = MODULE.normalize_result(raw, gen, duration_seconds=125)
        self.assertIn("This is the intro still the intro", result["transcription"])

    def test_extracts_json_from_markdown_fence(self) -> None:
        payload = {"chapters": [], "summary": "Summary", "seoDescription": "Desc"}
        raw = f"```json\n{json.dumps(payload)}\n```"
        self.assertEqual(MODULE.parse_model_json(raw), payload)

    def test_generation_caps_model_output_tokens(self) -> None:
        class Responses:
            kwargs = None

            def create(self, **kwargs):
                self.kwargs = kwargs
                return type("Response", (), {"output_text": '{"chapters": [], "summary": "s", "seoDescription": "d"}'})()

        responses = Responses()
        client = type("Client", (), {"responses": responses})()
        MODULE.generate(client, "test-model", "prompt")
        self.assertIsNotNone(responses.kwargs)
        assert responses.kwargs is not None
        self.assertEqual(responses.kwargs["max_output_tokens"], MODULE.MAX_OUTPUT_TOKENS)

    def test_published_transcripts_are_structurally_valid(self) -> None:
        # Enriched transcripts must be a supported version (v2 or v3) with the
        # keys the site renders; raw/cache files are ignored.
        published = Path(__file__).parents[3] / "src" / "data" / "transcripts"
        invalid = []
        for path in published.glob("*.json"):
            data = json.loads(path.read_text())
            version = data.get("schemaVersion")
            if version is None and "chapters" not in data:
                continue  # raw/cache file, not an enriched transcript
            required = {"chapters", "summary", "transcription"}
            if version == 3:
                required = required | {"seoDescription"}
            elif version != 2:
                invalid.append(f"{path.name} (v{version})")
                continue
            if not required.issubset(data):
                invalid.append(path.name)
        self.assertEqual(invalid, [], f"malformed enriched transcripts: {', '.join(invalid)}")


if __name__ == "__main__":
    unittest.main()
