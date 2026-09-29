import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  calculateReminderSchedule,
  createDefaultUser,
  normalizeDate,
  progressBar,
  stepsById,
} from "../src/domain.js";

test("normalizeDate rejects impossible dates", () => {
  assert.equal(normalizeDate("2026-02-29"), null);
  assert.equal(normalizeDate("2026-09-29"), "2026-09-29");
});

test("addDays handles month boundaries", () => {
  assert.equal(addDays("2026-09-29", 7), "2026-10-06");
});

test("progressBar renders a bounded ten-cell bar", () => {
  assert.equal(progressBar(4, 8), "█████░░░░░");
  assert.equal(progressBar(20, 8), "██████████");
});

test("reminder is scheduled two days before deadline", () => {
  const user = createDefaultUser("1", 1, 180);
  user.arrivalDate = "2026-10-01";
  const step = stepsById.get("migration-registration");
  const schedule = calculateReminderSchedule(user, step, new Date("2026-10-01T00:00:00Z"));
  assert.equal(schedule.dueDate, "2026-10-08");
  assert.equal(schedule.remindAt, "2026-10-06T06:00:00.000Z");
});
