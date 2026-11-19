"""Test-side GRIB writer and a fake ECMWF open-data server (constructed from the ecmwf-opendata client source;
the first live Actions run is the real test of the remote side)."""
import datetime as dt
import http.server
import json
import threading

import eccodes as ec
import numpy as np

STEPS_ALL = list(range(0, 361, 6))


def grib_bytes(short, level, data, lat, lon, type_of_level="isobaricInhPa"):
    """One regular_ll GRIB2 message. `data` is (ny, nx) laid out in the order given by `lat` and `lon`."""
    h = ec.codes_grib_new_from_samples("regular_ll_pl_grib2")
    try:
        ny, nx = data.shape
        ec.codes_set(h, "Ni", nx)
        ec.codes_set(h, "Nj", ny)
        ec.codes_set(h, "latitudeOfFirstGridPointInDegrees", float(lat[0]))
        ec.codes_set(h, "latitudeOfLastGridPointInDegrees", float(lat[-1]))
        ec.codes_set(h, "longitudeOfFirstGridPointInDegrees", float(lon[0]))
        ec.codes_set(h, "longitudeOfLastGridPointInDegrees", float(lon[-1]))
        ec.codes_set(h, "iDirectionIncrementInDegrees", abs(float(lon[1] - lon[0])))
        ec.codes_set(h, "jDirectionIncrementInDegrees", abs(float(lat[1] - lat[0])))
        ec.codes_set(h, "jScansPositively", 1 if lat[1] > lat[0] else 0)
        ec.codes_set(h, "iScansNegatively", 1 if lon[1] < lon[0] else 0)
        ec.codes_set(h, "shortName", short)
        ec.codes_set(h, "typeOfLevel", type_of_level)
        ec.codes_set(h, "level", int(level))
        ec.codes_set(h, "bitsPerValue", 24)
        ec.codes_set_values(h, np.asarray(data, np.float64).ravel())
        return ec.codes_get_message(h)
    finally:
        ec.codes_release(h)


def write_grib(path, messages):
    with open(path, "wb") as fh:
        for m in messages:
            fh.write(grib_bytes(**m))


class Store:
    """path -> bytes, served over HTTP with HEAD, GET and single Range requests."""

    def __init__(self):
        self.files = {}
        self.requests = []
        store = self

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _serve(self, body_too):
                store.requests.append((self.command, self.path, self.headers.get("Range")))
                data = store.files.get(self.path)
                if data is None:
                    self.send_response(404)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                rng = self.headers.get("Range")
                if rng and rng.startswith("bytes="):
                    a, _, b = rng[6:].split(",")[0].partition("-")
                    a = int(a)
                    b = int(b) if b else len(data) - 1
                    chunk = data[a:b + 1]
                    self.send_response(206)
                    self.send_header("Content-Range", f"bytes {a}-{a + len(chunk) - 1}/{len(data)}")
                else:
                    chunk = data
                    self.send_response(200)
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(len(chunk)))
                self.end_headers()
                if body_too:
                    self.wfile.write(chunk)

            def do_GET(self):
                self._serve(True)

            def do_HEAD(self):
                self._serve(False)

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(5)


def _index_and_blob(entries):
    """entries: list of (keys dict, grib bytes) -> (file bytes, index bytes)."""
    blob, lines, off = b"", [], 0
    for keys, b in entries:
        lines.append(json.dumps(dict(keys, _offset=off, _length=len(b))))
        blob += b
        off += len(b)
    return blob, ("\n".join(lines) + "\n").encode()


def publish_run(store, run, steps, model="ifs", skip=(), lat=None, lon=None, fields=None, es_steps=None):
    """Put one run into `store` using the open-data layout. `skip` = {(kind, step)} to leave out (404).

    Values (constants plus east-longitude/360, so tests can predict every result and spot a shifted grid): gh500 = 5500 + step, u250 = 30, v250 = 40,
    t850 = 270 + step/10, tp = 0.0005 * step metres accumulated, msl = 101325, es(gh500) = 5 + step/2.
    Decoy messages (other levels) are included so tests can prove a request downloads only what it asked for.
    """
    lat = np.linspace(90, -90, 361) if lat is None else lat
    lon = np.arange(0, 360, 0.5) if lon is None else lon
    shape = (len(lat), len(lon))
    ymd, hh = run.strftime("%Y%m%d"), run.strftime("%H")
    stamp = run.strftime("%Y%m%d%H0000")
    ramp = (np.asarray(lon, float) % 360.0) / 360.0  # east longitude / 360: lets tests detect a shifted or flipped grid
    mdir = {"ifs": "ifs", "aifs": "aifs-single"}[model]

    def key(**k):
        base = {"domain": "g", "date": ymd, "time": hh + "00", "expver": "0001", "class": "od", "stream": "oper"}
        base.update({a: str(b) for a, b in k.items()})
        return base

    for s in steps:
        ent = []

        def add(kind, short, level, val, tol="isobaricInhPa", levtype="pl", rmp=True):
            if (kind, s) in skip:
                return
            k = key(type="fc", step=s, levtype=levtype, param=short)
            if levtype == "pl":
                k["levelist"] = str(level)
            ent.append((k, grib_bytes(short, level, np.full(shape, val, np.float64) + (ramp[None, :] if rmp else 0.0),
                                      lat, lon, tol)))

        gh_name = "z" if model == "aifs" else "gh"
        gh_val = lambda lv: (5500.0 + s) * (9.80665 if model == "aifs" else 1.0) + (0 if lv == 500 else 111)
        add("gh500", gh_name, 500, gh_val(500))
        add("gh500", gh_name, 850, gh_val(850))   # decoys
        add("gh500", gh_name, 250, gh_val(250))
        for lv in (250, 500, 850):
            add("wind250", "u", lv, 30.0 if lv == 250 else 1.0)
            add("wind250", "v", lv, 40.0 if lv == 250 else 2.0)
        add("t850", "t", 850, 270.0 + s / 10)
        add("t850", "t", 500, 250.0)
        add("tp", "tp", 0, 0.0005 * s, "surface", "sfc", rmp=False)  # a real accumulation is 0 at step 0, no ramp
        add("msl", "msl", 0, 101325.0, "meanSea", "sfc")
        add("ivt_sp", "sp", 0, 100000.0, "surface", "sfc")
        if ent:
            blob, idx = _index_and_blob(ent)
            base = f"/{ymd}/{hh}z/{mdir}/0p25/oper/{stamp}-{s}h-oper-fc"
            store.files[base + ".grib2"] = blob
            store.files[base + ".index"] = idx
    # ensemble mean and spread live in the -240h / -360h enfo-ep files (steps <= 240, then beyond)
    for end, lo, hi in ((240, 0, 240), (360, 246, 360)):
        ent = []
        for s in [x for x in (es_steps if es_steps is not None else steps) if lo <= x <= hi]:
            if ("es", s) in skip:
                continue
            for typ, val in (("es", 5.0 + s / 2), ("em", 5500.0 + s)):
                k = key(type=typ, step=s, levtype="pl", param="gh", stream="enfo")
                k["levelist"] = "500"
                ent.append((k, grib_bytes("gh", 500, np.full(shape, val, np.float64), lat, lon)))
        if ent:
            blob, idx = _index_and_blob(ent)
            base = f"/{ymd}/{hh}z/ifs/0p25/enfo/{stamp}-{end}h-enfo-ep"
            store.files[base + ".grib2"] = blob
            store.files[base + ".index"] = idx
    return store
