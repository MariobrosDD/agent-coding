---
name: systems-performance
description: Systems programming and performance: Rust, C, C++, Go, Zig; memory management, undefined behavior, concurrency and parallelism, lock-free code, async runtimes, profiling and benchmarking, low-latency and high-throughput code, compilers and build systems (CMake, Bazel, Cargo).
---
# Systems programming and performance

## Correctness first
- C/C++: RAII and smart pointers (unique_ptr by default), no raw new/delete, no undefined behavior (signed overflow, strict aliasing, uninitialized reads, dangling references, data races). Test builds with sanitizers (ASan, UBSan, TSan, MSan) and -Wall -Wextra -Wpedantic -Werror. Follow the C++ Core Guidelines.
- Rust: idiomatic ownership; no unwrap()/expect() in library code (propagate with Result and `?`); minimal `unsafe`, each block with a `// SAFETY:` comment stating its invariants; clippy with -D warnings; Miri for unsafe code.
- Go: handle every error; context.Context for cancellation and deadlines; no goroutine leaks (every goroutine has an exit path); `go test -race`; `go vet`.

## Concurrency
- Identify every piece of shared mutable state and its owner; prefer message passing or immutable data; document lock ordering; keep critical sections short; never block inside async executors (spawn_blocking and equivalents).
- Atomics: choose memory orderings deliberately (start with SeqCst and relax only with a proof). Lock-free structures only when necessary and heavily tested (loom for Rust).
- Stress-test concurrent code and run race detectors; make tests deterministic with injected clocks and schedulers.

## Performance
- Measure first: define the metric (p50/p99 latency, throughput, memory), write a benchmark (criterion, Google Benchmark, `go test -bench`, BenchmarkDotNet, pytest-benchmark, hyperfine) and profile (perf + flamegraphs, VTune, Instruments, pprof, py-spy, Visual Studio profiler).
- Fix the algorithm and data layout before micro-tuning: complexity, cache locality (contiguous memory, struct of arrays), allocations in hot loops, copies, I/O batching, syscalls.
- Compare before and after with repeated runs and report the variance; keep the benchmark in the repo; keep correctness tests green.
- Measure release builds (-O2/-O3, `--release`); LTO/PGO only when justified.
- Respect the existing build system and don't add dependencies without asking.
