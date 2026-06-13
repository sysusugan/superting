const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const { spawn } = require("child_process");
const debugLogger = require("./debugLogger");
const { downloadFile, createDownloadSignal, checkDiskSpace } = require("./downloadUtils");
const { resolveBinaryPath, gracefulStopProcess } = require("../utils/serverUtils");
const { getModelsDirForService } = require("./modelDirUtils");
const {
  analyzeAudioFile,
  convertToWav,
  extractAudioWindowToWav,
  normalizeAudioPeak,
} = require("./ffmpegUtils");
const { getSafeTempDir } = require("./safeTempDir");
const { applyConfirmedSpeaker, isSpeakerLocked } = require("./speakerAssignmentPolicy");
const sidecarPidFile = require("./sidecarPidFile");
const { MAX_SPEAKER_COUNT } = require("../constants/speakerDetection.json");
const {
  DEFAULT_WINDOW_SECONDS,
  DIARIZATION_PROFILES,
  mergeWindowSegments,
  planDiarizationWindows,
  scoreDiarizationWindow,
  selectDiarizationProfile,
} = require("./diarizationAudioPolicy");
const {
  transcriptsOverlap,
  transcriptsLooselyOverlap,
  buildMergedCandidates,
} = require("./transcriptText");

const DIARIZATION_TIMEOUT_MS = 300000; // 5 minutes
const POST_MERGE_CONTEXT_WINDOW_MS = 6000;
const POST_MERGE_CONTEXT_MERGE_LIMIT = 3;

const dedupeMicAgainstSystem = (segments) => {
  const systemSegments = segments.filter((seg) => seg.source === "system" && seg.text);
  if (!systemSegments.length) return segments;

  return segments.filter((seg) => {
    if (seg.source !== "mic" || !seg.text) return true;
    if (
      !seg.likelyRenderBleed &&
      !seg.hasBleedEvidence &&
      seg.suppressionReason !== "double_talk"
    ) {
      return true;
    }

    const matcher =
      seg.suppressionReason === "double_talk" ? transcriptsLooselyOverlap : transcriptsOverlap;
    const candidates = buildMergedCandidates({
      segments: systemSegments,
      timestamp: seg.timestamp,
      windowMs: POST_MERGE_CONTEXT_WINDOW_MS,
      mergeLimit: POST_MERGE_CONTEXT_MERGE_LIMIT,
    });
    return !candidates.some((candidateText) => matcher(seg.text, candidateText));
  });
};

const SEGMENTATION_MODEL_URL =
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2";
const EMBEDDING_MODEL_URL =
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx";
const SILERO_VAD_MODEL_URL =
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx";

const SEGMENTATION_DIR = "sherpa-onnx-pyannote-segmentation-3-0";
const SEGMENTATION_ONNX = path.join(SEGMENTATION_DIR, "model.onnx");
const EMBEDDING_ONNX = "3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx";
const SILERO_VAD_ONNX = "silero_vad.onnx";

class DiarizationManager {
  constructor() {
    this._process = null;
    this.currentDownloadProcess = null;
    this.cachedBinaryPath = null;
  }

  getBinaryPath() {
    if (this.cachedBinaryPath) return this.cachedBinaryPath;

    const platformArch = `${process.platform}-${process.arch}`;
    const binaryName =
      process.platform === "win32"
        ? `sherpa-onnx-diarize-${platformArch}.exe`
        : `sherpa-onnx-diarize-${platformArch}`;

    const resolved = resolveBinaryPath(binaryName);
    if (resolved) this.cachedBinaryPath = resolved;
    return resolved;
  }

  isAvailable() {
    return this.getBinaryPath() !== null && this.isModelDownloaded();
  }

  getModelsDir() {
    return getModelsDirForService("diarization");
  }

  getBundledModelsDir() {
    if (!process.resourcesPath) {
      return null;
    }

    return path.join(process.resourcesPath, "bin", "diarization-models");
  }

  _resolveModelPath(relativePath) {
    const bundledModelsDir = this.getBundledModelsDir();
    if (bundledModelsDir) {
      const bundledPath = path.join(bundledModelsDir, relativePath);
      if (fs.existsSync(bundledPath)) {
        return bundledPath;
      }
    }

    return path.join(this.getModelsDir(), relativePath);
  }

  isModelDownloaded() {
    const segPath = this._resolveModelPath(SEGMENTATION_ONNX);
    const embPath = this._resolveModelPath(EMBEDDING_ONNX);
    return fs.existsSync(segPath) && fs.existsSync(embPath);
  }

  getVadModelPath() {
    return this._resolveModelPath(SILERO_VAD_ONNX);
  }

  isVadModelDownloaded() {
    return fs.existsSync(this.getVadModelPath());
  }

  async downloadModels(progressCallback = null) {
    const modelsDir = this.getModelsDir();
    await fsPromises.mkdir(modelsDir, { recursive: true });

    const modelsReady = this.isModelDownloaded();
    const vadReady = this.isVadModelDownloaded();

    if (modelsReady && vadReady) {
      return { success: true, path: modelsDir };
    }

    const requiredBytes = modelsReady ? 2 * 1_000_000 : 37 * 1_000_000;
    const spaceCheck = await checkDiskSpace(modelsDir, requiredBytes * 2.5);
    if (!spaceCheck.ok) {
      throw new Error(
        `Not enough disk space. Need ~${Math.round((requiredBytes * 2.5) / 1_000_000)}MB, ` +
          `only ${Math.round(spaceCheck.availableBytes / 1_000_000)}MB available.`
      );
    }

    const { signal, abort } = createDownloadSignal();
    this.currentDownloadProcess = { abort };

    try {
      // Download segmentation model (tar.bz2)
      const segArchivePath = path.join(modelsDir, `${SEGMENTATION_DIR}.tar.bz2`);
      const segModelPath = path.join(modelsDir, SEGMENTATION_ONNX);

      if (!fs.existsSync(segModelPath)) {
        await downloadFile(SEGMENTATION_MODEL_URL, segArchivePath, {
          timeout: 600000,
          signal,
          onProgress: (downloadedBytes, totalBytes) => {
            if (progressCallback) {
              progressCallback({
                type: "progress",
                stage: "segmentation",
                downloaded_bytes: downloadedBytes,
                total_bytes: totalBytes,
                percentage: totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0,
              });
            }
          },
        });

        // Extract tar.bz2
        if (progressCallback) {
          progressCallback({ type: "progress", stage: "extracting", percentage: 100 });
        }

        await this._extractTarBz2(segArchivePath, modelsDir);
        await fsPromises.unlink(segArchivePath).catch(() => {});

        if (!fs.existsSync(segModelPath)) {
          throw new Error("Segmentation model extraction failed: model.onnx not found");
        }
      }

      // Download embedding model (.onnx directly)
      const embModelPath = path.join(modelsDir, EMBEDDING_ONNX);

      if (!fs.existsSync(embModelPath)) {
        await downloadFile(EMBEDDING_MODEL_URL, embModelPath, {
          timeout: 600000,
          signal,
          onProgress: (downloadedBytes, totalBytes) => {
            if (progressCallback) {
              progressCallback({
                type: "progress",
                stage: "embedding",
                downloaded_bytes: downloadedBytes,
                total_bytes: totalBytes,
                percentage: totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0,
              });
            }
          },
        });
      }

      if (!this.isVadModelDownloaded()) {
        try {
          await downloadFile(SILERO_VAD_MODEL_URL, this.getVadModelPath(), {
            timeout: 600000,
            signal,
            onProgress: (downloadedBytes, totalBytes) => {
              if (progressCallback) {
                progressCallback({
                  type: "progress",
                  stage: "vad",
                  downloaded_bytes: downloadedBytes,
                  total_bytes: totalBytes,
                  percentage: totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0,
                });
              }
            },
          });
        } catch (error) {
          if (error.isAbort) {
            throw new Error("Download interrupted by user");
          }
          debugLogger.warn("Silero VAD model download failed", {
            error: error.message,
            modelsDir,
          });
        }
      }

      if (progressCallback) {
        progressCallback({ type: "complete", percentage: 100 });
      }

      debugLogger.info("Diarization models downloaded", { modelsDir });
      return { success: true, path: modelsDir };
    } catch (error) {
      if (error.isAbort) {
        throw new Error("Download interrupted by user");
      }
      if (progressCallback) {
        progressCallback({ type: "error", error: error.message });
      }
      throw error;
    } finally {
      this.currentDownloadProcess = null;
    }
  }

  async _extractTarBz2(archivePath, destDir) {
    try {
      await this._runSystemTar(archivePath, destDir);
      return;
    } catch (err) {
      debugLogger.debug("System tar failed, falling back to JS extraction", {
        error: err.message,
      });
    }

    const unbzip2 = require("unbzip2-stream");
    const tar = require("tar");
    const { pipeline } = require("stream/promises");
    await pipeline(fs.createReadStream(archivePath), unbzip2(), tar.x({ cwd: destDir }));
  }

  _runSystemTar(archivePath, destDir) {
    return new Promise((resolve, reject) => {
      // Use relative paths from archive dir as cwd so neither -f nor -C args
      // contain Windows drive letter colons (GNU tar treats C: as remote host)
      const cwd = path.dirname(archivePath);
      const tarProcess = spawn(
        "tar",
        ["-xjf", path.basename(archivePath), "-C", path.relative(cwd, destDir)],
        { stdio: ["ignore", "pipe", "pipe"], cwd }
      );

      let stderr = "";

      tarProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      tarProcess.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`tar extraction failed with code ${code}: ${stderr}`));
        }
      });

      tarProcess.on("error", (err) => {
        reject(new Error(`Failed to start tar process: ${err.message}`));
      });
    });
  }

  async cancelDownload() {
    if (this.currentDownloadProcess) {
      this.currentDownloadProcess.abort();
      this.currentDownloadProcess = null;
      return { success: true, message: "Download cancelled" };
    }
    return { success: false, error: "No active download to cancel" };
  }

  async diarize(wavPath, options = {}) {
    const { numSpeakers = -1, threshold = 0.55 } = options;

    const binaryPath = this.getBinaryPath();
    if (!binaryPath) {
      debugLogger.warn("Diarization binary not found");
      return [];
    }

    if (!this.isModelDownloaded()) {
      debugLogger.warn("Diarization models not downloaded");
      return [];
    }

    if (!fs.existsSync(wavPath)) {
      debugLogger.warn("Diarization input file not found", { wavPath });
      return [];
    }

    const args = this._buildDiarizationArgs(wavPath, options);

    debugLogger.info("Starting diarization", {
      binaryPath,
      numSpeakers,
      threshold,
      wavPath,
    });

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";

      const proc = spawn(binaryPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
      });

      this._process = proc;
      sidecarPidFile.write("diarization", proc.pid);

      const timeout = setTimeout(() => {
        debugLogger.warn("Diarization timed out", { timeoutMs: DIARIZATION_TIMEOUT_MS });
        gracefulStopProcess(proc);
        this._process = null;
        resolve([]);
      }, DIARIZATION_TIMEOUT_MS);

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        clearTimeout(timeout);
        this._process = null;
        sidecarPidFile.clear("diarization");

        if (code !== 0) {
          debugLogger.warn("Diarization process exited with error", {
            code,
            stderr: stderr.slice(-500).trim(),
          });
          resolve([]);
          return;
        }

        const segments = this._parseOutput(stdout);
        debugLogger.info("Diarization complete", { segmentCount: segments.length });
        resolve(segments);
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        this._process = null;
        sidecarPidFile.clear("diarization");
        debugLogger.warn("Diarization process error", { error: err.message });
        resolve([]);
      });
    });
  }

  _buildDiarizationArgs(wavPath, options = {}) {
    const {
      numSpeakers = -1,
      threshold = 0.55,
      minDurationOn = 0.2,
      minDurationOff = 0.5,
    } = options;
    const segPath = this._resolveModelPath(SEGMENTATION_ONNX);
    const embPath = this._resolveModelPath(EMBEDDING_ONNX);

    return [
      `--segmentation.pyannote-model=${segPath}`,
      `--embedding.model=${embPath}`,
      `--clustering.num-clusters=${numSpeakers}`,
      `--clustering.cluster-threshold=${threshold}`,
      `--min-duration-on=${minDurationOn}`,
      `--min-duration-off=${minDurationOff}`,
      wavPath,
    ];
  }

  async diarizeAdaptive(wavPath, options = {}) {
    const analysis = await this._analyzeAudioFile(wavPath, options);
    const duration = Number(analysis?.durationSeconds) || 0;
    const shouldWindow = duration > DEFAULT_WINDOW_SECONDS;
    const windows = shouldWindow
      ? planDiarizationWindows(duration, options.windowOptions)
      : [{ index: 0, startSeconds: 0, endSeconds: duration, durationSeconds: duration }];
    const diagnostics = {
      mode: shouldWindow ? "windowed" : "single",
      windowCount: windows.length,
      windows: [],
    };
    const tempPaths = [];

    try {
      const windowResults = [];
      for (const window of windows) {
        const windowPath = shouldWindow ? this._makeAdaptiveTempPath("diar-window") : wavPath;
        if (shouldWindow) {
          tempPaths.push(windowPath);
          await this._extractAudioWindowToWav(wavPath, windowPath, {
            startSeconds: window.startSeconds,
            durationSeconds: window.durationSeconds,
            signal: options.signal,
          });
        }

        const windowAnalysis = shouldWindow
          ? await this._analyzeAudioFile(windowPath, options)
          : analysis;
        const profile = selectDiarizationProfile(windowAnalysis);
        const diagnostic = {
          startSeconds: window.startSeconds,
          endSeconds: window.endSeconds,
          profile: profile.name,
          analysis: windowAnalysis,
          skipped: profile.name === "silent",
          reason: profile.reason || null,
          retriedWithGain: false,
          segmentCount: 0,
        };

        if (profile.name === "silent") {
          diagnostics.windows.push(diagnostic);
          windowResults.push({
            ...window,
            analysis: windowAnalysis,
            profile,
            segments: [],
            score: scoreDiarizationWindow(windowAnalysis, profile),
          });
          continue;
        }

        let segments = await this.diarize(windowPath, {
          ...options,
          threshold: profile.threshold,
          minDurationOn: profile.minDurationOn,
          minDurationOff: profile.minDurationOff,
        });

        if ((!Array.isArray(segments) || segments.length === 0) && profile.name === "low_signal") {
          const normalizedPath = this._makeAdaptiveTempPath("diar-gain");
          tempPaths.push(normalizedPath);
          await this._normalizeAudioPeak(windowPath, normalizedPath, {
            currentPeakDb: windowAnalysis.maxVolumeDb,
            ...DIARIZATION_PROFILES.low_signal.retry,
            signal: options.signal,
          });
          diagnostic.retriedWithGain = true;
          segments = await this.diarize(normalizedPath, {
            ...options,
            threshold: DIARIZATION_PROFILES.low_signal.retry.threshold,
            minDurationOn: DIARIZATION_PROFILES.low_signal.retry.minDurationOn,
            minDurationOff: DIARIZATION_PROFILES.low_signal.retry.minDurationOff,
          });
        }

        diagnostic.segmentCount = Array.isArray(segments) ? segments.length : 0;
        diagnostics.windows.push(diagnostic);
        windowResults.push({
          ...window,
          analysis: windowAnalysis,
          profile,
          segments: Array.isArray(segments) ? segments : [],
          score: scoreDiarizationWindow(windowAnalysis, profile),
        });
      }

      const mergedSegments = shouldWindow
        ? mergeWindowSegments(windowResults)
        : windowResults[0]?.segments || [];
      return {
        segments: this.stabilizeSpeakerClusters(mergedSegments, options.stabilizeOptions || {}),
        diagnostics,
      };
    } finally {
      for (const tempPath of tempPaths) {
        this._cleanupAdaptiveTempPath(tempPath);
      }
    }
  }

  _makeAdaptiveTempPath(label) {
    return path.join(
      getSafeTempDir(),
      `openwhispr-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`
    );
  }

  _cleanupAdaptiveTempPath(filePath) {
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
  }

  _analyzeAudioFile(filePath, options = {}) {
    return analyzeAudioFile(filePath, { signal: options.signal });
  }

  _extractAudioWindowToWav(inputPath, outputPath, options = {}) {
    return extractAudioWindowToWav(inputPath, outputPath, options);
  }

  _normalizeAudioPeak(inputPath, outputPath, options = {}) {
    return normalizeAudioPeak(inputPath, outputPath, options);
  }

  _parseOutput(stdout) {
    const segments = [];
    const lineRegex = /^(\d+\.?\d*)\s+--\s+(\d+\.?\d*)\s+(speaker_\d+)$/;

    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(lineRegex);
      if (match) {
        segments.push({
          start: parseFloat(match[1]),
          end: parseFloat(match[2]),
          speaker: match[3],
        });
      }
    }

    return segments;
  }

  capSpeakerClusters(segments, cap) {
    if (!cap || !segments?.length) return segments;
    const totals = new Map();
    for (const s of segments) {
      totals.set(s.speaker, (totals.get(s.speaker) || 0) + (s.end - s.start));
    }
    if (totals.size <= cap) return segments;

    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const keep = new Set(ranked.slice(0, cap).map(([sp]) => sp));
    const primary = ranked[0][0];
    return segments.map((s) => (keep.has(s.speaker) ? s : { ...s, speaker: primary }));
  }

  stabilizeSpeakerClusters(
    segments,
    { cap = MAX_SPEAKER_COUNT, minNoiseDuration = 1.2, minNoiseSegments = 2 } = {}
  ) {
    if (!Array.isArray(segments) || segments.length === 0) return [];

    const stats = new Map();
    for (const segment of segments) {
      const duration = Math.max(0, segment.end - segment.start);
      const existing = stats.get(segment.speaker) || {
        totalDuration: 0,
        count: 0,
        segments: [],
      };
      existing.totalDuration += duration;
      existing.count += 1;
      existing.segments.push(segment);
      stats.set(segment.speaker, existing);
    }

    if (stats.size <= 1) return segments.map((segment) => ({ ...segment }));

    const ranked = [...stats.entries()].sort((a, b) => b[1].totalDuration - a[1].totalDuration);
    const primarySpeaker = ranked[0][0];
    const stableSpeakers = new Set(
      ranked
        .filter(
          ([speaker, stat]) =>
            speaker === primarySpeaker ||
            stat.totalDuration >= minNoiseDuration ||
            stat.count >= minNoiseSegments
        )
        .map(([speaker]) => speaker)
    );

    const distanceBetween = (a, b) => {
      if (a.end >= b.start && b.end >= a.start) return 0;
      return a.end < b.start ? b.start - a.end : a.start - b.end;
    };

    const nearestStableSpeaker = (speaker) => {
      let bestSpeaker = primarySpeaker;
      let bestDistance = Number.POSITIVE_INFINITY;
      const sourceSegments = stats.get(speaker)?.segments || [];

      for (const candidate of stableSpeakers) {
        if (candidate === speaker) continue;
        const candidateSegments = stats.get(candidate)?.segments || [];
        for (const source of sourceSegments) {
          for (const target of candidateSegments) {
            const distance = distanceBetween(source, target);
            if (distance < bestDistance) {
              bestDistance = distance;
              bestSpeaker = candidate;
            }
          }
        }
      }

      return bestSpeaker;
    };

    const stabilized = segments.map((segment) =>
      stableSpeakers.has(segment.speaker)
        ? { ...segment }
        : { ...segment, speaker: nearestStableSpeaker(segment.speaker) }
    );

    return this.capSpeakerClusters(stabilized, cap);
  }

  sanitizeTranscriptSegments(segments, { mergeGapSeconds = 1.2 } = {}) {
    if (!Array.isArray(segments) || segments.length === 0) return [];
    const cleaned = [];

    for (const segment of segments) {
      const text = typeof segment.text === "string" ? segment.text.trim() : "";
      if (!text) continue;

      const duration =
        Number.isFinite(segment.endTime) && Number.isFinite(segment.timestamp)
          ? segment.endTime - segment.timestamp
          : null;
      if (!segment.speakerLocked && duration != null && duration < 0.35 && text.length <= 1) {
        continue;
      }

      const current = { ...segment, text };
      const previous = cleaned[cleaned.length - 1];
      const gap =
        previous && Number.isFinite(previous.endTime) && Number.isFinite(current.timestamp)
          ? current.timestamp - previous.endTime
          : null;

      if (
        previous &&
        previous.source === current.source &&
        previous.speaker === current.speaker &&
        !previous.speakerLocked &&
        !current.speakerLocked &&
        gap != null &&
        gap >= 0 &&
        gap <= mergeGapSeconds
      ) {
        previous.text = `${previous.text} ${current.text}`.trim();
        previous.endTime = current.endTime ?? previous.endTime;
        continue;
      }

      cleaned.push(current);
    }

    return cleaned;
  }

  mergeWithTranscript(transcriptSegments, diarizationSegments, options = {}) {
    const assignMicSegments = options.assignMicSegments === true;
    const includeDiagnostics = options.includeDiagnostics === true;
    const emptyResult = includeDiagnostics
      ? {
          segments: [],
          diagnostics: {
            speakerCount: 0,
            matchedSegmentCount: 0,
            fallbackMatchedSegmentCount: 0,
            unmatchedSegmentCount: 0,
            missingTimestampCount: 0,
            diarizationSegmentCount: 0,
            lockedSegmentCount: 0,
          },
        }
      : [];
    if (!transcriptSegments || transcriptSegments.length === 0) return emptyResult;
    const deduped = dedupeMicAgainstSystem(transcriptSegments);
    const diagnostics = {
      speakerCount: 0,
      matchedSegmentCount: 0,
      fallbackMatchedSegmentCount: 0,
      unmatchedSegmentCount: 0,
      missingTimestampCount: 0,
      diarizationSegmentCount: 0,
      lockedSegmentCount: 0,
    };

    const finalize = (segments) => {
      const sanitized = this.sanitizeTranscriptSegments(segments);
      return includeDiagnostics ? { segments: sanitized, diagnostics } : sanitized;
    };

    if (!diarizationSegments || diarizationSegments.length === 0) {
      const copied = deduped.map((seg) => {
        const enriched = { ...seg };
        if (isSpeakerLocked(enriched)) {
          diagnostics.lockedSegmentCount += 1;
          return enriched;
        }
        const shouldDiagnose =
          seg?.source === "system" || (assignMicSegments && seg?.source === "mic");
        if (shouldDiagnose) {
          if (seg.timestamp == null) diagnostics.missingTimestampCount += 1;
          diagnostics.unmatchedSegmentCount += 1;
          enriched.speakerMatchStatus = "unmatched";
          enriched.speakerMatchReason =
            seg.timestamp == null ? "missing_timestamp" : "no_diarization";
        }
        return enriched;
      });
      return finalize(copied);
    }

    const cappedDiarizationSegments =
      options.diarizationAlreadyStabilized === true
        ? diarizationSegments.map((segment) => ({ ...segment }))
        : this.stabilizeSpeakerClusters(diarizationSegments, options.stabilizeOptions || {});
    diagnostics.diarizationSegmentCount = cappedDiarizationSegments.length;

    // Build speaker renumbering map (e.g., speaker_00 → speaker_0)
    const speakerSet = new Set(cappedDiarizationSegments.map((d) => d.speaker));
    diagnostics.speakerCount = speakerSet.size;
    const speakerMap = new Map();
    let idx = 0;
    for (const sp of speakerSet) {
      speakerMap.set(sp, `speaker_${idx}`);
      idx++;
    }

    const isAssignableSegment = (segment) =>
      segment?.source === "system" || (assignMicSegments && segment?.source === "mic");

    const nextAssignableTimestampAt = (startIndex) => {
      for (let i = startIndex + 1; i < deduped.length; i += 1) {
        const candidate = deduped[i];
        if (isAssignableSegment(candidate) && candidate.timestamp != null) {
          return candidate.timestamp;
        }
      }
      return null;
    };

    const merged = deduped.map((seg, index) => {
      const enriched = { ...seg };

      if (isSpeakerLocked(enriched)) {
        diagnostics.lockedSegmentCount += 1;
        return enriched;
      }

      if (seg.source === "mic" && !assignMicSegments) {
        applyConfirmedSpeaker(enriched, {
          speaker: "you",
          speakerIsPlaceholder: false,
        });
        return enriched;
      }

      if (isAssignableSegment(seg)) {
        if (seg.timestamp == null) {
          diagnostics.missingTimestampCount += 1;
          diagnostics.unmatchedSegmentCount += 1;
          enriched.speakerMatchStatus = "unmatched";
          enriched.speakerMatchReason = "missing_timestamp";
          return enriched;
        }

        const segStart = seg.timestamp;
        const explicitEnd =
          Number.isFinite(seg.endTime) && seg.endTime > segStart ? seg.endTime : null;
        const segEnd = explicitEnd ?? nextAssignableTimestampAt(index) ?? segStart + 2.5;
        const midpoint = segStart + (segEnd - segStart) / 2;
        let bestSpeaker = null;
        let bestOverlap = 0;
        let nearestSpeaker = null;
        let bestDistance = Number.POSITIVE_INFINITY;

        for (const dSeg of cappedDiarizationSegments) {
          const overlap = Math.min(segEnd, dSeg.end) - Math.max(segStart, dSeg.start);
          if (overlap > bestOverlap) {
            bestOverlap = overlap;
            bestSpeaker = dSeg.speaker;
          }

          const distance =
            midpoint < dSeg.start
              ? dSeg.start - midpoint
              : midpoint > dSeg.end
                ? midpoint - dSeg.end
                : 0;

          if (distance < bestDistance) {
            bestDistance = distance;
            nearestSpeaker = dSeg.speaker;
          }
        }

        const matchMethod = bestSpeaker ? "overlap" : nearestSpeaker ? "nearest" : null;
        const matchedSpeaker = bestSpeaker || nearestSpeaker;

        if (matchedSpeaker) {
          applyConfirmedSpeaker(enriched, {
            speaker: speakerMap.get(matchedSpeaker) || matchedSpeaker,
            speakerIsPlaceholder: false,
          });
          enriched.speakerMatchStatus = "matched";
          enriched.speakerMatchMethod = matchMethod;
          diagnostics.matchedSegmentCount += 1;
          if (matchMethod === "nearest") {
            diagnostics.fallbackMatchedSegmentCount += 1;
          }
          if (assignMicSegments && enriched.source === "mic") {
            enriched.source = "system";
          }
        } else {
          diagnostics.unmatchedSegmentCount += 1;
          enriched.speakerMatchStatus = "unmatched";
          enriched.speakerMatchReason = "no_overlap";
          if (!enriched.speaker) {
            delete enriched.speakerIsPlaceholder;
          }
        }
      }

      return enriched;
    });

    return finalize(merged);
  }

  async convertRawPcmToWav(rawPcmPath, inputSampleRate) {
    const stat = await fsPromises.stat(rawPcmPath);
    if (stat.size === 0) {
      throw new Error("Raw PCM file is empty");
    }

    const tempDir = getSafeTempDir();
    const timestamp = Date.now();
    const inputWavPath = path.join(tempDir, `ow-diarize-${timestamp}-input.wav`);
    const wavPath = path.join(tempDir, `ow-diarize-${timestamp}.wav`);

    // Stream: write 44-byte WAV header, then pipe raw PCM — avoids loading entire file into memory
    const header = this._createWavHeader(stat.size, inputSampleRate, 1);
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(inputWavPath);
      out.write(header);
      const pcmStream = fs.createReadStream(rawPcmPath);
      pcmStream.pipe(out);
      out.on("finish", resolve);
      out.on("error", reject);
      pcmStream.on("error", reject);
    });

    try {
      await convertToWav(inputWavPath, wavPath, { sampleRate: 16000, channels: 1 });
    } finally {
      await fsPromises.unlink(inputWavPath).catch(() => {});
    }

    debugLogger.debug("Raw PCM converted to WAV for diarization", {
      wavPath,
      rawPcmBytes: stat.size,
    });

    return wavPath;
  }

  _createWavHeader(dataSize, sampleRate, channels) {
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const header = Buffer.alloc(44);

    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bytesPerSample * 8, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);

    return header;
  }

  async deleteModels() {
    const modelsDir = this.getModelsDir();
    const segDir = path.join(modelsDir, SEGMENTATION_DIR);
    const embPath = path.join(modelsDir, EMBEDDING_ONNX);
    const vadPath = this.getVadModelPath();

    if (fs.existsSync(segDir)) {
      await fsPromises.rm(segDir, { recursive: true, force: true });
    }
    if (fs.existsSync(embPath)) {
      await fsPromises.unlink(embPath);
    }
    if (fs.existsSync(vadPath)) {
      await fsPromises.unlink(vadPath);
    }

    debugLogger.info("Diarization models deleted", { modelsDir });
    return { success: true };
  }

  async shutdown() {
    if (this._process) {
      await gracefulStopProcess(this._process);
      this._process = null;
    }
  }
}

module.exports = DiarizationManager;
