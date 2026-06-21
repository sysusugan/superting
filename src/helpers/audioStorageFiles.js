const path = require("path");

const RETAINED_AUDIO_EXTENSIONS = new Set([".webm", ".wav"]);

function formatTimestamp(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  const valid = !isNaN(d.getTime()) ? d : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${valid.getFullYear()}-${pad(valid.getMonth() + 1)}-${pad(valid.getDate())}`;
  const time = `${pad(valid.getHours())}-${pad(valid.getMinutes())}-${pad(valid.getSeconds())}`;
  return `${date}-${time}`;
}

function buildDictationAudioFilename(transcriptionId, timestamp) {
  if (timestamp) {
    return `SuperTing-${formatTimestamp(timestamp)}-${transcriptionId}.webm`;
  }
  return `SuperTing-${transcriptionId}.webm`;
}

function buildMeetingAudioFilename(noteId, timestamp) {
  return `SuperTing-meeting-${formatTimestamp(timestamp)}-${noteId}.webm`;
}

function buildMeetingWavFallbackFilename(noteId, timestamp) {
  return `SuperTing-meeting-${formatTimestamp(timestamp)}-${noteId}.wav`;
}

function buildMergedMeetingAudioFilename(noteId, timestamp) {
  return `SuperTing-meeting-merged-${formatTimestamp(timestamp)}-${noteId}.webm`;
}

function buildUploadAudioFilename(noteId, timestamp, extension = ".wav") {
  const ext = String(extension || ".wav").toLowerCase() === ".webm" ? ".webm" : ".wav";
  return `SuperTing-upload-${formatTimestamp(timestamp)}-${noteId}${ext}`;
}

function parseMeetingAudioFilename(filename) {
  const match = String(filename || "").match(
    /^SuperTing-meeting-(merged-)?(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d+)\.(wav|webm)$/i
  );
  if (!match) return null;

  const [, merged, year, month, day, hour, minute, second, noteId] = match;
  return {
    noteId: Number(noteId),
    recordedAt: new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    ).toISOString(),
    isMerged: !!merged,
  };
}

function isRetainedAudioFile(filename) {
  const lower = String(filename || "").toLowerCase();
  for (const ext of RETAINED_AUDIO_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function isDictationAudioFile(filename) {
  return String(filename || "")
    .toLowerCase()
    .endsWith(".webm");
}

function resolveRetainedAudioPath(audioDir, filename) {
  const name = String(filename || "");
  if (!name || path.basename(name) !== name || !isRetainedAudioFile(name)) {
    return null;
  }

  const resolvedDir = path.resolve(audioDir);
  const resolvedPath = path.resolve(resolvedDir, name);
  if (resolvedPath !== path.join(resolvedDir, name)) {
    return null;
  }
  return resolvedPath;
}

function buildAudioDownloadFilename(title, sourceFilename) {
  const ext = path.extname(String(sourceFilename || "")).toLowerCase();
  const safeExt = RETAINED_AUDIO_EXTENSIONS.has(ext) ? ext : ".wav";
  const safeTitle = String(title || "")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .trim();
  return `${safeTitle || "SuperTing-audio"}${safeExt}`;
}

module.exports = {
  buildAudioDownloadFilename,
  buildMergedMeetingAudioFilename,
  buildDictationAudioFilename,
  buildMeetingAudioFilename,
  buildMeetingWavFallbackFilename,
  buildUploadAudioFilename,
  isDictationAudioFile,
  isRetainedAudioFile,
  parseMeetingAudioFilename,
  resolveRetainedAudioPath,
};
