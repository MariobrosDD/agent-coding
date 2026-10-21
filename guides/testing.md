---
name: testing
description: Test strategy and techniques for any language: unit, integration, end-to-end, property-based, fuzzing, snapshot/golden, mutation testing, mocking strategy, coverage, test data, and fast deterministic tests.
---
# Testing

- Use the project's framework and conventions (locations, naming, fixtures, helpers). Find how tests run (package scripts, Makefile, CI config) and run them.
- Test behavior through public interfaces, not implementation details. Each test has a clear arrange/act/assert, one reason to fail and a descriptive name.
- Cover the happy path, boundaries (0, 1, max, empty, very large), invalid input, error paths, and concurrency where relevant. Every bug fix gets a regression test that fails without the fix.
- Mock only at boundaries you don't own or that are slow or non-deterministic (network, clock, randomness, hardware); prefer fakes to deep mocks; integration-test the real thing (databases in containers) where it matters.
- Determinism: inject clocks and seeds; no sleeps — wait for conditions; isolate global state; tests must not depend on their order.
- Property-based testing (Hypothesis, fast-check, proptest, jqwik, FsCheck) for invariants: round-trips, idempotence, algebraic laws, agreement with a reference implementation.
- Fuzzing (libFuzzer, AFL++, cargo-fuzz, `go test -fuzz`, Atheris, Jazzer) for parsers and anything that handles untrusted input.
- Golden/snapshot tests for complex outputs — review snapshot diffs, never update them blindly.
- Mutation testing (Stryker, mutmut, PIT, cargo-mutants) to check that the tests actually catch bugs when rigor matters.
- Coverage finds untested code; it is not the goal. For safety-critical coverage requirements, load the safety-critical guide.
- Never weaken, skip or delete a failing test to get a green run unless the test is genuinely wrong — and then explain why.
