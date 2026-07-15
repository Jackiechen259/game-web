import { toCatalogEntry, validateCatalog, validateGameConfig } from "@game-platform/game-schema";
import { NotFoundError } from "./app-error.ts";
import type { AppContext } from "./context.ts";
import type { ValidationResult } from "@game-platform/game-schema";

async function fileSet(ctx: AppContext, ref?: string): Promise<Set<string>> {
  const files = await ctx.repo.listFiles(ref);
  return new Set(files);
}

/** Validate a single game config against the repo file tree. */
export async function validateSingleGame(ctx: AppContext, id: string, ref?: string): Promise<ValidationResult> {
  const game = await ctx.repo.getGame(id, ref);
  if (!game) throw new NotFoundError(`Game ${id}`);
  const files = await fileSet(ctx, ref);
  return validateGameConfig(game.config, {
    fileExists: (p: string) => files.has(p),
  });
}

/** Validate the full catalog (all game configs together). */
export async function validateCatalogAll(ctx: AppContext, ref?: string): Promise<ValidationResult> {
  const configs = await ctx.repo.listGameConfigs(ref);
  const files = await fileSet(ctx, ref);
  const catalog = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    games: configs.map((c) => toCatalogEntry(c.config)),
  };
  return validateCatalog(catalog, {
    fileExists: (p: string) => files.has(p),
  });
}
