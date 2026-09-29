const MODES = new Set(["polling", "webhook"]);

function positiveInteger(value, fallback, name) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  if (value === undefined || value === "") return fallback;
  throw new Error(`${name} должен быть положительным целым числом`);
}

function integerInRange(value, fallback, name, min, max) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isInteger(parsed) && parsed >= min && parsed <= max) return parsed;
  if (value === undefined || value === "") return fallback;
  throw new Error(`${name} должен быть целым числом от ${min} до ${max}`);
}

export function loadConfig(env = process.env) {
  const mode = (env.BOT_MODE || "polling").trim().toLowerCase();

  return {
    token: env.MAX_BOT_TOKEN?.trim() || "",
    mode,
    port: positiveInteger(env.PORT, 3000, "PORT"),
    publicBaseUrl: env.PUBLIC_BASE_URL?.trim() || "",
    webhookSecret: env.WEBHOOK_SECRET?.trim() || "",
    webhookPath: env.WEBHOOK_PATH?.trim() || "",
    stateFile: env.STATE_FILE?.trim() || "./data/state.json",
    reminderPollIntervalMs: positiveInteger(
      env.REMINDER_POLL_INTERVAL_MS,
      30_000,
      "REMINDER_POLL_INTERVAL_MS",
    ),
    defaultTimezoneOffsetMinutes: integerInRange(
      env.DEFAULT_TIMEZONE_OFFSET_MINUTES,
      180,
      "DEFAULT_TIMEZONE_OFFSET_MINUTES",
      -720,
      840,
    ),
  };
}

export function assertConfig(config) {
  if (!config.token) {
    throw new Error("Не задан MAX_BOT_TOKEN. Скопируйте .env.example в .env и вставьте токен.");
  }

  if (!MODES.has(config.mode)) {
    throw new Error("BOT_MODE должен быть polling или webhook");
  }

  if (config.mode === "webhook") {
    if (!config.publicBaseUrl) {
      throw new Error("Для webhook-режима задайте PUBLIC_BASE_URL с внешним HTTPS-адресом");
    }
    if (!config.webhookSecret) {
      throw new Error("Для webhook-режима задайте WEBHOOK_SECRET");
    }
  }
}
