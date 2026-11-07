# Factory Glossary

- **Execution Key**: Deterministic identifier `<owner>/<repo>#<issue_number>` used for deduplication and single-flight locks.
- **Stage Token**: Single-use token (`st_<hex>`) issued per stage; replay or stage mismatch returns HTTP `409`.
- **Verifier**: Fresh independent sub-agent (`author != verifier`) required by `tlc-spec-lean` v2.2.0 Rule 5.
- **Judge**: Automated PR reviewer (`the-judge` skill) returning `APPROVE`, `REQUEST_CHANGES`, or `COMMENT` tied to `commit_sha` with a 3-round cap.
- **Circuit Breaker**: Router safety switch that opens on `timeout`, HTTP `500`, or HTTP `429` to stop burning tokens on a degraded runtime.
