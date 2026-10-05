# Independent verification

`python3 -m unittest discover -s oracle -p 'test_*.py' -v`

`python3 scripts/verify_export.py artifacts/demo --identity-dir artifacts/identity --report artifacts/oracle/report.json`

## What is independent

- `scripts/verify_export.py` uses only Python's standard library, never the app's JavaScript parser or mapping functions
- Its complete expected connection table is handwritten, checked against separate hand-authored `fixtures/native/remapped/*.pd` files
- A byte-oriented regular-expression record scanner locates connection integer slots, canvas scopes, and fixture object positions
- Exact full-file comparisons permit only the declared endpoint edits; comments, escaping, whitespace, CRLF, connection/fanout order, and object indices are all covered
- The revised abstraction and unselected `triplet-extra.pd` must match their supplied source bytes
- Python independently computes source/output hashes and the migration contract ID, and checks both machine-readable and plain-text receipts
- The identity bundle must preserve every original caller byte

`oracle/probe_core.mjs` is only a JSON transport for exercising the public API. It contains no expected results, parsers, or rewriting logic. `test_independent.py` supplies its own UTF-8/CRLF/nested caller, exact root-only and nested-only expectations, identity/leading-zero cases, and variable-width endpoint cases.

The adversarial suite checks incomplete/duplicate/noninteger maps, invalid selection, source/hash tampering, replay, object and selected-port range errors, comments as endpoints, unsupported/dynamic records, malformed nesting, equal-X port ambiguity, signal/argumented/count-changing ports, encoding, filename traversal, and output collisions. Mutation tests also prove the oracle rejects altered endpoints, untouched bytes, connection order, module/support files, CRLF normalization, or forged receipt data, even when an attacker recomputes output hashes.

## Scope

This oracle is intentionally grounded in the authored demo fixtures. It is not a second general Pure Data parser and does not claim arbitrary patch behavioral equivalence. Native execution evidence is a separate gate run against synthetic fixtures only. Imported user patches are never executed by these checks.
