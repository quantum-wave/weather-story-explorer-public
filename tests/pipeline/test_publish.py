"""P-PUBLISH: one orphan commit per publish, other directories kept on request, main untouched."""
import os
import subprocess

import pytest

from pipeline import publish


def sh(cwd, *args):
    r = subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", *args], cwd=cwd, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


@pytest.fixture
def repo(work):
    bare = work / "remote.git"
    sh(work, "init", "-q", "--bare", "-b", "main", str(bare))
    r = work / "clone"
    r.mkdir()
    sh(r, "init", "-q", "-b", "main")
    (r / "code.py").write_text("print('main')\n")
    (r / ".gitignore").write_text("out/\n")
    sh(r, "add", ".")
    sh(r, "commit", "-q", "-m", "main commit")
    sh(r, "remote", "add", "origin", str(bare))
    sh(r, "push", "-q", "origin", "main")
    return r, bare


def data_dir(work, name, files):
    d = work / name
    d.mkdir()
    for k, v in files.items():
        (d / k).write_text(v)
    return d


def remote_tree(bare, branch):
    return sorted(sh(bare, "ls-tree", "-r", "--name-only", branch).splitlines())


def test_publishes_one_root_commit_and_leaves_main_alone(work, repo):
    r, bare = repo
    src = data_dir(work, "d1", {"manifest.json": "{}", "z.bin": "x"})
    publish.publish(str(r), "data", str(src), "latest", "data run 1")
    assert remote_tree(bare, "data") == ["latest/manifest.json", "latest/z.bin"]
    assert sh(bare, "rev-list", "--count", "data") == "1"
    assert sh(bare, "log", "-1", "--format=%s", "main") == "main commit" and remote_tree(bare, "main") == [".gitignore", "code.py"]
    assert sh(bare, "rev-list", "--max-parents=0", "data") == sh(bare, "rev-parse", "data")  # a root commit


def test_second_publish_replaces_the_branch_with_a_new_single_commit(work, repo):
    r, bare = repo
    publish.publish(str(r), "data", str(data_dir(work, "d1", {"a.bin": "1"})), "latest", "one")
    first = sh(bare, "rev-parse", "data")
    sh(r, "switch", "-q", "main")
    publish.publish(str(r), "data", str(data_dir(work, "d2", {"b.bin": "2"})), "latest", "two")
    assert remote_tree(bare, "data") == ["latest/b.bin"]  # the stale file is gone
    assert sh(bare, "rev-list", "--count", "data") == "1" and sh(bare, "rev-parse", "data") != first


def test_keep_other_carries_the_other_model_directory(work, repo):
    r, bare = repo
    publish.publish(str(r), "data", str(data_dir(work, "d1", {"m.json": "ifs"})), "latest", "ifs")
    sh(r, "switch", "-q", "main")
    publish.publish(str(r), "data", str(data_dir(work, "d2", {"m.json": "aifs"})), "latest-aifs", "aifs", keep_other=True)
    assert remote_tree(bare, "data") == ["latest-aifs/m.json", "latest/m.json"]
    assert sh(bare, "rev-list", "--count", "data") == "1"
    sh(r, "switch", "-q", "main")
    publish.publish(str(r), "data", str(data_dir(work, "d3", {"n.json": "ifs2"})), "latest", "ifs again", keep_other=True)
    assert remote_tree(bare, "data") == ["latest-aifs/m.json", "latest/n.json"]


def test_keep_other_on_a_branch_that_does_not_exist_yet(work, repo):
    r, bare = repo
    publish.publish(str(r), "data", str(data_dir(work, "d1", {"m.json": "x"})), "latest", "first", keep_other=True)
    assert remote_tree(bare, "data") == ["latest/m.json"]


def test_a_single_file_to_the_branch_root_for_clim(work, repo):
    r, bare = repo
    f = work / "harmonics.npz"
    f.write_bytes(b"npz")
    publish.publish(str(r), "clim", str(f), "harmonics.npz", "clim")
    assert remote_tree(bare, "clim") == ["harmonics.npz"]
    assert sh(bare, "show", "clim:harmonics.npz") == "npz"


def test_ignored_output_is_still_added_because_out_is_gitignored(work, repo):
    r, bare = repo
    out = r / "out" / "data"
    out.mkdir(parents=True)
    (out / "manifest.json").write_text("{}")
    publish.publish(str(r), "data", str(out), "latest", "from out/")
    assert remote_tree(bare, "data") == ["latest/manifest.json"]


def test_missing_source_is_an_error(work, repo):
    r, _ = repo
    with pytest.raises(FileNotFoundError):
        publish.publish(str(r), "data", str(work / "nope"), "latest", "x")


def test_cli_prints_the_commit(work, repo, capsys):
    r, bare = repo
    src = data_dir(work, "d1", {"m.json": "x"})
    assert publish.main(["--repo", str(r), "--branch", "data", "--src", str(src), "--dest", "latest", "--message", "cli"]) == 0
    assert "published" in capsys.readouterr().out and remote_tree(bare, "data") == ["latest/m.json"]
