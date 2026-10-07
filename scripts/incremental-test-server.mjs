// Test-only built server. Never used by production startup.
import { serveTestServer } from './verify-incremental-persistence.mjs';

serveTestServer().catch(error => {
  console.error(error);
  process.exit(1);
});
