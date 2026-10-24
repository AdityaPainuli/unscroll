// An empty `TZ=` (e.g. from .env) makes Node fall back to UTC and report the zone as
// "Etc/Unknown". Unset it so the machine's timezone is used.
if (process.env.TZ?.trim() === "") delete process.env.TZ;

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number, got "${raw}"`);
  return value;
}

function str(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export const config = {
  telegramToken: str("TELEGRAM_BOT_TOKEN"),
  telegramOwnerId: num("TELEGRAM_OWNER_ID", 0),

  igUserId: str("IG_USER_ID"),
  igAccessToken: str("IG_ACCESS_TOKEN"),
  igGraphVersion: str("IG_GRAPH_VERSION", "v26.0"),

  briefCron: str("BRIEF_CRON", "0 9 * * 0"),
  syncCron: str("SYNC_CRON", "0 3 * * *"),
  timezone: str("TZ") || Intl.DateTimeFormat().resolvedOptions().timeZone,

  briefSize: num("BRIEF_SIZE", 5),
  outlierMinRatio: num("OUTLIER_MIN_RATIO", 3),
  outlierWindowDays: num("OUTLIER_WINDOW_DAYS", 14),

  dbPath: str("DB_PATH", "data/studio.db"),
  webPort: num("WEB_PORT", 4321),
};

export const demoMode = !config.igUserId || !config.igAccessToken;
