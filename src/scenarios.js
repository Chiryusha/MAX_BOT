import { Keyboard } from "@maxhub/max-bot-api";
import {
  checklistText,
  content,
  formatDate,
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

export function checklistScreen(user) {
  const completed = new Set(user.completedStepIds || []);
  const rows = steps.map((step) => [
    Keyboard.button.callback(
      `${completed.has(step.id) ? "✅" : "⬜"} ${step.order}. ${step.title}`,
      `step:${step.id}`,
    ),
  ]);

  if (!user.readOnly) {
    rows.push([Keyboard.button.callback("📅 Изменить дату въезда", "arrival:set")]);
  }
  rows.push([Keyboard.button.callback("↩️ В начало", "onboarding")]);

  return screen(checklistText(user), rows);
}

export function stepScreen(user, step, notice = "") {
  const rows = [];
  if (!user.readOnly) {
    const completed = (user.completedStepIds || []).includes(step.id);
    rows.push([
      Keyboard.button.callback(
        completed ? "↩️ Вернуть в работу" : "✅ Отметить сделанным",
        `toggle:${step.id}`,
      ),
    ]);
    rows.push([Keyboard.button.callback("⏰ Напомнить за 2 дня", `remind:${step.id}`)]);
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
  return `⏰ Напоминание для «${step.title}» установлено. Дедлайн: **${formatDate(schedule.dueDate)}**.`;
}

export function helpScreen() {
  return screen([
    "**Команды**",
    "/start — начать заново с выбора ситуации",
    "/checklist — открыть чек-лист",
    "/arrival ГГГГ-ММ-ДД — изменить дату въезда",
    "/reset — удалить прогресс и напоминания",
    "/help — показать помощь",
  ].join("\n"), [
    [Keyboard.button.callback("Открыть чек-лист", "checklist")],
  ]);
}
