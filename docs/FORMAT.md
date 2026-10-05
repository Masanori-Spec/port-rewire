# Format and safety contract

## Parser

The scanner finds unescaped semicolon record boundaries and retains token spans in the original string. Backslash escapes are respected when splitting atoms; escaped commas/semicolons remain content. Unescaped comma chaining is rejected on every record except the exact trailing `, f N` graphical-width suffix, because Pd would evaluate a comma as a second message to the canvas. Each raw atom must be shorter than 1,000 UTF-8 bytes, avoiding native atom-buffer splitting. Input must round-trip as UTF-8. Files with a UTF-8 BOM, invalid UTF-8, unpaired surrogates, unsupported control bytes or unterminated records fail closed.

The root header has the ordinary font field; nested headers have a name and visibility field. Every nested header must have a matching `#X restore … pd <name>` record. Root canvas ID is `root`; a child's ID appends its eventual parent restore index, e.g. `root/2`. Object indices include comments and restored canvases, but not connections, coordinates or width metadata. Connection endpoints must already exist when their record is encountered; forward references are rejected.

Unknown record forms are rejected because their index contribution cannot safely be guessed. This is a bounded subset, not a universal Pd file parser. Connection object indices must refer to connectable records. For unrelated objects the app cannot know valid inlet/outlet arity; only nonnegative integer syntax is checked. Selected abstraction endpoints additionally must be within the reviewed old interface's port counts.

## Interfaces

Only root-canvas, argument-free `[inlet]` and `[outlet]` objects define the reviewed control interface. Their X coordinates determine zero-based order. Graphical-object and restore coordinates must be signed 16-bit integers (−32768 through 32767), matching native Pd storage without overflow. Escaped or dollar-parameterized object-class tokens are rejected to avoid hidden class aliases or double-decoding ambiguity. Duplicate X values within a direction are rejected. Counts must match between old and revised abstractions. Both mappings must be complete bijections, including an empty bijection for a zero-port side.

File and abstraction names are bounded safe ASCII. The old abstraction basename determines the exact class token to match and the output filename. Qualified names and escaped spellings are never silently resolved. Supplied caller/support filenames are case-insensitively unique and cannot collide with the abstraction output.

## Migration schema

`migration.json` has schema `port-rewire/migration-1`:

- `target`: exact unqualified abstraction name
- `oldModule`: original basename and SHA-256 of original text bytes
- `newModule`: original basename and SHA-256 of revised text bytes
- `inputMap` / `outputMap`: arrays indexed by old port, values are new indices
- `callers`: filename, original SHA-256, and explicitly selected `{canvas,index}` pairs

Application of the contract revalidates all sources, mappings and selections. Instance references require a canonical canvas string and a nonnegative integer index; string indices, sparse arrays and malformed members fail explicitly. It checks every source hash before generating an output. The contract is review metadata, not a signature or authorization token; intentional editing makes a different decision contract.

`receipt.json` has schema `port-rewire/receipt-1`. It records the SHA-256 of compact JSON serialization of the contract, selected count, changed connection/token counts, before/after hashes and every changed endpoint tuple. The tuple is `[sourceObject, sourceOutlet, destinationObject, destinationInlet]`.

## Editing guarantee

Edits are applied by replacing only selected endpoint-token spans, from the end of the original string backward. The app never normalizes numbers, spaces or line endings elsewhere. An identity mapping produces exactly the original caller bytes, even if port tokens use leading zeros. Byte-span preservation is independently checked by the Python oracle against handwritten expected edits.

The ZIP writer uses ZIP store, CRC-32, UTF-8 filename flags, deterministic timestamps and flat safe filenames. No imported filename becomes a directory path. User content is rendered through DOM text APIs, not HTML interpolation. A CSP disallows network connections. No inputs are stored in browser storage.

Resource bounds additionally limit each direction to 64 ports, the caller bundle to 512 exact-name instances and 5,000 connection records. These bounds keep the review UI finite; larger projects should be split into reviewed bundles.

## Import concurrency

Every source input has an independent read ticket. Replacing the same input supersedes only its older read; old and revised source reads can finish in either order. Reset/demo invalidate all pending reads. Starting a new mapping cancels pending contract import while preserving unrelated source reads. Mapping/selection controls are disabled during imports. Preview work has a separate revision check, so obsolete hash results cannot resurrect an export.
