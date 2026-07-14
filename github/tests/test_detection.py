from madewith_github.detection import qualify
from madewith_github.models import Rule, Technology


def _tech(slug, name, *, topics=None, keywords=None, metadata=None, threshold=65):
    return Technology(
        id=1, slug=slug, name=name, minimum_stars=0, maximum_repository_age_days=None,
        maximum_inactivity_days=None, include_forks=False, include_archived=False,
        maximum_candidates_per_run=1000, search_topics=topics or [], search_keywords=keywords or [],
        excluded_keywords=[], allowed_project_types=[], quality_threshold=threshold, metadata=metadata or {},
    )


def _rule(rule_type, *, manifest_path=None, selector=None, expected_value=None, strong=True):
    return Rule(id=1, rule_type=rule_type, manifest_path=manifest_path, selector=selector,
                expected_value=expected_value, confidence=1.0, weight=1.0, strong_evidence=strong, metadata={})


def _pkg(deps):
    return {"package.json": {"json": {"dependencies": deps}, "raw": ""}}


def test_exact_dependency_from_metadata_qualifies():
    tech = _tech("nextjs", "Next.js", topics=["nextjs"], metadata={"manifest": "package.json", "dependencies": ["next"]})
    d = qualify(tech, [], _pkg({"next": "14.0.0", "react": "18"}), {"package.json"}, ["nextjs"], "a next.js app")
    assert d.accepted and d.confidence >= 65
    assert any(e.kind == "dependency" for e in d.evidence)


def test_dependency_rule_with_legacy_selector_qualifies():
    # The real rule stores a comma-joined selector; the engine matches on the
    # expected_value ("next") as a dependency key, not by walking the selector.
    tech = _tech("nextjs", "Next.js")
    rule = _rule("dependency", manifest_path="package.json", selector="dependencies,devDependencies", expected_value="next")
    d = qualify(tech, [rule], _pkg({"next": "14"}), {"package.json"}, [], "")
    assert d.accepted


def test_slug_as_package_name_qualifies_without_metadata():
    tech = _tech("react", "React")  # no rules, no metadata
    d = qualify(tech, [], _pkg({"react": "18", "react-dom": "18"}), {"package.json"}, [], "")
    assert d.accepted


def test_vendor_prefix_composer_package_qualifies():
    tech = _tech("laravel", "Laravel")
    manifests = {"composer.json": {"json": {"require": {"laravel/framework": "^11"}}, "raw": ""}}
    d = qualify(tech, [], manifests, {"composer.json"}, [], "")
    assert d.accepted


def test_requirements_txt_token_qualifies():
    tech = _tech("django", "Django")
    manifests = {"requirements.txt": {"json": None, "raw": "Django==5.0\npsycopg2\n"}}
    d = qualify(tech, [], manifests, {"requirements.txt"}, [], "")
    assert d.accepted


def test_config_file_present_qualifies():
    tech = _tech("nuxt", "Nuxt")
    rule = _rule("config_file", manifest_path="nuxt.config.ts", expected_value="nuxt.config.ts")
    d = qualify(tech, [rule], {}, {"nuxt.config.ts"}, [], "")
    assert d.accepted
    assert any(e.kind == "config_file" for e in d.evidence)


def test_dependency_prefix_qualifies():
    tech = _tech("nuxt", "Nuxt", metadata={"dependency_prefixes": ["@nuxt/"]})
    d = qualify(tech, [], _pkg({"@nuxt/kit": "3"}), {"package.json"}, [], "")
    assert d.accepted


def test_topic_only_does_not_qualify():
    # A repo merely tagged "nextjs" with no code evidence is corroboration, not proof.
    tech = _tech("nextjs", "Next.js", topics=["nextjs"], metadata={"dependencies": ["next"]})
    d = qualify(tech, [], _pkg({"vue": "3"}), {"package.json"}, ["nextjs"], "")
    assert not d.accepted
    assert d.confidence < 65


def test_no_signal_does_not_qualify():
    tech = _tech("nextjs", "Next.js", metadata={"dependencies": ["next"]})
    d = qualify(tech, [], _pkg({"vue": "3"}), {"package.json"}, ["vue"], "a vue app")
    assert not d.accepted
    assert d.evidence == []


def test_runtime_technology_needs_corroboration():
    # Node is flagged as a runtime: a single loose signal must not assign it.
    tech = _tech("node", "Node.js", metadata={"requires_runtime_verification": True})
    rule = _rule("runtime_dependency", expected_value="express")
    one = qualify(tech, [rule], _pkg({"express": "4"}), {"package.json"}, [], "")
    assert not one.accepted  # only one signal
    two = qualify(tech, [rule], _pkg({"express": "4"}), {"package.json"}, ["node"], "node server")
    assert two.accepted  # dependency + topic
