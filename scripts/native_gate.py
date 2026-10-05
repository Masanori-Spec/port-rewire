#!/usr/bin/env python3
"""Run only the own-authored deterministic native Pure Data fixture harness.

This is an independent native oracle, not the application parser. --app-callers
accepts only byte-verified exports of the two known callers, revised triplet
module and unchanged triplet-extra support. The actual verified export bytes
are staged with the own-authored harness; arbitrary imported patches never run.
"""

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures" / "native"
CALLERS = ("caller-a.pd", "caller-b.pd")
APP_GOLDENS = {
    "caller-a.pd": FIXTURES / "remapped" / "caller-a.pd",
    "caller-b.pd": FIXTURES / "remapped" / "caller-b.pd",
    "triplet.pd": FIXTURES / "new" / "triplet.pd",
    "triplet-extra.pd": FIXTURES / "support" / "triplet-extra.pd",
}
PD_FLAGS = ["-nogui", "-batch", "-noaudio", "-nomidi", "-noprefs", "-stderr"]
TRACE = re.compile(r"^[AB]_(?:RESULT|FAN_FIRST|FAN_SECOND|ECHO): -?\d+(?:\.\d+)?$")
BAD_DIAGNOSTIC = re.compile(
    r"couldn.t create|could not create|connection failed|connect[^\n]*failed|"
    r"failed[^\n]*connect|^error:|syntax error|cannot open|can't open|no such object",
    re.IGNORECASE | re.MULTILINE,
)


def expected_trace():
    result = []
    for label, pairs in (("A", ((7, 3), (9, 4))), ("B", ((5, 2), (14, 5)))):
        for value, echo in pairs:
            result.extend([
                f"{label}_RESULT: {value}", f"{label}_FAN_FIRST: {value}",
                f"{label}_FAN_SECOND: {value}", f"{label}_ECHO: {echo}",
            ])
    return result


EXPECTED = expected_trace()
NEGATIVE_EXPECTED = [
    "A_ECHO: 2", "A_RESULT: 1", "A_FAN_FIRST: 1", "A_FAN_SECOND: 1",
    "B_ECHO: 3", "B_RESULT: -1", "B_FAN_FIRST: -1", "B_FAN_SECOND: -1",
]


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fixture_invariants():
    """Guard the golden fixture independently of any app implementation."""
    for name in CALLERS:
        original = (FIXTURES / "original" / name).read_bytes()
        mapped = (FIXTURES / "remapped" / name).read_bytes()
        if name == "caller-a.pd":
            assert b"\r" not in original and b"\r" not in mapped, "A must remain LF"
        else:
            assert b"\r\n" in original and b"\r\n" in mapped, "B must remain CRLF"
            assert b"\n" not in original.replace(b"\r\n", b"")
            assert b"\n" not in mapped.replace(b"\r\n", b"")
        before, after = original.splitlines(keepends=True), mapped.splitlines(keepends=True)
        assert len(before) == len(after)
        changes = [(left, right) for left, right in zip(before, after) if left != right]
        assert len(changes) == 8, f"{name}: exactly eight endpoint edits required"
        for left, right in changes:
            assert left.startswith(b"#X connect ") and right.startswith(b"#X connect ")
            left_tokens, right_tokens = left.split(), right.split()
            differing = [i for i, pair in enumerate(zip(left_tokens, right_tokens)) if pair[0] != pair[1]]
            assert differing in ([3], [5]), "Only an outlet or inlet number may change"
            assert len(left) == len(right), "Fixtures have one-digit port replacements"
        assert b"triplet-extra" in original
        assert b"\\," in original and b"\\;" in original
    old = (FIXTURES / "old" / "triplet.pd").read_text().splitlines()
    new = (FIXTURES / "new" / "triplet.pd").read_text().splitlines()
    changes = [(a.split(), b.split()) for a, b in zip(old, new) if a != b]
    assert len(changes) == 5, "Only three inlet and two outlet x-coordinates change"
    for a, b in changes:
        assert [i for i, pair in enumerate(zip(a, b)) if pair[0] != pair[1]] == [2]


def run_case(pd, name, definition, callers, expected, output_dir, app_files=None):
    with tempfile.TemporaryDirectory(prefix="port-rewire-native-") as temporary:
        stage = Path(temporary)
        shutil.copyfile(FIXTURES / "support" / "harness.pd", stage / "harness.pd")
        if app_files is not None:
            # Stage the same bytes already checked before any native execution.
            # Do not reread source exports here, avoiding a check/use race.
            for filename, content in app_files.items():
                (stage / filename).write_bytes(content)
        else:
            shutil.copyfile(FIXTURES / "support" / "triplet-extra.pd", stage / "triplet-extra.pd")
            shutil.copyfile(FIXTURES / definition / "triplet.pd", stage / "triplet.pd")
            for filename in CALLERS:
                shutil.copyfile(callers / filename, stage / filename)
        staged_sha256 = {path.name: sha256(path) for path in sorted(stage.glob("*.pd"))}
        command = [pd, *PD_FLAGS, "-open", "harness.pd"]
        try:
            process = subprocess.run(command, cwd=stage, stdout=subprocess.PIPE,
                                     stderr=subprocess.STDOUT, text=True, timeout=15,
                                     check=False)
            log, returncode, timed_out = process.stdout, process.returncode, False
        except subprocess.TimeoutExpired as error:
            partial = error.stdout or b""
            log = partial.decode(errors="replace") if isinstance(partial, bytes) else partial
            returncode, timed_out = None, True
        (output_dir / f"{name}.log").write_text(log)
        lines = [line.strip() for line in log.splitlines()]
        trace = [line for line in lines if TRACE.fullmatch(line)]
        diagnostics = BAD_DIAGNOSTIC.findall(log)
        unexpected_trace = [line for line in lines
                            if line.startswith(("A_", "B_")) and not TRACE.fullmatch(line)]
        passed = not timed_out and returncode == 0 and not diagnostics and not unexpected_trace and trace == expected
        return {
            "name": name, "passed": passed, "returncode": returncode,
            "timed_out": timed_out, "command": command, "trace": trace,
            "expected_trace": expected, "bad_diagnostics": diagnostics,
            "unexpected_trace_lines": unexpected_trace,
            "matches_original_behavior": trace == EXPECTED,
            "staged_from": "validated-app-export-bytes-plus-authored-harness" if app_files is not None else "authored-fixtures",
            "staged_sha256": staged_sha256,
            "log_file": f"{name}.log",
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pd", default=os.environ.get("PD_BIN", "pd"), help="Pure Data executable")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts" / "native-gate")
    parser.add_argument("--app-callers", type=Path,
                        help="Directory with app-exported caller-a.pd, caller-b.pd, triplet.pd and triplet-extra.pd from the supplied fixtures")
    arguments = parser.parse_args()
    fixture_invariants()
    app_files = None
    if arguments.app_callers:
        app_files = {}
        for name, golden in APP_GOLDENS.items():
            try:
                content = (arguments.app_callers / name).read_bytes()
            except OSError as error:
                parser.error(f"{name}: cannot read required app export: {error}; refusing native execution")
            if content != golden.read_bytes():
                parser.error(f"{name}: app export must match its authored golden bytes; refusing to execute unknown patch content")
            app_files[name] = content
    pd = shutil.which(arguments.pd)
    if not pd:
        parser.error("Pure Data unavailable. Install official puredata-core or provide --pd; native gate is NOT passed.")
    pd = str(Path(pd).resolve())
    arguments.output.mkdir(parents=True, exist_ok=True)
    version = subprocess.run([pd, "-version"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True, timeout=10, check=False)
    if version.returncode:
        parser.error(f"Pure Data version probe failed: {version.stdout.strip()}")
    cases = [
        run_case(pd, "old-original", "old", FIXTURES / "original", EXPECTED, arguments.output),
        run_case(pd, "new-original-negative", "new", FIXTURES / "original", NEGATIVE_EXPECTED, arguments.output),
        run_case(pd, "new-handwritten-remapped", "new", FIXTURES / "remapped", EXPECTED, arguments.output),
    ]
    if arguments.app_callers:
        cases.append(run_case(pd, "new-app-remapped", "new", arguments.app_callers,
                              EXPECTED, arguments.output, app_files=app_files))
    passed = all(case["passed"] for case in cases) and not cases[1]["matches_original_behavior"]
    report = {
        "schema": 1, "passed": passed,
        "created_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "pd_version": version.stdout.strip(), "input_map": [2, 0, 1], "output_map": [1, 0],
        "app_exports_tested": bool(arguments.app_callers),
        "app_export_sha256": {name: hashlib.sha256(content).hexdigest()
                              for name, content in (app_files or {}).items()},
        "fixture_sha256": {str(path.relative_to(FIXTURES)): sha256(path)
                           for path in sorted(FIXTURES.rglob("*.pd"))},
        "cases": cases,
        "scope": "Own-authored deterministic message patches only; app case stages actual caller, revised module and support export bytes after exact golden validation, plus the authored harness; no audio, MIDI, GUI, arbitrary imported patches or hardware",
    }
    (arguments.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(version.stdout.strip())
    for case in cases:
        print(f"{'PASS' if case['passed'] else 'FAIL'} {case['name']}: {len(case['trace'])} trace lines")
        if not case["passed"]:
            print((arguments.output / case["log_file"]).read_text())
    print(f"{'PASS' if passed else 'FAIL'} native gate; report: {arguments.output / 'report.json'}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
