# 0001 — Record decisions as ADRs; WATTROOM.md is the founding set

- Status: accepted
- Date: 2026-07-16

## Context

The project started with an intensive decision phase: platform, stack, feature set, game design, privacy stance, and tooling were settled interactively and validated with deep research (see [RESEARCH.md](../RESEARCH.md)). Those ~35 decisions live in [WATTROOM.md](../../WATTROOM.md) as a table. As contributors join, future decisions need a home that captures *why*, survives Slack/PR archaeology, and can be proposed via PR.

## Decision

[WATTROOM.md](../../WATTROOM.md) is frozen as the founding decision record — it is edited only to mark a decision as superseded. Every decision from here on that changes architecture, protocol semantics, dependencies, product behavior, or tooling gets a numbered ADR in this directory, using [0000-template.md](0000-template.md), landing in the same PR as the change it explains. Contributors propose decisions the same way.

## Consequences

"Why did we do X?" has one answer path: WATTROOM.md table → ADR number. The founding document keeps its shape instead of becoming a changelog. Cost: small ceremony per decision — deliberately smaller than the decision itself.
