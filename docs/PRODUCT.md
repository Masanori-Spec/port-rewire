# Why PortRewire exists

## Maintenance problem

Pure Data abstraction inlet/outlet order follows horizontal placement. Reorganizing an abstraction's interface can therefore make old callers send to or read from the wrong port. Message fan-out creation order also affects execution, so reconstructing a caller graph through a generic serializer is a risky way to make a small edit. Both properties are described in the [official Pd theory-of-operation manual](https://github.com/pure-data/pure-data/blob/master/doc/1.manual/2.theory.of.operation.htm).

The [official ELSE release history](https://github.com/porres/pd-else/releases/) includes inlet ordering changes, showing that interfaces can change over time. PortRewire v1 does not claim to migrate ELSE's signal-processing objects; its narrow control-only fixture demonstrates the workflow separately.

## Existing options

- Native Pd provides editor operations such as connection swapping and triggerize
- Patcherize extracts objects into subpatches or abstractions; see the [official externals manual](https://github.com/pure-data/pure-data/blob/master/doc/1.manual/4.externals.htm)
- [pd-vibe](https://github.com/BorisMolch/pd-vibe) provides structural editing, semantic diffs and documentation workflows. Its reviewed README does not present this particular old/new hash-bound, selected-caller permutation workflow

This is not a claim that patch parsing, graph editing, or connection swapping is novel. The practical distinction is a reviewed old-to-new control-port contract, applied consistently to selected caller instances through minimal byte edits, with a receipt and independently demonstrated native-consumer behavior.

## Portfolio value and constraints

The project demonstrates bounded format handling, fail-closed migrations, independent oracles, an actual external consumer gate, multilingual local UI, and intentionally explicit limitations. It is a small maintenance tool rather than a general Pd replacement. Its commercial usefulness still needs real-user validation; the synthetic fixture proves the documented workflow, not market demand or compatibility with every patch.

Sources reviewed 2026-10-05. No university-hosted sites, upstream tutorial patches, private patches, external customer contact, paid services or patent-candidate material were used.
