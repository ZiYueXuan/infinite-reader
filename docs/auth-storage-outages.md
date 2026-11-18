# Authentication during a storage outage

Google login needs D1 after identity verification to find or create the account, record Terms of Use consent, and create the session. An unavailable D1 instance also affects existing sessions and annotation synchronization.

The Google start endpoint checks database availability after validating consent, before creating an OAuth cookie. Known D1 service failures return HTTP 503 with `database_unavailable`, `Retry-After: 30`, and no session cookie. SQL syntax errors and constraint violations are not mislabeled as temporary outages.

Callback exceptions return to the reader's original page with a safe authentication error instead of leaving the browser on a JSON 500 response. Token exchange, profile retrieval, and storage failure have distinct user-facing messages. The handshake cookie is cleared; readers restart sign-in rather than reloading a callback whose authorization code may have been consumed. Neither authorization-code exchanges nor ambiguous database writes are automatically replayed by the callback.

Annotation and note writes already use the persistent browser outbox. HTTP 500/503 failures retain the entry; reload and a later replay preserve its original range, text, font, and ink. The queue is cleared only after server acknowledgement. This is local pending data, not confirmation of a cloud save. Browser site-data removal can remove pending entries. Reading-progress writes do not have the same persistent outbox guarantee.

Validation: Worker auth tests simulate service failures at account lookup, consent recording, session creation, and login start, plus Google network/JSON failures. `web/scripts/check-sync-outage.mjs` verifies real IndexedDB/localStorage retention through 500, reload, 503, and successful replay using an intercepted test API. These checks validate application recovery behavior; they do not restore an unavailable Cloudflare D1 service or substitute for a real Google-account login.
