# Security Policy · 安全策略

## Reporting a vulnerability · 报告漏洞

**Please do not open a public GitHub issue for a security problem.**
**请不要用公开的 GitHub issue 报告安全问题。**

Email the maintainer instead, and allow up to 72 hours for an initial response:

请邮件联系维护者，我们会在 72 小时内给出首次回复：

- Subject format: `[AiMD security] <one-line summary>`
- Include: affected version or commit, reproduction steps, and whether the issue
  needs a running server / a second account to demonstrate.
- If you have a patch, a private fork or a `git format-patch` attachment is welcome.
- 邮件标题：`[AiMD security] <一句话概述>`；正文请附版本或 commit、复现步骤，以及是否需要
  真实服务端 / 第二个账号才能复现。有补丁的话欢迎附 `git format-patch`。

We will confirm receipt, agree on a disclosure timeline with you, and only publish an
advisory after a fix is available (or after 90 days, whichever comes first).
Credit is given unless you ask to stay anonymous.

我们会确认收到、与你商定披露时间，并在修复可用后（或最迟 90 天）再发布公告。
除非你要求匿名，否则会在公告中致谢。

## Scope · 范围

In scope (worth reporting):

- Cross-tenant data access: any API or WebSocket path that returns or mutates another
  `owner_id`'s notes, folders, tags, attachments or settings.
- Authentication bypass, refresh-token replay, or a browser-reachable refresh token.
- Stored XSS that survives the Markdown pipeline (`packages/markdown` + DOMPurify).
- Path traversal in attachment upload/download, ZIP import or export.
- SSRF via the AI provider `baseUrl` when `AI_ALLOW_PRIVATE_BASE_URL=false`.
- Plaintext credentials at rest, or a secret committed to the repository.

Out of scope: attacks that require physical access to a device already logged in,
social engineering, and findings in third-party services you host yourself
(Caddy, Postgres, your AI provider).

## Hardening baseline · 已实现的安全基线

| Area | Implementation |
| --- | --- |
| Passwords | `argon2id` via `@node-rs/argon2`; never stored or logged in plaintext |
| Sessions | 15-minute access token + 30-day rotating refresh token |
| Browser transport | refresh token in an `httpOnly` + `SameSite` cookie; scripts cannot read it |
| Desktop transport | refresh token in the OS keychain (`safeStorage`); the client must send `X-Token-Transport: bearer` before the server returns one in a body |
| Collaboration WS | the access token is required at connect time; cross-tenant documents are rejected |
| Authorization | every query is narrowed by `owner_id`; cross-tenant attempts are covered by integration tests |
| Rate limiting | 10 req/min/IP on credential endpoints, 600 req/min/IP globally |
| AI provider keys | AES-256-GCM at rest, derived from `AI_CREDENTIALS_SECRET` (or `JWT_SECRET`); the API only ever returns a mask |
| AI `baseUrl` | HTTPS + public-address only by default, to block SSRF; `AI_ALLOW_PRIVATE_BASE_URL=true` opts out |
| Note HTML | raw HTML is escaped (`html: false`) and rendered output passes DOMPurify |
| Attachment SVG | served with a restrictive CSP so an uploaded SVG cannot script the origin |
| Config | `JWT_SECRET` has no default — boot fails fast if it is missing or under 32 characters |
| Secrets in repo | `scripts/check-secrets.sh` runs in CI and as a pre-commit hook |

## Deployment checklist · 部署方检查清单

- Set a unique `JWT_SECRET` (`deploy.sh` generates one with `openssl rand`); never reuse one across deployments.
- Set `AI_CREDENTIALS_SECRET` if you use AI features, so rotating `JWT_SECRET` does not invalidate stored provider keys.
- Put the app behind HTTPS. Plain HTTP is supported for a first trial only.
- Turn `ALLOW_REGISTRATION=false` once your accounts exist.
- Restrict `CORS_ORIGIN` if you serve the SPA from a different origin than the API.
- Keep Postgres and the upload volume backed up (`make backup`); a CRDT store is not recoverable without them.

## Supported versions · 受支持的版本

`main` only, until the first tagged release. After `v1.0.0` we will support the latest
minor release and document breaking migrations in the release notes.
