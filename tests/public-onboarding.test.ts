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
    expect(readme).toContain("pnpm verify");
    expect(readme).toContain(
      "![Generic Quick Start perspective preview](docs/assets/quickstart-perspective.png)",
    );
    expect(readme).toContain(
      "请使用 shubi-shot-director Skill 创建一个新镜头",
    );
    expect(readme).toContain("actor_generic_1");
    expect(readme).toContain(
      "Verified on Windows 11 Pro, 64-bit (build 26200).",
    );
    expect(readme).toContain(
      "macOS and Linux have not yet been verified for v0.2.1.",
    );
    const approvedOriginTitle = ["売り札", "の塔"].join("");
    expect(readme).toContain(
      `Originally developed during the production of the visual novel “${approvedOriginTitle}”.`,
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
    expect(releaseGuide).toMatch(/new public repository/iu);
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
    expect(releaseGuide).toContain("Initial version: `v0.2.1`");
    expect(releaseGuide).toContain("License: `MIT`");
    expect(releaseGuide).toContain("git init -b main");
    expect(releaseGuide).toMatch(/do not publish to npm/iu);
  });

  it("locks the public package metadata without enabling npm publication", async () => {
    const packageJson = JSON.parse(
      await readRepositoryFile("package.json"),
    ) as {
      name?: unknown;
      version?: unknown;
      private?: unknown;
      license?: unknown;
    };

    expect(packageJson).toMatchObject({
      name: "shubi-shot-director",
      version: "0.2.1",
      private: true,
      license: "MIT",
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
