import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const readRepositoryFile = (relativePath: string): Promise<string> =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const readRepositoryBytes = (
  relativePath: string,
): Promise<Buffer> =>
  readFile(new URL(`../${relativePath}`, import.meta.url));

const expectHeadingsInOrder = (
  source: string,
  headings: readonly string[],
): void => {
  let cursor = -1;
  for (const heading of headings) {
    const next = source.indexOf(heading);
    expect(next, `missing heading: ${heading}`).toBeGreaterThan(cursor);
    cursor = next;
  }
};

describe("public onboarding", () => {
  it("gives an unfamiliar developer one complete runnable path", async () => {
    const readme = await readRepositoryFile("README.md");

    expectHeadingsInOrder(readme, [
      "## What it is (and is not)",
      "## Architecture and privacy boundary",
      "## Quick Start preview",
      "## Prerequisites",
      "## Install and start",
      "## Five-minute structured quick start",
      "## Browser controls and PNG export",
      "## Use the Codex Skill",
      "## Copy-paste Codex example",
      "## Save, load, and revisions",
      "## Verification",
      "## External profiles and private data",
      "## Known limits",
      "## Verified platform",
      "## Origin & Maintainer",
      "## License",
    ]);
    expect(readme).toContain("pnpm install --frozen-lockfile");
    expect(readme).toContain("node scripts/director.mjs ensure");
    expect(readme).toContain(
      "examples/quickstart.scene-submission.json",
    );
    expect(readme).toContain("http://127.0.0.1:4317/");
    expect(readme).toContain("scene submit --file");
    expect(readme).toContain("export png --file");
    expect(readme).toMatch(/open connected Shot Preview/iu);
    expect(readme).toMatch(
      /镜头预览[\s\S]*without an activation toggle/iu,
    );
    expect(readme).toMatch(/six[\s-]*button[\s\S]*movement/iu);
    expect(readme).toContain("PageUp");
    expect(readme).toContain("PageDown");
    expect(readme).toContain("pnpm verify");
    expect(readme).toContain(
      "![Generic Quick Start perspective preview](docs/assets/quickstart-perspective.png)",
    );
    expect(readme).toContain(
      "请使用 shubi-shot-director Skill 创建一个新镜头",
    );
    expect(readme).toContain("actor_generic_1");
    expect(readme).toContain(
      "historically been verified on Windows 11 Pro, 64-bit (build 26200).",
    );
    expect(readme).toContain(
      "macOS and Linux are not claimed as verified for v0.9.2.",
    );
    expect(readme).toMatch(/generic limb presence/iu);
    expect(readme).toMatch(
      /separate Codex conversations[\s\S]*separate workspaces/iu,
    );
    expect(readme).toContain("workspace current");
    expect(readme).toMatch(/workspace routing version 1/iu);
    expect(readme).not.toMatch(/Task 6[\s\S]*browser gate[\s\S]*(?:complete|passed)/iu);
    expect(readme).toContain(
      "Originally developed through iterative product work on editable graybox camera previs.",
    );
    expect(readme).toContain(
      "Created and maintained by Shubi, an AI collaborator working alongside her human partner.",
    );
  });

  it("ships the audited generic Quick Start perspective image", async () => {
    const png = await readRepositoryBytes(
      "docs/assets/quickstart-perspective.png",
    );

    expect(png.subarray(0, 8).toString("hex")).toBe(
      "89504e470d0a1a0a",
    );
    expect(png.length).toBeGreaterThan(10_000);
  });

  it("includes an MIT license and a no-history release procedure", async () => {
    const [license, releaseGuide] = await Promise.all([
      readRepositoryFile("LICENSE"),
      readRepositoryFile("docs/public-release.md"),
    ]);

    expect(license).toContain("MIT License");
    expect(license).toContain(
      "Copyright (c) 2026 Shubi Shot Director contributors",
    );
    expect(license).toContain(
      "Permission is hereby granted, free of charge",
    );
    expect(releaseGuide).toContain("git archive");
    expect(releaseGuide).toContain(
      "New-Item -ItemType Directory -Force .shubi-shot",
    );
    expect(releaseGuide).toMatch(/existing public repository/iu);
    expect(releaseGuide).toMatch(/history-free source snapshot/iu);
    expect(releaseGuide).toMatch(
      /never push the existing internal branches or tags/iu,
    );
    expect(releaseGuide).toContain("--deny-token");
    expect(releaseGuide).toContain("--skip-license-check");
    expect(releaseGuide).toMatch(/repository name/iu);
    expect(releaseGuide).toMatch(/repository owner/iu);
    expect(releaseGuide).toContain(
      "Repository: `shubi-shot-director`",
    );
    expect(releaseGuide).toContain("Visibility: `public`");
    expect(releaseGuide).toContain("Default branch: `main`");
    expect(releaseGuide).toContain(
      "## Fixed v0.9.2 publication parameters",
    );
    expect(releaseGuide).toContain("Release version: `v0.9.2`");
    expect(releaseGuide).toContain("git tag -a v0.9.2");
    expect(releaseGuide).not.toContain("git tag v0.4.0");
    expect(releaseGuide).toContain("License: `MIT`");
    expect(releaseGuide).not.toContain("git init -b main");
    expect(releaseGuide).toMatch(/do not publish to npm/iu);
  });

  it("ships reusable v0.9.2 public release notes", async () => {
    const [readme, releaseNotes] = await Promise.all([
      readRepositoryFile("README.md"),
      readRepositoryFile("docs/releases/v0.9.2.md"),
    ]);

    expect(readme).toContain(
      "[v0.9.2 release notes](docs/releases/v0.9.2.md)",
    );
    expect(readme).not.toMatch(/release candidate/iu);
    expect(releaseNotes).toContain("# Shubi Shot Director v0.9.2");
    expect(releaseNotes).toMatch(/left-drag[\s\S]*pan/iu);
    expect(releaseNotes).toMatch(/right-drag[\s\S]*orbit/iu);
    expect(releaseNotes).toMatch(/5 px/iu);
    expect(releaseNotes).toMatch(/SceneSpec/iu);
    expect(releaseNotes).toMatch(/workspace routing:\s*1/iu);
    expect(releaseNotes).toContain("actor.pose-joints");
    expect(releaseNotes).toMatch(/schema version:\s*6/iu);
    expect(releaseNotes).toMatch(/capability contract:\s*2/iu);
  });

  it("locks the public package metadata without enabling npm publication", async () => {
    const packageJson = JSON.parse(
      await readRepositoryFile("package.json"),
    ) as {
      name?: unknown;
      version?: unknown;
      private?: unknown;
      license?: unknown;
      scripts?: Record<string, unknown>;
    };

    expect(packageJson).toMatchObject({
      name: "shubi-shot-director",
      version: "0.9.2",
      private: true,
      license: "MIT",
    });
    expect(packageJson.scripts).toMatchObject({
      test: "pnpm test:parallel && pnpm test:workspace-e2e",
      "test:parallel":
        "vitest run --exclude tests/parallel-workspace-e2e.test.ts",
      "test:workspace-e2e":
        "vitest run tests/parallel-workspace-e2e.test.ts",
    });
  });

  it("keeps generated and private files out while preserving examples", async () => {
    const gitignore = await readRepositoryFile(".gitignore");

    for (const pattern of [
      ".shubi-shot/",
      "/exports/",
      "/scenes/",
      "/screenshots/",
      "/reports/",
      "*.scene.json",
      "!examples/*.scene.json",
      "*.scene-submission.json",
      "!examples/*.scene-submission.json",
      "*.trace",
      "*.log",
      "*.pem",
    ]) {
      expect(gitignore).toContain(pattern);
    }
  });

  it("documents that CLI export comes from the connected browser preview", async () => {
    const [skill, cliContract, visualQa] = await Promise.all([
      readRepositoryFile(
        ".agents/skills/shubi-shot-director/SKILL.md",
      ),
      readRepositoryFile(
        ".agents/skills/shubi-shot-director/references/cli-contract.md",
      ),
      readRepositoryFile(
        ".agents/skills/shubi-shot-director/references/visual-qa.md",
      ),
    ]);

    for (const source of [skill, cliContract, visualQa]) {
      expect(source).toMatch(/open connected Shot Preview/iu);
      expect(source).toMatch(/browser-rendered final camera/iu);
    }
    expect(skill).toContain('inputContract: "structured-only"');
    expect(skill).toContain('credentialPolicy: "forbidden"');
  });
});
