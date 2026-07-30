import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = path.resolve(
  path.dirname(scriptPath),
  "..",
);
const maxTextBytes = 2 * 1024 * 1024;
const allowedDependencyLicenses = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
]);
const sourceSnapshotExcludedDirectories = new Set([
  ".git",
  ".shubi-shot",
  ".tools",
  ".vite",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

const normalizeDisplayPath = (displayPath) =>
  displayPath.replaceAll("\\", "/").replace(/^\.\//u, "");

const finding = (code, file, extra = {}) => ({
  code,
  ...(file ? { file } : {}),
  ...extra,
});

const isRuntimeArtifactPath = (displayPath) =>
  /\.(?:json|log|txt|png)$/iu.test(displayPath) ||
  /(?:^|\/)(?:artifacts?|exports?|reports?|screenshots?)(?:\/|$)/iu.test(
    displayPath,
  );

export const auditText = (
  displayPath,
  text,
  denyTokens = [],
) => {
  const file = normalizeDisplayPath(displayPath);
  const findings = [];
  const rules = [
    {
      code: "MACHINE_ABSOLUTE_PATH",
      pattern:
        /(?:^|[\s"'`(])(?:[a-z]:[\\/]|\\\\[^\\/\s]+[\\/][^\\/\s]+[\\/]|\/(?:users|home)\/[^/\s"'`]+\/)/imu,
    },
    {
      code: "FILE_URI",
      pattern: /\bfile:\/\//iu,
    },
    {
      code: "PRIVATE_KEY",
      pattern:
        /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
    },
    {
      code: "API_SECRET",
      pattern:
        /(?:\b(?:sk|rk|pk)-(?:proj-)?[a-z0-9_-]{20,}\b|\bgh[pousr]_[a-z0-9]{20,}\b|\bgithub_pat_[a-z0-9_]{20,}\b|\bAKIA[0-9A-Z]{16}\b|\bxox[baprs]-[a-z0-9-]{20,}\b)/iu,
    },
  ];

  for (const rule of rules) {
    if (rule.pattern.test(text)) {
      findings.push(finding(rule.code, file));
    }
  }

  if (
    isRuntimeArtifactPath(file) &&
    /"(?:sourcePath|sourceFile|externalPath|blueprintFile)"\s*:/u.test(
      text,
    )
  ) {
    findings.push(finding("BLUEPRINT_PROVENANCE_FIELD", file));
  }

  const folded = text.normalize("NFKC").toLocaleLowerCase();
  for (let index = 0; index < denyTokens.length; index += 1) {
    const token = denyTokens[index]
      .normalize("NFKC")
      .toLocaleLowerCase();
    if (token && folded.includes(token)) {
      findings.push(
        finding("DENY_TOKEN_PRESENT", file, {
          tokenIndex: index + 1,
        }),
      );
    }
  }

  return findings;
};

export const auditRepositoryPath = (displayPath) => {
  const file = normalizeDisplayPath(displayPath);
  const folded = file.toLocaleLowerCase();
  if (
    folded === ".env.example" ||
    folded.startsWith("examples/")
  ) {
    return [];
  }

  const unsafe =
    /(?:^|\/)\.env(?:\.|$)/u.test(folded) ||
    /(?:^|\/)(?:[^/]+\.)?project-profile\.json$/u.test(folded) ||
    folded.startsWith(".shubi-shot/") ||
    /(?:^|\/)(?:dist|coverage|test-results|playwright-report)(?:\/|$)/u.test(
      folded,
    ) ||
    /(?:^|\/)(?:exports?|logs?|scenes?|screenshots?|artifacts?)(?:\/|$)/u.test(
      folded,
    ) ||
    /\.(?:log|scene\.json|zip|7z|rar|tar|tgz|pem|key|p12|pfx)$/u.test(
      folded,
    );

  return unsafe
    ? [finding("UNSAFE_REPOSITORY_PATH", file)]
    : [];
};

export const auditPackageMetadata = (value) => {
  const packageJson =
    typeof value === "object" && value !== null
      ? value
      : {};
  const findings = [];
  if (packageJson.private !== true) {
    findings.push(finding("PACKAGE_PUBLICATION_NOT_GUARDED"));
  }
  if (packageJson.license !== "MIT") {
    findings.push(finding("PACKAGE_LICENSE_INVALID"));
  }
  const nodeEngine = packageJson.engines?.node;
  if (
    typeof nodeEngine !== "string" ||
    !/^>=22\.12(?:\.0)?$/u.test(nodeEngine)
  ) {
    findings.push(finding("PACKAGE_NODE_ENGINE_INVALID"));
  }
  if (
    typeof packageJson.packageManager !== "string" ||
    !/^pnpm@11(?:\.|$)/u.test(packageJson.packageManager)
  ) {
    findings.push(finding("PACKAGE_MANAGER_INVALID"));
  }
  return findings;
};

export const auditLicenseNames = (names) => {
  const findings = [];
  for (const name of [...new Set(names)].sort()) {
    if (!allowedDependencyLicenses.has(name)) {
      findings.push(
        finding("DEPENDENCY_LICENSE_REVIEW_REQUIRED", undefined, {
          detail: name,
        }),
      );
    }
  }
  return findings;
};

const parseArguments = (args) => {
  const options = {
    root: defaultRepositoryRoot,
    denyTokens: [],
    checkLicenses: true,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--root" || argument === "--deny-token") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("AUDIT_ARGUMENT_INVALID");
      }
      if (argument === "--root") {
        options.root = path.resolve(value);
      } else {
        options.denyTokens.push(value);
      }
      index += 1;
      continue;
    }
    if (argument === "--skip-license-check") {
      options.checkLicenses = false;
      continue;
    }
    throw new Error("AUDIT_ARGUMENT_INVALID");
  }
  return options;
};

const listGitRepositoryFiles = async (repositoryRoot) => {
  const { stdout } = await execFileAsync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ],
    {
      cwd: repositoryRoot,
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map(normalizeDisplayPath);
};

const isSamePath = (left, right) => {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  if (process.platform === "win32") {
    return (
      normalizedLeft.toLocaleLowerCase() ===
      normalizedRight.toLocaleLowerCase()
    );
  }
  return normalizedLeft === normalizedRight;
};

const isGitRepositoryRoot = async (repositoryRoot) => {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--show-toplevel"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      },
    );
    return isSamePath(stdout.trim(), repositoryRoot);
  } catch {
    return false;
  }
};

const listSourceSnapshotFiles = async (repositoryRoot) => {
  const files = [];
  const walk = async (absoluteDirectory, relativeDirectory) => {
    const entries = await readdir(absoluteDirectory, {
      withFileTypes: true,
    });
    entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? path.join(relativeDirectory, entry.name)
        : entry.name;
      if (entry.isDirectory()) {
        if (
          sourceSnapshotExcludedDirectories.has(
            entry.name.toLocaleLowerCase(),
          )
        ) {
          continue;
        }
        await walk(
          path.join(absoluteDirectory, entry.name),
          relativePath,
        );
        continue;
      }
      if (entry.isFile()) {
        files.push(normalizeDisplayPath(relativePath));
      }
    }
  };

  await walk(repositoryRoot, "");
  return files;
};

const listRepositoryFiles = async (repositoryRoot) =>
  (await isGitRepositoryRoot(repositoryRoot))
    ? listGitRepositoryFiles(repositoryRoot)
    : listSourceSnapshotFiles(repositoryRoot);

const readDependencyLicenseNames = async (repositoryRoot) => {
  const pnpmEntry = process.env.npm_execpath;
  if (!pnpmEntry) {
    throw new Error("DEPENDENCY_LICENSE_AUDIT_FAILED");
  }
  const { stdout } = await execFileAsync(
    process.execPath,
    [pnpmEntry, "licenses", "list", "--prod", "--json"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const value = JSON.parse(stdout);
  if (typeof value !== "object" || value === null) {
    throw new Error("DEPENDENCY_LICENSE_AUDIT_FAILED");
  }
  return Object.keys(value).sort();
};

export const runRepositoryAudit = async (options) => {
  const repositoryRoot = path.resolve(options.root);
  const files = await listRepositoryFiles(repositoryRoot);
  const findings = [];

  for (const displayPath of files) {
    findings.push(...auditRepositoryPath(displayPath));
    const absolutePath = path.join(repositoryRoot, displayPath);
    let info;
    try {
      info = await stat(absolutePath);
    } catch {
      findings.push(finding("FILE_UNREADABLE", displayPath));
      continue;
    }
    if (!info.isFile()) {
      continue;
    }
    if (info.size > maxTextBytes) {
      findings.push(
        finding("OVERSIZED_REPOSITORY_FILE", displayPath),
      );
      continue;
    }
    const bytes = await readFile(absolutePath);
    const binaryText =
      bytes.includes(0) && displayPath.toLocaleLowerCase().endsWith(".png")
        ? bytes.toString("latin1")
        : null;
    if (bytes.includes(0) && binaryText === null) continue;
    findings.push(
      ...auditText(
        displayPath,
        binaryText ?? bytes.toString("utf8"),
        options.denyTokens,
      ),
    );
  }

  const packagePath = path.join(repositoryRoot, "package.json");
  try {
    const packageJson = JSON.parse(
      await readFile(packagePath, "utf8"),
    );
    findings.push(...auditPackageMetadata(packageJson));
  } catch {
    findings.push(finding("PACKAGE_METADATA_INVALID"));
  }

  let dependencyLicenseNames = [];
  if (options.checkLicenses) {
    try {
      dependencyLicenseNames = await readDependencyLicenseNames(
        repositoryRoot,
      );
      findings.push(...auditLicenseNames(dependencyLicenseNames));
    } catch {
      findings.push(finding("DEPENDENCY_LICENSE_AUDIT_FAILED"));
    }
  }

  return {
    ok: findings.length === 0,
    scannedFileCount: files.length,
    dependencyLicenseNames,
    findings,
  };
};

const isMain =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]).toLocaleLowerCase() ===
    path.resolve(scriptPath).toLocaleLowerCase();

if (isMain) {
  try {
    const result = await runRepositoryAudit(
      parseArguments(process.argv.slice(2)),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch {
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        scannedFileCount: 0,
        dependencyLicenseNames: [],
        findings: [{ code: "PUBLIC_AUDIT_FAILED" }],
      })}\n`,
    );
    process.exitCode = 1;
  }
}
