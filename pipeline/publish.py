"""Force-push one directory to an orphan branch as a single commit (`data` holds `latest/`, `clim` the harmonics).

  python -m pipeline.publish --branch data --src out/data --dest latest
  python -m pipeline.publish --branch data --src out/data-aifs --dest latest-aifs --keep-other
  python -m pipeline.publish --branch clim --src out/clim/harmonics.npz --dest harmonics.npz

Runs inside a checkout (in Actions the one `actions/checkout` made, which already holds the push credentials):
switches to a new orphan branch, so every publish is one root commit and history never grows. `--keep-other`
carries over what the branch already holds except `--dest`. The checkout is left on the throwaway branch, so run
this last. `--remote` may be any URL or remote name (tests use a local bare repo).
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import uuid

IDENT = ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com"]


def git(repo, *args, check=True):
    r = subprocess.run(["git", *IDENT, *args], cwd=repo, capture_output=True, text=True)
    if check and r.returncode:
        raise RuntimeError(f"git {' '.join(args)} failed: {r.stderr.strip() or r.stdout.strip()}")
    return r


def publish(repo, branch, src, dest, message, remote="origin", keep_other=False, push=True):
    repo, src = os.path.abspath(repo), os.path.abspath(src)
    if not os.path.exists(src):
        raise FileNotFoundError(src)
    previous = False
    if keep_other:
        previous = git(repo, "fetch", "--depth", "1", remote, branch, check=False).returncode == 0
    work = f"wse-publish-{uuid.uuid4().hex[:8]}"
    git(repo, "switch", "--orphan", work)
    if previous:
        git(repo, "checkout", "FETCH_HEAD", "--", ".")
        if dest not in (".", ""):
            git(repo, "rm", "-rqf", "--ignore-unmatch", "--", dest)
            shutil.rmtree(os.path.join(repo, dest), ignore_errors=True)
    target = repo if dest in (".", "") else os.path.join(repo, dest)
    if os.path.isdir(src):
        os.makedirs(target, exist_ok=True)
        for name in os.listdir(src):
            s = os.path.join(src, name)
            d = os.path.join(target, name)
            shutil.copytree(s, d) if os.path.isdir(s) else shutil.copy2(s, d)
    else:
        if dest in (".", ""):
            raise ValueError("a single file needs a --dest file name")
        os.makedirs(os.path.dirname(target) or repo, exist_ok=True)
        shutil.copy2(src, target)
    git(repo, "add", "-f", "--", "." if dest in (".", "") else dest)
    git(repo, "commit", "-q", "-m", message)
    if push:
        git(repo, "push", "--force", remote, f"HEAD:refs/heads/{branch}")
    return git(repo, "rev-parse", "HEAD").stdout.strip()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--branch", required=True)
    ap.add_argument("--src", required=True)
    ap.add_argument("--dest", required=True)
    ap.add_argument("--message", default="Publish data")
    ap.add_argument("--remote", default="origin")
    ap.add_argument("--repo", default=".")
    ap.add_argument("--keep-other", action="store_true")
    ap.add_argument("--no-push", action="store_true")
    a = ap.parse_args(argv)
    sha = publish(a.repo, a.branch, a.src, a.dest, a.message, a.remote, a.keep_other, not a.no_push)
    print(f"published {a.src} to {a.branch}:{a.dest} as {sha[:12]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
