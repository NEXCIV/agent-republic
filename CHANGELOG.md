# Changelog

## v1.1 — 2026-11-18 — Self-built World + 3D

### Added
- `docs/WORLD_ENGINE.md`: WorldFrameV1, chain/offchain provenance, deterministic 60-second simulation, building stage derivation, world APIs, index reconciliation and rollback.
- `docs/3D_RENDERING.md`: R3F orthographic city, District 01 manifest, four landmark buildings, agent visualization, build-stage animation, WebGL fallback and performance acceptance.
- `examples/world-frame.demo.json` and `examples/scene-manifest.demo.json` (explicit DEMO, not production data).

### Changed
- PRD: District 01 feature and eight visual/real-state acceptance checks.
- ARCHITECTURE: `packages/world-engine`, WorldFrame endpoints, new worker queues and strict view-only renderer boundary.
- AGENT_ENGINE: replaced parallel WorldSnapshot model with `AgentObservationV1` derived from WorldFrameV1; visual movement cannot create chain facts.
- SMART_CONTRACTS: clarified that World Engine/3D introduce no contract economic changes.
- UI_DESIGN: new 3D-centered terminal console, provenance labels and graceful fallback.
- IMPLEMENTATION_PLAN: new E5 world, E6 3D, E7 integration tasks and revised deadline/quality gates.
- AGENTS.md and README.md updated for Codex self-built architecture.

### Preserved
- Official Agent ID identity verification and Binance Agentic Wallet security restrictions.
- No direct wallet signing by AI; no `personal_sign` assumption.
- Non-transferable internal BUILD/REP rules and one owner/one vote.
- Whitepaper v0.1 as vision only.

### Not yet implemented
No production code, audited contracts, verified Agentic Wallet custom interaction, deployed contracts, live agents or finished 3D assets are included in this DevPack.
