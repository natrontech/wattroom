# Security Policy

WattRoom handles health data (heart rate) and live camera/voice — we treat security reports seriously.

**Report vulnerabilities privately** via [GitHub private vulnerability reporting](https://github.com/natrontech/wattroom/security/advisories/new) — not as public issues.

You can expect an acknowledgment within a week. Pre-1.0 there are no supported-version guarantees; fixes land on `main`.

Scope worth probing: WS message handling (untrusted client input), auth/OAuth flows, room access control, anything that could leak metrics or media outside a room. The privacy rules in [WATTROOM.md](WATTROOM.md) (room-scoped metrics, AV never recorded, rides private by default) are security boundaries — violations of them are vulnerabilities, not feature requests.
