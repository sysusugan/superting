const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "src/components/OnboardingFlow.tsx"), "utf8");

test("onboarding navigation exposes the first setup step controls", () => {
  assert.match(source, /const showProgress = true;/);
  assert.doesNotMatch(source, /const showProgress = currentStep > 0;/);
});

test("onboarding step metadata matches the three rendered steps", () => {
  const stepsBlock = source.match(/const steps = useMemo\([\s\S]*?\n\s*\);\n\n\s*const showProgress/);
  assert.ok(stepsBlock, "expected steps useMemo block");

  assert.match(stepsBlock[0], /id: "setup"/);
  assert.match(stepsBlock[0], /id: "permissions"/);
  assert.match(stepsBlock[0], /id: "activation"/);
  assert.doesNotMatch(stepsBlock[0], /id: "welcome"/);
});

test("onboarding progress uses direct step indexes", () => {
  const progressLine = source.match(/<StepProgress[^\n]+\/>/)?.[0] ?? "";

  assert.equal(progressLine, "<StepProgress steps={steps} currentStep={currentStep} />");
  assert.doesNotMatch(source, /steps\.slice\(1\)/);
  assert.doesNotMatch(progressLine, /currentStep - 1/);
});

test("activation step index points at the rendered activation step", () => {
  assert.match(source, /const activationStepIndex = 2;/);
  assert.doesNotMatch(source, /const activationStepIndex = 3;/);
});
