# Public release procedure

This repository can be prepared as public source, but its current internal Git history is not the publication artifact. The history contains development-only checkpoints and must remain private.

## Fixed v0.2.1 publication parameters

- Repository: `shubi-shot-director`
- Visibility: `public`
- Default branch: `main`
- Initial version: `v0.2.1`
- License: `MIT`
- Package publication: disabled; keep `package.json` at `private: true` and do not publish to npm.

The only hosting decision left is the repository owner or organization. It does not change the history-free source snapshot.

## Verify the private working repository

Run every gate from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm verify
node .agents/skills/shubi-shot-director/scripts/audit-generic-output.mjs
git diff --check
git status --short
```

`pnpm verify` already performs the dependency-license audit. Run the content scan again with each private project name, alias, or marker supplied only as a command-line deny token:

```powershell
node scripts/audit-public-release.mjs --skip-license-check --deny-token <private-marker-1> --deny-token <private-marker-2>
```

Do not store deny tokens in repository files, shell scripts, reports, fixtures, logs, screenshots, or command transcripts intended for publication.

## Create a history-free source snapshot

Create the release candidate from the final verified commit with `git archive`. Extract it into a clean directory that is not itself a checkout of this internal repository.

```powershell
New-Item -ItemType Directory -Force .shubi-shot | Out-Null
git archive --format=tar HEAD -o .shubi-shot/public-source.tar
```

The archive must contain only committed source files. It must not contain `.git`, ignored runtime state, external profiles, environment files, local scenes, exports, logs, build output, internal branches, or tags.

Inside the extracted snapshot, run:

```powershell
pnpm install --frozen-lockfile
pnpm verify
node scripts/director.mjs doctor
node scripts/director.mjs ensure
node scripts/director.mjs scene submit --file examples/quickstart.scene-submission.json
node scripts/director.mjs snapshot
```

Open the returned loopback URL, wait for the Shot Preview, and complete one real 1920 × 1080 PNG export before accepting the snapshot.

## Initialize the future public repository

Create a new public repository from the verified extracted snapshot, or initialize an orphan-rooted repository whose first commit contains only that snapshot.

Never push the existing internal branches or tags. Do not add the future remote to this internal checkout. Do not publish a package from this repository as part of the source-release procedure.

A future maintainer may initialize the extracted snapshot with the fixed default branch and version:

```powershell
git init -b main
git add .
git commit -m "Initial public release"
git tag v0.2.1
```

After choosing the repository owner, create a public repository named `shubi-shot-director`, then add that new remote from the initialized snapshot. Stop before creating a remote, pushing, opening the public repository, or publishing anything unless those actions are separately authorized.
