"""Download the GRIB fields of one model run with the `ecmwf-opendata` client, one request per step and need.

Why per-step requests: a missing or late step then costs one dropped step, not the run (SPEC section 10). Why
one request per "need": the client matches the cross product of `param` and `levelist` against the file index,
so `u,v` at 250 and `t` at 850 asked together would also download `u,v` at 850 and `t` at 250.

The client is injected (`client_factory(source) -> object with retrieve(request, target)`); tests pass a fake
or the real client pointed at a local HTTP server (`source` may be a URL). Nothing here is retried for long:
`maximum_retries` is small, 404s are not retried by the client, and a step that fails everywhere is dropped.
"""
from __future__ import annotations

import concurrent.futures as cf
import datetime as dt
import logging
import os

LOG = logging.getLogger("pipeline.fetch")

STEPS = list(range(0, 361, 6))
EM_FIRST_STEP = 144   # z500em: the ensemble mean is only used from day 6 (SPEC 13.2)
PR_WINDOW_H = 24      # `tpg` products are 24 h windows, written as range steps "a-b", one every 12 h
PR_EVERY_H = 12
LOW_LEVEL_LAST_STEP = 168  # ivt (00Z run only, MET-10) and t2m (card highs and lows) are built to 7 days
IVT_LEVELS = [1000, 925, 850, 700, 600, 500, 400, 300]

# field id -> the needs it takes. A need is one request; `sfc` collects the single-level params.
FIELD_NEEDS = {
    "z500": ("gh500",), "z500a": ("gh500",), "z500sd": ("es",), "ws250": ("wind250",),
    "t850a": ("t850",), "tp6": ("tp",), "msl": ("msl",), "ivt": ("ivt_pl", "ivt_sp"),
    "z500em": ("em",), "pr1": ("tpg",), "pr10": ("tpg",), "t2m": ("t2m",),
}


def need_applies(need, step):
    """Whether `need` exists at `step`: accumulations start at step 0 (a step-0 file has no `tp`), the ensemble mean is
    wanted from 144 h, `ivt` and `t2m` stop at 168 h, and rain-probability windows are keyed by their end hour (24, 36 ... 360)."""
    if need == "tp":
        return step > 0
    if need == "em":
        return step >= EM_FIRST_STEP
    if need == "tpg":
        return step >= PR_WINDOW_H and step % PR_EVERY_H == 0
    if need in ("ivt_pl", "ivt_sp", "t2m"):
        return step <= LOW_LEVEL_LAST_STEP
    return True


def pr_windows(max_step=360):
    """End hours of the 24 h rain-probability windows up to `max_step`: 24, 36 ... 360 (29 of them)."""
    return list(range(PR_WINDOW_H, max_step + 1, PR_EVERY_H))


def pr_window(end):
    """The index's range step for the window ending at `end`: 252 -> "228-252"."""
    return f"{end - PR_WINDOW_H}-{end}"


def ens_file_hours(end_step):
    """Which `enfo-ep` file holds a step (or a window, by its END hour): the 240 h one up to 240, else the 360 h one.
    The ecmwf-opendata client makes the same choice (`end_step(value) <= 240`)."""
    return 240 if end_step <= 240 else 360


def needs_for(fields):
    """Ordered, de-duplicated list of need names for the requested fields."""
    out = []
    for f in fields:
        for n in FIELD_NEEDS[f]:
            if n not in out:
                out.append(n)
    return out


def request_for(need, model, run, step):
    """The ecmwf-opendata request dict for one need at one step."""
    base = dict(date=run.strftime("%Y%m%d"), time=run.hour, step=step)
    if need == "es":  # ensemble spread of gh500 (IFS ENS only; lives in the -240h/-360h enfo-ep files)
        return dict(base, model="ifs", stream="enfo", type="es", levtype="pl", param="gh", levelist=500)
    if need == "em":
        return dict(base, model="ifs", stream="enfo", type="em", levtype="pl", param="gh", levelist=500)
    if need == "tpg":  # P(24 h rain >= 1 mm, >= 10 mm): `step` is the window's END hour, requested as a range step
        return dict(base, step=pr_window(step), model="ifs", stream="enfo", type="ep", levtype="sfc",
                    param=["tpg1", "tpg10"])
    m = {"ifs": "ifs", "aifs": "aifs-single"}[model]
    base = dict(base, model=m, stream="oper", type="fc")
    if need == "gh500":
        # AIFS has no `gh`: it publishes `z` (m2/s2), divided by g in reduce.py.
        return dict(base, levtype="pl", param="z" if model == "aifs" else "gh", levelist=500)
    if need == "wind250":
        return dict(base, levtype="pl", param=["u", "v"], levelist=250)
    if need == "t850":
        return dict(base, levtype="pl", param="t", levelist=850)
    if need in ("tp", "msl", "sp"):
        return dict(base, levtype="sfc", param=need)
    if need == "ivt_pl":
        return dict(base, levtype="pl", param=["q", "u", "v"], levelist=IVT_LEVELS)
    if need == "t2m":
        return dict(base, levtype="sfc", param="2t")
    if need == "ivt_sp":
        return dict(base, levtype="sfc", param="sp")
    raise KeyError(need)


def quiet_downloads():
    """multiurl draws a tqdm bar per download (`disable=False` is hard-coded): thousands of lines in a CI log.
    Hand its downloader a no-op bar instead, once."""
    import ecmwf.opendata.client as c
    from multiurl.base import NoBar
    if not getattr(c.download, "_wse_quiet", False):
        orig = c.download

        def quiet(*a, **k):
            k.setdefault("progress_bar", lambda total, initial=0, desc=None: NoBar())
            return orig(*a, **k)

        quiet._wse_quiet = True
        c.download = quiet


def default_client_factory(source, model="ifs"):
    from ecmwf.opendata import Client
    quiet_downloads()
    return Client(source=source, model={"ifs": "ifs", "aifs": "aifs-single"}[model], resol="0p25",
                  maximum_retries=4, retry_after=5, use_server_retry_after=False)


class Retriever:
    """get(run, step, need) -> path of the GRIB file, or None when no source has it."""

    def __init__(self, workdir, model="ifs", sources=("ecmwf",), client_factory=None):
        self.workdir = str(workdir)
        self.model = model
        self.sources = list(sources)
        self.factory = client_factory or (lambda src: default_client_factory(src, model))
        self._clients = {}
        os.makedirs(self.workdir, exist_ok=True)

    def _client(self, source):
        if source not in self._clients:
            self._clients[source] = self.factory(source)
        return self._clients[source]

    def path(self, need, step):
        return os.path.join(self.workdir, f"{need}.{step:03d}.grib2")

    def get(self, run, step, need):
        target = self.path(need, step)
        if os.path.exists(target) and os.path.getsize(target) > 0:
            return target
        req = request_for(need, self.model, run, step)
        part = target + ".part"
        for source in self.sources:
            try:
                self._client(source).retrieve(req, target=part)
                if os.path.getsize(part) == 0:
                    raise OSError("empty download")
                os.replace(part, target)
                return target
            except Exception as e:  # noqa: BLE001 - any failure means "try the next source, then drop the step"
                LOG.warning("step %s need %s from %s failed: %s", step, need, source, str(e)[:160])
                if os.path.exists(part):
                    os.remove(part)
        return None


def fetch_steps(retriever, run, steps, needs, reducer, workers=4):
    """For every step fetch the needs, hand {need: path} to `reducer(step, paths)` and collect its result.

    A step is dropped when any need required by `reducer` is missing: the reducer receives only the needs that
    arrived and decides what it can still compute (it returns {} to drop the step). Results: {step: value}.
    """
    results = {}

    def one(step):
        paths = {}
        for n in needs:
            if not need_applies(n, step):
                continue
            p = retriever.get(run, step, n)
            if p:
                paths[n] = p
        try:
            return step, reducer(step, paths) if paths else None
        finally:
            for p in paths.values():
                try:
                    os.remove(p)
                except OSError:
                    pass

    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        for step, val in ex.map(one, steps):
            if val:
                results[step] = val
    return results


def parse_run(text):
    """'YYYYMMDDHH' -> aware UTC datetime."""
    return dt.datetime.strptime(text, "%Y%m%d%H").replace(tzinfo=dt.timezone.utc)
