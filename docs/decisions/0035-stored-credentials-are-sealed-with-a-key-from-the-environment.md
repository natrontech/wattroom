# 0035 — Stored credentials are sealed with a key from the environment

- Status: accepted
- Date: 2026-09-08
- Constrained by: [0002](0002-single-vm-compose-deploy.md) — one VM, docker
  compose, no KMS; and [0019](0019-tagged-releases-and-a-self-converging-vm.md)
  — the deploy timer's `pg_dump` before every rollout, and expand/contract
- Answers: [#697](https://github.com/natrontech/wattroom/issues/697), decided
  by the maintainer in that thread on 2026-09-06

## Context

The Strava refresh token was stored in the clear. It was the only credential
held that way: session tokens are hashed, because nothing ever needs them back,
and no other third-party credential is stored at all. It is `activity:write` —
it can post fabricated activities to a rider's Strava account, but cannot read
their data back — and it is long-lived by design, which is what makes
auto-upload work without re-authorising.

"Encrypt it" becomes a key-management question immediately, and
[0002](0002-single-vm-compose-deploy.md) leaves nowhere to put a managed key.
So the honest question is what a key in the app's environment actually buys:

**Exactly one thing — a database dump that escapes the host without the app's
environment.** That is not hypothetical.
[0019](0019-tagged-releases-and-a-self-converging-vm.md) has the deploy timer
`pg_dump` before every rollout, so dumps exist routinely on disk and in
whatever backs them up. It buys nothing against an attacker with code execution
on the VM, who has the environment and therefore the key.

## Decision

**Seal it with AES-256-GCM under a key from the app environment**, and encrypt
the dumps in the operator's infrastructure repo. Both, because they are
different controls: the second covers rides, DMs, email addresses and session
hashes at the same operational cost, and the first stays cheap.

This ADR covers the app half. `internal/secrets` owns it — the cipher, the pair
of column values a credential is written as, and the boot-time backfill.

**Absent key: a warning, and storage in the clear.** This has to stay possible,
or the release that introduces the key cannot be deployed before the key is
provisioned, and every dev box would need one to run a feature it does not
exercise.

**Present but unusable key: refuse to start.** An operator who set the variable
believes credentials are encrypted; a server that boots anyway makes that
belief false and silent. Failing loudly is also the safe direction here —
[0019](0019-tagged-releases-and-a-self-converging-vm.md)'s health gate catches
it and rolls back the image, which is the designed response to a bad deploy.

**Rotation is re-authorisation, not re-encryption.** There is no key-versioning
scheme and no envelope: a changed key makes every sealed token unreadable, and
riders reconnect Strava. That is an honest cost at this scale — one VM, one
integration, a table bounded by third-party connections — and inventing a key
hierarchy for it would be building a KMS badly. The error names
`WATTROOM_TOKEN_KEY` so a rotation that was not meant to happen is diagnosable
rather than mysterious.

## The rollback consequence, stated plainly

Expand/contract is honoured for the **schema**: this release only adds a
nullable `identities.refresh_token_enc`, and the plaintext column is dropped a
release after the code stops reading it.

The **data** is a different matter, and it is a deliberate choice. Once a key
is configured, writes clear the plaintext column — that is the entire point,
since leaving a stale credential behind protects nothing. So retagging to an
image older than this one leaves Strava auto-upload needing a reconnect for any
rider whose token was written or backfilled in the meantime. Rolling back to
this release or newer is unaffected.

The alternative — writing both columns for a release — was rejected because it
delivers no security benefit at all in the release that claims to, and the
credential this removes is write-scoped rather than a login.

## Consequences

- `internal/secrets` is where "how a stored credential is stored" is answered,
  once. Three writers were about to answer it separately.
- Reads take either column, sealed first, so the release that turns the key on
  meets rows written before it without asking anyone to reconnect. A sealed
  value that will not open is an error naming the key variable — never "no
  token stored", which would tell every rider to reconnect over an operator's
  mistake.
- A one-time backfill at boot seals the rows written before the key existed. It
  is best-effort and not a transaction: the table is bounded by third-party
  connections, a row it cannot seal is left readable through the plaintext path,
  and the next boot tries again. A server that refuses to start because one row
  would not update helps nobody.
- Dropping `identities.refresh_token` is a follow-up issue for the release
  after this one.
- The operator's infrastructure repo owns key provisioning, its presence across
  VM rebuilds, and encrypting the dumps. None of that lives here.

## Alternatives

- **Accept plaintext and write it down.** Defensible only if dump handling is
  genuinely controlled, which is knowledge that lives in the infrastructure
  repo. Rejected once dumps were confirmed to be produced automatically before
  every deploy.
- **Stop storing the token; re-authorise per upload.** Removes the credential
  and breaks the auto-upload promise in WATTROOM.md, which is the reason the
  integration exists.
- **A managed key service.** Contradicts [0002](0002-single-vm-compose-deploy.md).
