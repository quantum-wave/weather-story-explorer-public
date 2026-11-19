"""P-INTEGRATION: the names the workflows, the deploy, the bootstrap script and the docs use for each other agree."""
import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
WF = ROOT / ".github" / "workflows"


def load(name):
    return yaml.safe_load((WF / name).read_text())


def test_workflow_names_and_files_agree():
    assert load("data.yml")["name"] == "data"
    assert load("clim.yml")["name"] == "clim"
    pages = load("pages.yml")
    trig = pages.get("on", pages.get(True))
    assert trig["workflow_run"]["workflows"] == ["data"], "pages.yml follows the workflow named `data`"
    boot = (ROOT / "scripts" / "bootstrap-mac.sh").read_text()
    assert "clim.yml" in boot and "data.yml" in boot


def test_data_branch_layout_matches_the_deploy():
    pages = (WF / "pages.yml").read_text()
    data = (WF / "data.yml").read_text()
    assert "ref: data" in pages and "data/latest" in pages, "pages.yml assembles from the data branch's latest/"
    assert re.search(r"\bdata\b", data) and "latest" in data
    publish = (ROOT / "pipeline" / "publish.py").read_text()
    assert "latest" in publish and "data" in publish


def test_clim_branch_name_is_shared():
    clim = (WF / "clim.yml").read_text()
    data = (WF / "data.yml").read_text()
    assert "clim" in clim and "clim" in data
    for text in (clim, data):
        assert "--branch clim" in text or "clim" in text


# Private-only: GUIDE.md is not in tools/export-public.sh's allowlist, so the public mirror has no copy. The test runs in the
# private repo and is skipped (with this reason shown) in the mirror.
@pytest.mark.skipif(not (ROOT / "GUIDE.md").exists(), reason="private-only: GUIDE.md is not exported to the public mirror")  # wse-lint: ok
def test_guide_documents_the_launcher_not_dash_m():
    guide = (ROOT / "GUIDE.md").read_text()  # wse-lint: ok (private-only test, skipped when absent)
    assert "pipeline/run.py" in guide
    assert "python -I -m pipeline" not in guide.replace("`python -I -m pipeline.build` cannot work", "")
    assert "tests/scripts/bootstrap.test.sh" in guide
