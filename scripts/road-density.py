#!/usr/bin/env python3
"""How often two riders share a road (#3318, RESEARCH.md §20).

The chance that someone else is on my 5 km of road, when R riders spread over
roads whose 5 km stretches are ridden with Zipf popularity:

    P(meet) = 1 - exp(-(R - 1) / M_eff),   M_eff = 1 / sum(p_i^2)

M_eff is the effective number of stretches: the number of equally popular
stretches that would give the same chance of company. Every input below is
either a dated fact (with its source in RESEARCH.md §20) or labelled as an
assumption. Run it with no arguments; its output is §20's table.
"""
import math

# Facts, dated (sources in RESEARCH.md §20).
SWISS_ROAD_KM = 85_151  # BFS, 2025
ZWIFT_ROAD_KM = 408.5  # Zwift Insider, 2025-10-15
ZWIFT_ROAD_KM_ALL = 834.7  # with Climb Portal and Gravel Mountain
ZWIFT_PEAK_RIDERS = 40_600  # the5krunner, 2026-01-23
STRETCH_KM = 5

# Assumptions — each one a guess, labelled as such in §20.
ONLINE = 100  # WattRoom riders online at once
SOLO_ON_A_ROAD = 40  # of them, riding solo on a road
HOME_ZIPF = (0.5, 0.8)  # popularity of Swiss 5 km stretches, low and high
LIBRARY_ROADS = 12  # famous climbs in the library
LIBRARY_STRETCHES_PER_ROAD = 4  # a 20 km road each
LIBRARY_SHARE = 0.5  # of solo road riders, on a library road
LIBRARY_ZIPF = 0.8  # popularity of library roads
COL_OF_THE_MONTH_SHARE = 0.75  # of library riders, on the featured col
ZWIFT_ZIPF = 0.8  # popularity of Zwift's stretches

# The alpha-size instance ADR-0076 quotes.
ALPHA_RIDERS = 40
ALPHA_RIDES_PER_WEEK = 3
ALPHA_RIDE_HOURS = 1
ALPHA_SOLO_LIBRARY_SHARE = 0.30
PRIME_TIME_HOURS = 21  # 3 h an evening, 7 evenings
REOPEN_SOLO_RIDES_PER_WEEK = 60  # ADR-0076's condition for the always-on road
DAYS = 90


def zipf(n, s):
    w = [k**-s for k in range(1, n + 1)]
    t = sum(w)
    return [x / t for x in w]


def m_eff(p):
    return 1 / sum(x * x for x in p)


def p_meet(riders, p):
    return 1 - math.exp(-(riders - 1) / m_eff(p))


def library(featured_share=None):
    """Stretch popularity over the library, optionally with a featured col."""
    k = LIBRARY_STRETCHES_PER_ROAD
    if featured_share is None:
        roads = zipf(LIBRARY_ROADS, LIBRARY_ZIPF)
    else:
        rest = zipf(LIBRARY_ROADS - 1, LIBRARY_ZIPF)
        roads = [featured_share] + [(1 - featured_share) * r for r in rest]
    return [r / k for r in roads for _ in range(k)]


def main():
    home = round(SWISS_ROAD_KM / STRETCH_KM)
    lib_riders = SOLO_ON_A_ROAD * LIBRARY_SHARE
    print(f"Someone else on my {STRETCH_KM} km, {ONLINE} online, {SOLO_ON_A_ROAD} solo on a road")
    lo, hi = (p_meet(SOLO_ON_A_ROAD, zipf(home, s)) for s in HOME_ZIPF)
    print(f"  home roads ({home:,} stretches, Zipf {HOME_ZIPF[0]}-{HOME_ZIPF[1]}): {lo:.1%} - {hi:.1%}")
    print(f"  {LIBRARY_ROADS}-road library ({lib_riders:.0f} riders): {p_meet(lib_riders, library()):.0%}")
    col = p_meet(lib_riders, library(COL_OF_THE_MONTH_SHARE))
    print(f"  col of the month takes {COL_OF_THE_MONTH_SHARE:.0%} of them: {col:.0%}")

    print(f"Others per {STRETCH_KM} km in Zwift at peak ({ZWIFT_PEAK_RIDERS:,} riders)")
    for km in (ZWIFT_ROAD_KM_ALL, ZWIFT_ROAD_KM):
        n = round(km / STRETCH_KM)
        print(f"  spread evenly over {km} km: {(ZWIFT_PEAK_RIDERS - 1) / n:,.0f}")
    n = round(ZWIFT_ROAD_KM / STRETCH_KM)
    zipf_others = (ZWIFT_PEAK_RIDERS - 1) / m_eff(zipf(n, ZWIFT_ZIPF))
    print(f"  over {ZWIFT_ROAD_KM} km, Zipf {ZWIFT_ZIPF}: {zipf_others:,.0f}")

    weekly = ALPHA_RIDERS * ALPHA_RIDES_PER_WEEK * ALPHA_SOLO_LIBRARY_SHARE
    per_road = weekly / LIBRARY_ROADS
    lam = per_road * ALPHA_RIDE_HOURS / PRIME_TIME_HOURS
    print(f"Alpha instance: {ALPHA_RIDERS} riders, {ALPHA_RIDES_PER_WEEK} one-hour rides a week, "
          f"{ALPHA_SOLO_LIBRARY_SHARE:.0%} solo on {LIBRARY_ROADS} library roads, {PRIME_TIME_HOURS} prime-time hours")
    print(f"  {per_road:.1f} solo rides a road a week; lambda {lam:.2f} others on the road at a moment")
    print(f"  nobody else there at a given moment: {math.exp(-lam):.0%}; "
          f"nobody met during the whole hour: {math.exp(-2 * lam):.0%}")
    top = zipf(LIBRARY_ROADS, LIBRARY_ZIPF)[0]
    efforts = weekly * DAYS / 7
    print(f"  efforts per library road per {DAYS} days: {efforts / LIBRARY_ROADS:.0f} on average, "
          f"{efforts * top:.0f} on the most popular")

    reopen = REOPEN_SOLO_RIDES_PER_WEEK * ALPHA_RIDE_HOURS / PRIME_TIME_HOURS
    print(f"Reopen condition: {REOPEN_SOLO_RIDES_PER_WEEK} solo rides a week on one road, lambda {reopen:.1f}; "
          f"nobody there at a given moment: {math.exp(-reopen):.0%}")


if __name__ == "__main__":
    main()
