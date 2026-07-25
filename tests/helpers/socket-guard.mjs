import childProcess from "node:child_process";
import dns from "node:dns";
import dgram from "node:dgram";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import https from "node:https";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";
import { URL } from "node:url";

const runtimeDirectory = process.env.SHUBI_SHOT_RUNTIME_DIR;
const logPath =
  runtimeDirectory === undefined
    ? undefined
    : path.join(runtimeDirectory, "socket-guard.jsonl");
const processRole = path.basename(process.argv[1] ?? "node");
const guardModuleUrl = import.meta.url;

const record = (entry) => {
  if (logPath === undefined) {
    return;
  }
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(
    logPath,
    JSON.stringify({
      pid: process.pid,
      processRole,
      ...entry,
    }) + "\n",
    "utf8",
  );
};

const blocked = (api, targetClass, details = {}) => {
  record({
    type: "network-blocked",
    api,
    targetClass,
    ...details,
  });
  const error = new Error(
    "Socket guard blocked outbound network access.",
  );
  error.code = "SOCKET_GUARD_BLOCKED";
  throw error;
};

const createBlockedProcessError = () => {
  const error = new Error(
    "Socket guard blocked an unguarded child process.",
  );
  error.code = "SOCKET_GUARD_BLOCKED";
  return error;
};

const recordBlockedProcess = (api) => {
  record({
    type: "process-blocked",
    api,
    targetClass: "unguarded-child-process",
  });
};

const blockedProcess = (api) => {
  recordBlockedProcess(api);
  throw createBlockedProcessError();
};

const callerClass = () => {
  const stack = new Error().stack ?? "";
  if (stack.includes("node_modules\\vite") || stack.includes("node_modules/vite")) {
    return "vite";
  }
  if (stack.includes("node_modules\\tsx") || stack.includes("node_modules/tsx")) {
    return "tsx";
  }
  if (stack.includes("server\\runtime.ts") || stack.includes("server/runtime.ts")) {
    return "server-runtime";
  }
  if (stack.includes("node:net")) {
    return "node-net";
  }
  return "other";
};

const dnsTargetClass = (value) => {
  if (value === "localhost") {
    return "localhost";
  }
  if (typeof value === "string" && net.isIP(value) !== 0) {
    return "numeric-address";
  }
  return "hostname";
};

const stripIpv6Brackets = (host) =>
  host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;

const numericLoopbackFamily = (host) => {
  if (typeof host !== "string" || host.length === 0) {
    return undefined;
  }
  const normalized = stripIpv6Brackets(host).toLowerCase();
  if (
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1"
  ) {
    return "ipv6-loopback";
  }
  if (
    net.isIP(normalized) === 4 &&
    normalized.split(".", 1)[0] === "127"
  ) {
    return "ipv4-loopback";
  }
  return undefined;
};

const safePort = (port) => {
  if (
    typeof port === "number" &&
    Number.isInteger(port) &&
    port >= 0 &&
    port <= 65_535
  ) {
    return port;
  }
  if (typeof port === "string" && /^[0-9]+$/u.test(port)) {
    return Number(port);
  }
  return undefined;
};

const readConnectTarget = (args) => {
  const first = args[0];
  if (Array.isArray(first)) {
    return readConnectTarget(first);
  }
  if (typeof first === "number") {
    return {
      host: typeof args[1] === "string" ? args[1] : undefined,
      port: first,
    };
  }
  if (typeof first === "object" && first !== null) {
    return {
      host:
        typeof first.host === "string"
          ? first.host
          : typeof first.hostname === "string"
            ? first.hostname
            : undefined,
      port: first.port,
      path: first.path,
    };
  }
  return {
    host: undefined,
    port: undefined,
    path: typeof first === "string" ? first : undefined,
  };
};

const classifySocketTarget = (target) => {
  if (target.path !== undefined && target.host === undefined) {
    return "ipc-or-path";
  }
  if (typeof target.host !== "string") {
    return "implicit-or-missing-host";
  }
  const normalized = stripIpv6Brackets(target.host);
  const family = net.isIP(normalized);
  if (family === 0) {
    return "non-numeric-host";
  }
  return family === 4
    ? "non-loopback-ipv4"
    : "non-loopback-ipv6";
};

const guardConnect = (api, original) =>
  function guardedConnect(...args) {
    const target = readConnectTarget(args);
    if (target.path !== undefined && target.host === undefined) {
      record({
        type: "local-ipc-allowed",
        api,
      });
      return Reflect.apply(original, this, args);
    }
    const family = numericLoopbackFamily(target.host);
    if (family === undefined) {
      return blocked(api, classifySocketTarget(target));
    }
    record({
      type: "network-allowed",
      api,
      family,
      port: safePort(target.port),
    });
    return Reflect.apply(original, this, args);
  };

const originalNetConnect = net.connect;
const originalNetCreateConnection = net.createConnection;
const originalSocketConnect = net.Socket.prototype.connect;
net.connect = guardConnect("net.connect", originalNetConnect);
net.createConnection = guardConnect(
  "net.createConnection",
  originalNetCreateConnection,
);
net.Socket.prototype.connect = guardConnect(
  "net.Socket.connect",
  originalSocketConnect,
);

const dnsMethods = [
  "lookupService",
  "resolve",
  "resolve4",
  "resolve6",
  "resolveAny",
  "resolveCaa",
  "resolveCname",
  "resolveMx",
  "resolveNaptr",
  "resolveNs",
  "resolvePtr",
  "resolveSoa",
  "resolveSrv",
  "resolveTxt",
  "reverse",
];

const lookupCallback = (args) => {
  for (let index = args.length - 1; index >= 0; index -= 1) {
    if (typeof args[index] === "function") {
      return args[index];
    }
  }
  return undefined;
};

const lookupOptions = (args) =>
  typeof args[1] === "object" && args[1] !== null ? args[1] : {};

const numericLookupResult = (hostname, options) => {
  const family = numericLoopbackFamily(hostname);
  if (family === undefined) {
    return undefined;
  }
  const address = stripIpv6Brackets(hostname);
  const familyNumber = family === "ipv4-loopback" ? 4 : 6;
  return options.all === true
    ? [{ address, family: familyNumber }]
    : { address, family: familyNumber };
};

dns.lookup = (hostname, ...args) => {
  const options = lookupOptions([hostname, ...args]);
  const result = numericLookupResult(hostname, options);
  if (result === undefined) {
    return blocked("dns.lookup", "name-resolution", {
      callerClass: callerClass(),
      dnsTargetClass: dnsTargetClass(hostname),
    });
  }
  record({
    type: "numeric-loopback-resolution-allowed",
    api: "dns.lookup",
    family:
      (Array.isArray(result) ? result[0]?.family : result.family) === 4
        ? "ipv4-loopback"
        : "ipv6-loopback",
  });
  const callback = lookupCallback(args);
  if (callback === undefined) {
    throw new TypeError("dns.lookup requires a callback.");
  }
  process.nextTick(() => {
    if (Array.isArray(result)) {
      callback(null, result);
    } else {
      callback(null, result.address, result.family);
    }
  });
};

if (typeof dns.promises?.lookup === "function") {
  dns.promises.lookup = async (hostname, options = {}) => {
    const result = numericLookupResult(hostname, options);
    if (result === undefined) {
      return blocked("dns.promises.lookup", "name-resolution", {
        callerClass: callerClass(),
        dnsTargetClass: dnsTargetClass(hostname),
      });
    }
    record({
      type: "numeric-loopback-resolution-allowed",
      api: "dns.promises.lookup",
      family:
        (Array.isArray(result) ? result[0]?.family : result.family) === 4
          ? "ipv4-loopback"
          : "ipv6-loopback",
    });
    return result;
  };
}

for (const method of dnsMethods) {
  if (typeof dns[method] === "function") {
    dns[method] = (...args) =>
      blocked("dns." + method, "name-resolution", {
        callerClass: callerClass(),
        dnsTargetClass: dnsTargetClass(args[0]),
      });
  }
  if (typeof dns.promises?.[method] === "function") {
    dns.promises[method] = (...args) =>
      blocked("dns.promises." + method, "name-resolution", {
        callerClass: callerClass(),
        dnsTargetClass: dnsTargetClass(args[0]),
      });
  }
  if (typeof dns.Resolver?.prototype?.[method] === "function") {
    dns.Resolver.prototype[method] = (...args) =>
      blocked("dns.Resolver." + method, "name-resolution", {
        callerClass: callerClass(),
        dnsTargetClass: dnsTargetClass(args[0]),
      });
  }
  if (
    typeof dns.promises?.Resolver?.prototype?.[method] === "function"
  ) {
    dns.promises.Resolver.prototype[method] = (...args) =>
      blocked(
        "dns.promises.Resolver." + method,
        "name-resolution",
        {
          callerClass: callerClass(),
          dnsTargetClass: dnsTargetClass(args[0]),
        },
      );
  }
}

tls.connect = () => blocked("tls.connect", "tls");
https.request = () => blocked("https.request", "https");
https.get = () => blocked("https.get", "https");
dgram.createSocket = () =>
  blocked("dgram.createSocket", "udp-socket");
if (typeof dgram._createSocketHandle === "function") {
  dgram._createSocketHandle = () =>
    blocked("dgram._createSocketHandle", "udp-socket");
}
dgram.Socket = function guardedDgramSocket() {
  return blocked("dgram.Socket", "udp-socket");
};

if (typeof globalThis.fetch === "function") {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function guardedFetch(input, init) {
    let url;
    try {
      const source =
        typeof input === "string" || input instanceof URL
          ? input
          : input.url;
      url = new URL(source);
    } catch {
      return blocked("fetch", "invalid-url");
    }
    const family = numericLoopbackFamily(url.hostname);
    if (
      url.protocol !== "http:" ||
      family === undefined ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return blocked(
        "fetch",
        url.protocol === "https:"
          ? "https"
          : family === undefined
            ? "non-loopback-or-non-numeric"
            : "credentialed-url",
      );
    }
    record({
      type: "network-allowed",
      api: "fetch",
      family,
      port: safePort(url.port || "80"),
    });
    return Reflect.apply(originalFetch, this, [input, init]);
  };
}

const sensitiveEnvironmentKeys = [
  "OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NODE_OPTIONS",
  "HOST_RAW_PROMPT_MARKER",
  "HOST_PROFILE_PATH_MARKER",
  "HOST_ALIAS_MARKER",
];
const originalSpawn = childProcess.spawn;
const originalChildProcessSpawn = childProcess.ChildProcess.prototype.spawn;
let guardedSpawnDepth = 0;
childProcess.ChildProcess.prototype.spawn = function guardedPrototypeSpawn(
  ...args
) {
  if (guardedSpawnDepth === 0) {
    return blockedProcess("child_process.ChildProcess.spawn");
  }
  return Reflect.apply(originalChildProcessSpawn, this, args);
};
const isNodeExecutable = (command) => {
  try {
    return (
      path.resolve(String(command)).toLowerCase() ===
      path.resolve(process.execPath).toLowerCase()
    );
  } catch {
    return false;
  }
};

const addGuardImport = (args) => {
  if (
    args.some(
      (argument, index) =>
        argument === "--import" && args[index + 1] === guardModuleUrl,
    )
  ) {
    return { args, injected: false };
  }
  return {
    args: ["--import", guardModuleUrl, ...args],
    injected: true,
  };
};

childProcess.spawn = function guardedSpawn(command, args, options) {
  const childArguments = Array.isArray(args) ? args : [];
  const childOptions = Array.isArray(args) ? options : args;
  if (!isNodeExecutable(command)) {
    return blockedProcess("child_process.spawn");
  }
  if (
    typeof childOptions === "object" &&
    childOptions !== null &&
    childOptions.shell !== undefined &&
    childOptions.shell !== false
  ) {
    return blockedProcess("child_process.spawn.shell");
  }
  const guarded = addGuardImport(childArguments);
  const childEnvironment =
    typeof childOptions === "object" &&
    childOptions !== null &&
    typeof childOptions.env === "object" &&
    childOptions.env !== null
      ? childOptions.env
      : undefined;
  record({
    type: "spawn-observation",
    command: path.basename(String(command)),
    guardInjected: guarded.injected,
    explicitEnvironment: childEnvironment !== undefined,
    sensitiveEnvironmentKeyCount:
      childEnvironment === undefined
        ? -1
        : sensitiveEnvironmentKeys.filter((key) =>
            Object.prototype.hasOwnProperty.call(childEnvironment, key),
          ).length,
    observerEnvironmentKeyCount:
      childEnvironment === undefined
        ? -1
        : Object.keys(childEnvironment).filter((key) =>
            key.startsWith("SOCKET_GUARD_"),
          ).length,
  });
  guardedSpawnDepth += 1;
  try {
    return Reflect.apply(originalSpawn, this, [
      command,
      guarded.args,
      childOptions,
    ]);
  } finally {
    guardedSpawnDepth -= 1;
  }
};

childProcess.exec = function guardedExec(...args) {
  if (callerClass() !== "vite") {
    return blockedProcess("child_process.exec");
  }
  recordBlockedProcess("child_process.exec");
  const callback = [...args]
    .reverse()
    .find((argument) => typeof argument === "function");
  if (callback !== undefined) {
    process.nextTick(() => {
      callback(createBlockedProcessError(), "", "");
    });
  }
  return undefined;
};

for (const method of [
  "execFile",
  "fork",
  "spawnSync",
  "execSync",
  "execFileSync",
]) {
  childProcess[method] = () =>
    blockedProcess("child_process." + method);
}

syncBuiltinESMExports();
