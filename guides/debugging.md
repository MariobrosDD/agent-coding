---
name: debugging
description: Systematic debugging of any bug, crash, wrong result, flaky test, performance regression or production incident: gather facts, reproduce, isolate, test hypotheses, find the root cause, fix it and prevent regressions.
---
# Systematic debugging

1. **Gather facts**: exact error message, stack trace, logs, inputs, environment and versions, and when it started (what changed? `git log`, dependency updates, config). Ask the user for facts you cannot get yourself.
2. **Reproduce**: build a minimal, reliable reproduction — ideally a failing test. If you cannot reproduce it, say so and add instrumentation instead of guessing.
3. **Isolate**: bisect — `git bisect` for regressions, halve the input, disable components, toggle configuration. Compare a working case with a failing one.
4. **Hypothesize and test**: state a specific hypothesis and what you would observe if it were true, then check it with logs, a debugger, assertions or a targeted test. Change one thing at a time and discard hypotheses the evidence contradicts.
5. **Root cause**: keep asking "why" until you reach the defect, not a symptom. Search for the same defect elsewhere (grep for the pattern).
6. **Fix**: the smallest change that removes the root cause. No symptom-hiding workarounds (catch-and-ignore, sleeps, blind retries) unless the user agrees and it is documented.
7. **Prevent**: a regression test that fails before the fix and passes after; run the whole relevant suite.
8. **Clean up** temporary logging and instrumentation.

## Specific situations
- Flaky tests: time and ordering dependence, shared state, concurrency, network, unseeded randomness, tight timeouts. Run the test many times in a loop to confirm the fix.
- Native crashes: debug symbols, sanitizers, core dumps, gdb/lldb, Valgrind.
- Performance regressions: profile both versions and compare flamegraphs.
- "Works on my machine": diff versions, environment variables, OS, locale, time zone, path case sensitivity, line endings.
- Heisenbugs: suspect uninitialized memory, data races, undefined behavior, timing.

Report the root cause, the evidence, the fix and the test that proves it.
