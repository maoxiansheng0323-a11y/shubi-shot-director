import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  open,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const MAX_JSON_INPUT_BYTES = 1024 * 1024;
export const MAX_EXPORT_PIXELS = 7680 * 4320;

export class CliCommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CliCommandError";
    this.code = code;
  }
}

export interface FileCommandOptions {
  file: string;
  force: boolean;
}

export interface ExportCommandOptions extends FileCommandOptions {
  width: number;
  height: number;
}

const requireOptionValue = (
  args: string[],
  index: number,
): string => {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new CliCommandError(
      "CLI_ARGUMENT_REQUIRED",
      "A required command option is missing its value.",
    );
  }
  return value;
};

const assignOnce = (
  current: string | undefined,
  value: string,
): string => {
  if (current !== undefined) {
    throw new CliCommandError(
      "CLI_ARGUMENT_DUPLICATE",
      "A command option may only be supplied once.",
    );
  }
  return value;
};

export const assertNoArguments = (args: string[]): void => {
  if (args.length !== 0) {
    throw new CliCommandError(
      "CLI_UNKNOWN_ARGUMENT",
      "This command does not accept additional arguments.",
    );
  }
};

export const parseFileCommandOptions = (
  args: string[],
  options: {
    allowForce?: boolean;
  } = {},
): FileCommandOptions => {
  let file: string | undefined;
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--file") {
      file = assignOnce(file, requireOptionValue(args, index));
      index += 1;
      continue;
    }
    if (argument === "--force" && options.allowForce === true) {
      if (force) {
        throw new CliCommandError(
          "CLI_ARGUMENT_DUPLICATE",
          "A command option may only be supplied once.",
        );
      }
      force = true;
      continue;
    }
    throw new CliCommandError(
      "CLI_UNKNOWN_ARGUMENT",
      "Unknown command option.",
    );
  }

  if (file === undefined || file.trim().length === 0) {
    throw new CliCommandError(
      "CLI_ARGUMENT_REQUIRED",
      "--file is required and must not be empty.",
    );
  }
  return { file, force };
};

const parseDimension = (
  source: string | undefined,
  option: "--width" | "--height",
): number => {
  if (source === undefined) {
    throw new CliCommandError(
      "CLI_ARGUMENT_REQUIRED",
      `${option} is required.`,
    );
  }
  if (!/^[1-9][0-9]*$/.test(source)) {
    throw new CliCommandError(
      "CLI_ARGUMENT_INVALID",
      `${option} must be a positive integer.`,
    );
  }
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value < 16 || value > 7680) {
    throw new CliCommandError(
      "CLI_ARGUMENT_INVALID",
      `${option} is outside the supported range.`,
    );
  }
  return value;
};

export const parseExportCommandOptions = (
  args: string[],
): ExportCommandOptions => {
  let file: string | undefined;
  let widthSource: string | undefined;
  let heightSource: string | undefined;
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (
      argument === "--file" ||
      argument === "--width" ||
      argument === "--height"
    ) {
      const value = requireOptionValue(args, index);
      if (argument === "--file") {
        file = assignOnce(file, value);
      } else if (argument === "--width") {
        widthSource = assignOnce(widthSource, value);
      } else {
        heightSource = assignOnce(heightSource, value);
      }
      index += 1;
      continue;
    }
    if (argument === "--force") {
      if (force) {
        throw new CliCommandError(
          "CLI_ARGUMENT_DUPLICATE",
          "A command option may only be supplied once.",
        );
      }
      force = true;
      continue;
    }
    throw new CliCommandError(
      "CLI_UNKNOWN_ARGUMENT",
      "Unknown export option.",
    );
  }

  if (file === undefined || file.trim().length === 0) {
    throw new CliCommandError(
      "CLI_ARGUMENT_REQUIRED",
      "--file is required and must not be empty.",
    );
  }
  const width = parseDimension(widthSource, "--width");
  const height = parseDimension(heightSource, "--height");
  if (width * height > MAX_EXPORT_PIXELS) {
    throw new CliCommandError(
      "CLI_ARGUMENT_INVALID",
      "The requested image contains too many pixels.",
    );
  }
  return { file, width, height, force };
};

export const parseCompositionInspectOptions = (args: string[]): void => {
  if (args.length !== 1 || args[0] !== "--json") {
    throw new CliCommandError(
      "CLI_ARGUMENT_REQUIRED",
      "composition inspect requires --json.",
    );
  }
};

const isNodeError = (
  error: unknown,
  code: string,
): boolean =>
  error instanceof Error &&
  "code" in error &&
  error.code === code;

export const readBoundedJsonFile = async (
  filePath: string,
  maxBytes = MAX_JSON_INPUT_BYTES,
): Promise<unknown> => {
  let handle;
  try {
    handle = await open(path.resolve(filePath), "r");
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new CliCommandError(
        "CLI_INPUT_FILE_INVALID",
        "The supplied input is not a regular file.",
      );
    }
    if (metadata.size > maxBytes) {
      throw new CliCommandError(
        "CLI_INPUT_FILE_TOO_LARGE",
        "The supplied JSON file exceeds the size limit.",
      );
    }
    const source = await handle.readFile();
    if (source.byteLength > maxBytes) {
      throw new CliCommandError(
        "CLI_INPUT_FILE_TOO_LARGE",
        "The supplied JSON file exceeds the size limit.",
      );
    }
    try {
      return JSON.parse(source.toString("utf8")) as unknown;
    } catch {
      throw new CliCommandError(
        "CLI_INPUT_FILE_INVALID_JSON",
        "The supplied input file is not valid JSON.",
      );
    }
  } catch (error) {
    if (error instanceof CliCommandError) {
      throw error;
    }
    if (isNodeError(error, "ENOENT")) {
      throw new CliCommandError(
        "CLI_INPUT_FILE_NOT_FOUND",
        "The supplied input file was not found.",
      );
    }
    throw new CliCommandError(
      "CLI_INPUT_FILE_READ_FAILED",
      "The supplied input file could not be read safely.",
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
};

const targetExists = async (targetFile: string): Promise<boolean> => {
  try {
    await lstat(targetFile);
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
};

export const writeFileAtomically = async (
  filePath: string,
  data: string | Uint8Array,
  options: {
    overwrite?: boolean;
    existsCode: string;
    writeFailedCode: string;
  },
): Promise<{ bytes: number; overwritten: boolean }> => {
  const targetFile = path.resolve(filePath);
  const overwrite = options.overwrite === true;
  let existed: boolean;
  let temporaryFile: string | null = null;

  try {
    existed = await targetExists(targetFile);
    if (existed && !overwrite) {
      throw new CliCommandError(
        options.existsCode,
        "The output file already exists; pass --force to replace it.",
      );
    }

    temporaryFile = path.join(
      path.dirname(targetFile),
      `.shubi-shot-${process.pid}-${randomUUID()}.tmp`,
    );
    await writeFile(temporaryFile, data, {
      flag: "wx",
      mode: 0o600,
    });

    if (overwrite) {
      await rename(temporaryFile, targetFile);
      temporaryFile = null;
    } else {
      // Publishing a hard link is an atomic create-if-absent operation. The
      // temporary file lives in the same directory, so it cannot cross devices.
      await link(temporaryFile, targetFile);
      await unlink(temporaryFile);
      temporaryFile = null;
    }

    return {
      bytes:
        typeof data === "string"
          ? Buffer.byteLength(data, "utf8")
          : data.byteLength,
      overwritten: existed,
    };
  } catch (error) {
    if (error instanceof CliCommandError) {
      throw error;
    }
    if (isNodeError(error, "EEXIST")) {
      throw new CliCommandError(
        options.existsCode,
        "The output file already exists; pass --force to replace it.",
      );
    }
    throw new CliCommandError(
      options.writeFailedCode,
      "The output file could not be written safely.",
    );
  } finally {
    if (temporaryFile !== null) {
      await unlink(temporaryFile).catch(() => undefined);
    }
  }
};
