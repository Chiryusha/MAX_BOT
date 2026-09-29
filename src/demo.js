import {
  checklistText,
  createDefaultUser,
  dateInOffset,
  stepText,
  steps,
} from "./domain.js";

const user = createDefaultUser("demo-user", 1, 180);
user.situation = "new";
user.arrivalDate = dateInOffset();
user.completedStepIds = [steps[0].id, steps[1].id];

console.log("=== ДЕМО ЧЕК-ЛИСТА ===\n");
console.log(checklistText(user));
console.log("\n=== ДЕМО КАРТОЧКИ ===\n");
console.log(stepText(user, steps[1]));
