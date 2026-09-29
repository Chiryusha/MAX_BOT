import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultUser, steps } from "../src/domain.js";
import { currentStudentSetupScreen, stepScreen } from "../src/scenarios.js";

test("current student setup provides a toggle for every checklist step", () => {
  const user = createDefaultUser("42", 100, 180);
  user.situation = "current";
  user.completedStepIds = [steps[0].id];

  const setup = currentStudentSetupScreen(user);
  const buttons = setup.extra.attachments[0].payload.buttons;

  assert.match(setup.text, /Отмечено: \*\*1\/8\*\*/);
  assert.equal(buttons.length, steps.length + 2);
  assert.equal(buttons[0][0].payload, `setup:toggle:${steps[0].id}`);
  assert.equal(buttons.at(-2)[0].payload, "setup:done");
});

test("completed step hides reminder controls until it is returned to work", () => {
  const user = createDefaultUser("42", 100, 180);
  user.situation = "current";
  user.completedStepIds = [steps[0].id];

  const result = stepScreen(user, steps[0]);
  const buttons = result.extra.attachments[0].payload.buttons.flat();
  const callbacks = buttons.map((button) => button.payload).filter(Boolean);

  assert.deepEqual(callbacks, [`toggle:${steps[0].id}`, "checklist"]);
  assert.match(result.text, /сначала нажми «Вернуть в работу»/);
});
