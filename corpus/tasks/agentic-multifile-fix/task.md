# One event, three different ids

This repository is an event processing pipeline. Its test suite currently passes.

Operations have opened a ticket. Upstream producers are sloppy about how they spell an event id:
the same logical event arrives sometimes as `EV-9`, sometimes as `ev-9`, and sometimes padded with
spaces or tabs around it. These are all meant to be the same event.

They are not being treated as the same event. The symptoms reported:

- The audit store ends up holding two records for one event, under two different spellings of its
  id, instead of one record that is written and then amended.
- The id reported back by the pipeline for a given event does not always match the id the event was
  actually stored under, so operators cannot look a rejected event up by the id they were given.
- An event whose id arrives padded with whitespace is sometimes rejected outright as a malformed
  identifier, and the rejection message quotes the id back in yet another spelling.

The intended rule is a single one, and it is not currently honoured:

> An event id is normalised by trimming surrounding whitespace and converting it to upper case,
> everywhere the id is derived, validated, stored or compared.

Make that rule hold. After your change it must hold on every path: whether an event is parsed from
a raw payload or handed in directly as an object, whether it is validated on its own or run through
the whole pipeline, whether it is accepted, rejected during validation, or routed to any handler.
The id that comes back in a result, the id quoted in a validation message, and the key an event is
stored and looked up under must all be the same normalised spelling.

Constraints:

- The rule must be applied consistently. It is currently applied in more than one place, and not
  the same way in each; a change in a single place will not be enough.
- Do not change the public API: the exported names and their signatures must stay as they are.
- Nothing else about the pipeline's behaviour may change: source normalisation, event kinds, body
  handling, validation codes and severities, retry behaviour, metrics and store namespaces all stay
  exactly as they are. Only id normalisation is in scope.
- The existing tests must still pass.
