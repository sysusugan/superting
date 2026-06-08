const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const VALID_SOURCES = new Set(["mic", "system"]);
const DEFAULT_SAMPLE_RATE = 24000;
const DEFAULT_CHANNELS = 1;
const BYTES_PER_SAMPLE = 2;
const AUDIBLE_PEAK_THRESHOLD = 256;

function clampInt16(value) {
  if (value > 32767) return 32767;
  if (value < -32768) return -32768;
  return value;
}

function calculatePeak(pcm) {
  let peak = 0;
  for (let offset = 0; offset + 1 < pcm.length; offset += BYTES_PER_SAMPLE) {
    const abs = Math.abs(pcm.readInt16LE(offset));
    if (abs > peak) peak = abs;
  }
  return peak;
}

function padPcmToStart(pcm, offsetMs, sampleRate, channels) {
  const frameCount = Math.max(0, Math.round((offsetMs / 1000) * sampleRate));
  if (frameCount === 0) return pcm;
  return Buffer.concat([Buffer.alloc(frameCount * channels * BYTES_PER_SAMPLE), pcm]);
}

function mixPcmBuffers(buffers) {
  const outputLength = Math.max(...buffers.map((buffer) => buffer.length));
  const output = Buffer.alloc(outputLength);
  for (let offset = 0; offset < outputLength; offset += BYTES_PER_SAMPLE) {
    let sum = 0;
    let count = 0;
    for (const buffer of buffers) {
      if (offset + 1 < buffer.length) {
        sum += buffer.readInt16LE(offset);
        count += 1;
      }
    }
    output.writeInt16LE(clampInt16(Math.round(sum / Math.max(1, count))), offset);
  }
  return output;
}

class MeetingRetainedAudioWriter {
  constructor(options = {}) {
    this.tmpDir = options.tmpDir || os.tmpdir();
    this.sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;
    this.channels = options.channels || DEFAULT_CHANNELS;
    this.debugLogger = options.debugLogger || null;
    this.id = options.id || `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    this.startedAt = null;
    this.finalizedPath = null;
    this.sources = {
      mic: this.createSourceState("mic"),
      system: this.createSourceState("system"),
    };
  }

  createSourceState(source) {
    return {
      source,
      path: path.join(this.tmpDir, `openwhispr-meeting-retained-${this.id}-${source}.pcm`),
      firstTimestampMs: null,
      bytesWritten: 0,
      peak: 0,
    };
  }

  writeChunk(source, chunk, timestampMs = Date.now()) {
    if (!VALID_SOURCES.has(source) || !chunk?.length) {
      return false;
    }

    const buffer = Buffer.from(chunk);
    const state = this.sources[source];
    if (state.firstTimestampMs == null) {
      state.firstTimestampMs = timestampMs;
    }
    this.startedAt = this.startedAt == null ? timestampMs : Math.min(this.startedAt, timestampMs);
    state.bytesWritten += buffer.length;
    state.peak = Math.max(state.peak, calculatePeak(buffer));
    fs.mkdirSync(this.tmpDir, { recursive: true });
    fs.appendFileSync(state.path, buffer);
    return true;
  }

  async finalize(options = {}) {
    const requireAudible = options.requireAudible === true;
    const candidates = Object.values(this.sources)
      .filter((state) => state.bytesWritten > 0 && fs.existsSync(state.path))
      .map((state) => {
        const rawPcm = fs.readFileSync(state.path);
        const alignedPcm = padPcmToStart(
          rawPcm,
          Math.max(0, state.firstTimestampMs - this.startedAt),
          this.sampleRate,
          this.channels
        );
        return {
          source: state.source,
          pcm: alignedPcm,
          peak: state.peak,
          audible: state.peak > AUDIBLE_PEAK_THRESHOLD,
          bytesWritten: state.bytesWritten,
          firstTimestampMs: state.firstTimestampMs,
        };
      });

    if (candidates.length === 0) {
      return { success: false, error: "No meeting audio captured" };
    }

    const audibleCandidates = candidates.filter((candidate) => candidate.audible);
    if (audibleCandidates.length === 0 && requireAudible) {
      return {
        success: false,
        error: "No audible meeting audio captured",
        stats: this.buildStats(candidates),
      };
    }

    const selected = audibleCandidates.length > 0 ? audibleCandidates : [candidates[0]];
    const mixedPcm = selected.length === 1 ? selected[0].pcm : mixPcmBuffers(selected.map((c) => c.pcm));
    const sourceMix = selected.length === 1 ? selected[0].source : "mixed";
    const outputPath = path.join(this.tmpDir, `openwhispr-meeting-retained-${this.id}-mixed.pcm`);
    fs.writeFileSync(outputPath, mixedPcm);
    this.finalizedPath = outputPath;

    this.debugLogger?.debug?.("Meeting retained audio finalized", {
      sourceMix,
      durationSeconds: mixedPcm.length / (this.sampleRate * this.channels * BYTES_PER_SAMPLE),
      stats: this.buildStats(candidates),
    });

    return {
      success: true,
      pcmPath: outputPath,
      startedAt: this.startedAt ? new Date(this.startedAt) : new Date(),
      durationSeconds: mixedPcm.length / (this.sampleRate * this.channels * BYTES_PER_SAMPLE),
      sourceMix,
      stats: this.buildStats(candidates),
    };
  }

  buildStats(candidates) {
    const stats = {};
    for (const candidate of candidates) {
      stats[candidate.source] = {
        bytesWritten: candidate.bytesWritten,
        peak: candidate.peak,
        audible: candidate.audible,
        firstTimestampMs: candidate.firstTimestampMs,
      };
    }
    return stats;
  }

  async cleanup() {
    const paths = Object.values(this.sources).map((state) => state.path);
    if (this.finalizedPath) {
      paths.push(this.finalizedPath);
    }
    for (const filePath of paths) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Best-effort temp cleanup.
      }
    }
  }
}

module.exports = MeetingRetainedAudioWriter;
