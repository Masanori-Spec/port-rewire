# Hosted verification evidence

Implementation revision: `1fd8a55c31fd1ff7ae14b3fe025ea01f736b00aa`  
Completed on 2026-10-05: [run 37273869596](https://github.com/Masanori-Spec/port-rewire/actions/runs/37273869596)

All five workflow jobs passed. This folder preserves the browser report, the native report, the workflow status, 13 screen/print PNGs, and two single-page A4 PDFs from that exact revision. Evidence-only documentation commits may follow it; inspect the current head's workflow for its own result.

- `browser-report.json`: 40 checks, 8 real ZIP downloads, sandbox launch evidence, print dimensions/text/pixels and source commit
- `native-browser-report.json`: exact downloaded Pd bytes, staged hashes and 16/8/16/16 baseline/negative/repair traces under official Ubuntu Pd 0.52.1
- `workflow-run.json`: successful job names and steps for the implementation revision
- `desktop-*`, `mobile-*`: Japanese/English normal and 200%-text screenshots
- `offline-file-ready.png`: real file-protocol standalone use
- `print-*-preview.png`: print-media previews
- `print-*.pdf` and `print-*-page-1.png`: final A4 pages and independent Poppler renders

The actual artifact ZIPs were authenticated downloads and matched GitHub's artifact digests:

- Browser: `b2a298bb02d45df30b331841adf7ab6e2a8cb66318ca11d8ad91851fa63c36f3`
- Native browser consumer: `61509294f2e3e2aca6eeab70c1da396014f78951845aa28a8a6a25c3104c1781`

Independent rechecking matched all eight ZIP digests/CRCs, both PDF digests, source/output bytes and browser-to-native staged hashes. Visual review checked both languages, desktop/mobile, enlarged text and every printed page. It confirmed readable port identities, expanded comments, unclipped controls, no stray skip-link overlays, and complete print records.

All content is the project's own synthetic fixture. No arbitrary imported patches, signal/audio interfaces, external libraries, production search paths or hardware were tested. This evidence does not prove arbitrary behavioral equivalence.
