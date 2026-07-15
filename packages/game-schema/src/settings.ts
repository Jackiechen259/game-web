import { z } from "zod";

/**
 * Site-level settings (`catalog/settings.json`). Admins may edit the
 * non-secret subset; secrets are always server-side environment variables.
 */
export const SUPPORTED_SETTINGS_SCHEMA_VERSION = 1;

export const settingsSchema = z.object({
  schemaVersion: z.number().int().positive(),
  siteName: z.string().min(1),
  siteDescription: z.string().min(1),
  defaultLanguage: z.string().min(1).default("zh-CN"),
  gamesPerPage: z.number().int().positive().default(24),
  showBetaGames: z.boolean().default(true),
  showArchivedGamePages: z.boolean().default(true),
  enableSearch: z.boolean().default(true),
  enableCategories: z.boolean().default(true),
  enableRecentlyPlayed: z.boolean().default(true),
  enableFullscreen: z.boolean().default(true),
  enableGamepad: z.boolean().default(true),
  maintenanceMode: z.boolean().default(false),
  featuredGameIds: z.array(z.string()).default([]),
  navigation: z
    .array(
      z.object({
        label: z.string().min(1),
        path: z.string().min(1),
      }),
    )
    .default([]),
});

export type SiteSettings = z.infer<typeof settingsSchema>;
