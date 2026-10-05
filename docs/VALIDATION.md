# Verification record

## Local evidence, 2026-10-05

Passed before full UI investment:

- Official Debian `puredata-core` 0.55.2+ds-2, extracted for testing outside this repository
- Own-authored old abstraction + original callers: exact 16-event expected trace
- Revised abstraction + original callers: exact 8-event negative trace, different from baseline
- Revised abstraction + handwritten endpoint-repaired callers: exact original 16-event trace
- No failed-create or failed-connect diagnostics
- Root and nested canvas indices, comments before objects, non-index-sorted fan-out creation order, LF/CRLF, escaped semicolons/commas

Then passed with the app's actual exported caller files: the same exact 16-event native trace. `scripts/native_gate.py` checks that only the known authored fixture exports are executed.

Core and UI event/state regressions: 74 Node test cases. Independent oracle: 21 Python test methods with adversarial subcases and oracle-mutation self-tests. The Python verifier imports no application functions; its separate scanner and handwritten endpoint table check the actual exported files.

- Migration: 16 expected endpoint edits, 1,985 untouched caller bytes verified exactly
- Identity: zero edits, all 2,001 caller bytes unchanged
- Revised abstraction and unrelated support bytes match their sources
- Source/output hashes, selected root/nested instance scope, connection order and receipt details verified
- Rejected malformed maps/contracts and sparse arrays, source/hash changes, double application, ambiguous ports, malformed nesting/records, invalid/forward indices, comma chaining, coordinate overflow, oversized atoms, escaped-class ambiguity, and encoding/filename hazards
- Event/state regressions cover independent concurrent imports, latest same-field read wins, pending-contract cancellation, disabled mappings during import and reset with late completions

Evidence snapshots are in `evidence/local/`. These show local headless Pd verification only. No local graphical Pd or browser was launched.

## Hosted browser and second native gate

The workflow `.github/workflows/verify.yml` defines:

1. Node 22/24 core, independent oracle and deterministic standalone build checks
2. Native Pd against actual CLI exports using Ubuntu's official `puredata-core`
3. Actual standalone HTML checks on GitHub-hosted Ubuntu 22.04, non-root Chromium with sandbox explicitly enabled, Japanese/English desktop/mobile screenshots, keyboard/reflow, saved contracts, invalidation/races, and real ZIP download verification
4. Native Pd against the exact browser-downloaded fixture callers

The full hosted workflow passed on implementation commit [`1fd8a55c31fd1ff7ae14b3fe025ea01f736b00aa`](https://github.com/Masanori-Spec/port-rewire/commit/1fd8a55c31fd1ff7ae14b3fe025ea01f736b00aa): [verified run 37273869596](https://github.com/Masanori-Spec/port-rewire/actions/runs/37273869596). All five jobs succeeded: Node 22, Node 24, native CLI exports, sandboxed browser/download/print checks, and native consumer validation of the exact browser-downloaded callers. Checked-in [hosted evidence](../evidence/hosted/README.md) records that implementation revision; subsequent evidence-only commits do not change the application or test logic.

## What the evidence does not establish

The native fixture verifies a known arithmetic control abstraction and deterministic message order. It does not establish semantic equivalence for arbitrary imported patches, compatibility with arbitrary Pd syntax, signal processing, external libraries, search paths, dynamic patches, or real hardware. No uploaded user patches are executed by the app or the tests.

## Print and enlarged-text reflow additions

Both hosted A4 print checks passed in Japanese and English. Each generated a clean single-page PDF, a print-media preview and a page rendered with the official distribution Poppler tools. Assertions cover all 16 change records, 32 endpoint tuples, bundle filenames, the full contract SHA-256, localized headings, hidden interactive controls, A4 dimensions, bounded page count, nonblank pixels and white paper margins. The PDFs and rendered pages are checked in with the hosted evidence.

Enlarged-text checks now inspect internal clipping of source context, revised-port details, index chips and the brand mark, and measure selected option text against available width. Mobile rows stack, comments expand, and revised X/object identities wrap outside the native select control. Screenshots begin at scroll top and assert that an unfocused skip link is visually clipped. The fresh hosted screenshots were visually reviewed in both languages, at desktop and 390px mobile sizes, including 200% text. Port identities and full reference comments remain readable; the previous narrow-column clipping and skip-link capture artifact are resolved.

## Download and native consumer evidence

- 40 browser checks passed, with no unexpected external requests or browser errors
- Eight actual downloaded ZIPs passed their SHA-256 and CRC checks
- Independent Python recheck confirms all 16 endpoint edits and every unrelated byte; the identity bundle retains all 2,001 caller bytes
- Ubuntu 22.04 official `puredata-core` reports Pd 0.52.1; the native job stages the exact browser-download bytes after golden-hash checks
- The native old/original, revised/original negative, handwritten repair and browser repair traces contain exactly 16, 8, 16 and 16 expected events respectively
- The four exported Pd file hashes equal the hashes actually staged in the native consumer

The earlier local Pd 0.55.2 check and hosted Pd 0.52.1 check are separate, accurately versioned evidence. Neither establishes behavior for arbitrary user patches.
