"""Adversarial tests written independently of the application's parser/tests.

Run: python3 -m unittest discover -s oracle -p 'test_*.py' -v
Only the tiny Node transport calls the public API. All fixtures, expected bytes,
malformed inputs, and result assertions live here in Python's standard library.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("export_oracle", ROOT / "scripts" / "verify_export.py")
ORACLE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ORACLE)

OLD = """#N canvas 0 0 480 320 10;
#X obj 10 20 inlet;
#X obj 100 20 inlet;
#X obj 200 20 inlet;
#X obj 10 240 outlet;
#X obj 200 240 outlet;
"""
NEW = """#N canvas 0 0 480 320 10;
#X obj 200 20 inlet;
#X obj 10 20 inlet;
#X obj 100 20 inlet;
#X obj 200 240 outlet;
#X obj 10 240 outlet;
"""
CALLER_LINES = [
    "#N canvas 0 0 640 480 10;",
    r"#X text 10 10 comment triplet \, inert \; boundary 日本語;",
    r"#X msg 10 50 triplet \, escaped \; destination payload;",
    "#X obj 10 100 triplet;",
    "#X obj 10 150 print;",
    "#N canvas 0 0 400 300 nested 0;",
    "#X text 10 10 nested comment;",
    "#X msg 10 50 7;",
    "#X obj 10 100 triplet;",
    "#X obj 10 150 print;",
    "#X connect 1 0 2 0;",
    "#X connect 2 0 3 0;",
    "#X restore 300 100 pd nested;",
    "#X obj 300 200 triplet-extra;",
    "#X connect 1 0 2 0;",
    "#X connect 2 0 3 0;",
    "#X connect 2 1 3 0;",
    "#X connect 1 0 5 0;",
]
CALLER = "\r\n".join(CALLER_LINES) + "\r\n"


def inputs() -> dict:
    return {"oldModule": {"name": "triplet.pd", "text": OLD},
            "newModule": {"name": "triplet-new.pd", "text": NEW},
            "callers": [{"name": "caller.pd", "text": CALLER}],
            "inputMap": [2, 0, 1], "outputMap": [1, 0],
            "selected": ["caller.pd::root::2"]}


def probe(request: dict) -> dict:
    completed = subprocess.run(["node", str(ROOT / "oracle" / "probe_core.mjs")],
                               input=json.dumps(request), text=True, capture_output=True,
                               cwd=ROOT, timeout=15, check=True)
    return json.loads(completed.stdout)


class CoreBoundaryTests(unittest.TestCase):
    def reject(self, request, expected=None):
        response = probe(request)
        self.assertFalse(response["ok"], response)
        if expected:
            self.assertEqual(response.get("code"), expected, response)

    def test_selected_root_only_exact_bytes(self):
        response = probe({"operation": "apply", "inputs": inputs()})
        self.assertTrue(response["ok"], response)
        result = response["result"]
        # Entire expected output is authored from three root-only endpoint edits.
        expected_lines = CALLER_LINES.copy()
        expected_lines[14] = "#X connect 1 0 2 2;"
        expected_lines[15] = "#X connect 2 1 3 0;"
        expected_lines[16] = "#X connect 2 0 3 0;"
        expected = "\r\n".join(expected_lines) + "\r\n"
        self.assertEqual(result["files"][1]["text"], expected)
        self.assertEqual(result["files"][0], {"name": "triplet.pd", "text": NEW})
        self.assertEqual(result["receipt"]["changedConnections"], 3)
        self.assertEqual(result["receipt"]["changedTokens"], 3)
        self.assertEqual(result["receipt"]["files"][0]["afterSha256"], hashlib.sha256(expected.encode()).hexdigest())

    def test_selected_nested_only_exact_bytes(self):
        data = inputs()
        data["selected"] = ["caller.pd::root/4::2"]
        response = probe({"operation": "apply", "inputs": data})
        self.assertTrue(response["ok"], response)
        expected_lines = CALLER_LINES.copy()
        expected_lines[10] = "#X connect 1 0 2 2;"
        expected_lines[11] = "#X connect 2 1 3 0;"
        self.assertEqual(response["result"]["files"][1]["text"], "\r\n".join(expected_lines) + "\r\n")

    def test_identity_retains_every_byte_and_zero_spelling(self):
        data = inputs()
        data["inputMap"], data["outputMap"] = [0, 1, 2], [0, 1]
        data["callers"][0]["text"] = CALLER.replace("#X connect 2 0 3 0;", "#X\tconnect 02 00 03 00;")
        response = probe({"operation": "apply", "inputs": data})
        self.assertTrue(response["ok"], response)
        self.assertEqual(response["result"]["files"][1]["text"], data["callers"][0]["text"])
        self.assertEqual(response["result"]["changes"], [])
        self.assertEqual(response["result"]["receipt"]["changedTokens"], 0)

    def test_same_edge_both_ends_changes_only_two_slots(self):
        data = inputs()
        data["callers"][0]["text"] += "#X\tconnect 02\t00 02 00;\r\n"
        response = probe({"operation": "apply", "inputs": data})
        self.assertTrue(response["ok"], response)
        self.assertTrue(response["result"]["files"][1]["text"].endswith("#X\tconnect 02\t1 02 2;\r\n"))

    def test_variable_width_endpoint_edits_preserve_utf8_and_every_gap(self):
        module = "#N canvas 0 0 600 300 10;\n" + "".join(f"#X obj {i * 20} 10 inlet;\n" for i in range(12)) + "#X obj 20 200 outlet;\n"
        caller = "#N canvas 0 0 600 300 10;\r\n#X msg 0 0 9;\r\n#X obj 0 40 triplet;\r\n#X text 0 80 日本語;\r\n#X connect 00\t0 01 00;\r\n#X connect 00 0\t01 11;\r\n"
        data = {"oldModule": {"name": "triplet.pd", "text": module},
                "newModule": {"name": "triplet-new.pd", "text": module},
                "callers": [{"name": "caller.pd", "text": caller}],
                "inputMap": list(reversed(range(12))), "outputMap": [0],
                "selected": ["caller.pd::root::1"]}
        response = probe({"operation": "apply", "inputs": data})
        self.assertTrue(response["ok"], response)
        expected = "#N canvas 0 0 600 300 10;\r\n#X msg 0 0 9;\r\n#X obj 0 40 triplet;\r\n#X text 0 80 日本語;\r\n#X connect 00\t0 01 11;\r\n#X connect 00 0\t01 0;\r\n"
        self.assertEqual(response["result"]["files"][1]["text"], expected)
        self.assertEqual(response["result"]["receipt"]["changedTokens"], 2)

    def test_maps_must_be_total_integer_bijections(self):
        for invalid in (None, [], [0, 1], [0, 1, 2, 3], [0, 0, 2], [-1, 0, 1], [0, 1, 3],
                        [0, 1, 1.5], [0, 1, "2"], [False, 1, 2]):
            with self.subTest(mapping=invalid):
                data = inputs()
                data["inputMap"] = invalid
                self.reject({"operation": "create", "inputs": data}, "MAP")

    def test_tampered_replayed_map_rejected(self):
        self.reject({"operation": "apply", "inputs": inputs(), "planOverrides": {"inputMap": [0, 0, 2]}}, "MAP")

    def test_empty_duplicate_or_nonexact_selection_rejected(self):
        for selected in ([], ["caller.pd::root::2"] * 2, ["caller.pd::root::0"],
                         ["caller.pd::root::5"], ["caller.pd::root/5::2"], ["caller.pd::root::1"]):
            with self.subTest(selected=selected):
                data = inputs()
                data["selected"] = selected
                self.reject({"operation": "create", "inputs": data}, "SELECTION")

    def test_source_and_contract_hashes_fail_closed(self):
        changed = inputs()
        changed["callers"][0]["text"] += "\r\n"
        self.reject({"operation": "apply", "inputs": inputs(), "sourceOverrides": {"callers": changed["callers"]}}, "HASH")
        self.reject({"operation": "apply", "inputs": inputs(), "sourceOverrides": {"newModule": {"name": "triplet-new.pd", "text": NEW + "\n"}}}, "HASH")
        self.reject({"operation": "apply", "inputs": inputs(), "planOverrides": {"oldModule": {"name": "triplet.pd", "sha256": "0" * 64}}}, "HASH")

    def test_already_migrated_caller_replay_rejected(self):
        data = inputs()
        first = probe({"operation": "apply", "inputs": data})
        output = first["result"]["files"][1]
        self.reject({"operation": "apply", "inputs": data, "sourceOverrides": {"callers": [{"name": output["name"], "text": output["text"]}]}}, "HASH")

    def test_out_of_range_and_comment_endpoints_rejected(self):
        for bad in ("#X connect 99 0 2 0;", "#X connect 1 0 99 0;", "#X connect 0 0 2 0;",
                    "#X connect 2 0 0 0;", "#X connect -1 0 2 0;", "#X connect 1 0 2 3;",
                    "#X connect 2 2 3 0;", "#X connect 1 0 2 65536;"):
            with self.subTest(record=bad):
                data = inputs()
                data["callers"][0]["text"] += bad + "\r\n"
                self.reject({"operation": "apply", "inputs": data}, "INDEX")

    def test_unknown_or_executable_dynamic_record_forms_rejected(self):
        records = ("#A 0 1 2 3;", "#X mystery 10 20;", "#X scalar foo 1 2;",
                   "#X obj 10 20 clone triplet 2;", "#X obj 10 20 declare -path somewhere;",
                   r"#X msg 10 20 \; pd-nested clear;", "#X obj 10 20 s pd-nested;")
        for record in records:
            with self.subTest(record=record):
                self.reject({"operation": "parse", "text": CALLER + record + "\r\n"})

    def test_malformed_canvas_nesting_rejected(self):
        cases = (CALLER.replace("#X restore 300 100 pd nested;\r\n", ""),
                 CALLER.replace("pd nested;", "pd wrong;"),
                 CALLER + "#X restore 0 0 pd root;\r\n",
                 "#X obj 10 10 triplet;\n" + CALLER,
                 CALLER + "#N canvas 0 0 400 300 10;\r\n",
                 CALLER.replace("#N canvas 0 0 400 300 nested 0;", "#N canvas 0 0 400 nested 0;"))
        for text in cases:
            with self.subTest(text=text[-90:]):
                self.reject({"operation": "parse", "text": text})

    def test_ambiguous_signal_argumented_or_changed_count_ports_rejected(self):
        cases = ((OLD.replace("100 20 inlet", "10 20 inlet"), "AMBIGUOUS"),
                 (OLD.replace("200 240 outlet", "10 240 outlet"), "AMBIGUOUS"),
                 (OLD.replace("10 20 inlet;", "10 20 inlet~;"), "SIGNAL"),
                 (OLD.replace("10 20 inlet;", "10 20 inlet 1;"), "PORT"),
                 (OLD.replace("#X obj 200 20 inlet;\n", ""), "COUNT"))
        for new, code in cases:
            with self.subTest(code=code):
                data = inputs()
                data["newModule"]["text"] = new
                self.reject({"operation": "create", "inputs": data}, code)

    def test_malformed_encoding_and_incomplete_record_rejected(self):
        for text in (CALLER + "\0", CALLER + "#X text 0 0 unfinished", "\ufeff" + CALLER):
            self.reject({"operation": "parse", "text": text})
        self.reject({"operation": "decode", "bytes": [0xC3, 0x28]}, "ENCODING")

    def test_filename_traversal_collision_and_path_qualified_target_rejected(self):
        for name in ("../triplet.pd", "dir/triplet.pd", "CON.pd", "triplet..pd", "triplet.PD"):
            with self.subTest(name=name):
                data = inputs()
                data["oldModule"]["name"] = name
                self.reject({"operation": "create", "inputs": data}, "FILENAME")
        data = inputs()
        data["callers"].append({"name": "CALLER.pd", "text": CALLER})
        self.reject({"operation": "create", "inputs": data}, "FILENAME")


class OracleMutationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="port-rewire-oracle-")
        cls.bundle = Path(cls.temporary.name) / "baseline"
        cls.bundle.mkdir()
        fixture = ORACLE.FIXTURES
        data = {"oldModule": {"name": "triplet.pd", "text": (fixture / "old/triplet.pd").read_bytes().decode()},
                "newModule": {"name": "triplet-new.pd", "text": (fixture / "new/triplet.pd").read_bytes().decode()},
                "callers": [{"name": name, "text": (fixture / "original" / name).read_bytes().decode()} for name, _ in ORACLE.CALLERS],
                "inputMap": [2, 0, 1], "outputMap": [1, 0]}
        data["callers"].append({"name": "triplet-extra.pd", "text": (fixture / "support/triplet-extra.pd").read_bytes().decode()})
        response = probe({"operation": "apply", "inputs": data})
        if not response["ok"]:
            raise AssertionError(response)
        result = response["result"]
        for file in result["files"]:
            (cls.bundle / file["name"]).write_bytes(file["text"].encode())
        (cls.bundle / "migration.json").write_text(json.dumps(result["plan"]))
        (cls.bundle / "receipt.json").write_text(json.dumps(result["receipt"]))
        # Receipt text must be from the app; the adapter returns it explicitly.
        (cls.bundle / "receipt.txt").write_text(result["plainReceipt"])
        ORACLE.verify_bundle(cls.bundle)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_oracle_rejects_mutations_even_with_recomputed_output_hash(self):
        cases = [
            ("caller-a.pd", lambda b: b.replace(b"#X connect 3 0 7 0;", b"#X connect 3 0 7 1;")),
            ("caller-a.pd", lambda b: b.replace(b"#X connect 1 0 2 0;", b"#X connect 1 0 2 1;")),
            ("caller-a.pd", lambda b: b.replace(b"#X connect 7 1 10 0;\n#X connect 7 1 9 0;", b"#X connect 7 1 9 0;\n#X connect 7 1 10 0;")),
            ("caller-a.pd", lambda b: b.replace(b"#X connect 7 1 8 0;", b"#X connect 7 1 9 0;")),
            ("caller-a.pd", lambda b: b.replace(b"inert text", b"inert TEXT")),
            ("caller-a.pd", lambda b: b.replace(b"#X connect 7 1 8 0;", b"#X  connect 7 1 8 0;")),
            ("caller-a.pd", lambda b: b.replace(b"\\; inert", b"; inert")),
            ("caller-b.pd", lambda b: b.replace(b"\r\n", b"\n")),
            ("triplet-extra.pd", lambda b: b + b"\n"),
            ("triplet.pd", lambda b: (ORACLE.FIXTURES / "old/triplet.pd").read_bytes()),
        ]
        for index, (name, mutate) in enumerate(cases):
            with self.subTest(file=name, mutation=index):
                folder = Path(self.temporary.name) / f"mutant-{index}"
                shutil.copytree(self.bundle, folder)
                original = (folder / name).read_bytes()
                mutated = mutate(original)
                self.assertNotEqual(original, mutated, "mutation must actually change the witness")
                (folder / name).write_bytes(mutated)
                receipt = json.loads((folder / "receipt.json").read_text())
                for entry in receipt["files"]:
                    if entry["name"] == name:
                        entry["afterSha256"] = hashlib.sha256(mutated).hexdigest()
                (folder / "receipt.json").write_text(json.dumps(receipt))
                with self.assertRaises(ORACLE.OracleFailure):
                    ORACLE.verify_bundle(folder)

    def test_oracle_rejects_metadata_and_receipt_mutations(self):
        cases = [
            ("migration.json", lambda j: j["oldModule"].update(sha256="0" * 64)),
            ("migration.json", lambda j: j["newModule"].update(sha256="0" * 64)),
            ("migration.json", lambda j: j["callers"][1]["instances"][0].update(canvas="root")),
            ("migration.json", lambda j: j.update(inputMap=[1, 2, 0])),
            ("receipt.json", lambda j: j.update(contractId="0" * 64)),
            ("receipt.json", lambda j: j.update(changedTokens=15)),
            ("receipt.json", lambda j: j["changes"][0].update(after=[3, 0, 7, 1])),
            ("receipt.json", lambda j: j["files"][0].update(afterSha256="0" * 64)),
        ]
        for index, (name, mutate) in enumerate(cases):
            with self.subTest(file=name, mutation=index):
                folder = Path(self.temporary.name) / f"metadata-{index}"
                shutil.copytree(self.bundle, folder)
                value = json.loads((folder / name).read_text())
                mutate(value)
                (folder / name).write_text(json.dumps(value))
                with self.assertRaises(ORACLE.OracleFailure):
                    ORACLE.verify_bundle(folder)

    def test_oracle_rejects_incorrect_plain_text_receipt(self):
        folder = Path(self.temporary.name) / "text-receipt"
        shutil.copytree(self.bundle, folder)
        text = (folder / "receipt.txt").read_text()
        (folder / "receipt.txt").write_text(text.replace("3 0 7 1 -> 3 0 7 0", "3 0 7 1 -> 3 0 7 2", 1))
        with self.assertRaises(ORACLE.OracleFailure):
            ORACLE.verify_bundle(folder)

    def test_handwritten_expectations_agree_with_independent_fixtures(self):
        for name, canvas in ORACLE.CALLERS:
            expected, changes, count = ORACLE.expected_caller(name, canvas)
            self.assertEqual(len(changes), 8)
            self.assertEqual(count, 8)
            self.assertEqual(expected, (ORACLE.FIXTURES / "remapped" / name).read_bytes())

    def test_lexical_semicolons_do_not_create_fake_records(self):
        source = (ORACLE.FIXTURES / "original" / "caller-a.pd").read_bytes()
        edges, objects = ORACLE.scan_fixture(source)
        self.assertEqual(len(edges), 13)
        self.assertEqual(len(objects["root"]), 15)
        self.assertEqual(edges[5]["record"], 22)


if __name__ == "__main__":
    unittest.main()
