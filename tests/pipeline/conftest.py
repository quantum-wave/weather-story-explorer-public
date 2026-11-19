import os
import pathlib
import shutil
import uuid

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
WORK = ROOT / "out" / "pytest-wp1"  # inside the repo (git-ignored), never /tmp


@pytest.fixture
def work():
    d = WORK / uuid.uuid4().hex[:10]
    d.mkdir(parents=True)
    yield d
    shutil.rmtree(d, ignore_errors=True)
    try:
        WORK.rmdir()
    except OSError:
        pass


@pytest.fixture(scope="session")
def fixtures_dir():
    p = os.environ.get("WSE_FIXTURES")
    if not p or not os.path.isdir(p):
        pytest.skip("WSE_FIXTURES is not set (the spike fixture directory)")
    return p


@pytest.fixture
def store():
    from grib_helpers import Store
    s = Store()
    yield s
    s.close()


@pytest.fixture(autouse=True)
def no_outbound_network(monkeypatch):
    """A test that reaches a real host fails at once instead of waiting on a blocked network."""
    import socket
    real = socket.socket.connect

    def guard(self, addr, *a, **k):
        host = addr[0] if isinstance(addr, tuple) else addr
        if host not in ("127.0.0.1", "::1", "localhost"):
            raise OSError(f"test tried to reach {host}")
        return real(self, addr, *a, **k)

    monkeypatch.setattr(socket.socket, "connect", guard)
