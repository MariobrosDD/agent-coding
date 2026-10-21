---
name: databases
description: Relational and NoSQL data modeling, SQL, migrations, indexing, query performance, transactions and isolation, ORMs (Prisma, SQLAlchemy, Django ORM, Hibernate/JPA, EF Core, ActiveRecord, GORM), PostgreSQL, MySQL, SQLite, SQL Server, Oracle, MongoDB, Redis.
---
# Databases

- Inspect the existing schema, migrations folder and ORM models before changing anything; use the project's migration tool (Alembic, Prisma Migrate, Flyway, Liquibase, Django, EF Core, Rails, golang-migrate).
- Never edit a migration that has been applied or shipped — add a new one. Make migrations reversible when the tool supports it.
- Zero-downtime changes: expand → migrate data → contract (add a nullable column, backfill in batches, add constraints, switch reads/writes, drop the old column later). Avoid long locks on large tables (CREATE INDEX CONCURRENTLY in Postgres, online DDL in MySQL).
- Never run destructive statements (DROP, TRUNCATE, DELETE/UPDATE without WHERE) against real data without explicit approval; work against a local or disposable database.
- Enforce invariants in the database: primary and foreign keys, NOT NULL, UNIQUE and CHECK constraints. Proper types: timestamptz, numeric/decimal for money, uuid, enums or lookup tables.
- Queries: parameterized only (string concatenation means SQL injection). Avoid N+1 (eager loading, joins, batching). Select only the needed columns. Paginate.
- Indexes follow real WHERE/JOIN/ORDER BY patterns; composite column order matters; confirm with EXPLAIN (ANALYZE); don't over-index write-heavy tables.
- Transactions: know the default isolation (Postgres and SQL Server READ COMMITTED, MySQL InnoDB REPEATABLE READ); use SERIALIZABLE or explicit locks for multi-row invariants; retry on serialization failures and deadlocks.
- Store timestamps in UTC; convert at the edges.
- NoSQL: model for access patterns; know the consistency guarantees; TTLs and eviction policies in Redis; avoid unbounded documents and keys.
- Tests: run migrations up and down against the same engine and version as production (Testcontainers/docker). SQLite is not a faithful stand-in for Postgres or MySQL.
