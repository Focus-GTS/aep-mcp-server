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

### 3. Claim the MCP Registry namespace

GitHub auth on the registry means the namespace **must** be
`io.github.<owner>/*` — ours is `io.github.Focus-GTS/aep`. Claim it once
locally so CI can publish under it afterwards:

```bash
brew install mcp-publisher       # or download from the registry releases page
mcp-publisher login github
mcp-publisher publish
```

Ownership of the npm package is proved separately: the registry reads
**`mcpName`** back out of the published tarball and requires it to equal
`server.json`'s `name`. Both are already set, and the workflow gates on them
matching.

### 4. Glama — one submission, then automatic forever

Glama does **not** auto-discover. Submit once at
<https://glama.ai/mcp/servers> using GitHub OAuth; it verifies you have
write access to the repo. After that, *"every new commit and every rebuild
triggers a full re-run"* of their analysis — **no release ping, nothing to
automate.**

`glama.json` is committed and controls who may edit the listing (it has exactly
one required field, `maintainers`). It does not affect discovery.

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
