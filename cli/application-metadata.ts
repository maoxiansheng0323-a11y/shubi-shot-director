import { readFileSync } from "node:fs";

const semverPattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export const parseApplicationVersion = (input: unknown): string => {
  if (
    typeof input !== "object" ||
    input === null ||
    !("version" in input) ||
    typeof input.version !== "string" ||
    !semverPattern.test(input.version)
  ) {
    throw new Error("Application package metadata is invalid.");
  }
  return input.version;
};

const readPackageText = (): string =>
  readFileSync(new URL("../package.json", import.meta.url), "utf8");

export const loadApplicationVersion = (
  readPackageMetadata: () => string = readPackageText,
): string => {
  try {
    return parseApplicationVersion(
      JSON.parse(readPackageMetadata()) as unknown,
    );
  } catch {
    throw new Error("Application package metadata is invalid.");
  }
};

export const APPLICATION_VERSION =
  loadApplicationVersion();
