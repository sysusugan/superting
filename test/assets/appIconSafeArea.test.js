const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const svgPath = path.join(root, "src/assets/logo/superting-logo-smark.svg");
const iconPath = path.join(root, "src/assets/icon.png");

test("app icon source keeps the mark inside a macOS safe area", () => {
  const source = fs.readFileSync(svgPath, "utf8");

  assert.match(source, /<g id="app-icon-mark" transform="translate\(20 20\) scale\(0\.84375\)">/);
  assert.match(source, /<rect width="256" height="256" rx="28" ry="28" fill="url\(#bgA\)"\/>/);
});

test("generated app icon PNG has transparent outer padding", () => {
  const trimBox = execFileSync(
    "magick",
    [iconPath, "-alpha", "extract", "-format", "%@", "info:"],
    { encoding: "utf8" }
  ).trim();
  const match = trimBox.match(/^(\d+)x(\d+)\+(\d+)\+(\d+)$/);

  assert.ok(match, `Unexpected trim box format: ${trimBox}`);

  const [, width, height, x, y] = match.map(Number);
  assert.equal(width, height);
  assert.ok(width >= 850 && width <= 890, `Expected icon mark to stay near 84% canvas size, got ${trimBox}`);
  assert.ok(x >= 65 && x <= 90, `Expected horizontal transparent padding, got ${trimBox}`);
  assert.ok(y >= 65 && y <= 90, `Expected vertical transparent padding, got ${trimBox}`);
});
