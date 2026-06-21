const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");

const SCAN_ROOTS = [
  "src",
  "README.md",
  "README.en.md",
  "docs",
  "agent-skills",
  "package.json",
];

const FORBIDDEN = [
  /SuperTing Cloud/i,
  /api\.superting\.com/i,
  /auth\.superting\.com/i,
  /notes\.superting\.com/i,
  /mcp\.superting\.com/i,
  /stripe/i,
  /checkout/i,
  /billing portal/i,
  /subscription/i,
  /upgrade to pro/i,
  /paid plan/i,
  /business plan/i,
  /usage limit/i,
  /referral/i,
];

const FORBIDDEN_PATHS = [
  "src/config/supertingCloud.js",
  "src/services/cloudApi.ts",
  "src/services/SyncService.ts",
  "src/services/ai/inferenceProviders/superting.ts",
  "src/components/UpgradePrompt.tsx",
  "src/components/UsageDisplay.tsx",
  "src/components/ReferralDashboard.tsx",
  "src/components/ReferralModal.tsx",
  "src/components/settings/WorkspaceBillingTab.tsx",
  "src/components/AuthenticationStep.tsx",
  "src/components/EmailVerificationStep.tsx",
  "src/components/ForgotPasswordView.tsx",
  "src/hooks/useAuth.ts",
  "src/hooks/useUsage.ts",
  "src/lib/auth.ts",
];

const ALLOWED_FILES = new Set([
  "src/utils/transcriptFindReplace.test.mjs",
  "src/helpers/meetingProcessDetector.js",
  "src/helpers/audioActivityDetector.js",
]);

function* walk(target) {
  const absolute = path.join(ROOT, target);
  if (!fs.existsSync(absolute)) return;
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(absolute)) {
      if (entry === "node_modules" || entry === "dist") continue;
      yield* walk(path.join(target, entry));
    }
    return;
  }
  yield target;
}

test("repo does not contain official SuperTing commercial cloud content", () => {
  const matches = [];
  for (const file of SCAN_ROOTS.flatMap((root) => [...walk(root)])) {
    if (ALLOWED_FILES.has(file)) continue;
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const pattern of FORBIDDEN) {
      if (pattern.test(text)) {
        matches.push(`${file}: ${pattern}`);
      }
    }
  }

  assert.deepEqual(matches, []);
});

test("official hosted modules are not present in the open-source build", () => {
  const existing = FORBIDDEN_PATHS.filter((file) => fs.existsSync(path.join(ROOT, file)));
  assert.deepEqual(existing, []);
});
