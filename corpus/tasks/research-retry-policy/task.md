# Document the retry policy

This repository is an event-ingestion pipeline that retries failing work. Find where the retry
policy is defined, what its parameters are, and what delays it actually produces.

Do not change any source file. This is a read-only investigation.

Write a file named `answer.json` in the root of this repository, with exactly these nine keys and
nothing else:

```json
{
  "policyFile": "<repository-relative path of the file where the retry policies are defined>",
  "defaultPolicyName": "<exact identifier of the policy used by default when a caller supplies none>",
  "maxAttempts": 0,
  "baseDelayMs": 0,
  "factor": 0,
  "maxDelayMs": 0,
  "jitterRatio": 0,
  "backoffDelaysMs": [0],
  "alertPolicyName": "<exact identifier of the policy used when delivering alert events>"
}
```

Rules for the answer:

- `maxAttempts`, `baseDelayMs`, `factor`, `maxDelayMs` and `jitterRatio` describe the **default**
  policy.
- `backoffDelaysMs` is the ordered list of the delays that are actually waited between attempts
  when the default policy is used and every attempt fails: the delay after attempt 1, then after
  attempt 2, and so on. It must follow the code as written, including any clamping, and must stop
  where the code stops sleeping. Give whole numbers of milliseconds.
- Use exact identifiers as spelled in the source.
