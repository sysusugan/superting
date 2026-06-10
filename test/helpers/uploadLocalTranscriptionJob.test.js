const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function mockElectron(request, parent, isMain) {
  if (request === "electron") {
    return {
      app: {
        getAppPath: () => "/tmp/openwhispr-test",
        getPath: () => "/tmp/openwhispr-test",
        isReady: () => false,
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  LOCAL_UPLOAD_CHUNK_SEGMENT_SECONDS,
  UploadTranscriptionCoordinator,
  transcribeLocalUploadFileInChunks,
} = require("../../src/helpers/uploadLocalTranscriptionJob");

test("local upload chunk transcription retries failed chunks and returns partial text", async () => {
  const progress = [];
  const attemptsByChunk = new Map();

  const result = await transcribeLocalUploadFileInChunks({
    filePath: "/tmp/audio.mp3",
    provider: "whisper",
    model: "base",
    splitAudioFile: async (_input, _outputDir, options) => {
      assert.equal(options.segmentDuration, LOCAL_UPLOAD_CHUNK_SEGMENT_SECONDS);
      return ["/tmp/chunk-000.mp3", "/tmp/chunk-001.mp3", "/tmp/chunk-002.mp3"];
    },
    readFile: (chunkPath) => Buffer.from(chunkPath),
    transcribeChunk: async ({ chunkPath }) => {
      const attempts = (attemptsByChunk.get(chunkPath) || 0) + 1;
      attemptsByChunk.set(chunkPath, attempts);
      if (chunkPath.endsWith("001.mp3")) {
        throw new Error("whisper-server request timed out");
      }
      return { success: true, text: chunkPath.endsWith("000.mp3") ? "hello" : "world" };
    },
    onProgress: (payload) => progress.push(payload),
  });

  assert.equal(result.success, true);
  assert.equal(result.partial, true);
  assert.equal(result.text, "hello [第 2 段转录失败] world");
  assert.equal(result.chunksTotal, 3);
  assert.equal(result.chunksSucceeded, 2);
  assert.equal(result.chunksFailed, 1);
  assert.deepEqual(result.segments, [
    {
      id: "upload-0",
      text: "hello",
      source: "system",
      timestamp: 0,
      speaker: "speaker_0",
      speakerIsPlaceholder: true,
    },
    {
      id: "upload-2",
      text: "world",
      source: "system",
      timestamp: LOCAL_UPLOAD_CHUNK_SEGMENT_SECONDS * 2,
      speaker: "speaker_0",
      speakerIsPlaceholder: true,
    },
  ]);
  assert.equal(attemptsByChunk.get("/tmp/chunk-001.mp3"), 2);
  assert.deepEqual(
    progress
      .filter((p) => p.stage === "transcribing")
      .filter((p) => p.currentChunk > 0)
      .map((p) => [p.chunksCompleted, p.chunksFailed, p.currentChunk]),
    [
      [0, 0, 1],
      [1, 0, 1],
      [1, 0, 2],
      [1, 1, 2],
      [1, 1, 3],
      [2, 1, 3],
    ]
  );
});

test("local upload chunk transcription fails when every chunk has no speech", async () => {
  await assert.rejects(
    transcribeLocalUploadFileInChunks({
      filePath: "/tmp/audio.mp3",
      splitAudioFile: async () => ["/tmp/chunk-000.mp3", "/tmp/chunk-001.mp3"],
      readFile: () => Buffer.from("chunk"),
      transcribeChunk: async () => ({
        success: false,
        code: "NO_SPEECH_DETECTED",
        message: "No speech detected",
      }),
    }),
    (error) => {
      assert.equal(error.code, "NO_SPEECH_DETECTED");
      return true;
    }
  );
});

test("local upload chunk transcription retries a preempted chunk without marking it failed", async () => {
  let calls = 0;
  const result = await transcribeLocalUploadFileInChunks({
    filePath: "/tmp/audio.mp3",
    splitAudioFile: async () => ["/tmp/chunk-000.mp3"],
    readFile: () => Buffer.from("chunk"),
    transcribeChunk: async () => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error("preempted"), {
          code: "UPLOAD_TRANSCRIPTION_PREEMPTED",
        });
      }
      return { success: true, text: "resumed" };
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.text, "resumed");
  assert.equal(result.partial, false);
  assert.equal(result.chunksFailed, 0);
});

test("local upload chunk transcription rejects cancellation before splitting", async () => {
  const controller = new AbortController();
  controller.abort(Object.assign(new Error("cancelled"), { code: "CANCELLED" }));

  await assert.rejects(
    transcribeLocalUploadFileInChunks({
      filePath: "/tmp/audio.mp3",
      signal: controller.signal,
      splitAudioFile: async () => {
        throw new Error("should not split");
      },
      readFile: () => Buffer.from("chunk"),
      transcribeChunk: async () => ({ success: true, text: "unused" }),
    }),
    (error) => {
      assert.equal(error.code, "CANCELLED");
      return true;
    }
  );
});

test("upload transcription coordinator allows only one active upload job", async () => {
  const coordinator = new UploadTranscriptionCoordinator();
  let releaseFirst;

  const first = coordinator.run("local", async () => {
    await new Promise((resolve) => {
      releaseFirst = resolve;
    });
    return { success: true };
  });

  const second = await coordinator.run("cloud", async () => ({ success: true }));

  assert.equal(second.success, false);
  assert.equal(second.code, "UPLOAD_TRANSCRIPTION_IN_PROGRESS");

  releaseFirst();
  assert.deepEqual(await first, { success: true });
});

test("upload transcription coordinator cancels active job by id", async () => {
  const coordinator = new UploadTranscriptionCoordinator();

  const running = coordinator.run("local", async ({ signal }) => {
    await new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });

  const active = coordinator.getActiveJob();
  assert.equal(active.mode, "local");
  assert.equal(coordinator.cancel(active.jobId).success, true);

  await assert.rejects(running, (error) => {
    assert.equal(error.code, "CANCELLED");
    return true;
  });
});
