---
name: legacy-and-refactoring
description: Working safely in large or legacy codebases: understanding unfamiliar code, characterization tests, incremental refactoring, migrations between frameworks, languages or major versions, dependency upgrades, and removing dead code.
---
# Legacy code and refactoring

- Understand before changing: map the entry points, data flow and dependencies of the area (subagents can explore several areas in parallel). Read the tests, git history (`git log -p`, blame) and docs to learn the intent.
- Refactoring changes structure, not behavior. Keep refactoring steps separate from behavior changes.
- Safety net first: if the code has no tests, add characterization (golden master) tests that capture current behavior — quirks included — before refactoring.
- Small steps, each verified (build + tests) before the next. Keep the code working at every step; use the strangler-fig pattern or branch by abstraction for large replacements.
- Preserve public APIs and behavior unless the user approved the change; deprecate before removing.
- Upgrades: read the official migration guide and changelog of every major version you cross; one major at a time; use official codemods when they exist; fix deprecation warnings first.
- Language or framework migrations: run old and new side by side on the same inputs and compare outputs (differential testing).
- Dead code: prove it is unused (dynamic references, reflection, configuration, external callers) before deleting it.
- Match existing conventions even if you would choose differently; propose wider cleanups to the user instead of doing them unasked.
