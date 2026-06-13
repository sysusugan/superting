const DEFAULT_ETA_RATIO = 0.164;

class DiarizationTaskTracker {
  constructor(options = {}) {
    this.tasks = new Map();
    this.nextId = 1;
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
    this.etaRatio = Number.isFinite(options.etaRatio) ? options.etaRatio : DEFAULT_ETA_RATIO;
  }

  startTask(task = {}) {
    const startedAt = this.now();
    const tracked = {
      taskId: `diarization-${startedAt}-${this.nextId++}`,
      noteId: task.noteId,
      noteTitle: task.noteTitle || "",
      audioDurationSeconds: Number.isFinite(task.audioDurationSeconds)
        ? task.audioDurationSeconds
        : null,
      startedAt,
    };
    this.tasks.set(tracked.taskId, tracked);
    return this._serializeTask(tracked, startedAt);
  }

  finishTask(taskId) {
    if (!taskId) return;
    this.tasks.delete(taskId);
  }

  getStatus(options = {}) {
    const now = Number.isFinite(options.now) ? options.now : this.now();
    const task = this._selectTask(options.preferredNoteId);
    return {
      activeTaskCount: this.tasks.size,
      task: task ? this._serializeTask(task, now) : null,
    };
  }

  _selectTask(preferredNoteId) {
    const tasks = [...this.tasks.values()];
    if (tasks.length === 0) return null;

    if (preferredNoteId != null) {
      const preferred = tasks.find((task) => task.noteId === preferredNoteId);
      if (preferred) return preferred;
    }

    return tasks.reduce((latest, task) => (task.startedAt >= latest.startedAt ? task : latest));
  }

  _serializeTask(task, now) {
    const elapsedSeconds = Math.max(0, (now - task.startedAt) / 1000);
    const estimatedTotalSeconds =
      Number.isFinite(task.audioDurationSeconds) && task.audioDurationSeconds > 0
        ? task.audioDurationSeconds * this.etaRatio
        : null;
    const estimatedRemainingSeconds =
      estimatedTotalSeconds == null ? null : Math.max(0, estimatedTotalSeconds - elapsedSeconds);

    return {
      ...task,
      estimatedRemainingSeconds,
    };
  }
}

module.exports = {
  DEFAULT_ETA_RATIO,
  DiarizationTaskTracker,
};
