const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { splitAudioFile, createAbortError, throwIfAborted } = require("./ffmpegUtils");
const debugLogger = require("./debugLogger");

const LOCAL_UPLOAD_CHUNK_SEGMENT_SECONDS = 300;
const LOCAL_UPLOAD_CHUNK_MAX_ATTEMPTS = 2;

function createUploadError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function isNoSpeechResult(result) {
  if (!result) return false;
  return (
    result.code === "NO_SPEECH_DETECTED" ||
    result.message === "No audio detected" ||
    result.message === "No speech detected" ||
    result.error === "No audio detected" ||
    result.error === "No speech detected"
  );
}

function isSuccessfulTextResult(result) {
  return result?.success !== false && typeof result?.text === "string" && result.text.trim();
}

function getFailedChunkPlaceholder(index) {
  return `[第 ${index + 1} 段转录失败]`;
}

function combineAbortSignals(signals) {
  const liveSignals = signals.filter(Boolean);
  const controller = new AbortController();

  const abortFrom = (signal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal?.reason || createAbortError(signal));
    }
  };

  for (const signal of liveSignals) {
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
    signal.addEventListener("abort", () => abortFrom(signal), { once: true });
  }

  return controller.signal;
}

class UploadTranscriptionCoordinator {
  constructor() {
    this.activeJob = null;
  }

  getActiveJob() {
    if (!this.activeJob) return null;
    return {
      jobId: this.activeJob.jobId,
      mode: this.activeJob.mode,
      startedAt: this.activeJob.startedAt,
    };
  }

  async run(mode, worker, options = {}) {
    if (this.activeJob) {
      return {
        success: false,
        code: "UPLOAD_TRANSCRIPTION_IN_PROGRESS",
        error: "Another upload transcription is already running.",
        activeJobId: this.activeJob.jobId,
      };
    }

    const jobId = options.jobId || crypto.randomUUID();
    const controller = new AbortController();
    const externalSignal = options.signal || null;
    const signal = externalSignal
      ? combineAbortSignals([controller.signal, externalSignal])
      : controller.signal;

    this.activeJob = {
      jobId,
      mode,
      startedAt: Date.now(),
      controller,
    };

    try {
      return await worker({ jobId, signal });
    } finally {
      if (this.activeJob?.jobId === jobId) {
        this.activeJob = null;
      }
    }
  }

  cancel(jobId = null) {
    if (!this.activeJob) {
      return { success: false, code: "NO_ACTIVE_UPLOAD_TRANSCRIPTION" };
    }
    if (jobId && this.activeJob.jobId !== jobId) {
      return { success: false, code: "UPLOAD_TRANSCRIPTION_NOT_FOUND" };
    }
    this.activeJob.controller.abort(
      createUploadError("CANCELLED", "Upload transcription cancelled")
    );
    return { success: true, jobId: this.activeJob.jobId };
  }
}

function emitProgress(onProgress, payload) {
  onProgress?.({
    stage: "transcribing",
    chunksTotal: 0,
    chunksCompleted: 0,
    chunksFailed: 0,
    currentChunk: 0,
    ...payload,
  });
}

async function transcribeChunkWithRetry({
  chunkPath,
  chunkIndex,
  chunkBuffer,
  provider,
  model,
  language,
  signal,
  transcribeChunk,
}) {
  let lastError = null;
  let lastNoSpeech = false;

  let attempt = 1;
  while (attempt <= LOCAL_UPLOAD_CHUNK_MAX_ATTEMPTS) {
    throwIfAborted(signal);
    try {
      const result = await transcribeChunk({
        chunkPath,
        chunkIndex,
        chunkBuffer,
        provider,
        model,
        language,
        signal,
        attempt,
      });
      if (isSuccessfulTextResult(result)) {
        return { ok: true, text: result.text.trim() };
      }
      if (isNoSpeechResult(result)) {
        lastNoSpeech = true;
        return { ok: false, noSpeech: true };
      }
      lastError = new Error(result?.error || result?.message || "Transcription returned no text");
      attempt += 1;
    } catch (error) {
      if (error?.code === "CANCELLED") {
        throw error;
      }
      if (error?.code === "UPLOAD_TRANSCRIPTION_PREEMPTED") {
        debugLogger.info("Local upload chunk preempted; retrying when local STT is available", {
          chunkIndex,
          attempt,
        });
        continue;
      }
      lastError = error;
      debugLogger.warn("Local upload chunk transcription attempt failed", {
        chunkIndex,
        attempt,
        error: error.message,
      });
      attempt += 1;
    }
  }

  return {
    ok: false,
    noSpeech: lastNoSpeech,
    error: lastError,
  };
}

async function transcribeLocalUploadFileInChunks({
  filePath,
  provider = "whisper",
  model,
  language,
  signal,
  jobId = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
  segmentDuration = LOCAL_UPLOAD_CHUNK_SEGMENT_SECONDS,
  splitAudioFile: splitAudioFileImpl = splitAudioFile,
  readFile = fs.readFileSync,
  transcribeChunk,
  onProgress,
}) {
  if (typeof transcribeChunk !== "function") {
    throw new Error("transcribeChunk is required");
  }

  throwIfAborted(signal);

  const chunkDir = path.join(os.tmpdir(), `ow-local-upload-chunks-${jobId}`);
  fs.mkdirSync(chunkDir, { recursive: true });

  try {
    emitProgress(onProgress, {
      jobId,
      stage: "splitting",
      message: "Splitting audio into chunks",
    });

    const chunkPaths = await splitAudioFileImpl(filePath, chunkDir, {
      segmentDuration,
      signal,
    });
    throwIfAborted(signal);

    const chunksTotal = chunkPaths.length;
    const parts = new Array(chunksTotal).fill(null);
    const segments = [];
    let chunksSucceeded = 0;
    let chunksFailed = 0;
    let noSpeechChunks = 0;

    emitProgress(onProgress, {
      jobId,
      stage: "transcribing",
      chunksTotal,
      chunksCompleted: 0,
      chunksFailed: 0,
      currentChunk: 0,
      message: "Transcribing chunks",
    });

    for (let index = 0; index < chunksTotal; index++) {
      throwIfAborted(signal);

      emitProgress(onProgress, {
        jobId,
        chunksTotal,
        chunksCompleted: chunksSucceeded,
        chunksFailed,
        currentChunk: index + 1,
      });

      const chunkPath = chunkPaths[index];
      const chunkBuffer = readFile(chunkPath);
      const chunkResult = await transcribeChunkWithRetry({
        chunkPath,
        chunkIndex: index,
        chunkBuffer,
        provider,
        model,
        language,
        signal,
        transcribeChunk,
      });

      if (chunkResult.ok) {
        parts[index] = chunkResult.text;
        segments.push({
          id: `upload-${index}`,
          text: chunkResult.text,
          source: "system",
          timestamp: index * segmentDuration,
          speaker: "speaker_0",
          speakerIsPlaceholder: true,
        });
        chunksSucceeded++;
      } else {
        if (chunkResult.noSpeech) noSpeechChunks++;
        parts[index] = getFailedChunkPlaceholder(index);
        chunksFailed++;
      }

      emitProgress(onProgress, {
        jobId,
        chunksTotal,
        chunksCompleted: chunksSucceeded,
        chunksFailed,
        currentChunk: index + 1,
      });
    }

    if (chunksSucceeded === 0) {
      if (noSpeechChunks === chunksTotal) {
        throw createUploadError("NO_SPEECH_DETECTED", "No speech detected in audio");
      }
      throw createUploadError(
        "LOCAL_UPLOAD_TRANSCRIPTION_FAILED",
        "All chunks failed to transcribe"
      );
    }

    const text = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

    return {
      success: true,
      text,
      segments,
      partial: chunksFailed > 0,
      chunksTotal,
      chunksSucceeded,
      chunksFailed,
      warning:
        chunksFailed > 0 ? `${chunksFailed} of ${chunksTotal} chunks failed to transcribe` : null,
    };
  } catch (error) {
    if (signal?.aborted && !error?.code) {
      throw createAbortError(signal);
    }
    throw error;
  } finally {
    try {
      fs.rmSync(chunkDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      debugLogger.warn("Failed to cleanup local upload chunk dir", {
        error: cleanupErr.message,
      });
    }
  }
}

module.exports = {
  LOCAL_UPLOAD_CHUNK_SEGMENT_SECONDS,
  LOCAL_UPLOAD_CHUNK_MAX_ATTEMPTS,
  UploadTranscriptionCoordinator,
  combineAbortSignals,
  createUploadError,
  getFailedChunkPlaceholder,
  transcribeLocalUploadFileInChunks,
};
