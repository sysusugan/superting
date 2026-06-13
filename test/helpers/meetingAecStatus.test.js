const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveMeetingAecStartStatus,
  resolveMeetingAecSystemAudioFailure,
} = require("../../src/helpers/meetingAecStatus");

test("enables meeting AEC when helper starts with system audio", () => {
  assert.deepEqual(
    resolveMeetingAecStartStatus({
      systemAudioMode: "native",
      helperSupported: true,
      helperAvailable: true,
      started: true,
    }),
    { aecMode: "enabled", aecReason: null }
  );
});

test("marks meeting AEC unavailable when system audio is missing", () => {
  assert.deepEqual(
    resolveMeetingAecStartStatus({
      systemAudioMode: "unsupported",
      helperSupported: true,
      helperAvailable: true,
      started: false,
    }),
    { aecMode: "unavailable", aecReason: "system-audio-missing" }
  );
});

test("falls back when helper is missing or fails after system audio is available", () => {
  assert.deepEqual(
    resolveMeetingAecStartStatus({
      systemAudioMode: "native",
      helperSupported: true,
      helperAvailable: false,
      started: false,
    }),
    { aecMode: "fallback", aecReason: "helper-unavailable" }
  );

  assert.deepEqual(
    resolveMeetingAecStartStatus({
      systemAudioMode: "native",
      helperSupported: true,
      helperAvailable: true,
      started: false,
    }),
    { aecMode: "fallback", aecReason: "helper-error" }
  );
});

test("falls back when system audio capture fails after AEC started", () => {
  assert.deepEqual(resolveMeetingAecSystemAudioFailure(), {
    aecMode: "fallback",
    aecReason: "system-audio-start-failed",
  });
});
