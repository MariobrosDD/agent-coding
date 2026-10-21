---
name: web-frontend
description: Browser applications and UI: React, Next.js, Vue, Nuxt, Svelte, Angular, TypeScript, CSS/Tailwind, state management, accessibility, performance, SSR/SSG, and frontend testing (Vitest/Jest, Testing Library, Playwright).
---
# Web frontend

- Check the framework and its version in package.json before writing code: APIs differ a lot between majors (React 18 vs 19, Next.js pages vs app router, Vue 2 vs 3, Angular modules vs standalone). Read the docs for that version when unsure.
- Follow the project's patterns: component structure, styling (CSS modules, Tailwind, styled-components), state library, data fetching (TanStack Query, SWR, route loaders), routing, i18n.
- TypeScript: precise types for props and API data; no `any` without a reason; validate external data at the boundary (zod, valibot).
- State: minimal and close to where it is used; derive instead of duplicating; server state is not client state.
- Effects: none for derived data; clean up subscriptions and timers; correct dependency arrays; handle races in async fetches (AbortController, ignore stale responses).
- Accessibility (WCAG 2.2 AA): semantic HTML first, labelled inputs, keyboard navigation with visible focus, alt text, ARIA only when semantics fall short, color contrast, prefers-reduced-motion.
- Performance: avoid needless re-renders (memoize where measured), code-split routes, lazy-load heavy components, optimized images, watch bundle size, Core Web Vitals (LCP, INP, CLS).
- Security: never inject unsanitized HTML (dangerouslySetInnerHTML, v-html, innerHTML); no secrets in client bundles; CSRF and CORS awareness; CSP-friendly code.
- Forms: client validation mirrors server validation; pending/disabled states; clear error messages.
- Every async view has loading, empty and error states. Responsive, mobile-first layout.
- Tests: Testing Library queries by role/label (behavior, not implementation); Playwright for critical flows; run the type checker and linter.
- To see the app, run the dev server as a background job (bash with run_in_background, then job_output with `until`) and check its logs; tell the user what to check visually when you cannot.
