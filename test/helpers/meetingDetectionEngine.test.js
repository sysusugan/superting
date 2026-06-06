const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const MeetingDetectionEngine = require("../../src/helpers/meetingDetectionEngine");
const { changeLanguage } = require("../../src/helpers/i18nMain");

function createEngine() {
  const windowManager = {
    notificationPrefs: {},
    showMeetingNotificationCalls: [],
    showMeetingNotification(payload) {
      this.showMeetingNotificationCalls.push(payload);
    },
    getAllWindows() {
      return [];
    },
  };

  const engine = new MeetingDetectionEngine(
    { getState: () => ({}) },
    new EventEmitter(),
    new EventEmitter(),
    windowManager,
    {}
  );
  engine.broadcastToWindows = () => {};

  return { engine, windowManager };
}

test("meeting detection notification payload uses translation keys instead of English copy", () => {
  changeLanguage("en");
  const { engine, windowManager } = createEngine();

  engine._showPrompt("det-1", "audio", "mic", {}, null);

  assert.equal(windowManager.showMeetingNotificationCalls.length, 1);
  assert.deepEqual(
    {
      title: windowManager.showMeetingNotificationCalls[0].title,
      body: windowManager.showMeetingNotificationCalls[0].body,
      titleKey: windowManager.showMeetingNotificationCalls[0].titleKey,
      bodyKey: windowManager.showMeetingNotificationCalls[0].bodyKey,
      eventSummary: windowManager.showMeetingNotificationCalls[0].event.summary,
    },
    {
      title: undefined,
      body: undefined,
      titleKey: "meetingNotification.detectedTitle",
      bodyKey: "meetingNotification.detectedBody",
      eventSummary: "New note",
    }
  );
});

test("detected meeting fallback note title follows the UI language", (t) => {
  changeLanguage("zh-CN");
  t.after(() => changeLanguage("en"));

  const { engine, windowManager } = createEngine();

  engine._showPrompt("det-2", "audio", "mic", {}, null);

  assert.equal(windowManager.showMeetingNotificationCalls[0].event.summary, "新笔记");
});
