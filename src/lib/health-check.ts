export type CheckResult = 'ok' | 'error';

interface DatabaseClient {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
}

interface RedisClient {
  ping: () => Promise<string>;
}

interface MinimalLogger {
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

export const checkDatabase = async (
  client: DatabaseClient,
  logger: MinimalLogger,
): Promise<CheckResult> => {
  try {
    await client.$queryRaw`SELECT 1`;
    return 'ok';
  } catch (error) {
    logger.error({ err: error }, 'Health check de base de datos falló');
    return 'error';
  }
};

export const checkRedis = async (
  client: RedisClient,
  logger: MinimalLogger,
): Promise<CheckResult> => {
  try {
    await client.ping();
    return 'ok';
  } catch (error) {
    logger.error({ err: error }, 'Health check de Redis falló');
    return 'error';
  }
};
