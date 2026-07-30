#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..", "..", "..");
const maxTextBytes = 2 * 1024 * 1024;

const args = process.argv.slice(2);
const explicitFiles = [];
const denyTokens = [];
let artifactMode = false;

for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--artifact") {
    artifactMode = true;
    continue;
  }
  if (argument === "--file" || argument === "--deny-token") {
    const value = args[index + 1];
    if (!value) {
      throw new Error(`${argument} requires a value.`);
    }
    (argument === "--file" ? explicitFiles : denyTokens).push(value);
    index += 1;
    continue;
  }
  throw new Error("Unknown audit option.");
}

const trackedFiles = async () => {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repositoryRoot, encoding: "buffer" },
  );
  return stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((relativePath) => ({
      absolutePath: path.join(repositoryRoot, relativePath),
      displayPath: relativePath.replaceAll("\\", "/"),
    }));
};

const selectedFiles =
  explicitFiles.length > 0
    ? explicitFiles.map((filePath, index) => ({
        absolutePath: path.resolve(filePath),
        displayPath: `artifact-${index + 1}`,
      }))
    : await trackedFiles();

const rules = [
  {
    code: "MACHINE_ABSOLUTE_PATH",
    pattern: /(?:^|[\s"'(])(?:[a-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:users|home)\/[^/\s]+\/)/imu,
  },
  {
    code: "FILE_URI",
    pattern: /\bfile:\/\//iu,
  },
  {
    code: "PRIVATE_KEY",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  },
  {
    code: "API_SECRET",
    pattern: /\b(?:sk|rk|pk)-(?:proj-)?[a-z0-9_-]{20,}\b/iu,
  },
];

if (artifactMode) {
  rules.push({
    code: "PRIVATE_PROVENANCE_FIELD",
    pattern:
      /"(?:rawPrompt|originalPrompt|sourcePrompt|profilePath|externalProfilePath|privateAlias|sourcePath|sourceFile|externalPath|blueprintFile)"\s*:/u,
  });
}

const findings = [];
for (const file of selectedFiles) {
  if (
    file.displayPath.endsWith(
      ".agents/skills/shubi-shot-director/scripts/audit-generic-output.mjs",
    )
  ) {
    continue;
  }
  let info;
  try {
    info = await stat(file.absolutePath);
  } catch {
    findings.push({ code: "FILE_UNREADABLE", file: file.displayPath });
    continue;
  }
  if (!info.isFile() || info.size > maxTextBytes) {
    continue;
  }

  const bytes = await readFile(file.absolutePath);
  if (bytes.includes(0) && !artifactMode) {
    continue;
  }
  const text = bytes.toString(bytes.includes(0) ? "latin1" : "utf8");
  for (const rule of rules) {
    if (rule.pattern.test(text)) {
      findings.push({ code: rule.code, file: file.displayPath });
    }
  }
  const folded = text.toLocaleLowerCase();
  for (let index = 0; index < denyTokens.length; index += 1) {
    const token = denyTokens[index].normalize("NFKC").toLocaleLowerCase();
    if (token && folded.includes(token)) {
      findings.push({
        code: "DENY_TOKEN_PRESENT",
        file: file.displayPath,
        tokenIndex: index + 1,
      });
    }
  }
}

const result = {
  ok: findings.length === 0,
  scannedFileCount: selectedFiles.length,
  findings,
};
process.stdout.write(`${JSON.stringify(result)}\n`);
if (!result.ok) {
  process.exitCode = 1;
}
