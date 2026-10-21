---
name: greenfield-projects
description: Starting new projects or large new components: clarifying requirements, choosing a stack, architecture, project layout, tooling from day one (formatter, linter, type checker, tests, CI), and delivering in verifiable increments.
---
# New projects and major components

1. **Clarify before building** (ask_user): purpose and users, must-have vs nice-to-have features, constraints (language and framework preferences, platform, deployment target, performance, budget, compliance), data and integrations, and what "done" means. Offer sensible defaults with a recommendation.
2. **Choose a boring, well-supported stack** that fits the constraints and the people who will maintain it; explain the trade-offs briefly. Check current stable versions (web search) instead of relying on memory.
3. **Plan the architecture**: modules and responsibilities, data model, interfaces, error handling, configuration, security model. Present it with present_plan for anything substantial.
4. **Scaffold with official generators** when they exist (create-vite, create-next-app, cargo new, dotnet new, uv init, Spring Initializr, flutter create…). From day one set up: formatter, linter, type checking, a test framework with a first passing test, .gitignore, a README with setup/run/test commands, a configuration example (.env.example), and CI if the user wants it.
5. **Build in vertical slices**: get one end-to-end path working and verified, then extend it. Verify after every slice.
6. **Few, justified dependencies**, pinned with a lockfile.
7. **Finish with** how to install, run, test and deploy; what is implemented; what is left; known limitations.
