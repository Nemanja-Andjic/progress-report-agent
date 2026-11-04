import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      MIGRACIJE: D1Migration[];
    }
  }
}
