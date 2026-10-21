---
name: security
description: Application security for any stack: OWASP Top 10, injection, XSS, authentication, sessions and tokens, secrets handling, cryptography, input validation, file handling, SSRF, dependency and supply-chain risks, threat modeling and security code review.
---
# Security

Start with a short threat model: assets, entry points, trust boundaries, likely attackers. Then:
- Injection: parameterized queries; never build shell commands, SQL, LDAP, XPath or templates from untrusted strings; pass subprocess arguments as arrays (no shell=True with user input).
- XSS: context-aware output encoding, framework auto-escaping, a vetted sanitizer (DOMPurify) when HTML must be rendered, Content-Security-Policy.
- Authentication: proven libraries or identity providers; Argon2id/bcrypt/scrypt for passwords; constant-time comparison of secrets; rate-limited login; safe password-reset flows; MFA-ready.
- Sessions and tokens: HttpOnly, Secure, SameSite cookies; short-lived access tokens; validate JWT signature, algorithm, issuer, audience and expiry; reject `alg: none`.
- Authorization: deny by default; check on the server for every resource access (IDOR); least privilege for services, tokens and database users.
- Secrets: never in code, logs, URLs or client bundles; env vars or a secret manager; .gitignore patterns. If a secret was committed, tell the user to rotate it — rewriting history is not enough.
- Cryptography: no homemade crypto; high-level APIs (libsodium, standard libraries); AES-GCM or ChaCha20-Poly1305; CSPRNG randomness; TLS everywhere with certificate verification.
- Files: prevent path traversal (resolve and check against a base directory), limit upload size and type, store outside the web root.
- SSRF: allowlist outbound destinations; block internal and cloud metadata address ranges.
- Deserialization: never deserialize untrusted data with pickle, Java serialization, BinaryFormatter or unsafe YAML loaders.
- Dependencies: lockfiles and pinned versions; `npm audit`, `pip-audit`, `cargo audit`, `govulncheck`, `dotnet list package --vulnerable`, OWASP Dependency-Check; prefer maintained packages; watch for typosquatting.
- Errors and logs: no sensitive data in error messages or logs; log security-relevant events.
- Security headers, CORS restricted to known origins, CSRF protection for cookie-based auth.
- In security reviews, report each finding with severity, a concrete exploit scenario and the fix. Never claim code is secure without evidence.
- Only help with defensive work, authorized testing and education; refuse to build malware or attacks against systems the user does not own.
