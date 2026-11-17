#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FigmaClient } from "./figma-client.js";
import {
  createFigmaBlockServer,
  handleCacheDesign,
  handleCleanCache,
  handleListCache,
} from "./server.js";
import { parseCacheCliArgs } from "./url-parser.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const subcommand = args[0];

  if (subcommand === "clean" || (subcommand === "cache" && args[1] === "clean")) {
    const client = new FigmaClient();
    const cleanArgs = subcommand === "clean" ? args.slice(1) : args.slice(2);
    const force = cleanArgs.includes("--force") || cleanArgs.includes("-f");
    const fileKey = cleanArgs.find((a) => !a.startsWith("-"));
    const output = await handleCleanCache({ fileKey, force }, client);
    console.log(output);
    return;
  }

  if (subcommand === "cache") {
    const client = new FigmaClient();
    const input = parseCacheCliArgs(args.slice(1));
    const output = await handleCacheDesign(input, client);
    console.log(output);
    return;
  }

  if (subcommand === "list" || subcommand === "ls") {
    const client = new FigmaClient();
    const fileKey = args[1] && !args[1].startsWith("-") ? args[1] : undefined;
    const output = await handleListCache({ fileKey }, client);
    console.log(output);
    return;
  }

  const server = createFigmaBlockServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error running figma-cache-design-mcp:", error);
  process.exit(1);
});
