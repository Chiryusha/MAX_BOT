import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { JsonStore } from "../src/storage.js";

test("JsonStore persists progress and keeps one reminder per step", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "first-step-bot-"));
  t.after(() => {
    const resolved = resolve(directory);
    assert.ok(resolved.startsWith(resolve(tmpdir())));
    rmSync(resolved, { recursive: true, force: true });
  });

  const file = join(directory, "state.json");
  const store = new JsonStore(file);
  store.ensureUser("42", 100);
  store.setSituation("42", "new", { arrivalDate: "2026-09-29" });
  store.toggleStep("42", "migration-card");
  store.scheduleReminder({
    userId: "42",
    chatId: 100,
    stepId: "migration-registration",
    dueDate: "2026-10-06",
    remindAt: "2026-10-04T06:00:00.000Z",
  });
  store.scheduleReminder({
    userId: "42",
    chatId: 100,
    stepId: "migration-registration",
    dueDate: "2026-10-07",
    remindAt: "2026-10-05T06:00:00.000Z",
  });

  const reloaded = new JsonStore(file);
  reloaded.load();
  assert.deepEqual(reloaded.getUser("42").completedStepIds, ["migration-card"]);
  assert.equal(Object.keys(JSON.parse(readFileSync(file, "utf8")).reminders).length, 1);
  assert.equal(reloaded.listDueReminders(new Date("2026-10-05T06:00:00.000Z")).length, 1);
  assert.equal(reloaded.listUserReminders("42").length, 1);
  assert.equal(reloaded.getReminder("42", "migration-registration").dueDate, "2026-10-07");
  assert.equal(reloaded.deleteReminder("42", "migration-registration"), true);
  assert.equal(reloaded.listUserReminders("42").length, 0);
});
