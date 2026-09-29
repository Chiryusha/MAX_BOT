import { Keyboard } from "@maxhub/max-bot-api";
import {
  checklistText,
  content,
  formatDate,
  formatDateTimeInOffset,
  stepText,
  steps,
} from "./domain.js";

function screen(text, rows = []) {
  const attachments = rows.length > 0
    ? [Keyboard.inlineKeyboard(rows)]
    : [];
  return { text, extra: { format: "markdown", attachments } };
}

export function onboardingScreen() {
  return screen([
    `**${content.productName}**`,
    content.subtitle,
    "",
    "Привет! Я помогу разобраться с документами после приезда в Россию.",
    "Выбери свою ситуацию:",
    "",
    `_${content.disclaimer}_`,
  ].join("\n"), [
    [Keyboard.button.callback("🎓 Я студент, только приехал", "profile:new")],
    [Keyboard.button.callback("🏠 Я уже учусь", "profile:current")],
    [Keyboard.button.callback("❓ Просто посмотреть", "profile:preview")],
  ]);
}

export function checklistScreen(user, reminders = []) {
  const completed = new Set(user.completedStepIds || []);
  const rows = steps.map((step) => [
    Keyboard.button.callback(
      `${completed.has(step.id) ? "✅" : "⬜"} ${step.order}. ${step.title}`,
      `step:${step.id}`,
    ),
  ]);

  if (!user.readOnly) {
    rows.push([Keyboard.button.callback("📅 Изменить дату въезда", "arrival:set")]);
    rows.push([Keyboard.button.callback(`⏰ Мои напоминания (${reminders.length})`, "reminders")]);
  }
  rows.push([Keyboard.button.callback("↩️ В начало", "onboarding")]);

  return screen(checklistText(user), rows);
}

export function stepScreen(user, step, notice = "", reminder = null) {
  const rows = [];
  if (!user.readOnly) {
    const completed = (user.completedStepIds || []).includes(step.id);
    rows.push([
      Keyboard.button.callback(
        completed ? "↩️ Вернуть в работу" : "✅ Отметить сделанным",
        `toggle:${step.id}`,
      ),
    ]);
    rows.push([
      Keyboard.button.callback(
        reminder ? "⚙️ Настроить напоминание" : "⏰ Напомнить за 2 дня",
        reminder ? `reminder:${step.id}` : `remind:${step.id}`,
      ),
    ]);
  }
  rows.push([Keyboard.button.link(`🔗 ${step.sourceLabel}`, step.sourceUrl)]);
  rows.push([Keyboard.button.callback("← К чек-листу", "checklist")]);
  return screen(stepText(user, step, notice), rows);
}

export function arrivalPromptScreen() {
  return screen([
    "**Дата въезда**",
    "",
    "Отправь дату одним сообщением в формате **ГГГГ-ММ-ДД**.",
    "Например: `2026-09-29`.",
  ].join("\n"), [
    [Keyboard.button.callback("Отмена", "checklist")],
  ]);
}

export function deadlinePromptScreen(step) {
  return screen([
    `**Дедлайн: ${step.title}**`,
    "",
    "Для этого шага нет универсального срока. Сначала уточни дату в вузе или официальном ведомстве, затем отправь её в формате **ГГГГ-ММ-ДД**.",
    "Например: `2026-12-15`.",
  ].join("\n"), [
    [Keyboard.button.callback("Отмена", `step:${step.id}`)],
  ]);
}

export function reminderConfirmationText(step, schedule) {
  return `⏰ Напоминание для «${step.title}» установлено за ${schedule.leadDays} дн. до срока. Дедлайн: **${formatDate(schedule.dueDate)}**.`;
}

export function remindersScreen(user, reminders) {
  const rows = reminders.map((reminder) => {
    const step = steps.find((item) => item.id === reminder.stepId);
    return [Keyboard.button.callback(
      `⚙️ ${step ? `${step.order}. ${step.title}` : reminder.stepId}`,
      `reminder:${reminder.stepId}`,
    )];
  });
  rows.push([Keyboard.button.callback("← К чек-листу", "checklist")]);

  const lines = reminders.length === 0
    ? ["Активных напоминаний пока нет.", "", "Открой нужный пункт чек-листа и нажми «Напомнить за 2 дня»."]
    : reminders.map((reminder) => {
      const step = steps.find((item) => item.id === reminder.stepId);
      const title = step ? `${step.order}. ${step.title}` : reminder.stepId;
      return `• **${title}**\n  ${formatDateTimeInOffset(reminder.remindAt, user.timezoneOffsetMinutes)}`;
    });

  return screen(["**Мои напоминания**", "", ...lines].join("\n"), rows);
}

export function reminderSettingsScreen(user, step, reminder, notice = "") {
  if (!reminder) {
    return stepScreen(user, step, "Напоминание не найдено или уже отправлено.");
  }

  const leadDays = Number.isInteger(reminder.leadDays) ? reminder.leadDays : 2;
  const lines = [
    `**Напоминание: ${step.title}**`,
    "",
    `Дедлайн: **${formatDate(reminder.dueDate)}**`,
    `Когда напомнить: **${formatDateTimeInOffset(reminder.remindAt, user.timezoneOffsetMinutes)}**`,
    `Интервал: **за ${leadDays} дн. до срока**`,
  ];
  if (notice) lines.push("", notice);

  return screen(lines.join("\n"), [
    [
      Keyboard.button.callback("За 1 день", `reminder:offset:${step.id}:1`),
      Keyboard.button.callback("За 2 дня", `reminder:offset:${step.id}:2`),
    ],
    [
      Keyboard.button.callback("За 3 дня", `reminder:offset:${step.id}:3`),
      Keyboard.button.callback("За 7 дней", `reminder:offset:${step.id}:7`),
    ],
    [Keyboard.button.callback("📅 Изменить дедлайн", `reminder:deadline:${step.id}`)],
    [Keyboard.button.callback("🗑 Отключить", `reminder:delete:${step.id}`)],
    [Keyboard.button.callback("← К напоминаниям", "reminders")],
  ]);
}

export function helpScreen() {
  return screen([
    "**Команды**",
    "/start — начать заново с выбора ситуации",
    "/checklist — открыть чек-лист",
    "/arrival ГГГГ-ММ-ДД — изменить дату въезда",
    "/reminders — открыть и настроить напоминания",
    "/reset — удалить прогресс и напоминания",
    "/help — показать помощь",
  ].join("\n"), [
    [Keyboard.button.callback("Открыть чек-лист", "checklist")],
  ]);
}
