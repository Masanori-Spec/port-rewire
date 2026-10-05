# PortRewire

A small offline workbench for repairing Pure Data caller connections after an abstraction's **control inlet/outlet order changes**.

Open [`dist/port-rewire.html`](dist/port-rewire.html) in a modern browser. No server, account, network requests or runtime dependencies are needed. Japanese and English interfaces are included. Imported patches are read as UTF-8 text and are **never executed**.

## The job it does

1. Load the old abstraction, the revised abstraction, and caller/support `.pd` files.
2. Review ports in their actual left-to-right X-coordinate order.
3. Explicitly map each old inlet and outlet to a unique revised index.
4. Select exact-name instances, including instances inside nested canvases.
5. Preview every changed connection and download a migration ZIP.

The ZIP contains the revised abstraction under the **original basename**, repaired callers, unchanged supplied support patches, `migration.json`, `receipt.json` and a readable `receipt.txt`. Keep your originals; test the bundle in a separate folder before replacing production patches.

`migration.json` binds the chosen permutation and selected instances to SHA-256 source hashes. Reusing that saved contract with changed or already-migrated caller bytes fails. An identity/no-edit mapping retains the original bytes and is safely repeatable. A freshly created contract is a new user decision; the app cannot infer migration history from arbitrary patch text.

## Deliberately narrow scope

- Equal-count bijections of argument-free ordinary `[inlet]` / `[outlet]` ports
- Exact, unqualified abstraction object name; no substring or path lookup
- One selected abstraction basename, up to 20 caller/support files
- At most 512 KiB per file, 4 MiB combined, 20,000 records per file, 32 canvas levels
- Standard `#N canvas`, `#X obj/msg/text/floatatom/symbolatom/listbox`, `#X connect`, `#X restore … pd …`, `#X coords` and presentation width records
- Safe ASCII filenames; UTF-8 patch content without BOM or unsupported control characters
- Plain object-class tokens; graphical coordinates within −32768…32767; atoms shorter than 1,000 UTF-8 bytes

The app refuses ambiguous equal-X port positions, invalid graph object indices, incomplete or duplicate mappings, unsupported record forms, comma-chained canvas commands, forward references, escaped/parameterized object classes, signal interface ports, changed port counts, `clone`, `declare`, and recognizable dynamic-canvas messaging.

Outside scope: signal interfaces, added/deleted ports, type conversion, array/data-structure records, dynamic patch generation, external-library migration, abstraction/path shadow resolution, and arbitrary semantic or behavioral equivalence. Unrelated object classes are treated as inert text, not resolved or checked for availability. Runtime-generated dynamic behavior cannot be proven absent by a text parser. Include required local support patches yourself; external dependencies are not discovered or bundled automatically.

**Nearby comments are context, not authoritative port identities.** The user supplies the semantic mapping. SHA-256 confirms which source version was reviewed; it does not prove that an arbitrary revised abstraction has equivalent behavior.

## Preservation contract

Only the relevant integer inlet/outlet tokens in selected `#X connect` records are replaced. The implementation does not serialize the graph. Connection creation order, source/destination object indices, coordinates, comments, whitespace, CRLF/LF, unselected instances and all unrelated bytes are preserved. `#X text` counts in local object indices. A nested canvas's `#X restore` contributes exactly one parent object.

See [format contract](docs/FORMAT.md), [validation evidence](docs/VALIDATION.md), and [product rationale](docs/PRODUCT.md).

## Development and checks

Node 22 or later and Python 3.10 or later are enough for core/build/oracle checks. Browser tests use the pinned development-only Playwright dependency.

```sh
npm ci --ignore-scripts
npm run check
npm run serve
```

The served URL is `http://127.0.0.1:4173/`. Build output is deterministic. `npm run demo` regenerates own-authored example data and exports `artifacts/demo/` plus an identity/no-op bundle.

### Native consumer verification

Install the official distribution's `puredata-core` package **for testing only**, then run:

```sh
python3 scripts/native_gate.py --app-callers artifacts/demo --output artifacts/native
```

The only patches executed are the included own-authored fixtures, guarded against arbitrary substitution. Pd runs headless with `-nogui -batch -noaudio -nomidi -noprefs -stderr`; the own harness quits automatically, and the runner enforces a timeout. Neither user imports nor real hardware are used.

The fixture checks old/original baseline, revised/original negative control, handwritten repair, and actual app repair. Exact nested-canvas and same-outlet fan-out trace order must match. See [fixture details](fixtures/native/README.md).

### Browser verification

`npm run test:browser` is restricted to a non-root **GitHub-hosted Ubuntu 22.04** runner, with Chromium's sandbox explicitly enabled and its launch command independently checked. Do not remove that guard or disable the sandbox. The workflow tests the actual standalone HTML, Japanese/English desktop/mobile views, keyboard access, input replacement/reset races, saved contracts, and real downloaded ZIP bytes.

## License and distribution

Own application, parser, ZIP writer, synthetic fixtures and tests: MIT. Runtime dependencies: none. Playwright is development-only (Apache-2.0). Pd and its runtime dependencies are fetched from the operating-system distribution only when tests run; no Pd, ELSE, pd-vibe, tutorial patches, binaries or SDKs are distributed here. This is an independent project, not affiliated with those projects.

Resource bounds additionally limit each direction to 64 ports, the caller bundle to 512 exact-name instances and 5,000 connection records. These bounds keep the review UI finite; larger projects should be split into reviewed bundles.

## Printing a reviewed migration

After previewing, use the browser’s Print command. The print view includes the reviewed changes, contract SHA-256, bundle filenames and verification caveats. Interactive file/mapping controls are omitted. Printing does not apply a migration or change any source file.

## Verified example and previews

[Hosted verification](https://github.com/Masanori-Spec/port-rewire/actions/runs/37273869596): 74 Node tests per Node version, 21 independent Python test methods, 40 browser checks, and native Pd verification of the actual browser download. See the [verification record](docs/VALIDATION.md) for the exact revision and limits.

- [Japanese desktop](evidence/hosted/desktop-ja-ready.png) / [English desktop](evidence/hosted/desktop-en-ready.png)
- [Japanese mobile](evidence/hosted/mobile-ja-ready.png) / [English mobile](evidence/hosted/mobile-en-ready.png)
- [Japanese enlarged text](evidence/hosted/mobile-ja-text-200.png) / [English enlarged text](evidence/hosted/mobile-en-text-200.png)
- [Japanese A4 review](evidence/hosted/print-ja.pdf) / [English A4 review](evidence/hosted/print-en.pdf)

All previews use the included own-authored synthetic fixture. No user patch was uploaded or executed.
