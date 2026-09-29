import { createServer } from "node:http";
import { Bot, Webhook } from "@maxhub/max-bot-api";
import { assertConfig, loadConfig } from "./config.js";
import {
  calculateReminderSchedule,
  dateInOffset,
  isArrivalDateAllowed,
  normalizeDate,
  stepsById,
} from "./domain.js";
import { startReminderWorker } from "./reminders.js";
import {
  arrivalPromptScreen,
  checklistScreen,
  currentStudentSetupScreen,
  deadlinePromptScreen,
  helpScreen,
  onboardingScreen,
  reminderConfirmationText,
  reminderSettingsScreen,
  remindersScreen,
  stepScreen,
} from "./scenarios.js";
import { JsonStore } from "./storage.js";
import { configureMaxApiTls } from "./tls.js";

const ALLOWED_UPDATES = ["bot_started", "message_created", "message_callback"];

function idsFromContext(ctx) {
  const userId = ctx.user?.user_id;
  const chatId = ctx.chatId;
  if (userId === undefined || chatId === undefined || chatId === null) {
    throw new Error(`Не удалось определить пользователя или чат для ${ctx.updateType}`);
  }
  return { userId: String(userId), chatId: Number(chatId) };
}

async function sendScreen(ctx, value, replace = false) {
  if (replace && ctx.callback) {
    return ctx.answerOnCallback({
      message: {
        text: value.text,
        format: value.extra.format,
        attachments: value.extra.attachments,
      },
    });
  }
  return ctx.reply(value.text, value.extra);
}

function commandArgument(ctx) {
  const text = ctx.message?.body?.text || "";
  return text.trim().split(/\s+/).slice(1).join(" ");
}

function registerHandlers(bot, store) {
  const ensure = (ctx) => {
    const { userId, chatId } = idsFromContext(ctx);
    const user = store.ensureUser(userId, chatId);
    return { userId, chatId, user };
  };

  const showOnboarding = (ctx, replace = false) => {
    ensure(ctx);
    return sendScreen(ctx, onboardingScreen(), replace);
  };

  const checklist = (user) => checklistScreen(
    user,
    store.listUserReminders(user.userId),
  );

  const stepDetails = (user, step, notice = "") => stepScreen(
    user,
    step,
    notice,
    store.getReminder(user.userId, step.id),
  );

  const stepIsCompleted = (user, stepId) => (
    (user.completedStepIds || []).includes(stepId)
  );

  const completedStepScreen = (user, step) => {
    store.deleteReminder(user.userId, step.id);
    return stepDetails(
      user,
      step,
      "⛔ Напоминание не установлено.",
    );
  };

  const rescheduleActiveReminders = (userId, chatId) => {
    const user = store.getUser(userId);
    for (const reminder of store.listUserReminders(userId)) {
      const step = stepsById.get(reminder.stepId);
      if (!step) continue;
      const schedule = calculateReminderSchedule(user, step, new Date(), {
        leadDays: Number.isInteger(reminder.leadDays) ? reminder.leadDays : 2,
      });
      if (schedule) {
        store.scheduleReminder({ userId, chatId, stepId: step.id, ...schedule });
      }
    }
  };

  bot.on("bot_started", (ctx) => showOnboarding(ctx));
  bot.command("start", (ctx) => showOnboarding(ctx));

  bot.command("help", (ctx) => {
    ensure(ctx);
    return sendScreen(ctx, helpScreen());
  });

  bot.command("checklist", (ctx) => {
    const { user } = ensure(ctx);
    return sendScreen(ctx, user.situation ? checklist(user) : onboardingScreen());
  });

  bot.command("reminders", (ctx) => {
    const { userId, user } = ensure(ctx);
    if (user.readOnly) return sendScreen(ctx, checklist(user));
    return sendScreen(ctx, remindersScreen(user, store.listUserReminders(userId)));
  });

  bot.command("reset", (ctx) => {
    const { userId, chatId } = ensure(ctx);
    store.resetUser(userId, chatId);
    return sendScreen(ctx, onboardingScreen());
  });

  bot.command("arrival", (ctx) => {
    const { userId, user } = ensure(ctx);
    if (user.readOnly) return sendScreen(ctx, checklist(user));
    const candidate = normalizeDate(commandArgument(ctx));
    if (!candidate) {
      store.setAwaitingInput(userId, "arrival");
      return sendScreen(ctx, arrivalPromptScreen());
    }
    if (!isArrivalDateAllowed(candidate, new Date(), user.timezoneOffsetMinutes)) {
      store.setAwaitingInput(userId, "arrival");
      return sendScreen(
        ctx,
        arrivalPromptScreen("⛔ Дата въезда не может быть в будущем. Укажи сегодняшнюю или прошедшую дату."),
      );
    }
    const updated = store.setArrivalDate(userId, candidate);
    rescheduleActiveReminders(userId, updated.chatId);
    return sendScreen(ctx, checklist(store.getUser(userId)));
  });

  bot.action("onboarding", (ctx) => showOnboarding(ctx, true));

  bot.action(/^profile:(new|current|preview)$/, (ctx) => {
    const { userId, user } = ensure(ctx);
    const choice = ctx.match?.[1];
    const arrivalDate = choice === "new"
      ? dateInOffset(new Date(), user.timezoneOffsetMinutes)
      : user.arrivalDate;
    const updated = store.setSituation(userId, choice, {
      readOnly: choice === "preview",
      arrivalDate,
    });
    if (choice === "current") {
      return sendScreen(ctx, currentStudentSetupScreen(updated), true);
    }
    return sendScreen(ctx, checklist(updated), true);
  });

  bot.action("setup:open", (ctx) => {
    const { user } = ensure(ctx);
    if (user.readOnly || user.situation !== "current") {
      return sendScreen(ctx, checklist(user), true);
    }
    return sendScreen(ctx, currentStudentSetupScreen(user), true);
  });

  bot.action(/^setup:toggle:([a-z0-9-]+)$/, (ctx) => {
    const { userId, user } = ensure(ctx);
    const step = stepsById.get(ctx.match?.[1]);
    if (!step || user.readOnly || user.situation !== "current") {
      return sendScreen(ctx, checklist(user), true);
    }
    const wasCompleted = stepIsCompleted(user, step.id);
    const updated = store.toggleStep(userId, step.id);
    if (!wasCompleted) store.deleteReminder(userId, step.id);
    return sendScreen(ctx, currentStudentSetupScreen(updated), true);
  });

  bot.action("setup:done", (ctx) => {
    const { user } = ensure(ctx);
    if (user.readOnly || user.situation !== "current") {
      return sendScreen(ctx, checklist(user), true);
    }
    return sendScreen(ctx, checklist(user), true);
  });

  bot.action("checklist", (ctx) => {
    const { userId, user } = ensure(ctx);
    if (user.awaitingInput) store.setAwaitingInput(userId, null);
    return sendScreen(ctx, checklist(store.getUser(userId)), true);
  });

  bot.action("reminders", (ctx) => {
    const { userId, user } = ensure(ctx);
    if (user.readOnly) return sendScreen(ctx, checklist(user), true);
    if (user.awaitingInput) store.setAwaitingInput(userId, null);
    return sendScreen(
      ctx,
      remindersScreen(store.getUser(userId), store.listUserReminders(userId)),
      true,
    );
  });

  bot.action("arrival:set", (ctx) => {
    const { userId, user } = ensure(ctx);
    if (user.readOnly) return sendScreen(ctx, checklist(user), true);
    store.setAwaitingInput(userId, "arrival");
    return sendScreen(ctx, arrivalPromptScreen(), true);
  });

  bot.action(/^step:([a-z0-9-]+)$/, (ctx) => {
    const { user } = ensure(ctx);
    const step = stepsById.get(ctx.match?.[1]);
    if (!step) return sendScreen(ctx, checklist(user), true);
    return sendScreen(ctx, stepDetails(user, step), true);
  });

  bot.action(/^toggle:([a-z0-9-]+)$/, (ctx) => {
    const { userId, user } = ensure(ctx);
    const step = stepsById.get(ctx.match?.[1]);
    if (!step || user.readOnly) return sendScreen(ctx, checklist(user), true);
    const wasCompleted = stepIsCompleted(user, step.id);
    const updated = store.toggleStep(userId, step.id);
    if (!wasCompleted) store.deleteReminder(userId, step.id);
    return sendScreen(ctx, checklist(updated), true);
  });

  bot.action(/^remind:([a-z0-9-]+)$/, (ctx) => {
    const { userId, chatId, user } = ensure(ctx);
    const step = stepsById.get(ctx.match?.[1]);
    if (!step || user.readOnly) return sendScreen(ctx, checklist(user), true);
    if (stepIsCompleted(user, step.id)) {
      return sendScreen(ctx, completedStepScreen(user, step), true);
    }

    const schedule = calculateReminderSchedule(user, step);
    if (!schedule) {
      store.setAwaitingInput(userId, `deadline:${step.id}`);
      return sendScreen(ctx, deadlinePromptScreen(step), true);
    }

    store.scheduleReminder({ userId, chatId, stepId: step.id, ...schedule });
    return sendScreen(
      ctx,
      stepDetails(user, step, reminderConfirmationText(step, schedule)),
      true,
    );
  });

  bot.action(/^reminder:([a-z0-9-]+)$/, (ctx) => {
    const { userId, user } = ensure(ctx);
    const step = stepsById.get(ctx.match?.[1]);
    if (!step || user.readOnly) return sendScreen(ctx, checklist(user), true);
    if (stepIsCompleted(user, step.id)) {
      return sendScreen(ctx, completedStepScreen(user, step), true);
    }
    return sendScreen(
      ctx,
      reminderSettingsScreen(user, step, store.getReminder(userId, step.id)),
      true,
    );
  });

  bot.action(/^reminder:offset:([a-z0-9-]+):(1|2|3|7)$/, (ctx) => {
    const { userId, chatId, user } = ensure(ctx);
    const step = stepsById.get(ctx.match?.[1]);
    const leadDays = Number(ctx.match?.[2]);
    if (!step || user.readOnly) return sendScreen(ctx, checklist(user), true);
    if (stepIsCompleted(user, step.id)) {
      return sendScreen(ctx, completedStepScreen(user, step), true);
    }

    const schedule = calculateReminderSchedule(user, step, new Date(), { leadDays });
    if (!schedule) {
      store.setAwaitingInput(userId, `deadline:${step.id}:${leadDays}`);
      return sendScreen(ctx, deadlinePromptScreen(step), true);
    }

    const reminder = store.scheduleReminder({
      userId,
      chatId,
      stepId: step.id,
      ...schedule,
    });
    return sendScreen(
      ctx,
      reminderSettingsScreen(user, step, reminder, `✅ Теперь напомню за ${leadDays} дн. до срока.`),
      true,
    );
  });

  bot.action(/^reminder:deadline:([a-z0-9-]+)$/, (ctx) => {
    const { userId, user } = ensure(ctx);
    const step = stepsById.get(ctx.match?.[1]);
    if (!step || user.readOnly) return sendScreen(ctx, checklist(user), true);
    if (stepIsCompleted(user, step.id)) {
      return sendScreen(ctx, completedStepScreen(user, step), true);
    }
    const reminder = store.getReminder(userId, step.id);
    const leadDays = Number.isInteger(reminder?.leadDays) ? reminder.leadDays : 2;
    store.setAwaitingInput(userId, `deadline:${step.id}:${leadDays}`);
    return sendScreen(ctx, deadlinePromptScreen(step), true);
  });

  bot.action(/^reminder:delete:([a-z0-9-]+)$/, (ctx) => {
    const { userId, user } = ensure(ctx);
    const step = stepsById.get(ctx.match?.[1]);
    if (!step || user.readOnly) return sendScreen(ctx, checklist(user), true);
    store.deleteReminder(userId, step.id);
    return sendScreen(ctx, stepDetails(user, step, "🔕 Напоминание отключено."), true);
  });

  bot.on("message_created", async (ctx) => {
    const { userId, chatId, user } = ensure(ctx);
    const text = ctx.message?.body?.text?.trim() || "";

    if (!user.awaitingInput) {
      return sendScreen(ctx, user.situation ? helpScreen() : onboardingScreen());
    }

    const candidate = normalizeDate(text);
    if (!candidate) {
      return ctx.reply("Не получилось распознать дату. Отправь её в формате ГГГГ-ММ-ДД, например 2026-09-29.");
    }

    if (user.awaitingInput === "arrival") {
      if (!isArrivalDateAllowed(candidate, new Date(), user.timezoneOffsetMinutes)) {
        return ctx.reply("⛔ Дата въезда не может быть в будущем. Отправь сегодняшнюю или прошедшую дату в формате ГГГГ-ММ-ДД.");
      }
      const updated = store.setArrivalDate(userId, candidate);
      rescheduleActiveReminders(userId, chatId);
      return sendScreen(ctx, checklist(store.getUser(userId)));
    }

    if (user.awaitingInput.startsWith("deadline:")) {
      const [, stepId, rawLeadDays] = user.awaitingInput.split(":");
      const leadDays = [1, 2, 3, 7].includes(Number(rawLeadDays))
        ? Number(rawLeadDays)
        : 2;
      const step = stepsById.get(stepId);
      if (!step) {
        store.setAwaitingInput(userId, null);
        return sendScreen(ctx, checklist(store.getUser(userId)));
      }
      if (stepIsCompleted(user, step.id)) {
        store.setAwaitingInput(userId, null);
        return sendScreen(ctx, completedStepScreen(store.getUser(userId), step));
      }

      const updated = store.setCustomDeadline(userId, stepId, candidate);
      const schedule = calculateReminderSchedule(updated, step, new Date(), { leadDays });
      const reminder = store.scheduleReminder({ userId, chatId, stepId, ...schedule });
      return sendScreen(
        ctx,
        reminderSettingsScreen(
          updated,
          step,
          reminder,
          reminderConfirmationText(step, schedule),
        ),
      );
    }

    store.setAwaitingInput(userId, null);
    return sendScreen(ctx, checklist(store.getUser(userId)));
  });
}

function createHttpServer({ port, mode, webhookHandler, readiness }) {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      const status = readiness.ready ? 200 : 503;
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: readiness.ready ? "ok" : "starting", mode }));
      return;
    }

    if (webhookHandler) {
      webhookHandler(req, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve(server));
  });
}

async function main() {
  const config = loadConfig();
  assertConfig(config);
  configureMaxApiTls();

  const store = new JsonStore(config.stateFile, {
    timezoneOffsetMinutes: config.defaultTimezoneOffsetMinutes,
  });
  store.load();
  store.pruneCompletedReminders();

  const bot = new Bot(config.token);
  registerHandlers(bot, store);
  bot.catch((error, ctx) => {
    console.error(`Ошибка обработки ${ctx.updateType}`, error);
    throw error;
  });

  bot.botInfo = await bot.api.getMyInfo();
  await bot.api.setMyCommands([
    { name: "start", description: "Начать работу" },
    { name: "checklist", description: "Открыть чек-лист" },
    { name: "arrival", description: "Изменить дату въезда" },
    { name: "reminders", description: "Настроить напоминания" },
    { name: "reset", description: "Сбросить прогресс" },
    { name: "help", description: "Показать команды" },
  ]);

  const readiness = { ready: false };
  let server;

  if (config.mode === "webhook") {
    const path = config.webhookPath || `/webhook/${Webhook.generateTokenRelatedHash(config.token)}`;
    const webhookHandler = bot.webhookCallback({
      domain: config.publicBaseUrl,
      path,
      secret: config.webhookSecret,
    });
    server = await createHttpServer({
      port: config.port,
      mode: config.mode,
      webhookHandler,
      readiness,
    });
    const webhookUrl = Webhook.getWebhookUrl(config.publicBaseUrl, path);
    await bot.api.subscribe(webhookUrl, config.webhookSecret, ALLOWED_UPDATES);
    await Webhook.clearSubscriptions(bot.api, webhookUrl);
    readiness.ready = true;
    console.log(`Бот @${bot.botInfo.username} запущен: webhook ${webhookUrl}`);
  } else {
    await Webhook.clearSubscriptions(bot.api);
    server = await createHttpServer({
      port: config.port,
      mode: config.mode,
      webhookHandler: null,
      readiness,
    });
    readiness.ready = true;
    console.log(`Бот @${bot.botInfo.username} запущен: long polling`);
    void bot.startPolling({ allowedUpdates: ALLOWED_UPDATES, retry: true });
  }

  const reminderWorker = startReminderWorker(
    bot,
    store,
    config.reminderPollIntervalMs,
  );

  const shutdown = (signal) => {
    console.log(`Получен ${signal}, завершаю работу`);
    readiness.ready = false;
    reminderWorker.stop();
    bot.stopPolling();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("Не удалось запустить бота", error);
  process.exit(1);
});
