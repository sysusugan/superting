const test = require("node:test");
const assert = require("node:assert/strict");

const CliBridge = require("../../src/helpers/cliBridge");

test("CLI bridge exposes dictionary and alias read endpoints for local agents", async () => {
  const bridge = new CliBridge({
    databaseManager: {
      getDictionary: () => ["EntVerse", "SuperTing"],
      getDictionaryAliases: () => [{ from: "Antibus", to: "EntVerse" }],
    },
  });

  const dictionaryRoute = bridge._matchRoute("GET", "/v1/dictionary");
  const aliasesRoute = bridge._matchRoute("GET", "/v1/dictionary/aliases");

  assert.ok(dictionaryRoute);
  assert.ok(aliasesRoute);
  assert.deepEqual(await dictionaryRoute.handler({ query: new URLSearchParams() }), {
    data: ["EntVerse", "SuperTing"],
  });
  assert.deepEqual(await aliasesRoute.handler({ query: new URLSearchParams() }), {
    data: [{ from: "Antibus", to: "EntVerse" }],
  });
});
