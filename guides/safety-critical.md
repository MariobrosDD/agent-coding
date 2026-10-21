---
name: safety-critical
description: Aerospace, space flight, medical, automotive, rail, defense, and any code where a failure can injure people, destroy hardware or lose a mission. Coding rules (NASA/JPL Power of Ten, MISRA), standards (DO-178C, ISO 26262, IEC 62304, NASA NPR 7150.2), fault tolerance and verification rigor.
---
# Safety- and mission-critical software

## Mindset
- Correctness, predictability and verifiability beat cleverness, performance and brevity. Every line must be explainable to a reviewer and traceable to a requirement.
- State assumptions explicitly. If a requirement, unit, coordinate frame, tolerance, timing constraint or failure behavior is not specified, ask — do not guess.
- Establish the criticality level first: DO-178C DAL A–E, ISO 26262 ASIL A–D, IEC 62304 class A–C, NASA software class A–E (NPR 7150.2, NASA-STD-8739.8). It drives the rigor required (coverage, independence, documentation). Ask the user if it is unknown.

## NASA/JPL "Power of Ten" (Holzmann) — mandatory for C/C++ flight code, and in spirit elsewhere
1. Simple control flow: no goto, setjmp/longjmp, or recursion (direct or indirect).
2. Every loop has a fixed upper bound that a tool can prove.
3. No dynamic memory allocation after initialization.
4. Functions fit on one printed page (about 60 lines).
5. At least two assertions per function on average; assertions have no side effects and trigger an explicit recovery action.
6. Declare data at the smallest possible scope.
7. Check the return value of every non-void function; validate every parameter inside each function.
8. Preprocessor only for includes and simple macros: no token pasting, variadic or recursive macros; minimize conditional compilation.
9. Restrict pointers: at most one level of dereference; no function pointers.
10. Compile with all warnings at the most pedantic level from day one, zero warnings; run one or more static analyzers, zero findings.

Related standards: JPL Institutional Coding Standard for C, MISRA C:2012/2023, MISRA C++:2023, AUTOSAR C++14, CERT C/C++, SPARK/Ada for the highest assurance.

## Design for faults
- Define behavior for every input, including out-of-range, NaN/Inf, stale, missing, duplicated and out-of-order data. Decide per function whether it fails safe or fails operational, and document it.
- Range-check sensor inputs; use plausibility checks, persistence/debounce filters and cross-checks between redundant sources.
- No silent failures: detect, report (telemetry/log with an error code), contain, recover. Watchdogs for liveness.
- Deterministic timing: bounded execution time, no unbounded waits, priority-inheritance mutexes against priority inversion (Mars Pathfinder), worst-case execution time analysis on hard real-time paths.
- Partition safety-critical from non-critical code; minimize shared mutable state.
- Explicit units in names or types (`thrust_n`, `altitude_m`, `dt_s`) or unit-aware types; document coordinate frames and epochs. Mars Climate Orbiter was lost to an lbf·s vs N·s mismatch.
- Guard against integer overflow, implicit conversions, signed/unsigned mixing, float→int truncation (Ariane 5 flight 501 was lost to an unprotected 64-bit float to 16-bit integer conversion), division by zero, uninitialized variables.
- Time: monotonic clocks for intervals; be explicit about UTC/TAI/GPS/TT and leap seconds; handle counter rollover (GPS week rollover, 32-bit millisecond counters at ~49.7 days).
- Reused code must be re-verified in its new context (Ariane 5 reused Ariane 4 code with a different flight envelope).

## Verification
- Requirements-based testing: every requirement has tests and every test traces to a requirement. Keep a traceability table (requirement ID → code → test) when the project uses requirement IDs.
- Structural coverage by level: statement, decision, and MC/DC for the highest levels (DO-178C DAL A). Measure it (gcov/lcov, llvm-cov, Bullseye, VectorCAST, LDRA).
- Test nominal, boundary, robustness (invalid input), fault-injection and timing cases.
- Static analysis (cppcheck, clang-tidy, Coverity, Polyspace, CodeSonar, Frama-C) and formal methods where warranted (SPARK, Frama-C/ACSL, TLA+ for protocols, model checking with SPIN or CBMC).
- Software-in-the-loop and hardware-in-the-loop where hardware is involved; simulations validated against reference data.
- Reproducible builds with pinned, ideally qualified, toolchains.

## How to work
- Before coding, restate requirements, assumptions, units, frames and failure behavior, and confirm the missing ones with ask_user. Use present_plan before implementing.
- Small, reviewed changes. Never weaken a check, assertion or test to make something pass.
- Document every deviation from the coding rules with its rationale (the way MISRA deviations are documented).
- In the final report list: requirements covered, tests and coverage achieved, static-analysis results, open risks, and what still needs independent review or hardware testing.
