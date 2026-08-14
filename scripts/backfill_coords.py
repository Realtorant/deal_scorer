#!/usr/bin/env python3
"""Backfill parcel_coords from the Maricopa Assessor Parcel Points shapefile.

Offline data-ops job (run periodically, e.g. monthly — parcel centroids are
static). It's Python rather than TS because shapefile parsing + State Plane ->
WGS84 reprojection are painless with pyshp/pyproj and gnarly in Node.

  python3 -m pip install pyshp pyproj
  python3 scripts/backfill_coords.py

Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env. Only upserts coords for
parcels present in assessor_comps (the comps we actually score), joined by APN.
Requires migration 0003 (parcel_coords table) to have been applied first.
"""
import json, os, sys, time, urllib.request, urllib.parse
from pathlib import Path

PARCEL_POINTS_URL = "https://www.arcgis.com/sharing/rest/content/items/dbf139379db946e1b10a2f15672c142d/data"
ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / ".coords-cache"


def load_env():
    env = {}
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"')
    return env


def supa(env, method, path, body=None):
    url = env["SUPABASE_URL"] + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "apikey": env["SUPABASE_SERVICE_ROLE_KEY"],
        "Authorization": f"Bearer {env['SUPABASE_SERVICE_ROLE_KEY']}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    })
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def fetch_comp_apns(env):
    apns, offset = set(), 0
    while True:
        rows = json.loads(supa(env, "GET",
            f"/rest/v1/assessor_comps?select=parcel_number&order=parcel_number&limit=1000&offset={offset}"))
        for r in rows:
            apns.add(r["parcel_number"])
        if len(rows) < 1000:
            break
        offset += 1000
    return apns


def main():
    import shapefile
    from pyproj import Transformer, CRS

    env = load_env()
    WORK.mkdir(exist_ok=True)
    zip_path = WORK / "ParcelPoints.zip"
    if not zip_path.exists():
        print("downloading Parcel Points shapefile (~85MB)...")
        urllib.request.urlretrieve(PARCEL_POINTS_URL, zip_path)
    import zipfile
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(WORK / "shp")
    base = str(next((WORK / "shp").glob("*.shp")))[:-4]

    print("loading comp APNs from assessor_comps...")
    want = fetch_comp_apns(env)
    print(f"  {len(want):,} comp parcels to locate")

    src = CRS.from_wkt(Path(base + ".prj").read_text())
    tf = Transformer.from_crs(src, CRS.from_epsg(4326), always_xy=True)
    sf = shapefile.Reader(base)
    xs, ys, apns = [], [], []
    try:
        it = sf.iterShapeRecords(fields=["APN"])
    except TypeError:
        it = sf.iterShapeRecords()
    for sr in it:
        apn = sr.record["APN"]
        if apn in want and sr.shape.points:
            x, y = sr.shape.points[0]
            xs.append(x); ys.append(y); apns.append(apn)
    print(f"  matched {len(apns):,} of {len(want):,}")

    lons, lats = tf.transform(xs, ys)
    rows = [{"parcel_number": apns[i], "lat": round(lats[i], 6), "long": round(lons[i], 6)}
            for i in range(len(apns))]

    print("upserting parcel_coords...")
    B = 1000
    for i in range(0, len(rows), B):
        supa(env, "POST", "/rest/v1/parcel_coords", rows[i:i + B])
        if (i // B) % 10 == 0:
            print(f"  {i:,}/{len(rows):,}")
    print(f"done: {len(rows):,} parcel_coords upserted")


if __name__ == "__main__":
    main()
