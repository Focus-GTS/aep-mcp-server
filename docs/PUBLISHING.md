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
| CHANGELOG has a section for this version | You forgot the entry — release notes come from it |
| `npm run typecheck` | Types are broken |
| `npm test` | Tests fail |
| `npm run build` | Build fails |
| Built entrypoint loads and registers tools | The build emitted files that can't actually run |

Only then does it:

1. `npm publish --access public --provenance`
2. Create the GitHub Release, notes lifted verbatim from `CHANGELOG.md`

**The gates exist because npm versions are immutable.** A wrong publish can't be
withdrawn, only superseded by another version. Every check runs before anything
leaves the machine.

### Provenance

`--provenance` publishes a signed attestation linking the exact tarball to this
repo, commit, and workflow run. npm shows it as a verified badge, and consumers
can check that what they installed was built by CI from public source rather
than uploaded from someone's laptop. It requires the `id-token: write`
permission, which the workflow declares.

---

## One-time setup

These are done once, by a human, and then never again.

### 1. `NPM_TOKEN` secret

Create a **granular access token** at
<https://www.npmjs.com/settings/focusgts/tokens>:

- Packages and scopes: **read and write**, limited to `@focusgts/aep-mcp-server`
- Organizations: **no access**
- **Bypass two-factor authentication: enabled** — required, or CI cannot publish

Add it to the repo as a secret named `NPM_TOKEN`, scoped to the `npm-publish`
environment:

```bash
gh secret set NPM_TOKEN --env npm-publish
```

### 2. `npm-publish` environment

The workflow runs in an environment named `npm-publish`. Creating it is what
lets you optionally require a manual approval before any publish:

```
Settings → Environments → New environment → npm-publish
```

Leave it unprotected for hands-off releases, or add yourself as a **required
reviewer** to get a "someone must click approve" gate on every publish. The
workflow does not need changing either way.

---

## CHANGELOG format

Release notes are extracted from `CHANGELOG.md` by
[`scripts/extract-changelog.mjs`](../scripts/extract-changelog.mjs), so the
heading format matters:

```markdown
## [0.7.0] - 2026-08-15

### Added
- Thing you added

### Fixed
- Thing you fixed
```

The extractor takes everything between that heading and the next `## [` — so
`### Added` and friends stay inside the section. An empty or missing section
fails the release rather than publishing with blank notes.

Keep writing these by hand. Tools like semantic-release generate changelogs
from commit messages, which produces a worse changelog than one written for a
reader.

---

## Registries

The MCP registry ecosystem is mostly **pull, not push** — most registries crawl
npm and GitHub rather than accepting a submission, so a successful npm publish
is usually all that's needed.

| Registry | How it lists | Action needed |
|---|---|---|
| npm | Direct publish | Automated ✅ |
| Glama | Crawls GitHub / npm | *see below* |
| Smithery | Manifest + submission | *see below* |
| mcp.so | Submission | *see below* |
| Official MCP Registry | Manifest + CLI | *see below* |

> **This table is being verified.** Registry requirements changed
> substantially through 2025–2026 and are worth confirming against each
> registry's current docs rather than trusting a snapshot. Update this section
> once confirmed, and move anything automatable into the workflow's
> `Ping registries` step.

The workflow's registry step is deliberately `continue-on-error: true`: a
registry being slow or down must never fail a release whose package already
published successfully.

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
