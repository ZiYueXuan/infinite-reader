# D1 reader read replicas

The primary remains in WNAM. Enable D1 read replication with the database update
API (`read_replication.mode = auto`); disabling it routes Sessions API queries back
to the primary without a code rollback or data migration.

The reader's bookshelf, book detail, notes, annotations, file and cover GETs use a
new D1 session per request with `first-primary`. The first SQL query validates the
login and current consent on the primary. D1's resulting bookmark fences later
queries in the request so replicas cannot serve data older than this check.
This also covers previous writes from another tab/device without relying on a
browser-held bookmark. Missing cookies still perform no SQL queries.

All mutations, login callbacks, generation jobs, job polling and other endpoints
retain the original primary binding. Cost ledger persistence also uses the primary.
No schema changes, browser storage or database migration are involved.

Structured `d1_read_routing` logs count primary/replica read results and serving
regions from D1 metadata. They contain no SQL, user identifiers or book contents.
Local D1 tests validate the session boundary and route selection, but real replica
routing must be verified on Cloudflare using `served_by_primary: false`.

This removes remote-primary round trips for eligible queries **after** the login
check. It does not eliminate the primary authentication round trip, accelerate
writes or affect anonymous sample-book/font downloads. Replica catch-up and
Cloudflare placement can still cause individual reads to use the primary.
