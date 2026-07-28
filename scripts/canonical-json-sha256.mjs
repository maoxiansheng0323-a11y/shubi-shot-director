#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
if (args.length !== 1) {
  throw new Error("Usage: canonical-json-sha256.mjs <json-file>");
}

const value = JSON.parse(await readFile(path.resolve(args[0]), "utf8"));
const digest = createHash("sha256")
  .update(JSON.stringify(value), "utf8")
  .digest("hex");
process.stdout.write(`${digest}\n`);
