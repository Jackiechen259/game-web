import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "node",
      environment: "node",
      include: [
        "packages/**/src/**/*.{test,spec}.ts",
        "apps/admin-api/src/**/*.{test,spec}.ts",
        "scripts/**/*.{test,spec}.ts",
        "tests/**/*.{test,spec}.ts",
      ],
      exclude: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    },
  },
  {
    test: {
      name: "web",
      environment: "jsdom",
      include: ["apps/portal/src/**/*.{test,spec}.{ts,tsx}"],
      setupFiles: ["./apps/portal/src/test/setup.ts"],
      exclude: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    },
  },
]);
