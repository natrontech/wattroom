#!/usr/bin/env python3
"""Decode WattRoom's .fit exports with Garmin's own FIT SDK (#2330, ADR-0088).

The Go tests decode with muktihari/fit, the library that wrote the file, so a
mistake the two share passes them. This decodes the golden files in
server/internal/fitexport/testdata, which TestGoldenFile pins to what Encode
writes today, with Garmin's Python SDK: header and file CRC checked, every
message through Garmin's profile. Then it holds each file to the Activity file
description (developer.garmin.com/fit/file-types/activity/): the required
messages, the summary fields, and the summary-last order of a single-sport
activity.

    python3 -m venv /tmp/fitsdk
    /tmp/fitsdk/bin/pip install --require-hashes -r scripts/fit-sdk-requirements.txt
    /tmp/fitsdk/bin/python scripts/fit-sdk-check.py server/internal/fitexport/testdata/*.fit
"""

import os
import sys
from datetime import timedelta

from garmin_fit_sdk import Decoder, Profile, Stream

SDK = "{major}.{minor}.{patch}".format(**Profile["version"])
SUMMARY_FIELDS = ("timestamp", "start_time", "total_elapsed_time", "total_timer_time")


def has(mesg: dict, field: str) -> bool:
    return mesg.get(field) is not None


def decode(data: bytes):
    order: list[str] = []
    messages, errors = Decoder(Stream.from_byte_array(bytearray(data))).read(
        enable_crc_check=True,
        mesg_listener=lambda num, _: order.append(Profile["messages"].get(num, {}).get("name", str(num))),
    )
    return order, messages, errors


def check(data: bytes) -> tuple[list[str], str]:
    if not Decoder(Stream.from_byte_array(bytearray(data))).is_fit():
        return ["not a FIT file"], ""
    if not Decoder(Stream.from_byte_array(bytearray(data))).check_integrity():
        return ["header or file CRC does not match, or the file is truncated"], ""
    order, mesgs, errors = decode(data)
    problems = [f"decode: {e}" for e in errors]

    file_ids = mesgs.get("file_id_mesgs", [])
    activities = mesgs.get("activity_mesgs", [])
    sessions = mesgs.get("session_mesgs", [])
    laps = mesgs.get("lap_mesgs", [])
    records = mesgs.get("record_mesgs", [])

    # The required messages: one File Id, one Activity, a Session, a Lap for
    # every Session, and Records. WattRoom writes one sport per ride, so one
    # session: a multi-sport file would need the checks below per session.
    if len(file_ids) != 1:
        problems.append(f"{len(file_ids)} file_id messages, want 1")
    if len(activities) != 1:
        problems.append(f"{len(activities)} activity messages, want 1")
    if len(sessions) != 1:
        problems.append(f"{len(sessions)} session messages, want 1")
    if not laps:
        problems.append("no lap message")
    if not records:
        problems.append("no record messages")
    if problems:
        return problems, ""

    # Order: File Id first, then summary last for a single sport: records,
    # the laps that close over them, the session, and the activity at the end.
    def at(name: str) -> list[int]:
        return [i for i, n in enumerate(order) if n == name]

    if order[0] != "file_id":
        problems.append(f"first message is {order[0]}, want file_id")
    if max(at("record")) > max(at("lap")):
        problems.append("a record follows the last lap")
    if max(at("lap")) > min(at("session")):
        problems.append("a lap follows the session")
    if order[-1] != "activity":
        problems.append(f"last message is {order[-1]}, want activity")

    file_id, activity = file_ids[0], activities[0]
    if file_id.get("type") != "activity":
        problems.append(f"file_id.type is {file_id.get('type')!r}, want 'activity' (4)")
    for field in ("manufacturer", "time_created"):
        if not has(file_id, field):
            problems.append(f"file_id.{field} is absent")
    if activity.get("num_sessions") != len(sessions):
        problems.append(f"activity.num_sessions is {activity.get('num_sessions')}, the file has {len(sessions)}")

    for kind, summaries in (("lap", laps), ("session", sessions)):
        for i, mesg in enumerate(summaries):
            for field in SUMMARY_FIELDS:
                if not has(mesg, field):
                    problems.append(f"{kind} {i}: {field} is absent")
    if problems:
        return problems, ""

    # A summary covers start_time to start_time + elapsed and is written at
    # its end, so its timestamp is not earlier (a second's grace: timestamps
    # are whole seconds, durations are not). Laps run in order, inside the
    # session, and add up to it.
    def end_of(mesg: dict):
        return mesg["start_time"] + timedelta(seconds=mesg["total_elapsed_time"])

    grace = timedelta(seconds=1)
    session = sessions[0]
    for kind, i, mesg in [("session", 0, session)] + [("lap", i, lap) for i, lap in enumerate(laps)]:
        if mesg["total_timer_time"] > mesg["total_elapsed_time"]:
            problems.append(f"{kind} {i}: timer {mesg['total_timer_time']} s exceeds elapsed {mesg['total_elapsed_time']} s")
        if end_of(mesg) > mesg["timestamp"] + grace:
            problems.append(f"{kind} {i}: ends {end_of(mesg)}, after its timestamp {mesg['timestamp']}")
    for i, lap in enumerate(laps):
        if lap["start_time"] < session["start_time"] or end_of(lap) > end_of(session):
            problems.append(f"lap {i}: {lap['start_time']} to {end_of(lap)} is outside the session")
        if i > 0 and lap["start_time"] < end_of(laps[i - 1]):
            problems.append(f"lap {i}: starts {lap['start_time']}, before lap {i - 1} ends")
    for field in ("total_elapsed_time", "total_distance"):
        if has(session, field) or any(has(lap, field) for lap in laps):
            total = sum(lap.get(field) or 0 for lap in laps)
            if abs(total - (session.get(field) or 0)) > 1e-6:
                problems.append(f"laps' {field} sums to {total}, session says {session.get(field)}")

    start, end = session["start_time"], end_of(session)
    previous = None
    for i, record in enumerate(records):
        values = [k for k, v in record.items() if k != "timestamp" and v is not None]
        if not has(record, "timestamp") or not values:
            problems.append(f"record {i}: needs a timestamp and at least one value")
            continue
        stamp = record["timestamp"]
        if previous is not None and stamp <= previous:
            problems.append(f"record {i}: timestamp {stamp} is not after {previous}")
        if not start <= stamp <= end:
            problems.append(f"record {i}: timestamp {stamp} is outside the session, {start} to {end}")
        previous = stamp

    # WattRoom's own promises (ADR-0044): an indoor ride on a trainer, and
    # power on every record, zeros included.
    if (session.get("sport"), session.get("sub_sport")) != ("cycling", "virtual_activity"):
        problems.append(f"session is {session.get('sport')}/{session.get('sub_sport')}, want cycling/virtual_activity")
    unpowered = [i for i, r in enumerate(records) if not has(r, "power")]
    if unpowered:
        problems.append(f"{len(unpowered)} records have no power, the first is record {unpowered[0]}")
    if problems:
        return problems, ""

    def count(field: str) -> int:
        return sum(has(r, field) for r in records)

    # The order as it is, runs folded: "file_id, record x120, lap, ...".
    runs: list[list] = []
    for name in order:
        if runs and runs[-1][0] == name:
            runs[-1][1] += 1
        else:
            runs.append([name, 1])
    sequence = ", ".join(name if n == 1 else f"{name} x{n}" for name, n in runs)
    zero = sum(r.get("power") == 0 for r in records)
    summary = (
        f"{sequence}; "
        f"{session['sport']}/{session['sub_sport']}; start {start.isoformat()}; "
        f"elapsed {session['total_elapsed_time']:g} s, timer {session['total_timer_time']:g} s; "
        f"power on {count('power')} ({zero} at 0 W), cadence on {count('cadence')}, "
        f"heart rate on {count('heart_rate')}, distance on {count('distance')}; "
        f"{session.get('total_calories')} kcal; "
        f"local_timestamp {'set' if has(activity, 'local_timestamp') else 'absent'}"
    )
    return problems, summary


def main(paths: list[str]) -> int:
    if not paths:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    failed = 0
    print(f"Garmin FIT SDK (Python) {SDK}")
    for path in paths:
        with open(path, "rb") as f:
            problems, summary = check(f.read())
        name = os.path.basename(path)
        if problems:
            failed += 1
            print(f"FAIL {name}")
            for p in problems:
                print(f"     {p}")
        else:
            print(f"ok   {name}: {summary}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
