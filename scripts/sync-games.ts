import { readConfig, syncGames } from "./sync-lib.ts";

const config = readConfig();
const result = await syncGames(config);
process.exit(result.ok ? 0 : 1);
