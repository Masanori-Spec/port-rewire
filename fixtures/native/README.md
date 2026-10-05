# Native Pure Data feasibility gate

All `.pd` files here are authored specifically for this project. They do not
contain upstream example patches, binaries, user patches, externals, audio
objects, MIDI objects, hardware access, dynamic patch construction or plugins.

## Contract and physical port order

Both `old/triplet.pd` and `new/triplet.pd` implement:

- result = value × gain + bias
- echo = value

Only the five port-object x-coordinates change between module revisions. Object
creation order and internal connections remain identical. Old inlet x-order is
value, gain, bias; new inlet x-order is gain, bias, value. Old outlet x-order is
result, echo; new outlet x-order is echo, result. Thus the explicit old-index →
new-index maps are input `[2, 0, 1]` and output `[1, 0]`.

Every canvas has a text object before its first connectable object. The native
gate therefore exercises actual Pd indexing, including comments. The nested
canvas in caller B is object index 2 in its parent, while the target `triplet`
instance is object index 7 inside that canvas. Caller A's target is index 7 in
the root. The local target canvas identities used by the app are `root` and
`root/2` respectively.

## Determinism and preservation cases

- The harness triggers caller A, then caller B, then `pd quit`, in that order
- Each caller's `t b b b b` sets gain, sets bias, sends the first value, then sends
  the second value, via right-to-left trigger outlets
- Inside `triplet`, `t f f` sends the value through multiplication/addition before
  echoing it
- Result fan-out connections target objects 8, 10, 9 in that creation order; the
  exact trace must retain RESULT, FAN_FIRST, FAN_SECOND ordering
- Caller A uses LF, while caller B uses CRLF, including its final newline
- Escaped comma and semicolon appear in an unconnected message and a comment
- The `triplet-extra` abstraction is deliberately a different exact object name
- Additional comments mention `triplet`; those bytes must remain untouched
- Caller B's outer connection is not in the target canvas and is unchanged

The expected callers in `remapped/` are independent handwritten golden fixtures:
exactly eight one-digit endpoint token substitutions per caller. Every other
byte, the original connection line order, and each line ending are preserved.

| Before connection | After connection | Meaning |
| --- | --- | --- |
| `3 0 7 1` | `3 0 7 0` | gain input |
| `4 0 7 2` | `4 0 7 1` | bias input |
| `5 0 7 0` | `5 0 7 2` | first value input |
| `6 0 7 0` | `6 0 7 2` | second value input |
| `7 0 8 0` | `7 1 8 0` | result output |
| `7 0 10 0` | `7 1 10 0` | first fan-out |
| `7 0 9 0` | `7 1 9 0` | second fan-out |
| `7 1 11 0` | `7 0 11 0` | echo output |

## Run

Install only the official distro `puredata-core` package for testing, then run:

```sh
python3 scripts/native_gate.py --output artifacts/native-gate
```

The script stages only these authored files in a temporary directory and runs:

```sh
pd -nogui -batch -noaudio -nomidi -noprefs -stderr -open harness.pd
```

The harness quits itself; the subprocess also has a 15-second timeout. The gate
requires a zero exit, no failed-create/failed-connect diagnostics, and exact
line-for-line traces, rather than merely checking that Pd launched. Three cases
must pass: old module with original callers, revised module with original
callers (an exact known incorrect trace), and revised module with handwritten
remapped callers (the exact original trace). `new-original-negative` is a
successful *test of breakage*, not a migrated output.

An executable path may be provided with `--pd /path/to/puredata` or `PD_BIN`.
To test app exports, add `--app-callers artifacts/demo` (or the actual directory
containing `caller-a.pd`, `caller-b.pd`, `triplet.pd` and `triplet-extra.pd`). Before
any native execution, both caller exports must equal the endpoint-only golden
fixtures, the exported module must equal `new/triplet.pd`, and the exported
support must equal `support/triplet-extra.pd`. Missing or different bytes stop the
gate without launching Pd. These guards prevent executing arbitrary imported
patch content.

The native app case stages the actual validated export bytes for all four files,
along with only the own-authored fixture harness. It retains the validated bytes
in memory until staging so later source-file changes cannot replace checked
content. It therefore independently proves that the exported callers, revised
module and unchanged support run together and restore the original behavior.
The report records SHA-256 hashes for the app exports and every staged file,
plus each case's source type, allowing their byte identity to be verified.

## Exact passing trace: old/original and new/remapped

```text
A_RESULT: 7
A_FAN_FIRST: 7
A_FAN_SECOND: 7
A_ECHO: 3
A_RESULT: 9
A_FAN_FIRST: 9
A_FAN_SECOND: 9
A_ECHO: 4
B_RESULT: 5
B_FAN_FIRST: 5
B_FAN_SECOND: 5
B_ECHO: 2
B_RESULT: 14
B_FAN_FIRST: 14
B_FAN_SECOND: 14
B_ECHO: 5
```

## Exact negative trace: new/original

```text
A_ECHO: 2
A_RESULT: 1
A_FAN_FIRST: 1
A_FAN_SECOND: 1
B_ECHO: 3
B_RESULT: -1
B_FAN_FIRST: -1
B_FAN_SECOND: -1
```

The negative case sets the wrong physical inlets and observes the wrong physical
outlets without producing a load error. It demonstrates why unchanged caller
connections cannot preserve behavior after a port reorder.

## Recorded local feasibility result

The three cases passed on official Debian `puredata-core` 0.55.2+ds-2, reporting
`Pd-0.55.2`, with official `libportaudio2` 19.6.0-1.2+b3 used only to satisfy the
executable's shared-library dependency. Audio and MIDI remained disabled. The
packages were extracted into a test-only directory outside this repository,
not installed system-wide or shipped with this deliverable. The machine-readable
run report records the Pd version, fixture SHA-256 hashes, all exact traces,
commands, exit codes, diagnostics and app-export coverage. A subsequent local
four-case run also passed using actual application-exported callers, revised
module and unchanged support, with the same exact 16-line original trace.

Official package sources:

- https://deb.debian.org/debian/pool/main/p/puredata/
- https://deb.debian.org/debian/pool/main/p/portaudio19/
- Ubuntu 22.04 test runner package: https://packages.ubuntu.com/jammy/puredata-core

This gate demonstrates these message-control fixtures. It does not establish
compatibility for arbitrary Pd patches, externals, signal-rate ports, dynamic
patching, older/newer Pd versions, audio scheduling or hardware.
