# Trace the audit event path

This repository is an event-ingestion pipeline. Events have a `kind`. You need to work out what
actually happens to an event whose kind is `audit` once the pipeline routes it.

Do not change any source file. This is a read-only investigation.

Answer by writing a file named `answer.json` in the root of this repository, with exactly these
five keys and nothing else:

```json
{
  "file": "<repository-relative path of the file that contains the handler chain for audit events>",
  "entryFunction": "<name of the function or exported handler value that the router invokes for kind 'audit'>",
  "finalFunction": "<name of the function that ultimately performs the work, i.e. the last one in the chain>",
  "callChain": ["<function names, in call order, from the entry function through to the final function>"],
  "storeNamespaces": ["<every namespace string the final function writes into the record store>"]
}
```

Rules for the answer:

- `callChain` must be **in call order** and must list only functions defined in the file named by
  `file`. Do not include generic helpers that live in other modules, and do not include the router
  itself.
- `entryFunction` is the first element of `callChain`; `finalFunction` is the last.
- `storeNamespaces` must contain the fully-resolved namespace strings the code writes under: the
  expanded values, not the names of the constants and not the template expressions as written.
  They are fixed by the source and can be worked out from it. Order does not matter.
- Use exact identifiers as spelled in the source.
