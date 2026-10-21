---
name: backend-services
description: APIs and server-side systems: REST, GraphQL, gRPC, WebSockets, authentication and authorization, validation, error handling, background jobs, messaging and queues, caching, distributed-systems reliability, observability. Node, Python (FastAPI/Django/Flask), Go, Java/Kotlin (Spring), .NET, Ruby, PHP, Elixir.
---
# Backend services and APIs

- Validate all input at the boundary with a schema (pydantic, zod, class-validator, FluentValidation, Bean Validation); reject unknown fields where appropriate; return precise 4xx errors.
- Authentication is not authorization: check permission for the specific resource on every request (object-level authorization, no IDOR). Never trust client-supplied IDs or roles.
- One consistent error model (e.g. RFC 9457 problem+json); never leak stack traces or internals; log server-side with correlation IDs.
- Idempotency: idempotency keys for retried POSTs; correct PUT/PATCH semantics; consumers tolerate duplicate and out-of-order messages.
- Every outbound call has a timeout, retries with exponential backoff and jitter (only for idempotent operations), and a circuit breaker where appropriate. Bound concurrency and queue sizes. Graceful shutdown drains in-flight work.
- Transactions: short; know the isolation level; use the outbox pattern to publish events consistently with database writes.
- Pagination (cursor-based for large sets), rate limiting, request size limits.
- Configuration from environment/secret manager, never hardcoded (12-factor).
- Observability: structured logs, metrics (RED/USE), traces (OpenTelemetry), health and readiness endpoints.
- Compatibility: evolve APIs additively or version them; never silently break clients; keep the OpenAPI/GraphQL/protobuf schema in sync.
- Concurrency: protect read-modify-write sequences (atomic UPDATEs, optimistic locking with a version column, SELECT … FOR UPDATE).
- Tests: unit tests for logic; integration tests against a real database and broker (Testcontainers or docker compose); contract tests for APIs.
- Load the databases and security guides for those topics.
