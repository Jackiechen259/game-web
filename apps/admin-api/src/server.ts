import { loadDotenv } from "./env.ts";

loadDotenv();

import { readConfig } from "./config.ts";
import { Database } from "./db.ts";
import { Store } from "./store.ts";
import { buildContext, createApp } from "./app.ts";
import { randomToken } from "./auth/crypto.ts";

const config = readConfig();

// Production validation: secrets must be configured server-side.
if (config.nodeEnv === "production") {
  const missing: string[] = [];
  if (!config.sessionSecret) missing.push("SESSION_SECRET");
  if (config.authProvider === "github" && (!config.githubOAuthClientId || !config.githubOAuthClientSecret)) {
    missing.push("GITHUB_OAUTH_CLIENT_ID/SECRET");
  }
  if (config.repositoryBackend === "github" && (!config.githubAppPrivateKey || !config.githubAppId || !config.githubAppInstallationId)) {
    missing.push("GITHUB_APP_*");
  }
  if (missing.length > 0) {
    console.error(`[admin-api] FATAL: missing required configuration in production: ${missing.join(", ")}`);
    process.exit(1);
  }
}

// In dev without a configured secret, use an ephemeral one so the HMAC path
// is still exercised (sessions will not survive a restart).
if (!config.sessionSecret && config.nodeEnv !== "production") {
  config.sessionSecret = randomToken(32);
  console.warn("[admin-api] SESSION_SECRET not set; using an ephemeral dev secret. Set SESSION_SECRET in production.");
}

const database = new Database(config.databasePath);
const store = new Store(database);
const ctx = buildContext(config, store);
const app = createApp(ctx);

app.listen(config.port, () => {
  console.log(
    `[admin-api] listening on http://localhost:${config.port} (provider=${config.authProvider}, backend=${config.repositoryBackend})`,
  );
});

export { app, ctx };
