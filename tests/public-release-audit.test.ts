import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface AuditFinding {
  code: string;
  file?: string;
  tokenIndex?: number;
  detail?: string;
}

interface PublicReleaseAuditModule {
  auditText(
    displayPath: string,
    text: string,
    denyTokens?: readonly string[],
  ): AuditFinding[];
  auditRepositoryPath(displayPath: string): AuditFinding[];
  auditPackageMetadata(value: unknown): AuditFinding[];
  auditLicenseNames(names: readonly string[]): AuditFinding[];
  runRepositoryAudit(options: {
    root: string;
    denyTokens: readonly string[];
    checkLicenses: boolean;
  }): Promise<{
    ok: boolean;
    scannedFileCount: number;
    dependencyLicenseNames: string[];
    findings: AuditFinding[];
  }>;
}

const loadAudit = async (): Promise<PublicReleaseAuditModule> => {
  const scriptUrl = new URL(
    "../scripts/audit-public-release.mjs",
    import.meta.url,
  );
  return (await import(
    `${scriptUrl.href}?test=${Date.now()}`
  )) as PublicReleaseAuditModule;
};

describe("public release audit", () => {
  it("keeps the v0.9.4 static blocking contract generic and publication-safe", async () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const releasePath = path.join(root, "docs", "releases", "v0.9.4.md");
    const [packageSource, skillSource, releaseSource] = await Promise.all([
      readFile(path.join(root, "package.json"), "utf8"),
      readFile(
        path.join(
          root,
          ".agents",
          "skills",
          "shubi-shot-director",
          "SKILL.md",
        ),
        "utf8",
      ),
      readFile(releasePath, "utf8").catch(() => ""),
    ]);
    const { auditPackageMetadata, auditText } = await loadAudit();
    const packageMetadata = JSON.parse(packageSource) as Record<string, unknown>;

    expect(packageMetadata.version).toBe("0.9.4");
    expect(auditPackageMetadata(packageMetadata)).toEqual([]);
    expect(releaseSource).not.toBe("");
    expect(auditText("SKILL.md", skillSource)).toEqual([]);
    expect(auditText("docs/releases/v0.9.4.md", releaseSource)).toEqual([]);
  });

  it("accepts generic repository text", async () => {
    const { auditText } = await loadAudit();

    expect(
      auditText(
        "docs/architecture.md",
        "Loopback runtime with generic actors and structured input.",
      ),
    ).toEqual([]);
  });

  it("detects machine paths and common secret shapes without echoing values", async () => {
    const { auditText } = await loadAudit();
    const machinePath = [
      "C:",
      "Users",
      "person",
      "private.json",
    ].join("\\");
    const privateKey = `-----BEGIN ${"PRIVATE"} KEY-----`;
    const apiSecret = `sk-${"a".repeat(24)}`;

    const findings = auditText(
      "docs/private-example.md",
      [machinePath, privateKey, apiSecret].join("\n"),
    );

    expect(findings.map(({ code }) => code)).toEqual([
      "MACHINE_ABSOLUTE_PATH",
      "PRIVATE_KEY",
      "API_SECRET",
    ]);
    expect(JSON.stringify(findings)).not.toContain(machinePath);
    expect(JSON.stringify(findings)).not.toContain(apiSecret);
  });

  it("rejects blueprint path fields and arbitrary drive paths in runtime artifacts", async () => {
    const { auditText } = await loadAudit();
    const marker = ["D:", "workspace", "actor.json"].join("\\");
    const findings = auditText(
      "fixtures/runtime.scene.json",
      JSON.stringify({
        sourcePath: marker,
        sourceFile: "actor.json",
        externalPath: marker,
        blueprintFile: "actor.json",
      }),
    );

    expect(findings.map(({ code }) => code)).toEqual([
      "MACHINE_ABSOLUTE_PATH",
      "BLUEPRINT_PROVENANCE_FIELD",
    ]);
    expect(JSON.stringify(findings)).not.toContain(marker);
  });

  it("detects caller-supplied private markers by index only", async () => {
    const { auditText } = await loadAudit();
    const privateMarker = ["private", "project", "marker"].join("-");

    const findings = auditText(
      "examples/scene.json",
      `generic text ${privateMarker}`,
      [privateMarker],
    );

    expect(findings).toEqual([
      {
        code: "DENY_TOKEN_PRESENT",
        file: "examples/scene.json",
        tokenIndex: 1,
      },
    ]);
    expect(JSON.stringify(findings)).not.toContain(privateMarker);
  });

  it("rejects unsafe repository paths while allowing generic examples", async () => {
    const { auditRepositoryPath } = await loadAudit();
    const blocked = [
      ".env",
      ".env.production",
      "project-profile.json",
      "example.project-profile.json",
      ".shubi-shot/runtime.json",
      "dist/index.html",
      "coverage/index.html",
      "test-results/report.json",
      "playwright-report/index.html",
      "exports/perspective.png",
      "logs/runtime.log",
      "scenes/private.scene.json",
      "backup/archive.zip",
      "certificates/private.pem",
    ];

    for (const displayPath of blocked) {
      expect(auditRepositoryPath(displayPath)).toEqual([
        {
          code: "UNSAFE_REPOSITORY_PATH",
          file: displayPath,
        },
      ]);
    }

    expect(auditRepositoryPath(".env.example")).toEqual([]);
    expect(
      auditRepositoryPath(
        "examples/quickstart.scene-submission.json",
      ),
    ).toEqual([]);
    expect(auditRepositoryPath("README.md")).toEqual([]);
    expect(
      auditRepositoryPath("docs/releases/v0.5.0.md"),
    ).toEqual([]);
  });

  it("requires publication-safe package metadata", async () => {
    const { auditPackageMetadata } = await loadAudit();
    const valid = {
      name: "shubi-shot-director",
      version: "0.5.0",
      private: true,
      license: "MIT",
      engines: { node: ">=22.12" },
      packageManager: "pnpm@11.9.0",
    };

    expect(auditPackageMetadata(valid)).toEqual([]);
    expect(
      auditPackageMetadata({
        ...valid,
        private: false,
        license: "UNLICENSED",
        engines: {},
        packageManager: "npm@11",
      }).map(({ code }) => code),
    ).toEqual([
      "PACKAGE_PUBLICATION_NOT_GUARDED",
      "PACKAGE_LICENSE_INVALID",
      "PACKAGE_NODE_ENGINE_INVALID",
      "PACKAGE_MANAGER_INVALID",
    ]);
  });

  it("allows only permissive production dependency licenses", async () => {
    const { auditLicenseNames } = await loadAudit();

    expect(
      auditLicenseNames([
        "MIT",
        "Apache-2.0",
        "BSD-2-Clause",
        "BSD-3-Clause",
        "ISC",
      ]),
    ).toEqual([]);
    expect(auditLicenseNames(["MIT", "GPL-3.0-only"])).toEqual([
      {
        code: "DEPENDENCY_LICENSE_REVIEW_REQUIRED",
        detail: "GPL-3.0-only",
      },
    ]);
  });

  it("audits a source snapshot without git metadata", async () => {
    const snapshotRoot = await mkdtemp(
      path.join(tmpdir(), "shubi-shot-public-audit-"),
    );
    const machinePath = [
      "C:",
      "Users",
      "person",
      "private.json",
    ].join(String.fromCharCode(92));

    try {
      await mkdir(path.join(snapshotRoot, "docs"), {
        recursive: true,
      });
      await mkdir(path.join(snapshotRoot, "node_modules", "ignored"), {
        recursive: true,
      });
      await mkdir(path.join(snapshotRoot, "dist"), {
        recursive: true,
      });
      await writeFile(
        path.join(snapshotRoot, "package.json"),
        JSON.stringify({
          name: "shubi-shot-director",
          private: true,
          license: "MIT",
          engines: { node: ">=22.12" },
          packageManager: "pnpm@11.9.0",
        }),
      );
      await writeFile(
        path.join(snapshotRoot, "docs", "overview.md"),
        "Generic structured-only runtime.\n",
      );
      await writeFile(
        path.join(
          snapshotRoot,
          "node_modules",
          "ignored",
          "private.txt",
        ),
        `${machinePath}${String.fromCharCode(10)}`,
      );
      await writeFile(
        path.join(snapshotRoot, "dist", "bundle.js"),
        `${machinePath}${String.fromCharCode(10)}`,
      );

      const { runRepositoryAudit } = await loadAudit();
      const result = await runRepositoryAudit({
        root: snapshotRoot,
        denyTokens: [],
        checkLicenses: false,
      });

      expect(result).toEqual({
        ok: true,
        scannedFileCount: 2,
        dependencyLicenseNames: [],
        findings: [],
      });
    } finally {
      await rm(snapshotRoot, { recursive: true, force: true });
    }
  });
});
