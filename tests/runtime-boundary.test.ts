import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  CLI_HELP_COMMANDS,
  getRuntimeCapabilityManifest,
} from "../cli/runtime-capabilities";
import { SceneClient } from "../src/editor/scene-client";
import {
  createStructuredPatch,
  createStructuredScene,
} from "./helpers/structured-fixtures";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const productionRoots = ["scripts", "cli", "server", "src"] as const;
const REVIEWED_DEPENDENCY_NAMES = [
  "@react-three/drei",
  "@react-three/fiber",
  "express",
  "react",
  "react-dom",
  "three",
  "zod",
  "zustand",
] as const;
const REVIEWED_DEV_DEPENDENCY_NAMES = [
  "@eslint/js",
  "@types/express",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "@types/react-test-renderer",
  "@types/three",
  "@vitejs/plugin-react",
  "ajv",
  "eslint",
  "react-test-renderer",
  "tsx",
  "typescript",
  "typescript-eslint",
  "vite",
  "vitest",
] as const;

const collectProductionModules = async (
  directory: string,
): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectProductionModules(entryPath);
      }
      return /\.(?:[cm]?js|tsx?)$/u.test(entry.name) ? [entryPath] : [];
    }),
  );
  return nested.flat();
};

const readProductionSources = async (): Promise<
  Array<{ filePath: string; relativePath: string; source: string }>
> => {
  const files = (
    await Promise.all(
      productionRoots.map((root) =>
        collectProductionModules(path.join(repositoryRoot, root)),
      ),
    )
  ).flat();
  return Promise.all(
    files.map(async (filePath) => ({
      filePath,
      relativePath: path
        .relative(repositoryRoot, filePath)
        .replaceAll("\\", "/"),
      source: await readFile(filePath, "utf8"),
    })),
  );
};

const importedModuleSpecifiers = (
  source: string,
  fileName: string,
): string[] => {
  const specifiers: string[] = [];
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : fileName.endsWith(".mjs") || fileName.endsWith(".js")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS,
  );
  const addLiteral = (node: ts.Node | undefined): void => {
    if (node !== undefined && ts.isStringLiteralLike(node)) {
      specifiers.push(node.text);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addLiteral(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addLiteral(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addLiteral(node.arguments[0]);
      } else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require"
      ) {
        addLiteral(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
};

const isForbiddenModelClientPackage = (specifier: string): boolean =>
  /(?:^|[/@._-])(?:openai|anthropic|langchain|llm|ollama|gemini|mistral|cohere|ai|ai-sdk|generative-ai|groq|bedrock|huggingface|hugging-face)(?:$|[/@._-])/iu.test(
    specifier,
  );

const createAuditSourceFile = (
  source: string,
  fileName = "runtime-boundary-fixture.ts",
): ts.SourceFile =>
  ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : fileName.endsWith(".mjs") || fileName.endsWith(".js")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS,
  );

const unwrapExpression = (input: ts.Expression): ts.Expression => {
  let expression = input;
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
};

const isProcessEnvironmentExpression = (
  input: ts.Expression,
): boolean => {
  const expression = unwrapExpression(input);
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression)
  ) {
    return (
      expression.expression.text === "process" &&
      expression.name.text === "env"
    );
  }
  return (
    ts.isElementAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "process" &&
    expression.argumentExpression !== undefined &&
    ts.isStringLiteralLike(expression.argumentExpression) &&
    expression.argumentExpression.text === "env"
  );
};

const expressionIsEnvironmentAlias = (
  input: ts.Expression,
  aliases: ReadonlySet<string>,
): boolean => {
  const expression = unwrapExpression(input);
  return (
    isProcessEnvironmentExpression(expression) ||
    (ts.isIdentifier(expression) && aliases.has(expression.text))
  );
};

const collectEnvironmentAliases = (
  sourceFile: ts.SourceFile,
): Set<string> => {
  const aliases = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    const addAlias = (name: string): void => {
      if (!aliases.has(name)) {
        aliases.add(name);
        changed = true;
      }
    };
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        expressionIsEnvironmentAlias(node.initializer, aliases)
      ) {
        addAlias(node.name.text);
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left) &&
        expressionIsEnvironmentAlias(node.right, aliases)
      ) {
        addAlias(node.left.text);
      } else if (
        ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer !== undefined &&
        ts.isIdentifier(unwrapExpression(node.initializer)) &&
        (unwrapExpression(node.initializer) as ts.Identifier).text ===
          "process"
      ) {
        for (const element of node.name.elements) {
          const propertyName = element.propertyName ?? element.name;
          if (
            ts.isIdentifier(propertyName) &&
            propertyName.text === "env" &&
            ts.isIdentifier(element.name)
          ) {
            addAlias(element.name.text);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return aliases;
};

const propertyNameText = (
  name: ts.PropertyName,
): string | undefined =>
  ts.isIdentifier(name) ||
  ts.isStringLiteralLike(name) ||
  ts.isNumericLiteral(name)
    ? name.text
    : undefined;

const auditAmbientEnvironmentSource = (
  source: string,
  fileName?: string,
): string[] => {
  const sourceFile = createAuditSourceFile(source, fileName);
  const aliases = collectEnvironmentAliases(sourceFile);
  const violations = new Set<string>();
  const referencesEnvironment = (expression: ts.Expression): boolean =>
    expressionIsEnvironmentAlias(expression, aliases);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expression = unwrapExpression(node.expression);
      if (
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression)
      ) {
        const receiver = expression.expression.text;
        const method = expression.name.text;
        if (
          receiver === "Object" &&
          ["keys", "entries", "values"].includes(method) &&
          node.arguments[0] !== undefined &&
          referencesEnvironment(node.arguments[0])
        ) {
          violations.add(`environment-enumeration:Object.${method}`);
        }
        if (
          receiver === "Reflect" &&
          method === "ownKeys" &&
          node.arguments[0] !== undefined &&
          referencesEnvironment(node.arguments[0])
        ) {
          violations.add("environment-enumeration:Reflect.ownKeys");
        }
        if (
          receiver === "Object" &&
          method === "assign" &&
          node.arguments
            .slice(1)
            .some((argument) => referencesEnvironment(argument))
        ) {
          violations.add("environment-enumeration:Object.assign");
        }
      }
    } else if (
      (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) &&
      referencesEnvironment(node.expression)
    ) {
      violations.add("environment-enumeration:spread");
    } else if (
      ts.isForInStatement(node) &&
      referencesEnvironment(node.expression)
    ) {
      violations.add("environment-enumeration:for-in");
    } else if (
      ts.isPropertyAssignment(node) &&
      propertyNameText(node.name) === "env" &&
      referencesEnvironment(node.initializer)
    ) {
      violations.add("whole-environment-forwarding");
    } else if (
      ts.isShorthandPropertyAssignment(node) &&
      node.name.text === "env" &&
      aliases.has(node.name.text)
    ) {
      violations.add("whole-environment-forwarding");
    } else if (
      ts.isReturnStatement(node) &&
      node.expression !== undefined &&
      referencesEnvironment(node.expression)
    ) {
      violations.add("whole-environment-return");
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer !== undefined &&
      referencesEnvironment(node.initializer) &&
      node.name.elements.some((element) => element.dotDotDotToken !== undefined)
    ) {
      violations.add("environment-enumeration:rest-binding");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...violations].sort();
};

const FULLY_FORBIDDEN_NETWORK_MODULES = new Set([
  "http2",
  "node:http2",
  "node-fetch",
  "got",
  "undici",
  "axios",
]);

const CORE_NETWORK_MODULES = new Set([
  "http",
  "node:http",
  "https",
  "node:https",
  "net",
  "node:net",
  "tls",
  "node:tls",
]);

const importClauseHasRuntimeBinding = (
  clause: ts.ImportClause | undefined,
): boolean => {
  if (clause === undefined) {
    return true;
  }
  if (clause.isTypeOnly) {
    return false;
  }
  if (clause.name !== undefined) {
    return true;
  }
  if (clause.namedBindings === undefined) {
    return false;
  }
  return (
    ts.isNamespaceImport(clause.namedBindings) ||
    clause.namedBindings.elements.some((element) => !element.isTypeOnly)
  );
};

const isGlobalObject = (expression: ts.Expression): boolean =>
  ts.isIdentifier(expression) &&
  ["globalThis", "window", "self"].includes(expression.text);

const isGlobalMemberReference = (
  input: ts.Expression,
  memberName: string,
): boolean => {
  const expression = unwrapExpression(input);
  if (ts.isPropertyAccessExpression(expression)) {
    return (
      isGlobalObject(unwrapExpression(expression.expression)) &&
      expression.name.text === memberName
    );
  }
  return (
    ts.isElementAccessExpression(expression) &&
    isGlobalObject(unwrapExpression(expression.expression)) &&
    expression.argumentExpression !== undefined &&
    ts.isStringLiteralLike(expression.argumentExpression) &&
    expression.argumentExpression.text === memberName
  );
};

const collectGlobalFetchAliases = (sourceFile: ts.SourceFile): Set<string> => {
  const aliases = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    const addAlias = (name: string): void => {
      if (!aliases.has(name)) {
        aliases.add(name);
        changed = true;
      }
    };
    const isFetchReference = (expression: ts.Expression): boolean => {
      const unwrapped = unwrapExpression(expression);
      return (
        isGlobalMemberReference(unwrapped, "fetch") ||
        (ts.isIdentifier(unwrapped) &&
          (unwrapped.text === "fetch" || aliases.has(unwrapped.text)))
      );
    };
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        isFetchReference(node.initializer)
      ) {
        addAlias(node.name.text);
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left) &&
        isFetchReference(node.right)
      ) {
        addAlias(node.left.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return aliases;
};

const auditNetworkClientSource = (
  source: string,
  fileName?: string,
): string[] => {
  const sourceFile = createAuditSourceFile(source, fileName);
  const fetchAliases = collectGlobalFetchAliases(sourceFile);
  const violations = new Set<string>();
  const addModuleViolation = (specifier: string): void => {
    if (FULLY_FORBIDDEN_NETWORK_MODULES.has(specifier)) {
      violations.add(`network-module:${specifier}`);
    } else if (CORE_NETWORK_MODULES.has(specifier)) {
      violations.add(`network-module:${specifier}:dynamic`);
    }
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      if (
        FULLY_FORBIDDEN_NETWORK_MODULES.has(specifier) &&
        importClauseHasRuntimeBinding(node.importClause)
      ) {
        violations.add(`network-module:${specifier}`);
      } else if (CORE_NETWORK_MODULES.has(specifier)) {
        const clause = node.importClause;
        if (clause === undefined) {
          violations.add(`network-module:${specifier}:side-effect`);
        }
        if (
          clause !== undefined &&
          !clause.isTypeOnly &&
          (clause.name !== undefined ||
            (clause.namedBindings !== undefined &&
              ts.isNamespaceImport(clause.namedBindings)))
        ) {
          violations.add(`network-module:${specifier}:namespace`);
        }
        if (
          clause?.namedBindings !== undefined &&
          ts.isNamedImports(clause.namedBindings)
        ) {
          for (const element of clause.namedBindings.elements) {
            const importedName = (element.propertyName ?? element.name).text;
            if (
              !element.isTypeOnly &&
              importedName !== "createServer"
            ) {
              violations.add(
                `network-module:${specifier}:${importedName}`,
              );
            }
          }
        }
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression !== undefined &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      addModuleViolation(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node)) {
      const expression = unwrapExpression(node.expression);
      if (
        (ts.isIdentifier(expression) &&
          (expression.text === "fetch" || fetchAliases.has(expression.text))) ||
        isGlobalMemberReference(expression, "fetch")
      ) {
        violations.add("global-fetch");
      }
      if (
        expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] !== undefined &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        addModuleViolation(node.arguments[0].text);
      } else if (
        ts.isIdentifier(expression) &&
        expression.text === "require" &&
        node.arguments[0] !== undefined &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        addModuleViolation(node.arguments[0].text);
      }
    } else if (ts.isNewExpression(node)) {
      const expression = unwrapExpression(node.expression);
      const constructorName = ts.isIdentifier(expression)
        ? expression.text
        : ["EventSource", "WebSocket", "XMLHttpRequest"].find((name) =>
            isGlobalMemberReference(expression, name),
          );
      if (constructorName === "EventSource") {
        violations.add("event-source");
      } else if (constructorName === "WebSocket") {
        violations.add("web-socket");
      } else if (constructorName === "XMLHttpRequest") {
        violations.add("xml-http-request");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...violations].sort();
};

const compileBoundaryImport = async (
  specifier: string,
): Promise<number[]> => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "shubi-shot-boundary-types-"),
  );
  try {
    const cliDirectory = path.join(directory, "cli");
    const scriptsDirectory = path.join(directory, "scripts");
    await mkdir(cliDirectory, { recursive: true });
    await mkdir(scriptsDirectory, { recursive: true });
    await copyFile(
      path.join(repositoryRoot, "scripts", "process-boundary.mjs"),
      path.join(scriptsDirectory, "process-boundary.mjs"),
    );
    const declarationRoots: string[] = [];
    for (const declarationName of [
      "process-boundary.d.ts",
      "process-boundary.d.mts",
    ]) {
      const sourcePath = path.join(
        repositoryRoot,
        "scripts",
        declarationName,
      );
      const destinationPath = path.join(
        scriptsDirectory,
        declarationName,
      );
      try {
        await copyFile(sourcePath, destinationPath);
        declarationRoots.push(destinationPath);
      } catch (error) {
        if (
          typeof error !== "object" ||
          error === null ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          throw error;
        }
      }
    }
    const fixturePath = path.join(cliDirectory, "fixture.ts");
    await writeFile(
      fixturePath,
      `
        import { createRuntimeChildEnvironment } from ${JSON.stringify(specifier)};
        const child = createRuntimeChildEnvironment({ PATH: "fixture" });
        child.PATH;
      `,
      "utf8",
    );
    const program = ts.createProgram({
      rootNames: [fixturePath, ...declarationRoots],
      options: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ["node"],
        typeRoots: [path.join(repositoryRoot, "node_modules", "@types")],
      },
    });
    return ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
      .map((diagnostic) => diagnostic.code);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

describe("static Director runtime boundary", () => {
  it("has no direct model/LLM client dependency or production import", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencyNames = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ];
    expect(Object.keys(packageJson.dependencies ?? {}).sort()).toEqual(
      [...REVIEWED_DEPENDENCY_NAMES].sort(),
    );
    expect(Object.keys(packageJson.devDependencies ?? {}).sort()).toEqual(
      [...REVIEWED_DEV_DEPENDENCY_NAMES].sort(),
    );
    expect(
      dependencyNames.filter(isForbiddenModelClientPackage),
    ).toEqual([]);

    const sources = await readProductionSources();
    const forbiddenImports = sources.flatMap(({ filePath, relativePath, source }) =>
      importedModuleSpecifiers(source, filePath)
        .filter(
          (specifier) =>
            !specifier.startsWith(".") &&
            !specifier.startsWith("node:") &&
            isForbiddenModelClientPackage(specifier),
        )
        .map((specifier) => `${relativePath}: ${specifier}`),
    );
    expect(forbiddenImports).toEqual([]);
  });

  it.each([
    "ai",
    "groq-sdk",
    "@aws-sdk/client-bedrock-runtime",
    "@huggingface/inference",
  ])("classifies model-client package escape %s", (specifier) => {
    expect(isForbiddenModelClientPackage(specifier)).toBe(true);
  });

  it("does not enumerate or forward the ambient process environment", async () => {
    const sources = await readProductionSources();
    const violations = sources.flatMap(({ relativePath, source }) =>
      auditAmbientEnvironmentSource(source).map(
        (violation) => `${relativePath}: ${violation}`,
      ),
    );
    expect(violations).toEqual([]);
    const combined = sources.map(({ source }) => source).join("\n");
    for (const name of [
      "OPENAI_API_KEY",
      "AZURE_OPENAI_ENDPOINT",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "NODE_OPTIONS",
    ]) {
      expect(combined).not.toContain(name);
    }
  });

  it("keeps process-boundary environment handling non-enumerating", async () => {
    const source = await readFile(
      path.join(repositoryRoot, "scripts", "process-boundary.mjs"),
      "utf8",
    );

    expect(source).not.toMatch(/Object\.(?:keys|entries|values)\s*\(/u);
    expect(source).not.toMatch(/Reflect\.ownKeys\s*\(/u);
    expect(source).not.toMatch(/\.\.\.\s*(?:env|environment)\b/u);
    expect(source).not.toMatch(
      /for\s*\([^)]*\bin\s+(?:env|environment)\s*\)/u,
    );
  });

  it("does not advertise removed raw-text semantic action IDs", async () => {
    const forbiddenActionIds = [
      "shot.create",
      "shot.modify",
      "profile.resolve",
    ];
    expect(getRuntimeCapabilityManifest().commands).not.toEqual(
      expect.arrayContaining(forbiddenActionIds),
    );
    expect(CLI_HELP_COMMANDS).not.toEqual(
      expect.arrayContaining(forbiddenActionIds),
    );

    for (const relativePath of [
      "scripts/director.mjs",
      "cli/director.ts",
      "cli/director-runtime.ts",
    ]) {
      const source = await readFile(
        path.join(repositoryRoot, relativePath),
        "utf8",
      );
      for (const actionId of forbiddenActionIds) {
        expect(source).not.toMatch(
          new RegExp(`["']${actionId.replace(".", "\\.")}["']`, "u"),
        );
      }
    }
  });

  it("keeps public guidance and CLI routing structured-only", async () => {
    const referenceDirectory = path.join(
      repositoryRoot,
      ".agents",
      "skills",
      "shubi-shot-director",
      "references",
    );
    const referenceFiles = (await readdir(referenceDirectory))
      .filter((fileName) => fileName.endsWith(".md"))
      .map((fileName) => path.join(referenceDirectory, fileName));
    const guidance = (
      await Promise.all(
        [
          path.join(
            repositoryRoot,
            ".agents",
            "skills",
            "shubi-shot-director",
            "SKILL.md",
          ),
          path.join(repositoryRoot, "README.md"),
          ...referenceFiles,
        ].map((filePath) => readFile(filePath, "utf8")),
      )
    ).join("\n");
    const commandSurface = CLI_HELP_COMMANDS.join("\n");

    expect(commandSurface).not.toMatch(
      /--(?:text|prompt|profile|api-key|token|model|provider|base-url|endpoint)\b/iu,
    );
    expect(guidance).not.toMatch(
      /\bshot\s+(?:create|modify)\b[^\n]*--text/iu,
    );
    expect(guidance).not.toMatch(/\bprofile\s+resolve\b/iu);
    expect(guidance).not.toMatch(/--profile\b/iu);
    expect(getRuntimeCapabilityManifest()).toMatchObject({
      semanticAuthority: "host",
      inputContract: "structured-only",
      modelIntegration: "none",
      credentialPolicy: "forbidden",
      networkPolicy: "loopback-only",
    });
  });

  it("limits production network clients to the reviewed bridge and same-origin scene client", async () => {
    const sources = await readProductionSources();
    const auditedEntries = sources.flatMap(
      ({ filePath, relativePath, source }) =>
        auditNetworkClientSource(source, filePath).map((violation) => ({
          relativePath,
          violation,
        })),
    );
    const allowedViolations = new Map<string, ReadonlySet<string>>([
      ["cli/bridge.ts", new Set(["global-fetch"])],
      [
        "src/editor/scene-client.ts",
        new Set(["event-source", "global-fetch"]),
      ],
      [
        "src/three/preview-export-client.ts",
        new Set(["event-source", "global-fetch"]),
      ],
    ]);
    const unexpected = auditedEntries.filter(
      ({ relativePath, violation }) =>
        !allowedViolations.get(relativePath)?.has(violation),
    );
    expect(unexpected).toEqual([]);
    expect(
      [...new Set(auditedEntries.map(({ relativePath }) => relativePath))].sort(),
    ).toEqual([
      "cli/bridge.ts",
      "src/editor/scene-client.ts",
      "src/three/preview-export-client.ts",
    ]);

    const sceneClientSource = await readFile(
      path.join(repositoryRoot, "src", "editor", "scene-client.ts"),
      "utf8",
    );
    expect(sceneClientSource).not.toContain("baseUrl");
    expect(sceneClientSource).not.toMatch(/https?:\/\//u);
  });

  it.each([
    [
      "object-spread environment copy",
      `
        const copied = { ...process.env };
      `,
    ],
    [
      "aliased whole-env forwarding",
      `
        const inherited = process.env;
        spawn(command, args, { env: inherited });
      `,
    ],
    [
      "aliased whole-env enumeration",
      `
        const inherited = process.env;
        Object.keys(inherited);
      `,
    ],
    [
      "chained alias enumeration",
      `
        const inherited = process.env;
        const forwarded = inherited;
        Reflect.ownKeys(forwarded);
      `,
    ],
  ])("detects synthetic %s", (_label, source) => {
    expect(auditAmbientEnvironmentSource(source)).not.toEqual([]);
  });

  it.each([
    ["node:http request", `import { request } from "node:http";`],
    ["node:http aliased get", `import { get as httpGet } from "node:http";`],
    ["node:https request", `import { request } from "node:https";`],
    ["node:https get", `import { get } from "node:https";`],
    ["node:net connect", `import { connect } from "node:net";`],
    [
      "node:net createConnection",
      `import { createConnection } from "node:net";`,
    ],
    ["node:tls connect", `import { connect } from "node:tls";`],
    ["node:http2", `import { connect } from "node:http2";`],
    ["node-fetch", `import fetch from "node-fetch";`],
    ["got", `import got from "got";`],
    ["undici", `import { request } from "undici";`],
    ["axios", `import axios from "axios";`],
  ])("detects synthetic network client import %s", (_label, source) => {
    expect(auditNetworkClientSource(source)).not.toEqual([]);
  });

  it.each([
    ["XMLHttpRequest", `new XMLHttpRequest();`],
    [
      "fetch alias",
      `const send = globalThis.fetch; send("https://example.test");`,
    ],
    [
      "bare fetch alias",
      `const send = fetch; send("https://example.test");`,
    ],
    [
      "chained bare fetch alias",
      `const send = fetch; const dispatch = send; dispatch("https://example.test");`,
    ],
    ["global WebSocket", `new globalThis.WebSocket("wss://example.test");`],
    [
      "global EventSource",
      `new globalThis.EventSource("https://example.test/events");`,
    ],
  ])("detects synthetic network runtime entry %s", (_label, source) => {
    expect(auditNetworkClientSource(source)).not.toEqual([]);
  });

  it.each([
    "node:http",
    "node:https",
    "node:net",
    "node:tls",
  ])("allows the explicit inbound createServer import from %s", (specifier) => {
    expect(
      auditNetworkClientSource(
        `import { createServer as startServer } from ${JSON.stringify(specifier)}; startServer(app);`,
      ),
    ).toEqual([]);
  });

  it.each([
    ["namespace", `import * as https from "node:https";`],
    ["CommonJS", `const net = require("node:net");`],
    ["dynamic import", `const tls = await import("node:tls");`],
  ])("rejects unprovable %s core-network module usage", (_label, source) => {
    expect(auditNetworkClientSource(source)).not.toEqual([]);
  });

  it("resolves the existing process-boundary module declaration", async () => {
    expect(
      await compileBoundaryImport("../scripts/process-boundary.mjs"),
    ).toEqual([]);
  });

  it("does not resolve a missing process-boundary module declaration", async () => {
    expect(
      await compileBoundaryImport("../missing/process-boundary.mjs"),
    ).toContain(2307);
  });

  it("uses an exact sibling declaration whose value exports match the runtime", async () => {
    const declarationSource = await readFile(
      path.join(repositoryRoot, "scripts", "process-boundary.d.mts"),
      "utf8",
    );
    const declaredValueExports = [
      ...declarationSource.matchAll(
        /export\s+(?:class|function)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gu,
      ),
    ]
      .map((match) => match[1])
      .sort();
    const runtimeModule = (await import(
      /* @vite-ignore */ new URL(
        "../scripts/process-boundary.mjs",
        import.meta.url,
      ).href
    )) as Record<string, unknown>;

    expect(declaredValueExports).toEqual(Object.keys(runtimeModule).sort());
    await expect(
      readFile(
        path.join(repositoryRoot, "scripts", "process-boundary.d.ts"),
        "utf8",
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not implement model/provider/base-url/endpoint CLI options", async () => {
    const cliFiles = await collectProductionModules(
      path.join(repositoryRoot, "cli"),
    );
    const combined = (
      await Promise.all(cliFiles.map((filePath) => readFile(filePath, "utf8")))
    ).join("\n");
    for (const option of [
      "--model",
      "--provider",
      "--base-url",
      "--endpoint",
    ]) {
      expect(combined).not.toContain(option);
    }
  });
});

describe("same-origin SceneClient", () => {
  it("uses exact relative API and event-stream URLs even when an extra baseUrl property is supplied", async () => {
    const scene = createStructuredScene();
    const patch = createStructuredPatch(scene);
    const fetchUrls: string[] = [];
    const eventUrls: string[] = [];
    const fetchImpl: typeof globalThis.fetch = async (input) => {
      fetchUrls.push(String(input));
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            scene,
            history: { canUndo: false, canRedo: false },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };
    const fakeEventSource = {
      addEventListener: () => undefined,
      close: () => undefined,
    } as unknown as EventSource;
    const options = {
      baseUrl: "https://remote.example.test/escape",
      fetch: fetchImpl,
      eventSourceFactory: (url: string): EventSource => {
        eventUrls.push(url);
        return fakeEventSource;
      },
    };
    const client = new SceneClient(options);

    await client.getScene();
    await client.applyPatch(patch);
    await client.replaceScene(scene);
    await client.undo();
    await client.redo();
    const unsubscribe = client.subscribe({ onScene: () => undefined });
    unsubscribe();

    expect(fetchUrls).toEqual([
      "/api/v1/scene",
      "/api/v1/patches",
      "/api/v1/scene",
      "/api/v1/undo",
      "/api/v1/redo",
    ]);
    expect(eventUrls).toEqual(["/api/v1/events"]);
  });
});
