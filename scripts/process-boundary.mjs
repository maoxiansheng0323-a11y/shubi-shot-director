import process from "node:process";

const CREDENTIAL_OPTION_TOKENS = new Set([
  "apikey",
  "key",
  "token",
  "auth",
  "authorization",
  "credential",
  "credentials",
  "password",
  "bearer",
  "secret",
]);
const COMPACT_CREDENTIAL_OPTION_NAMES = new Set([
  "requiresapikey",
  "apikey",
  "clientkey",
  "runtimeauth",
  "authheader",
  "clienttoken",
  "apitoken",
  "accesstoken",
  "bearertoken",
  "refreshtoken",
  "sessiontoken",
  "authtoken",
  "runtimetoken",
  "clientsecret",
  "apisecret",
  "accesssecret",
  "authsecret",
  "modelsecret",
  "providersecret",
  "runtimesecret",
  "customsecret",
  "custombearer",
  "token",
  "authorization",
  "credential",
  "credentials",
  "password",
  "bearer",
  "secret",
]);
const MODEL_CONFIGURATION_OPTION_TOKENS = new Set([
  "model",
  "provider",
  "endpoint",
]);
const MODEL_CONFIGURATION_CONTEXT_TOKENS = new Set([
  "config",
  "configuration",
  "settings",
  "options",
  "url",
  "service",
  "name",
  "id",
  "address",
  "integration",
  "model",
  "provider",
  "endpoint",
]);
const COMPACT_MODEL_CONFIGURATION_OPTION_NAMES = new Set(["baseurl"]);
for (const token of MODEL_CONFIGURATION_OPTION_TOKENS) {
  COMPACT_MODEL_CONFIGURATION_OPTION_NAMES.add(token);
  for (const context of MODEL_CONFIGURATION_CONTEXT_TOKENS) {
    COMPACT_MODEL_CONFIGURATION_OPTION_NAMES.add(`${token}${context}`);
    COMPACT_MODEL_CONFIGURATION_OPTION_NAMES.add(`${context}${token}`);
  }
}

const BOUNDARY_MESSAGES = {
  CREDENTIAL_ARGUMENT_FORBIDDEN:
    "Credential arguments are forbidden.",
  MODEL_CONFIGURATION_FORBIDDEN:
    "Model configuration arguments are forbidden.",
  CREDENTIAL_ENVIRONMENT_FORBIDDEN:
    "Director credential environment variables are forbidden.",
  MODEL_CONFIGURATION_ENVIRONMENT_FORBIDDEN:
    "Director model configuration environment variables are forbidden.",
};

export class BoundaryError extends Error {
  constructor(code, message = BOUNDARY_MESSAGES[code]) {
    super(message);
    this.name = "BoundaryError";
    this.code = code;
  }
}

const optionNameFromArgument = (argument) => {
  if (!argument.startsWith("--")) {
    return undefined;
  }
  const inlineValueIndex = argument.indexOf("=");
  const option =
    inlineValueIndex === -1
      ? argument
      : argument.slice(0, inlineValueIndex);
  return option.replace(/^-+/, "");
};

const normalizeOptionName = (optionName) =>
  optionName.replace(/[^a-z0-9]/gi, "").toLowerCase();

const tokenizeOptionName = (optionName) =>
  optionName
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());

const isCredentialOptionName = (optionName, tokens) => {
  const normalized = normalizeOptionName(optionName);
  return (
    COMPACT_CREDENTIAL_OPTION_NAMES.has(normalized) ||
    tokens.some((token) => CREDENTIAL_OPTION_TOKENS.has(token))
  );
};

const isModelConfigurationOptionName = (optionName, tokens) => {
  const normalized = normalizeOptionName(optionName);
  if (
    COMPACT_MODEL_CONFIGURATION_OPTION_NAMES.has(normalized) ||
    (tokens.includes("base") && tokens.includes("url"))
  ) {
    return true;
  }
  return tokens.some(
    (token) =>
      MODEL_CONFIGURATION_OPTION_TOKENS.has(token) &&
      (tokens.length === 1 ||
        tokens.some(
          (candidate) =>
            candidate !== token &&
            MODEL_CONFIGURATION_CONTEXT_TOKENS.has(candidate),
        )),
  );
};

export const assertNoForbiddenDirectorArguments = (args) => {
  for (const argument of args) {
    const optionName = optionNameFromArgument(argument);
    if (optionName === undefined) {
      continue;
    }
    const tokens = tokenizeOptionName(optionName);
    if (isCredentialOptionName(optionName, tokens)) {
      throw new BoundaryError("CREDENTIAL_ARGUMENT_FORBIDDEN");
    }
    if (isModelConfigurationOptionName(optionName, tokens)) {
      throw new BoundaryError("MODEL_CONFIGURATION_FORBIDDEN");
    }
  }
};

export const assertNoForbiddenDirectorEnvironment = (
  environment = process.env,
) => {
  if (
    environment.SHUBI_SHOT_API_KEY !== undefined ||
    environment.SHUBI_SHOT_TOKEN !== undefined ||
    environment.SHUBI_SHOT_AUTHORIZATION !== undefined ||
    environment.SHUBI_SHOT_SECRET !== undefined
  ) {
    throw new BoundaryError("CREDENTIAL_ENVIRONMENT_FORBIDDEN");
  }
  if (
    environment.SHUBI_SHOT_MODEL !== undefined ||
    environment.SHUBI_SHOT_PROVIDER !== undefined ||
    environment.SHUBI_SHOT_BASE_URL !== undefined ||
    environment.SHUBI_SHOT_ENDPOINT !== undefined
  ) {
    throw new BoundaryError(
      "MODEL_CONFIGURATION_ENVIRONMENT_FORBIDDEN",
    );
  }
};

const setDefined = (target, name, value) => {
  if (value !== undefined) {
    target[name] = value;
  }
};

const createOsChildEnvironment = (environment) => {
  const child = {};
  setDefined(child, "PATH", environment.PATH ?? environment.Path);
  setDefined(
    child,
    "SystemRoot",
    environment.SystemRoot ?? environment.SYSTEMROOT,
  );
  setDefined(child, "windir", environment.windir ?? environment.WINDIR);
  setDefined(child, "ComSpec", environment.ComSpec ?? environment.COMSPEC);
  setDefined(child, "PATHEXT", environment.PATHEXT);
  setDefined(child, "SYSTEMDRIVE", environment.SYSTEMDRIVE);
  setDefined(child, "TEMP", environment.TEMP);
  setDefined(child, "TMP", environment.TMP);
  setDefined(child, "TMPDIR", environment.TMPDIR);
  setDefined(child, "HOME", environment.HOME);
  setDefined(child, "USERPROFILE", environment.USERPROFILE);
  setDefined(child, "HOMEDRIVE", environment.HOMEDRIVE);
  setDefined(child, "HOMEPATH", environment.HOMEPATH);
  setDefined(child, "LANG", environment.LANG);
  setDefined(child, "LANGUAGE", environment.LANGUAGE);
  setDefined(child, "LC_ALL", environment.LC_ALL);
  setDefined(child, "LC_CTYPE", environment.LC_CTYPE);
  setDefined(child, "LC_MESSAGES", environment.LC_MESSAGES);
  setDefined(child, "TZ", environment.TZ);
  setDefined(child, "DISPLAY", environment.DISPLAY);
  setDefined(child, "WAYLAND_DISPLAY", environment.WAYLAND_DISPLAY);
  setDefined(child, "XAUTHORITY", environment.XAUTHORITY);
  setDefined(
    child,
    "DBUS_SESSION_BUS_ADDRESS",
    environment.DBUS_SESSION_BUS_ADDRESS,
  );
  setDefined(child, "XDG_RUNTIME_DIR", environment.XDG_RUNTIME_DIR);
  setDefined(child, "DESKTOP_SESSION", environment.DESKTOP_SESSION);
  setDefined(
    child,
    "XDG_CURRENT_DESKTOP",
    environment.XDG_CURRENT_DESKTOP,
  );
  setDefined(
    child,
    "__CF_USER_TEXT_ENCODING",
    environment.__CF_USER_TEXT_ENCODING,
  );
  return child;
};

export const createRuntimeChildEnvironment = (
  environment = process.env,
) => {
  assertNoForbiddenDirectorEnvironment(environment);
  const child = createOsChildEnvironment(environment);
  setDefined(child, "SHUBI_SHOT_URL", environment.SHUBI_SHOT_URL);
  setDefined(child, "SHUBI_SHOT_PORT", environment.SHUBI_SHOT_PORT);
  setDefined(
    child,
    "SHUBI_SHOT_RUNTIME_DIR",
    environment.SHUBI_SHOT_RUNTIME_DIR,
  );
  return child;
};

export const createBridgeChildEnvironment = (
  port,
  runtimeDirectory,
  environment = process.env,
) => {
  assertNoForbiddenDirectorEnvironment(environment);
  const child = createOsChildEnvironment(environment);
  child.SHUBI_SHOT_PORT = String(port);
  setDefined(child, "SHUBI_SHOT_RUNTIME_DIR", runtimeDirectory);
  return child;
};

export const createBrowserChildEnvironment = (
  environment = process.env,
) => {
  assertNoForbiddenDirectorEnvironment(environment);
  return createOsChildEnvironment(environment);
};
