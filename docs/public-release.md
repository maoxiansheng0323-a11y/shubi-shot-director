# Public release procedure

This repository can be prepared as public source, but its internal Git history
is not the publication artifact. Development-only checkpoints remain private;
GitHub receives only a verified, history-free source snapshot.

## Fixed v0.9.2 publication parameters

- Repository: `shubi-shot-director`
- Repository name: `shubi-shot-director`
- Repository owner: `maoxiansheng0323-a11y`
- Existing public repository: `maoxiansheng0323-a11y/shubi-shot-director`
- Visibility: `public`
- Default branch: `main`
- Release version: `v0.9.2`
- License: `MIT`
- Package publication: disabled; keep `package.json` at `private: true` and do not publish to npm.

## Verify the private working repository

Run every gate from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm verify
node .agents/skills/shubi-shot-director/scripts/audit-generic-output.mjs
git diff --check
git status --short
```

`pnpm verify` includes the dependency-license audit. Run the content scan again
with each private project name, alias, or marker supplied only as a command-line
deny token:

```powershell
node scripts/audit-public-release.mjs --skip-license-check --deny-token <private-marker-1> --deny-token <private-marker-2>
```

Never store deny tokens in repository files, scripts, reports, fixtures, logs,
screenshots, or command transcripts intended for publication.

## Create a history-free source snapshot

Create the release candidate from the final verified commit with `git archive`.
Extract it into a clean directory that is not itself the internal checkout.

```powershell
New-Item -ItemType Directory -Force .shubi-shot | Out-Null
git archive --format=tar HEAD -o .shubi-shot/public-source.tar
```

The archive must contain only committed source files. It must not contain
`.git`, ignored runtime state, external profiles, environment files, local
scenes, exports, logs, build output, internal branches, or tags.

Inside the extracted snapshot, run:

```powershell
pnpm install --frozen-lockfile
pnpm verify
node scripts/director.mjs doctor
node scripts/director.mjs ensure
node scripts/director.mjs scene submit --file examples/quickstart.scene-submission.json
node scripts/director.mjs snapshot
```

Open the returned loopback URL, wait for Shot Preview, and complete one real
1920 x 1080 PNG export before accepting the snapshot.

## Update the existing public repository

Clone the existing public repository into a separate public checkout. Never add
its remote to this internal checkout. Never push the existing internal branches or tags.
In the public checkout, preserve `.git`, replace only the tracked source tree
with the verified snapshot, and review the complete diff.

Before committing, require `package.json` to remain private, rerun the public
audit, and verify that no internal history, runtime state, profile, credential,
or private marker is present. Then commit and tag only from the public checkout:

```powershell
git add --all
git commit -m "Release v0.9.2"
git tag -a v0.9.2 -m "Shubi Shot Director v0.9.2"
git push origin main
git push origin v0.9.2
```

Create the public announcement from the committed reusable release notes:

```powershell
gh release create v0.9.2 --repo maoxiansheng0323-a11y/shubi-shot-director --title "Shubi Shot Director v0.9.2" --notes-file docs/releases/v0.9.2.md
```

Finally verify the remote `main` SHA, annotated tag target, published Release,
anonymous repository access, MIT license recognition, and attached export. Do
not publish this package to npm.
