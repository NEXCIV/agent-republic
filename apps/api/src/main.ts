import { createApiFromEnv } from './index.js';

/**
 * Process entrypoint. Configuration is fail-closed: a wrong chain, a missing
 * DATABASE_URL or a production run without contract addresses throws here and
 * the process exits instead of serving unverified data.
 */
const port = Number(process.env.PORT ?? 8787);

const app = createApiFromEnv(process.env);

app
  .listen({ port, host: '127.0.0.1' })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
