import {
  assertNoForbiddenDirectorArguments,
  assertNoForbiddenDirectorEnvironment,
  BoundaryError,
} from "../scripts/process-boundary.mjs";

const start = async (): Promise<void> => {
  assertNoForbiddenDirectorArguments(process.argv.slice(2));
  assertNoForbiddenDirectorEnvironment(process.env);
  const production = process.argv.includes("--production");
  const { startServer } = await import("./runtime");
  await startServer({ production });
};

void start().catch((error: unknown) => {
  if (error instanceof BoundaryError) {
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        error: {
          code: error.code,
          message: error.message,
        },
      })}\n`,
    );
    process.exitCode = 1;
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
