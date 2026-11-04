#!/usr/bin/env python3
"""Build house radio's records: the CC0 tracks behind the lounge's Records style.

Reads the Free Music Archive page of every entry in
web/src/lib/lounge/records.json, refuses any track whose own licence field is
not CC0 1.0, downloads it, evens its loudness, re-encodes it to 96 kbps MP3
into server/radio/, and writes the title, artist, licence and measured length
back into records.json. That file is the station's credits list.
Then it packs server/radio/ into house-radio.tar for a GitHub release; the
Dockerfile and `make radio` fetch that tarball by checksum.

Usage: python3 scripts/house-radio.py   (needs ffmpeg and ffprobe)
"""

import hashlib
import html
import json
import pathlib
import re
import subprocess
import tarfile
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
LIST = ROOT / "web/src/lib/lounge/records.json"
OUT = ROOT / "server/radio"
CACHE = ROOT / "server/radio-src"
TAR = ROOT / "house-radio.tar"
CC0 = "https://creativecommons.org/publicdomain/zero/1.0/"
# A radio under a lounge, not a club: a little below a streaming master.
LUFS = -16


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "wattroom-house-radio"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read()


def title_of(raw: str) -> str:
    # FMA titles carry mood tags, "( Lofi , Chill )", and sometimes ".mp3".
    t = re.sub(r"\s*\(\s*lo-?fi\b.*$", "", raw, flags=re.I)
    return re.sub(r"\.mp3$", "", t).replace("_", "").strip()


def main() -> None:
    OUT.mkdir(exist_ok=True)
    CACHE.mkdir(exist_ok=True)
    records = json.loads(LIST.read_text())
    for r in records:
        page = get(r["url"]).decode()
        info = next(
            d
            for m in re.finditer(r"data-track-info='([^']*)'", page)
            if (d := json.loads(html.unescape(m.group(1))))["url"] == r["url"]
        )
        licences = set(re.findall(r'rel="license"[^>]*href="([^"]+)"', page))
        if licences != {CC0}:
            raise SystemExit(f"{r['url']}: licence {licences}, not CC0")
        title = title_of(info["title"])
        file = re.sub(r"[^a-z0-9]+", "-", title.lower().replace("'", "")).strip("-") + ".mp3"
        src = CACHE / file
        if not src.exists():
            src.write_bytes(get(info["fileUrl"]))
        dst = OUT / file
        # The masters span 10 LU; two-pass loudnorm brings each to one level,
        # so a quiet record never follows a loud one.
        norm = f"loudnorm=I={LUFS}:TP=-1.5:LRA=11"
        measured = subprocess.run(
            ["ffmpeg", "-hide_banner", "-i", src, "-af", norm + ":print_format=json", "-f", "null", "-"],
            check=True, capture_output=True, text=True,
        ).stderr
        m = json.loads(measured[measured.rindex("{") : measured.rindex("}") + 1])
        norm += (f":measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
                 f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", src, "-map", "0:a", "-map_metadata", "-1",
             "-af", norm, "-c:a", "libmp3lame", "-b:a", "96k", "-ar", "44100", dst],
            check=True,
        )
        sec = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", dst],
            check=True, capture_output=True, text=True,
        ).stdout
        r.update(file=file, title=title, artist=info["artistName"], licence="CC0 1.0", ms=round(float(sec) * 1000))
        print(f"{file}\t{r['ms'] / 1000:.1f} s")
    LIST.write_text(json.dumps(records, indent="\t") + "\n")
    with tarfile.open(TAR, "w") as tar:
        for r in records:
            tar.add(OUT / r["file"], arcname=r["file"])
    print(f"{TAR.name} {TAR.stat().st_size / 1e6:.1f} MB sha256:{hashlib.sha256(TAR.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
