import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createDefaultUser } from "./domain.js";

function freshState() {
  return { version: 1, users: {}, reminders: {} };
}

function clone(value) {
  return structuredClone(value);
}

export class JsonStore {
  constructor(filePath, { timezoneOffsetMinutes = 180 } = {}) {
    this.filePath = filePath === ":memory:" ? ":memory:" : resolve(filePath);
    this.timezoneOffsetMinutes = timezoneOffsetMinutes;
    this.state = freshState();
  }

  load() {
    if (this.filePath === ":memory:" || !existsSync(this.filePath)) return;
    const parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    if (parsed?.version !== 1 || typeof parsed.users !== "object" || typeof parsed.reminders !== "object") {
      throw new Error(`Некорректный формат хранилища: ${this.filePath}`);
    }
    this.state = parsed;
  }

  persist() {
    if (this.filePath === ":memory:") return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp-${process.pid}`;
    writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    renameSync(temporary, this.filePath);
  }

  ensureUser(userId, chatId) {
    const key = String(userId);
    if (!this.state.users[key]) {
      this.state.users[key] = createDefaultUser(
        key,
        chatId,
        this.timezoneOffsetMinutes,
      );
    } else if (chatId !== undefined && chatId !== null) {
      this.state.users[key].chatId = Number(chatId);
      this.state.users[key].updatedAt = new Date().toISOString();
    }
    this.persist();
    return clone(this.state.users[key]);
  }

  getUser(userId) {
    const user = this.state.users[String(userId)];
    return user ? clone(user) : null;
  }

  mutateUser(userId, mutator) {
    const key = String(userId);
    const user = this.state.users[key];
    if (!user) throw new Error(`Пользователь ${key} не найден`);
    mutator(user);
    user.updatedAt = new Date().toISOString();
    this.persist();
    return clone(user);
  }

  setSituation(userId, situation, { readOnly = false, arrivalDate } = {}) {
    return this.mutateUser(userId, (user) => {
      user.situation = situation;
      user.readOnly = readOnly;
      user.awaitingInput = null;
      if (arrivalDate !== undefined) user.arrivalDate = arrivalDate;
    });
  }

  setArrivalDate(userId, arrivalDate) {
    return this.mutateUser(userId, (user) => {
      user.arrivalDate = arrivalDate;
      user.awaitingInput = null;
    });
  }

  setAwaitingInput(userId, awaitingInput) {
    return this.mutateUser(userId, (user) => {
      user.awaitingInput = awaitingInput;
    });
  }

  setCustomDeadline(userId, stepId, deadlineDate) {
    return this.mutateUser(userId, (user) => {
      user.customDeadlines ||= {};
      user.customDeadlines[stepId] = deadlineDate;
      user.awaitingInput = null;
    });
  }

  toggleStep(userId, stepId) {
    return this.mutateUser(userId, (user) => {
      const completed = new Set(user.completedStepIds || []);
      if (completed.has(stepId)) completed.delete(stepId);
      else completed.add(stepId);
      user.completedStepIds = [...completed];
    });
  }

  resetUser(userId, chatId) {
    const key = String(userId);
    this.state.users[key] = createDefaultUser(
      key,
      chatId,
      this.timezoneOffsetMinutes,
    );
    for (const [id, reminder] of Object.entries(this.state.reminders)) {
      if (reminder.userId === key) delete this.state.reminders[id];
    }
    this.persist();
    return clone(this.state.users[key]);
  }

  scheduleReminder({ userId, chatId, stepId, dueDate, remindAt }) {
    const id = `${String(userId)}:${stepId}`;
    const existing = this.state.reminders[id];
    this.state.reminders[id] = {
      id,
      userId: String(userId),
      chatId: Number(chatId),
      stepId,
      dueDate,
      remindAt,
      sentAt: null,
      attempts: 0,
      lastErrorAt: null,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.persist();
    return clone(this.state.reminders[id]);
  }

  listDueReminders(now = new Date()) {
    const nowMs = now.getTime();
    return Object.values(this.state.reminders)
      .filter((reminder) => !reminder.sentAt && Date.parse(reminder.remindAt) <= nowMs)
      .filter((reminder) => {
        if (!reminder.lastErrorAt) return true;
        const retryDelay = Math.min(3_600_000, 30_000 * (2 ** Math.min(reminder.attempts, 7)));
        return Date.parse(reminder.lastErrorAt) + retryDelay <= nowMs;
      })
      .map(clone);
  }

  markReminderSent(id, sentAt = new Date().toISOString()) {
    const reminder = this.state.reminders[id];
    if (!reminder) return;
    reminder.sentAt = sentAt;
    reminder.updatedAt = sentAt;
    this.persist();
  }

  markReminderFailed(id, failedAt = new Date().toISOString()) {
    const reminder = this.state.reminders[id];
    if (!reminder) return;
    reminder.attempts += 1;
    reminder.lastErrorAt = failedAt;
    reminder.updatedAt = failedAt;
    this.persist();
  }
}
