"""Launcher that works under `python -I` (isolated mode drops the current directory from sys.path, so
`python -I -m pipeline.build` cannot find this package unless it is installed).

  python -I pipeline/run.py build --fixture "$WSE_FIXTURES" --out site/data
  python -I pipeline/run.py runs --published out/published.json
  python -I pipeline/run.py clim | publish | validate ...

The repo root is added to sys.path here, explicitly, because this file is the repo's own code.
"""
import importlib
import os
import sys

COMMANDS = {"build": "pipeline.build", "runs": "pipeline.runs", "clim": "pipeline.clim",
            "publish": "pipeline.publish", "validate": "pipeline.validate"}


def main(argv):
    if not argv or argv[0] not in COMMANDS:
        print(f"usage: run.py {{{'|'.join(COMMANDS)}}} [args]", file=sys.stderr)
        return 2
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return importlib.import_module(COMMANDS[argv[0]]).main(argv[1:])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
