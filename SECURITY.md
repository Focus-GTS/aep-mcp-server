# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue for a security vulnerability.**

Email **dfox@focusgts.com** with:

- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- Affected version(s)
- Any suggested remediation

You'll get an acknowledgement within **3 business days** and an assessment with
a remediation plan or a rejection rationale within **10 business days**. We'll
credit you in the release notes unless you'd rather stay anonymous.

Please give us a reasonable window to ship a fix before disclosing publicly.

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.4.x   | Yes |
| < 0.4   | No — upgrade to the latest minor |

This project is pre-1.0. Security fixes land on the latest minor only.

---

## Threat model

This server is a **local stdio process** that holds Adobe I/O credentials and
performs authenticated read *and write* operations against a customer's Adobe
Experience Platform tenant. It is driven by an LLM agent.

That combination is the thing to reason about: the agent choosing which tools to
call is not a trusted, deterministic caller. Treat tool inputs as attacker-
influenced whenever the agent's context can contain untrusted text.

### In scope

- Credential handling and token lifecycle (`src/auth/`)
- Leakage of secrets, tokens, or PII into logs or tool responses
- SSRF via attacker-controlled paths or URLs reaching `AepClient`
- Missing or bypassable confirmation gates on destructive tools
- Input validation gaps at the Zod boundary
- Dependency vulnerabilities
- Anything that lets a tool call reach an endpoint or tenant the operator
  did not intend

### Out of scope

- Vulnerabilities in Adobe Experience Platform itself — report those to
  [Adobe PSIRT](https://helpx.adobe.com/security/alertus.html)
- Vulnerabilities in the MCP client (Claude Desktop, Cursor, etc.)
- An operator deliberately configuring the server against a production sandbox
  and instructing the agent to delete data. The confirmation gates are a
  guardrail against accident and drive-by prompt injection, not a substitute
  for least-privilege credentials
- Social engineering of the human operator

---

## Security properties this project maintains

These are deliberate, tested behaviors. A regression in any of them is a
security bug worth reporting.

**Credentials never leave the process.** They're read from the environment at
startup, exchanged for an OAuth token, and used only as request headers. They
are never returned in a tool result and never logged.

**Error bodies are sanitized at construction.** `AepApiError` filters upstream
response bodies through a field allowlist (`status`, `title`, `detail`, `type`,
`error-code`, `code`, `statusCode`, `message`) the moment it's constructed — not
at render time. So even a `logger.error({ err })` in a `catch` block cannot leak
unwhitelisted Adobe diagnostic fields. Bodies are also length-capped.

**Error-level logs omit response bodies entirely.** Adobe's free-form `detail`
strings can carry PII that no redaction path would reliably catch. Bodies go to
`debug` only.

**stdout is protocol-only.** All logging goes to stderr via pino. Writing to
stdout corrupts the JSON-RPC stream, so `console.log` is banned project-wide.

**SSRF guard on absolute URLs.** `AepClient.buildUrl` rejects any absolute URL
whose host doesn't end in `.adobe.io`, `.adobe.com`, `.adobedc.net`, or
`.adobelogin.com`. Relative paths are always resolved against
`https://platform.adobe.io`.

**Destructive tools gate before the network call.** Tools that can destroy
unrecoverable customer data require `confirm` to equal exactly
`"I understand this is irreversible"`, checked before any request is issued, and
log a warning when rejected. This is what stops an agent that has ingested a
malicious instruction from one-shotting a deletion.

**Non-idempotent requests are not retried on timeout.** A `POST` or `PATCH`
that times out may have been applied server-side; retrying could double-execute
it. Those are surfaced as errors instead.

**Tokens refresh on 401 exactly once.** A 401 invalidates the cached token and
retries a single time, preventing an infinite auth loop against Adobe's IMS.

---

## Operator guidance

**Scope your credentials.** The server can only do what the Adobe I/O
credential permits. Grant the narrowest product profile that covers your use
case. If you don't need Data Hygiene, don't provision it.

**Set `AEP_SANDBOX_NAME` explicitly.** It defaults to `prod`. An unset variable
plus a broadly-scoped credential is how accidents happen.

**Treat write and destructive tools as privileged.** `aep_create_record_delete`
and `aep_create_dataset_expiration` schedule permanent, irreversible deletion of
customer data. If your MCP client supports per-tool approval, require it for
these.

**Watch for prompt injection.** If your agent reads untrusted content — support
tickets, scraped pages, user-submitted text — that content can attempt to steer
tool calls. The confirmation gates raise the bar but are not a complete defense.
Least-privilege credentials are.

**Keep `.env` out of version control.** It's gitignored by default. Don't
override that.
