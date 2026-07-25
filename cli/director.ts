interface CliErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

const LEGACY_TEXT_ERROR: CliErrorEnvelope = {
  ok: false,
  error: {
    code: "HOST_STRUCTURED_INPUT_REQUIRED",
    message:
      "Natural-language requests must be authored by the host as structured submissions.",
  },
};

const CLI_LOAD_ERROR: CliErrorEnvelope = {
  ok: false,
  error: {
    code: "CLI_ERROR",
    message: "The command could not be completed safely.",
  },
};

const output = (value: CliErrorEnvelope): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

const isLegacyTextCommand = (args: readonly string[]): boolean =>
  (args[0] === "shot" &&
    (args[1] === "create" || args[1] === "modify")) ||
  (args[0] === "profile" && args[1] === "resolve");

const runDirectorRuntime = async (
  args: readonly string[],
): Promise<void> => {
  try {
    const boundary = await import("../scripts/process-boundary.mjs");
    try {
      boundary.assertNoForbiddenDirectorArguments(args);
      boundary.assertNoForbiddenDirectorEnvironment(process.env);
    } catch (error) {
      output(
        error instanceof boundary.BoundaryError
          ? {
              ok: false,
              error: {
                code: error.code,
                message: error.message,
              },
            }
          : CLI_LOAD_ERROR,
      );
      process.exitCode = 1;
      return;
    }
    const { runDirector } = await import("./director-runtime");
    await runDirector(args);
  } catch {
    output(CLI_LOAD_ERROR);
    process.exitCode = 1;
  }
};

const args = process.argv.slice(2);
if (isLegacyTextCommand(args)) {
  output(LEGACY_TEXT_ERROR);
  process.exitCode = 1;
} else {
  void runDirectorRuntime(args);
}
