# Project state

## Decisions

| ID | Decision | Rationale | Status | Date |
| --- | --- | --- | --- | --- |
| AD-001 | Use `tlc-spec-lean` v2.2.0 (`8658b66`) for all feature and bug implementation work | Enforces frozen obligations (`checks.md`), deterministic proof runner (`check_proofs.py`), and independent Verifier sub-agent (`validate_verification.py`), rejecting legacy v1 spec workflows | active | 2026-11-07 |
| AD-002 | Autonomous phase execution authorized across the roadmap (`docs/plan.md`) | User answered "podemos seguir todas as fases de maneira autonoma", authorizing plan approval, local commits, Verifier dispatch, and `git push` across Phases 2–7 | active | 2026-11-07 |
| AD-003 | Consolidate navigation into AWS Cloudscape `SideNavigation`, rebrand top bar to `Agentic Factory Control Plane`, and remove redundant `#tabs` and header utility clutter | User preferred `SideNavigation` drawer over duplicate `#tabs`, requested rebranding `TopNavigation` title to `Agentic Factory Control Plane`, removing redundant top status pills (`AUTONOMY`, `STALLED`), and moving `Refresh Telemetry` to an authentic Cloudscape Button in the page Header | active | 2026-11-08 |
| AD-004 | Unify Control Panel Kanban board into 3 consolidated columns: Triage, In Progress, and Done | User selected consolidating 9 granular stage columns into 3 columns: `Triage` (`triage`), `In Progress` (`plan`, `checks_and_build`, `verify`, `review`, `investigate`, `discover`, `merge`), and `Done` (`done`), while retaining granular stage badges on each task card | active | 2026-11-08 |


