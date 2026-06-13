const assert = require("node:assert/strict");
const test = require("node:test");

const { DiarizationTaskTracker } = require("../../src/helpers/diarizationTaskTracker");

test("DiarizationTaskTracker tracks active tasks and clears them on finish", () => {
  const tracker = new DiarizationTaskTracker({ now: () => 1_000 });
  const task = tracker.startTask({
    noteId: 12,
    noteTitle: "Project sync",
    audioDurationSeconds: 600,
  });

  const status = tracker.getStatus({ preferredNoteId: 12, now: 1_000 });
  assert.equal(status.activeTaskCount, 1);
  assert.equal(status.task.noteId, 12);
  assert.equal(status.task.noteTitle, "Project sync");

  tracker.finishTask(task.taskId);
  assert.deepEqual(tracker.getStatus({ preferredNoteId: 12, now: 1_000 }), {
    activeTaskCount: 0,
    task: null,
  });
});

test("DiarizationTaskTracker prefers the current note task before the latest task", () => {
  const tracker = new DiarizationTaskTracker({ now: () => 1_000 });
  tracker.startTask({ noteId: 1, noteTitle: "First", audioDurationSeconds: 120 });
  tracker.startTask({ noteId: 2, noteTitle: "Second", audioDurationSeconds: 120 });

  assert.equal(tracker.getStatus({ preferredNoteId: 1, now: 1_000 }).task.noteId, 1);
  assert.equal(tracker.getStatus({ preferredNoteId: 99, now: 1_000 }).task.noteId, 2);
});

test("DiarizationTaskTracker estimates remaining time and clamps expired estimates", () => {
  const tracker = new DiarizationTaskTracker({ now: () => 10_000, etaRatio: 0.164 });
  const task = tracker.startTask({
    noteId: 7,
    noteTitle: "Long meeting",
    audioDurationSeconds: 600,
  });

  assert.equal(
    tracker.getStatus({ preferredNoteId: 7, now: 40_000 }).task.estimatedRemainingSeconds,
    68.4
  );
  assert.equal(
    tracker.getStatus({ preferredNoteId: 7, now: 200_000 }).task.estimatedRemainingSeconds,
    0
  );

  tracker.finishTask(task.taskId);
});
