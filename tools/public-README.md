# Weather Story Explorer

An animation-first web app for watching how the atmosphere moves (ridges, troughs, the jet stream, atmospheric rivers) and how a pattern reaches the places you care about.

This repository holds the app's code and the scheduled data pipeline (GitHub Actions) that turns ECMWF open forecast data into the files the app plays. It is a code snapshot exported from a private working repository, so it carries no project history.

- `site/`: the static web app (no build step).
- `pipeline/`: fetch, derive and validate forecast fields; run by `.github/workflows/data.yml` and `clim.yml`.
- `tests/`: `bash tests/run_all.sh` runs the pipeline, site and script tests.

Forecast data: ECMWF open data, CC-BY-4.0. Reanalysis climatology: Copernicus ERA5.
