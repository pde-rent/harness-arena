# Audit every retry call site

This repository is an event-ingestion pipeline. Retrying is centralised in a single helper
function, `withRetry`. Some code paths hand that helper a metrics sink so retry attempts,
failures and backoff are reported; some do not, and those paths are invisible to the metrics.

Do not change any source file. This is a read-only investigation.

Find every call site of `withRetry` under `src/` and write a file named `answer.json` in the root
of this repository, with exactly these two keys and nothing else:

```json
{
  "callers": [
    {
      "file": "<repository-relative path of the file containing the call>",
      "function": "<name of the function that encloses the call>",
      "passesMetrics": true
    }
  ],
  "bypassMetrics": ["<names of the enclosing functions whose call does not pass a metrics sink>"]
}
```

Rules for the answer:

- One entry in `callers` per call site of `withRetry`. Order does not matter.
- `function` is the name of the immediately enclosing named function of the call.
- `passesMetrics` is `true` only if that call site itself supplies a metrics sink to `withRetry`.
- `bypassMetrics` is the list of `function` values whose entry has `passesMetrics: false`.
- Do not count the definition of `withRetry` itself, calls inside test files, or re-exports.
- Use exact identifiers as spelled in the source.
