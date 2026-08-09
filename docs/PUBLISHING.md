# Publishing

Releases are automated. You bump the version, write the changelog entry, and
push a tag — everything after that is machinery.

```bash
# 1. Write the CHANGELOG entry for the new version (see format below)
# 2. Bump, tag, push:
npm version minor          # or patch / major — bumps package.json, commits, tags
git push --follow-tags
```

That's it. The [Release workflow](../.github/workflows/release.yml) takes over.

---

## What happens automatically

Pushing a `v*` tag runs, in order:

| Step | Fails the release if… |
|---|---|
| Tag matches `package.json` version | You tagged `v0.7.0` but forgot to bump |
| Version not already on npm | You're re-running a release that already published |
| `server.json` version matches the tag | The registry manifest drifted — run `npm run sync-version` |
| `server.json` name matches `package.json` `mcpName` | Registry ownership check would be rejected |
| CHANGELOG has a section for this version | You forgot the entry — release notes come from it |
| `npm run typecheck` | Types are broken |
| `npm test` | Tests fail |
| `npm run build` | Build fails |
| Built entrypoint loads and registers tools | The build emitted files that can't actually run |

Only then does it:

1. `npm publish --access public` via Trusted Publishing (OIDC — no token)
2. Create the GitHub Release, notes lifted verbatim from `CHANGELOG.md`
3. Publish to the Official MCP Registry via `mcp-publisher` (also OIDC)

**The gates exist because npm versions are immutable.** A wrong publish can't be
withdrawn, only superseded by another version. Every check runs before anything
leaves the machine.

### Provenance

npm publishes a signed attestation linking the exact tarball to this repo,
commit, and workflow run. It shows as a verified badge on the npm page, and
consumers can check that what they installed was built by CI from public source
rather than uploaded from someone's laptop.

Under Trusted Publishing npm generates this **automatically** — the
`--provenance` flag is unnecessary and is deliberately absent from the
workflow. It requires the `id-token: write` permission, which the workflow
declares.

### Version bumping

`npm version` triggers a `version` lifecycle script that runs
`npm run sync-version` and stages `server.json`, so the registry manifest is
updated inside the same version commit. You do not need to remember it.

---

## One-time setup

Done once by a human, then never again.

### 1. npm Trusted Publishing (no token needed)

npm Trusted Publishing went GA on 2025-07-31 and supports scoped packages, so
there is **no `NPM_TOKEN` to create, store, or rotate**. GitHub mints a
short-lived OIDC token per run and npm verifies it against a publisher you
register on the package.

On npmjs.com → `@focusgts/aep-mcp-server` → **Settings → Publishing access →
Add trusted publisher**:

| Field | Value |
|---|---|
| Provider | GitHub Actions |
| Repository | `Focus-GTS/aep-mcp-server` |
| Workflow filename | `release.yml` |
| Allowed actions | **publish** |

> Publisher configs created after 2026-05-20 require explicitly selecting the
> allowed actions; older ones defaulted to publish-only.

**⚠️ The workflow filename is part of the trust binding.** Renaming
`release.yml` silently breaks publishing — npm rejects the OIDC token because
it no longer matches. There is a warning comment at the top of the file.

Optionally, once this works, flip the package to **"Require 2FA and disallow
tokens"** to close the legacy token path entirely.

### 2. `npm-publish` environment

The job binds to an environment of that name:

```
Settings → Environments → New environment → npm-publish
```

Leave it unprotected for hands-off releases, or add yourself as a **required
reviewer** to get an approval click before every publish. The workflow does not
change either way.

### 3. MCP Registry namespace — `com.focusgts/*` (already claimed)

The namespace is **`com.focusgts/aep`**, proved by a TXT record on
`focusgts.com`. This is deliberately a domain-verified namespace rather than a
GitHub one: it belongs to the company, not to any individual's GitHub account,
and survives personnel changes.

**Why not `io.github.Focus-GTS/*`?** The registry's GitHub device flow grants
only the authenticating *user's* namespace (`io.github.focusgts/*`), even with
public org membership and an admin role. Org namespaces were not obtainable
that way. DNS gives a better name anyway.

The TXT record at the apex of `focusgts.com`:

```
v=MCPv1; k=ed25519; p=m3GnSKmykfY2BKJjhZaLibit1q4XcB+0TNFjttIWHmo=
```

Two things that cost us a round trip and are easy to get wrong:

- The record must be at the **apex** (`@` / `focusgts.com`), **not** under a
  `_mcp-registry` selector. The registry says so explicitly if you get it wrong.
- The public key is **base64**, not hex.

The matching private key is stored as the repo secret
**`MCP_REGISTRY_DNS_KEY`**, which the release workflow uses:

```bash
mcp-publisher login dns --domain focusgts.com --private-key "$MCP_REGISTRY_DNS_KEY"
```

> ⚠️ The workflow authenticates by **DNS, not GitHub OIDC**. `login github-oidc`
> would only ever grant `io.github.focusgts/*` and cannot publish
> `com.focusgts/aep`. If you ever change the namespace, change the auth method
> to match.

**Rotating the key:** generate a new Ed25519 pair, update the apex TXT record,
then update the `MCP_REGISTRY_DNS_KEY` secret. Keep the old record in place
until the new one has propagated.

**Ordering matters.** The registry verifies npm ownership by reading `mcpName`
out of the *published tarball*, so it 400s if the version is not yet on npm.
The workflow publishes to npm first for exactly this reason. Publishing to the
registry by hand before npm will always fail.

### 4. Glama — listed, claim currently blocked

The server **is listed** at
<https://glama.ai/mcp/servers/@Focus-GTS/aep-mcp-server> and Glama re-scans the
repo on every commit, so listing data stays current without any action.

**The listing is unclaimed, and claiming does not currently work.** Unclaimed
means reduced ranking, not invisibility.

Everything Glama documents as a requirement is in place and was verified:

| Requirement | State |
|---|---|
| Claiming account has repo admin | ✅ `focusgts` has admin |
| Glama GitHub App authorized | ✅ |
| Glama App installed on the `Focus-GTS` org with repo access | ✅ installed 2026-08-09, `contents: read` |
| `glama.json` at repo root on the default branch | ✅ HTTP 200, lists `focusgts` |

The claim flow still returns to the page without completing.

**This is not a configuration problem on our side.** `eds-mcp-server` has
carried a correct `glama.json` naming `focusgts` for months and is *also* still
unclaimed — so the documented mechanism is not working for this organization's
repos, and retrying or waiting for a re-scan will not resolve it.

**If picking this up later:** report it to Glama (Discord or support) as
"claim flow for an org-owned repo returns without creating a claim, despite
glama.json listing the claiming user as a maintainer." Do not spend time
re-checking the four rows above — they were confirmed on 2026-08-09.

`glama.json` is committed to all three public MCP repos (`aep-mcp-server`,
`eds-mcp-server`, `firefly-services-mcp`) so all three can be claimed as soon
as the flow works. `workfront-mcp-server` is deliberately excluded while
private.

### 5. mcp.so — one submission

Submit at <https://mcp.so/submit>, which opens a GitHub issue. Public GitHub
repos only. Five minutes, once, not automatable.

### Smithery — optional, skipped

Smithery can list a stdio-only server, but only as a prebuilt **MCPB bundle**
it distributes for local execution. That is a real packaging commitment for
modest reach. Skipped deliberately; revisit if the distribution is wanted.

---

## Registries — what is automated

| Registry | Mechanism | In CI? |
|---|---|---|
| **npm** | Direct publish via OIDC | ✅ Automated |
| **Official MCP Registry** | `mcp-publisher` + GitHub OIDC | ✅ Automated |
| **PulseMCP** | Ingests from the Official Registry weekly | ✅ Free with the above |
| **Glama** | Re-scans every commit after a one-time claim | ✅ Nothing to do |
| **mcp.so** | Manual submission | ❌ One-time human step |
| **Smithery** | MCPB bundle | ❌ Skipped |

The MCP Registry step runs **after** the npm publish — the registry verifies
ownership by reading `mcpName` from the published tarball, so npm has to be
live first. It is `continue-on-error`: by that point the package is already
public, and a registry outage must not turn a successful release into a failed
one.

> **The Official MCP Registry is in preview** and warns that *"breaking changes
> or data resets may occur before general availability."* The schema is
> date-stamped `2025-12-11` and the field naming already moved once
> (snake_case → camelCase). If registry publishing starts failing, re-check the
> schema URL in `server.json` first.

---

## If a release fails

**Before the publish step** — nothing was published. Fix the problem, delete
the tag, re-tag:

```bash
git tag -d v0.7.0
git push origin :refs/tags/v0.7.0
# fix, commit, then re-tag
```

**After the publish step** — the version is on npm permanently. Do not try to
reuse it. Bump to the next patch version and release again. `npm unpublish` is
restricted to a 72-hour window and breaks anyone who already installed.

**Publish succeeded but the GitHub Release step failed** — the package is fine.
Create the release by hand:

```bash
gh release create v0.7.0 --title v0.7.0 \
  --notes "$(node scripts/extract-changelog.mjs v0.7.0)" --verify-tag
```
