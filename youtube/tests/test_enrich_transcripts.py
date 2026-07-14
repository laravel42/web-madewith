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


class EnrichTranscriptTests(unittest.TestCase):
    def test_builds_timestamped_source_for_model(self) -> None:
        raw = {
            "videoId": "abc123",
            "language": "en",
            "source": "auto",
            "segments": [
                {"start": 0.0, "text": "Welcome to the tutorial."},
                {"start": 65.2, "text": "Now configure the database."},
            ],
        }

        source = MODULE.timestamped_source(raw)

        self.assertEqual(source, "[00:00] Welcome to the tutorial.\n[01:05] Now configure the database.")

    def test_normalizes_model_output_to_v2_schema(self) -> None:
        raw = {
            "videoId": "abc123",
            "language": "en",
            "source": "manual",
            "segments": [
                {"start": 0.0, "text": "Welcome."},
                {"start": 120.0, "text": "Finish."},
            ],
        }
        generated = {
            "chapters": [
                {
                    "title": "Introduction",
                    "description": "What the tutorial covers.",
                    "startTime": 0,
                    "endTime": 119.9,
                },
                {
                    "title": "Wrap-up",
                    "description": "The final takeaway.",
                    "startTime": 120,
                    "endTime": 125,
                },
            ],
            "summary": "## Key idea\n\nA concise summary.",
            "transcription": "## Introduction\n\nWelcome.\n\n## Wrap-up\n\nFinish.",
        }

        result = MODULE.normalize_result(raw, generated, duration_seconds=125)

        self.assertEqual(result["schemaVersion"], 2)
        self.assertEqual(result["videoId"], "abc123")
        self.assertEqual(result["language"], "en")
        self.assertEqual(result["source"], "manual")
        self.assertEqual(result["chapters"][-1]["endTime"], 125)
        self.assertNotIn("segments", result)
        self.assertNotIn("text", result)

    def test_rejects_invalid_chapter_ranges(self) -> None:
        raw = {"videoId": "abc123", "language": "en", "source": "auto", "segments": []}
        generated = {
            "chapters": [{"title": "Bad", "description": "Bad range.", "startTime": 10, "endTime": 5}],
            "summary": "Enough summary text to validate.",
            "transcription": "Enough transcript text to validate.",
        }

        with self.assertRaisesRegex(ValueError, "endTime"):
            MODULE.normalize_result(raw, generated, duration_seconds=20)

    def test_extracts_json_from_markdown_fence(self) -> None:
        payload = {"chapters": [], "summary": "Summary", "transcription": "Transcript"}
        raw = f"```json\n{json.dumps(payload)}\n```"

        self.assertEqual(MODULE.parse_model_json(raw), payload)

    def test_generation_caps_model_output_tokens(self) -> None:
        class Responses:
            kwargs = None

            def create(self, **kwargs):
                self.kwargs = kwargs
                return type("Response", (), {"output_text": '{"chapters": [], "summary": "Summary", "transcription": "Transcript"}'})()

        responses = Responses()
        client = type("Client", (), {"responses": responses})()

        MODULE.generate(client, "test-model", "prompt")

        self.assertIsNotNone(responses.kwargs)
        assert responses.kwargs is not None
        self.assertEqual(responses.kwargs["max_output_tokens"], 24_000)

    def test_all_published_transcripts_use_v2_schema(self) -> None:
        published = Path(__file__).parents[2] / "src" / "data" / "transcripts"
        invalid = []
        for path in published.glob("*.json"):
            data = json.loads(path.read_text())
            if data.get("schemaVersion") != 2 or not all(key in data for key in ("chapters", "summary", "transcription")):
                invalid.append(path.name)

        self.assertEqual(invalid, [], f"legacy transcript files: {', '.join(invalid)}")


if __name__ == "__main__":
    unittest.main()
