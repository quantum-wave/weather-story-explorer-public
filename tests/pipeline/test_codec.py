"""P-CODEC: quantization, saturation, dx-shuffle and the gzip chunk, against the frozen byte format."""
import gzip
import importlib.util
import os
import pathlib

import numpy as np
import pytest

from pipeline.encode import NODATA, decode_chunk, dequantize, dx_shuffle, encode_chunk, quantize

ROOT = pathlib.Path(__file__).resolve().parents[2]


def independent_decode(blob, ny, nx, nframes):
    """Decoder written straight from the contract text in site/js/contract.js, with plain Python integers."""
    raw = gzip.decompress(blob)
    n = ny * nx
    frames = []
    for f in range(nframes):
        seg = raw[f * 2 * n:(f + 1) * 2 * n]
        lo, hi = seg[:n], seg[n:]
        fr = []
        for r in range(ny):
            acc, row = 0, []
            for c in range(nx):
                k = r * nx + c
                acc = (acc + (hi[k] << 8 | lo[k])) & 0xFFFF
                row.append(acc - 65536 if acc >= 32768 else acc)
            fr.append(row)
        frames.append(fr)
    return np.array(frames, dtype=np.int16)


def test_roundtrip_matches_an_independent_decoder_including_wraparound():
    rng = np.random.default_rng(1)
    f = rng.integers(-32767, 32768, size=(3, 7, 11), dtype=np.int16)
    f[0, 0, :] = np.where(np.arange(11) % 2, 32767, -32767)  # differences wrap mod 65536
    f[1, 2, 3] = NODATA
    blob = encode_chunk(f)
    assert blob[:2] == b"\x1f\x8b"
    assert np.array_equal(decode_chunk(blob, 7, 11, 3), f)
    assert np.array_equal(independent_decode(blob, 7, 11, 3), f)


def test_filter_none_roundtrip_and_unknown_filter():
    f = np.arange(-6, 6, dtype=np.int16).reshape(1, 3, 4)
    assert np.array_equal(decode_chunk(encode_chunk(f, "none"), 3, 4, 1, "none"), f)
    with pytest.raises(ValueError):
        encode_chunk(f, "zstd")


def test_dx_shuffle_layout_is_low_bytes_then_high_bytes():
    fr = np.array([[1, 258, 258]], dtype=np.int16)  # diffs 1, 257, 0 -> low 01 01 00, high 00 01 00
    assert dx_shuffle(fr) == bytes([1, 1, 0, 0, 1, 0])


def test_quantize_saturates_and_marks_no_data():
    q = quantize(np.array([np.nan, np.inf, -np.inf, 1e9, -1e9, 12.4, 12.6, -0.04]), 0.1, 0)
    assert q.tolist() == [NODATA, NODATA, NODATA, 32767, -32767, 124, 126, 0]
    # offset and scale: msl 101325 Pa at 10 Pa steps
    assert quantize(np.array([101325.0, 101335.0]), 10, 101325).tolist() == [0, 1]
    # a real value never becomes the NODATA code, even far below range
    assert NODATA not in quantize(np.array([-1e12]), 1, 0)


def test_dequantize_restores_values_and_nan():
    q = np.array([NODATA, 5, -5], np.int16)
    d = dequantize(q, 0.1, 0)
    assert np.isnan(d[0]) and d[1] == pytest.approx(0.5) and d[2] == pytest.approx(-0.5)


def test_encoding_is_byte_stable():
    f = np.arange(200, dtype=np.int16).reshape(2, 10, 10)
    assert encode_chunk(f) == encode_chunk(f.copy())


def test_decode_rejects_garbage_and_wrong_length():
    with pytest.raises(ValueError):
        decode_chunk(b"nope", 2, 2, 1)
    with pytest.raises(ValueError):
        decode_chunk(encode_chunk(np.zeros((1, 2, 2), np.int16)), 2, 2, 2)


def test_bytes_equal_phase0_fixture_encoder():
    """The Phase 0 stand-in (tools/make_fixtures.py) and the pipeline produce identical bytes."""
    spec = importlib.util.spec_from_file_location("make_fixtures", ROOT / "tools" / "make_fixtures.py")
    mf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mf)
    rng = np.random.default_rng(7)
    f = (np.cumsum(rng.normal(0, 3, (2, 19, 36)), axis=2)).astype(np.int16)
    assert encode_chunk(f) == mf.encode_chunk(f)


def test_real_frame_size_matches_the_spike_measurement(fixtures_dir):
    """A real 1 degree 500 hPa frame at 1 gpm encodes to about 32.9 kB (spike: 32,870; Phase 0: 32,882)."""
    from pipeline.gribio import read_messages
    msgs = [m for m in read_messages(os.path.join(fixtures_dir, "test4.grib")) if m.short == "z"]
    m = msgs[0]
    q = quantize(m.data / 9.80665, 1, 0)
    blob = encode_chunk(q[None])
    assert 31000 < len(blob) < 35000, len(blob)
    assert np.array_equal(decode_chunk(blob, *q.shape, 1)[0], q)
