import { formatDate, stepsById } from "./domain.js";

export async function deliverDueReminders(bot, store, now = new Date()) {
  const due = store.listDueReminders(now);

  for (const reminder of due) {
    const step = stepsById.get(reminder.stepId);
    if (!step) {
      store.markReminderSent(reminder.id, now.toISOString());
      continue;
    }

    try {
      await bot.api.sendMessageToChat(
        reminder.chatId,
        [
          `⏰ **Скоро дедлайн: ${step.title}**`,
          `Дата в твоём чек-листе: **${formatDate(reminder.dueDate)}**.`,
          "Открой /checklist, проверь статус и сверь требования с вузом или официальным ведомством.",
        ].join("\n"),
        { format: "markdown" },
      );
      store.markReminderSent(reminder.id, now.toISOString());
    } catch (error) {
      console.error(`Не удалось отправить напоминание ${reminder.id}`, error);
      store.markReminderFailed(reminder.id, now.toISOString());
    }
  }
}

export function startReminderWorker(bot, store, intervalMs) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await deliverDueReminders(bot, store);
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), intervalMs);

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
