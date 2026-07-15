import type { ApiConfig } from "./config.ts";
import type { Store } from "./store.ts";
import type { GameRepositoryService } from "./repository.ts";
import type { SessionService } from "./auth/session.ts";

export interface AppContext {
  config: ApiConfig;
  store: Store;
  repo: GameRepositoryService;
  session: SessionService;
  startedAt: string;
}
