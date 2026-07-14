from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

@dataclass(slots=True)
class Technology:
    id: int
    slug: str
    name: str
    minimum_stars: int
    maximum_repository_age_days: int | None
    maximum_inactivity_days: int | None
    include_forks: bool
    include_archived: bool
    maximum_candidates_per_run: int
    search_topics: list[str]
    search_keywords: list[str]
    excluded_keywords: list[str]
    allowed_project_types: list[str]
    quality_threshold: int
    metadata: dict[str, Any]

@dataclass(slots=True)
class Rule:
    id: int
    rule_type: str
    manifest_path: str | None
    selector: str | None
    expected_value: str | None
    confidence: float
    weight: float
    strong_evidence: bool
    metadata: dict[str, Any]

@dataclass(slots=True)
class Evidence:
    rule_id: int | None
    kind: str
    location: str
    value: str | None
    score: float
    strong: bool = False

@dataclass(slots=True)
class TechDetection:
    confidence: float
    accepted: bool
    evidence: list[Evidence] = field(default_factory=list)

@dataclass(slots=True)
class Classification:
    project_type: str
    project_type_confidence: float
    categories: list[str]
    category_confidence: float
    deterministic_rules: list[dict[str, Any]]
    llm_input_hash: str | None = None
    llm_output: dict[str, Any] | None = None

@dataclass(slots=True)
class SearchPartition:
    pushed_from: datetime
    pushed_to: datetime
    page: int = 1
