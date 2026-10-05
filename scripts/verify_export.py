#!/usr/bin/env python3
"""Independent, fixture-specific PortRewire export oracle (Python stdlib only).

Expected wiring is handwritten below and in fixtures/native/remapped/*.pd. No
application parser, map implementation, or generated expected output is imported.
The byte comparison allows changes only in the eight declared endpoint tokens
per caller. It therefore proves preservation of every other byte, not merely a
normalized parse, graph isomorphism, or an output hash produced by the app.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures" / "native"
# These literal assertions came from the fixture author's hand-written graph.
BEFORE = [
    (1, 0, 2, 0), (2, 3, 3, 0), (2, 2, 4, 0),
    (2, 1, 5, 0), (2, 0, 6, 0),
    (3, 0, 7, 1), (4, 0, 7, 2), (5, 0, 7, 0), (6, 0, 7, 0),
    (7, 0, 8, 0), (7, 0, 10, 0), (7, 0, 9, 0), (7, 1, 11, 0),
]
AFTER = [
    (1, 0, 2, 0), (2, 3, 3, 0), (2, 2, 4, 0),
    (2, 1, 5, 0), (2, 0, 6, 0),
    (3, 0, 7, 0), (4, 0, 7, 1), (5, 0, 7, 2), (6, 0, 7, 2),
    (7, 1, 8, 0), (7, 1, 10, 0), (7, 1, 9, 0), (7, 0, 11, 0),
]
CALLERS = (("caller-a.pd", "root"), ("caller-b.pd", "root/2"))
# A regular expression lexes escaped pairs before looking for record terminators.
# This is deliberately a byte scanner, unlike the app's character/atom parser.
RECORD = re.compile(rb"(?:\\[\s\S]|[^\\;])*;")
EDGE = re.compile(rb"\s*#X[ \t\r\n]+connect[ \t\r\n]+([0-9]+)[ \t\r\n]+([0-9]+)[ \t\r\n]+([0-9]+)[ \t\r\n]+([0-9]+)\s*;\Z")
HEAD = re.compile(rb"\s*#([NX])\s+(\w+)\b")


class OracleFailure(AssertionError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise OracleFailure(message)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def scan_fixture(data: bytes) -> tuple[list[dict], dict[str, list[bytes]]]:
    """Index only the small, authored fixture grammar; retain absolute byte slots."""
    stack: list[str] = []
    objects: dict[str, list[bytes]] = {}
    edges = []
    end = 0
    for number, record in enumerate(RECORD.finditer(data), 1):
        require(record.start() == end, "unrecognized bytes between fixture records")
        end = record.end()
        raw = record.group()
        head = HEAD.match(raw)
        require(head is not None, f"unrecognized fixture record {number}")
        lead, kind = head.groups()
        if lead == b"N":
            require(kind == b"canvas", "fixture contains unsupported #N record")
            canvas = "root" if not stack else f"{stack[-1]}/{len(objects[stack[-1]])}"
            require(canvas not in objects, f"duplicate fixture canvas {canvas}")
            stack.append(canvas)
            objects[canvas] = []
            continue
        require(bool(stack), "fixture record outside a canvas")
        if kind == b"restore":
            require(len(stack) > 1, "fixture restores root canvas")
            stack.pop()
            objects[stack[-1]].append(raw)
        elif kind == b"connect":
            edge = EDGE.fullmatch(raw)
            require(edge is not None, f"malformed fixture connection {number}")
            edges.append({
                "canvas": stack[-1], "record": number,
                "value": tuple(int(value) for value in edge.groups()),
                "slots": tuple((record.start() + edge.start(i), record.start() + edge.end(i)) for i in range(1, 5)),
            })
        elif kind in (b"obj", b"msg", b"text", b"floatatom", b"symbolatom", b"listbox"):
            objects[stack[-1]].append(raw)
        else:
            require(kind in (b"coords", b"f"), f"unexpected fixture record {kind!r}")
    require(not data[end:].strip(), "unterminated fixture record")
    require(stack == ["root"], "unclosed fixture canvas")
    return edges, objects


def expected_caller(name: str, canvas: str, identity: bool = False) -> tuple[bytes, list[dict], int]:
    source = (FIXTURES / "original" / name).read_bytes()
    edges, objects = scan_fixture(source)
    expected_before = [(canvas, value) for value in BEFORE]
    if name == "caller-b.pd":
        expected_before.append(("root", (1, 0, 2, 0)))
    require([(e["canvas"], e["value"]) for e in edges] == expected_before,
            f"{name}: source no longer matches the hand-written connection table")
    require(len(objects[canvas]) == 15, f"{name}: fixture object count changed")
    require(re.search(rb"#X obj 110 210 triplet;\Z", objects[canvas][7]) is not None,
            f"{name}: expected target object index 7 changed")
    require(b"\\," in source and b"\\;" in source, f"{name}: escaped-byte witness missing")
    if name == "caller-b.pd":
        require(source.count(b"\n") == source.count(b"\r\n") > 0, "CRLF witness missing")
    edits = []
    changes = []
    for edge, after in zip(edges, BEFORE if identity else AFTER):
        before = edge["value"]
        require(before[0] == after[0] and before[2] == after[2], "oracle must never rewrite object indices")
        for slot in (1, 3):
            if before[slot] != after[slot]:
                start, stop = edge["slots"][slot]
                edits.append((start, stop, str(after[slot]).encode("ascii")))
        if before != after:
            changes.append({"file": name, "canvas": canvas, "record": edge["record"],
                            "before": list(before), "after": list(after)})
    expected = source
    for start, stop, replacement in reversed(edits):
        expected = expected[:start] + replacement + expected[stop:]
    # A second independent representation prevents accidental map/table drift.
    if not identity:
        require(expected == (FIXTURES / "remapped" / name).read_bytes(),
                f"{name}: endpoint table disagrees with hand-authored remapped fixture")
    return expected, changes, len(edits)


def verify_bundle(directory: Path, identity: bool = False) -> dict:
    plan = read_json(directory / "migration.json")
    receipt = read_json(directory / "receipt.json")
    text_receipt = (directory / "receipt.txt").read_text(encoding="utf-8")
    revised = (FIXTURES / "new" / "triplet.pd").read_bytes()
    original_module = (FIXTURES / "old" / "triplet.pd").read_bytes()
    require((directory / "triplet.pd").read_bytes() == revised, "bundle abstraction is not the supplied revised bytes")
    require({p.name for p in directory.glob("*.pd")} == {"triplet.pd", "caller-a.pd", "caller-b.pd", "triplet-extra.pd"},
            "unexpected or missing Pd file in bundle")
    require(plan.get("schema") == "port-rewire/migration-1", "wrong migration schema")
    require(plan.get("target") == "triplet", "wrong migration target")
    require(plan.get("inputMap") == ([0, 1, 2] if identity else [2, 0, 1]), "wrong input mapping direction")
    require(plan.get("outputMap") == ([0, 1] if identity else [1, 0]), "wrong output mapping direction")
    require(plan.get("oldModule") == {"name": "triplet.pd", "sha256": digest(original_module)}, "old module source hash mismatch")
    require(plan.get("newModule") == {"name": "triplet.pd", "sha256": digest(revised)}, "revised module source hash mismatch")
    expected_plan_callers, expected_receipt_files, expected_changes = [], [], []
    preserved_bytes, changed_tokens = 0, 0
    for name, canvas in CALLERS:
        source = (FIXTURES / "original" / name).read_bytes()
        actual = (directory / name).read_bytes()
        expected, changes, tokens = expected_caller(name, canvas, identity)
        require(actual == expected, f"{name}: exported bytes differ outside the hand-authorized endpoint edits or use the wrong endpoint")
        # Semantic assertions are additional to, never replacements for, byte equality.
        actual_edges, actual_objects = scan_fixture(actual)
        source_edges, source_objects = scan_fixture(source)
        require(actual_objects == source_objects, f"{name}: object order, index, or record changed")
        require([e["canvas"] for e in actual_edges] == [e["canvas"] for e in source_edges], f"{name}: canvas-local connection order changed")
        expected_plan_callers.append({"name": name, "sha256": digest(source), "instances": [{"canvas": canvas, "index": 7}]})
        expected_receipt_files.append({"name": name, "beforeSha256": digest(source), "afterSha256": digest(actual), "changedTokens": tokens})
        expected_changes.extend(changes)
        changed_tokens += tokens
        preserved_bytes += len(source) - tokens  # Every demo endpoint slot is one byte.
        for value in (name, digest(source), digest(actual)):
            require(value in text_receipt, f"text receipt lacks verified {name} evidence")
    support_name = "triplet-extra.pd"
    support = (FIXTURES / "support" / support_name).read_bytes()
    require((directory / support_name).read_bytes() == support, "unselected support caller bytes changed")
    expected_plan_callers.append({"name": support_name, "sha256": digest(support), "instances": []})
    expected_receipt_files.append({"name": support_name, "beforeSha256": digest(support), "afterSha256": digest(support), "changedTokens": 0})
    preserved_bytes += len(support)
    require(support_name in text_receipt and digest(support) in text_receipt, "text receipt lacks support caller evidence")
    require(plan.get("callers") == expected_plan_callers, "plan caller hashes or selected scopes differ")
    canonical = json.dumps(plan, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    require(receipt.get("schema") == "port-rewire/receipt-1", "wrong receipt schema")
    require(receipt.get("contractId") == digest(canonical), "receipt contract hash does not bind exported migration")
    require(receipt.get("target") == "triplet", "receipt target mismatch")
    require(receipt.get("selectedInstances") == 2, "receipt selected-instance count mismatch")
    require(receipt.get("changedConnections") == len(expected_changes), "receipt connection count mismatch")
    require(receipt.get("changedTokens") == changed_tokens, "receipt token count mismatch")
    require(receipt.get("files") == expected_receipt_files, "receipt caller hashes or token counts mismatch")
    require(receipt.get("changes") == expected_changes, "receipt does not match hand-written edge evidence")
    expected_rows = [f"{c['file']} / {c['canvas']} / record {c['record']}: {' '.join(map(str, c['before']))} -> {' '.join(map(str, c['after']))}" for c in expected_changes]
    actual_rows = [line for line in text_receipt.splitlines() if " / record " in line]
    require(actual_rows == expected_rows, "text receipt endpoint rows mismatch")
    require("Selected instances: 2" in text_receipt, "text receipt selection count mismatch")
    require("Abstraction: triplet.pd" in text_receipt, "text receipt abstraction mismatch")
    require(receipt["contractId"] in text_receipt, "text receipt contract mismatch")
    require(f"Changed connections: {len(expected_changes)}" in text_receipt, "text receipt count mismatch")
    require(f"Changed endpoint tokens: {changed_tokens}" in text_receipt, "text receipt token count mismatch")
    return {"directory": str(directory), "status": "passed", "identity": identity,
            "callers": 3, "selectedInstances": 2, "changedConnections": len(expected_changes),
            "changedEndpointTokens": changed_tokens, "untouchedCallerBytesVerified": preserved_bytes,
            "checks": ["handwritten endpoint table", "all untouched bytes", "object order and indices",
                       "canvas-local connection order", "CRLF and escaping", "unselected connection",
                       "revised abstraction bytes", "input and output SHA-256", "contract and receipt evidence"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", type=Path, default=ROOT / "artifacts" / "demo")
    parser.add_argument("--identity", action="store_true", help="verify this directory as an identity-map export")
    parser.add_argument("--identity-dir", type=Path, help="also verify a separate identity-map bundle")
    parser.add_argument("--report", type=Path, help="write the independently computed JSON evidence")
    args = parser.parse_args()
    try:
        reports = [verify_bundle(args.directory, args.identity)]
        if args.identity_dir:
            reports.append(verify_bundle(args.identity_dir, True))
        result = {"oracle": "port-rewire/python-stdlib-1", "status": "passed", "bundles": reports}
        rendered = json.dumps(result, indent=2) + "\n"
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(rendered, encoding="utf-8")
        print(rendered, end="")
        return 0
    except (OracleFailure, OSError, ValueError, KeyError, TypeError) as error:
        print(f"Independent export oracle FAILED: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
