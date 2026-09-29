import { readFileSync } from "node:fs";

const contentUrl = new URL("./content.json", import.meta.url);

export const content = JSON.parse(readFileSync(contentUrl, "utf8"));
export const steps = [...content.steps].sort((a, b) => a.order - b.order);
export const stepsById = new Map(steps.map((step) => [step.id, step]));

if (steps.length === 0 || stepsById.size !== steps.length) {
  throw new Error("content.json должен содержать непустой список шагов с уникальными id");
}

export function createDefaultUser(userId, chatId, timezoneOffsetMinutes = 180) {
  const now = new Date().toISOString();
  return {
    userId: String(userId),
    chatId: Number(chatId),
    situation: null,
    readOnly: false,
    arrivalDate: null,
    timezoneOffsetMinutes,
    completedStepIds: [],
    customDeadlines: {},
    awaitingInput: null,
    createdAt: now,
    updatedAt: now
  };
}

export function normalizeDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function dateInOffset(date = new Date(), offsetMinutes = 180) {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export function addDays(dateString, days) {
  const normalized = normalizeDate(dateString);
  if (!normalized) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatDate(dateString) {
  const normalized = normalizeDate(dateString);
  if (!normalized) return "не указана";
  const [year, month, day] = normalized.split("-");
  return `${day}.${month}.${year}`;
}

export function getEffectiveDeadline(user, step) {
  const custom = normalizeDate(user.customDeadlines?.[step.id]);
  if (custom) return custom;
  if (Number.isInteger(step.deadlineDaysFromArrival) && user.arrivalDate) {
    return addDays(user.arrivalDate, step.deadlineDaysFromArrival);
  }
  return null;
}

export function calculateReminderSchedule(user, step, now = new Date(), { leadDays = 2 } = {}) {
  const dueDate = getEffectiveDeadline(user, step);
  if (!dueDate) return null;

  const safeLeadDays = Number.isInteger(leadDays) && leadDays >= 0 ? leadDays : 2;
  const reminderDate = addDays(dueDate, -safeLeadDays);
  const offset = Number.isInteger(user.timezoneOffsetMinutes)
    ? user.timezoneOffsetMinutes
    : 180;
  const [year, month, day] = reminderDate.split("-").map(Number);
  const targetMs = Date.UTC(year, month - 1, day, 9, 0, 0) - offset * 60_000;
  const minimumMs = now.getTime() + 60_000;

  return {
    dueDate,
    remindAt: new Date(Math.max(targetMs, minimumMs)).toISOString(),
    leadDays: safeLeadDays,
  };
}

export function formatDateTimeInOffset(isoString, offsetMinutes = 180) {
  const value = new Date(isoString);
  if (Number.isNaN(value.getTime())) return "не указано";
  const shifted = new Date(value.getTime() + offsetMinutes * 60_000);
  const [date, time] = shifted.toISOString().split("T");
  return `${formatDate(date)} в ${time.slice(0, 5)}`;
}

export function progressBar(completedCount, totalCount, width = 10) {
  const ratio = totalCount === 0 ? 0 : completedCount / totalCount;
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

export function checklistText(user) {
  const completed = new Set(user.completedStepIds || []);
  const count = steps.filter((step) => completed.has(step.id)).length;
  const mode = user.readOnly
    ? "Режим просмотра"
    : user.situation === "new"
      ? "Первые шаги после въезда"
      : user.situation === "current"
        ? "Проверка документов и сроков"
        : "Личный чек-лист";
  const arrival = user.arrivalDate
    ? `Дата въезда: ${formatDate(user.arrivalDate)}`
    : "Дата въезда не указана — автоматические дедлайны пока не считаются";
  const lineForStep = (step) => {
    const marker = completed.has(step.id) ? "✅" : "⬜";
    return `${marker} ${step.order}. ${step.title}`;
  };

  let lines;
  if (user.situation === "new" && !user.readOnly) {
    const urgent = steps.filter((step) => (
      Number.isInteger(step.deadlineDaysFromArrival)
      && step.deadlineDaysFromArrival <= 7
    ));
    const later = steps.filter((step) => !urgent.includes(step));
    lines = [
      "**⚡ Срочно после въезда**",
      ...urgent.map(lineForStep),
      "",
      "**📋 Следующие шаги**",
      ...later.map(lineForStep),
    ];
  } else {
    lines = steps.map(lineForStep);
  }

  const guidance = user.readOnly
    ? "Открой пункт, чтобы посмотреть карточку. Изменения в режиме просмотра не сохраняются."
    : user.situation === "current"
      ? "Отмеченные пункты уже оформлены. Открой документ, чтобы проверить актуальность, срок действия и настроить напоминание."
      : "Сначала проверь срочные пункты, затем двигайся по остальному списку. В карточке можно отметить выполнение и поставить напоминание.";

  return [
    `**${content.productName} — ${mode}**`,
    `${progressBar(count, steps.length)} ${count}/${steps.length}`,
    arrival,
    "",
    ...lines,
    "",
    guidance,
    "",
    `_${content.disclaimer}_`,
  ].join("\n");
}

export function stepText(user, step, notice = "") {
  const completed = (user.completedStepIds || []).includes(step.id);
  const deadlineDate = getEffectiveDeadline(user, step);
  const documents = step.documents.map((item) => `• ${item}`).join("\n");

  const lines = [
    `**${completed ? "✅" : "⬜"} ${step.order}. ${step.title}**`,
  ];

  if (user.situation === "current" && !user.readOnly) {
    lines.push(
      "",
      completed
        ? "**Статус**\nДокумент отмечен как оформленный. Проверь его актуальность и срок действия, если он ограничен."
        : "**Статус**\nДокумент пока не отмечен. Проверь, требуется ли его оформить или восстановить.",
    );
  }

  lines.push(
    "",
    `**Что это**\n${step.summary}`,
    "",
    `**Где делать**\n${step.where}`,
    "",
    `**Что взять**\n${documents}`,
    "",
    `**Срок**\n${step.deadline}`,
    deadlineDate ? `Персональная дата в боте: **${formatDate(deadlineDate)}**` : "Персональная дата пока не задана.",
    "",
    `**Если просрочить**\n${step.consequence}`,
  );

  if (notice) lines.push("", notice);
  lines.push("", `_${content.disclaimer}_`);
  return lines.join("\n");
}
