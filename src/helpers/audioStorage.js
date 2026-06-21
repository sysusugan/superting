const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("./debugLogger");
const { compressToOpusWebm, mergeToOpusWebm } = require("./ffmpegUtils");
const {
  buildMergedMeetingAudioFilename,
  buildDictationAudioFilename,
  buildMeetingWavFallbackFilename,
  isDictationAudioFile,
  isRetainedAudioFile,
  resolveRetainedAudioPath,
} = require("./audioStorageFiles");

const PENDING_DELETE_DIR = ".pending-delete";

class AudioStorageManager {
  constructor(options = {}) {
    this.audioDir = options.audioDir || path.join(app.getPath("userData"), "audio");
    this.compressToOpusWebm = options.compressToOpusWebm || compressToOpusWebm;
    this.mergeToOpusWebm = options.mergeToOpusWebm || mergeToOpusWebm;
    this.ensureAudioDir();
  }

  ensureAudioDir() {
    try {
      fs.mkdirSync(this.audioDir, { recursive: true });
    } catch (error) {
      debugLogger.error(
        "Failed to create audio directory",
        { error: error.message },
        "audio-storage"
      );
    }
  }

  _buildFilename(transcriptionId, timestamp) {
    return buildDictationAudioFilename(transcriptionId, timestamp);
  }

  saveAudio(transcriptionId, audioBuffer, timestamp) {
    try {
      const filename = this._buildFilename(transcriptionId, timestamp);
      const filePath = path.join(this.audioDir, filename);
      fs.writeFileSync(filePath, audioBuffer);
      debugLogger.debug(
        "Audio saved",
        { transcriptionId, filename, size: audioBuffer.length },
        "audio-storage"
      );
      return { success: true, path: filePath };
    } catch (error) {
      debugLogger.error(
        "Failed to save audio",
        { transcriptionId, error: error.message },
        "audio-storage"
      );
      return { success: false };
    }
  }

  _makeTempAudioPath(prefix, ext) {
    return path.join(
      os.tmpdir(),
      `superting-${prefix}-${crypto.randomBytes(6).toString("hex")}${ext}`
    );
  }

  _writePcmAsWav(inputPcmPath, outputWavPath, stats, { sampleRate, channels }) {
    const bytesPerSample = 2;
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + stats.size, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
    header.writeUInt16LE(channels * bytesPerSample, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(stats.size, 40);

    const out = fs.openSync(outputWavPath, "w");
    try {
      fs.writeSync(out, header);
      const input = fs.openSync(inputPcmPath, "r");
      try {
        const buffer = Buffer.alloc(1024 * 1024);
        let bytesRead = 0;
        while ((bytesRead = fs.readSync(input, buffer, 0, buffer.length, null)) > 0) {
          fs.writeSync(out, buffer, 0, bytesRead);
        }
      } finally {
        fs.closeSync(input);
      }
    } finally {
      fs.closeSync(out);
    }
  }

  async saveMeetingPcmAudio(noteId, pcmPath, timestamp, options = {}) {
    const sampleRate = options.sampleRate || 24000;
    const channels = options.channels || 1;
    const bytesPerSample = 2;
    try {
      const stats = fs.statSync(pcmPath);
      if (stats.size <= 0) {
        return { success: false, error: "No meeting audio captured" };
      }

      const filename = buildMeetingWavFallbackFilename(noteId, timestamp);
      const filePath = path.join(this.audioDir, filename);
      this._writePcmAsWav(pcmPath, filePath, stats, { sampleRate, channels });
      const durationSeconds = stats.size / (sampleRate * channels * bytesPerSample);

      debugLogger.debug(
        "Meeting audio saved",
        { noteId, filename, size: stats.size, durationSeconds, compressed: false },
        "audio-storage"
      );
      return { success: true, path: filePath, filename, durationSeconds, compressed: false };
    } catch (error) {
      debugLogger.error(
        "Failed to save meeting audio",
        { noteId, error: error.message },
        "audio-storage"
      );
      return { success: false, error: error.message };
    }
  }

  async mergeRetainedAudioToOpusWebm(noteId, filenames, timestamp, options = {}) {
    try {
      const inputPaths = [];
      for (const filename of filenames || []) {
        const filePath = this.getRetainedAudioPath(filename);
        if (!filePath) {
          return { success: false, error: `Audio file unavailable: ${filename}` };
        }
        inputPaths.push(filePath);
      }
      if (inputPaths.length === 0) {
        return { success: false, error: "No audio files to merge" };
      }

      const filename = buildMergedMeetingAudioFilename(noteId, timestamp);
      const filePath = path.join(this.audioDir, filename);
      await this.mergeToOpusWebm(inputPaths, filePath, {
        sampleRate: options.sampleRate || 24000,
        channels: options.channels || 1,
        bitrate: options.bitrate || "24k",
        application: "voip",
      });

      debugLogger.debug(
        "Meeting audio merged",
        { noteId, filename, inputCount: inputPaths.length },
        "audio-storage"
      );
      return { success: true, path: filePath, filename };
    } catch (error) {
      debugLogger.error(
        "Failed to merge meeting audio",
        { noteId, error: error.message },
        "audio-storage"
      );
      return { success: false, error: error.message };
    }
  }

  async compressRetainedAudioToOpusWebm(filename, options = {}) {
    try {
      const inputPath = this.getRetainedAudioPath(filename);
      if (!inputPath) {
        return { success: false, error: "Audio file unavailable" };
      }

      const ext = path.extname(filename).toLowerCase();
      if (ext === ".webm") {
        return { success: true, path: inputPath, filename, alreadyCompressed: true };
      }

      const outputFilename = `${path.basename(filename, ext)}.webm`;
      const outputPath = path.join(this.audioDir, outputFilename);
      const validation = await this.compressToOpusWebm(inputPath, outputPath, {
        sampleRate: options.sampleRate || 24000,
        channels: options.channels || 1,
        bitrate: options.bitrate || "24k",
        application: "voip",
      });
      try {
        fs.unlinkSync(inputPath);
      } catch (error) {
        try {
          fs.unlinkSync(outputPath);
        } catch {
          // ignore cleanup errors
        }
        return { success: false, error: error.message || "Failed to delete original WAV" };
      }

      debugLogger.debug(
        "Retained audio compressed",
        { filename, outputFilename },
        "audio-storage"
      );
      return {
        success: true,
        path: outputPath,
        filename: outputFilename,
        validation,
      };
    } catch (error) {
      debugLogger.error(
        "Failed to compress retained audio",
        { filename, error: error.message },
        "audio-storage"
      );
      return { success: false, error: error.message };
    }
  }

  async compressAllRetainedAudioToOpusWebm(options = {}) {
    try {
      const files = fs.readdirSync(this.audioDir).filter(isRetainedAudioFile);
      const targets = files.filter((file) => path.extname(file).toLowerCase() !== ".webm");
      const result = {
        success: true,
        scanned: files.length,
        compressed: 0,
        skipped: files.length - targets.length,
        failed: 0,
        pendingDeleteRemoved: 0,
        files: [],
        errors: [],
      };

      for (const filename of targets) {
        try {
          const compressed = await this.compressRetainedAudioToOpusWebm(filename, options);
          if (!compressed.success) {
            result.success = false;
            result.failed += 1;
            result.errors.push({ filename, error: compressed.error || "Compression failed" });
            continue;
          }
          if (compressed.alreadyCompressed || compressed.filename === filename) {
            result.skipped += 1;
            continue;
          }

          if (typeof options.onCompressed === "function") {
            await options.onCompressed(filename, compressed);
          }
          result.compressed += 1;
          result.files.push({ sourceFilename: filename, filename: compressed.filename });
        } catch (error) {
          result.success = false;
          result.failed += 1;
          result.errors.push({ filename, error: error.message });
        }
      }

      debugLogger.info(
        "Retained audio bulk compression complete",
        {
          scanned: result.scanned,
          compressed: result.compressed,
          skipped: result.skipped,
          failed: result.failed,
        },
        "audio-storage"
      );
      result.pendingDeleteRemoved = this.cleanupPendingDeleteAudio().deleted;
      return result;
    } catch (error) {
      debugLogger.error(
        "Failed to compress all retained audio",
        { error: error.message },
        "audio-storage"
      );
      return {
        success: false,
        scanned: 0,
        compressed: 0,
        skipped: 0,
        failed: 0,
        files: [],
        errors: [{ error: error.message }],
      };
    }
  }

  getAudioPath(transcriptionId) {
    try {
      const files = fs.readdirSync(this.audioDir);
      const match = files.find(
        (f) => f.endsWith(`-${transcriptionId}.webm`) || f === `${transcriptionId}.webm`
      );
      if (match) return path.join(this.audioDir, match);
    } catch {}
    return null;
  }

  getRetainedAudioPath(filename) {
    const filePath = resolveRetainedAudioPath(this.audioDir, filename);
    if (!filePath) return null;
    try {
      const stats = fs.statSync(filePath);
      return stats.isFile() ? filePath : null;
    } catch {
      return null;
    }
  }

  getAudioBuffer(transcriptionId) {
    const filePath = this.getAudioPath(transcriptionId);
    if (!filePath) return null;
    try {
      return fs.readFileSync(filePath);
    } catch (error) {
      debugLogger.error(
        "Failed to read audio",
        { transcriptionId, error: error.message },
        "audio-storage"
      );
      return null;
    }
  }

  deleteAudio(transcriptionId) {
    try {
      const filePath = this.getAudioPath(transcriptionId);
      if (filePath) {
        fs.unlinkSync(filePath);
        debugLogger.debug("Audio deleted", { transcriptionId }, "audio-storage");
      }
      return { success: true };
    } catch (error) {
      debugLogger.error(
        "Failed to delete audio",
        { transcriptionId, error: error.message },
        "audio-storage"
      );
      return { success: false };
    }
  }

  deleteRetainedAudioFiles(filenames = []) {
    const uniqueFilenames = [...new Set((filenames || []).filter(Boolean))];
    const result = { success: true, deleted: [], missing: [], failed: [] };

    for (const filename of uniqueFilenames) {
      const filePath = resolveRetainedAudioPath(this.audioDir, filename);
      if (!filePath) {
        result.failed.push({ filename, error: "Invalid audio filename" });
        result.success = false;
        continue;
      }

      try {
        if (!fs.existsSync(filePath)) {
          result.missing.push(filename);
          continue;
        }
        fs.unlinkSync(filePath);
        result.deleted.push(filename);
      } catch (error) {
        result.failed.push({ filename, error: error.message });
        result.success = false;
        debugLogger.error(
          "Failed to delete retained audio file",
          { filename, error: error.message },
          "audio-storage"
        );
      }
    }

    if (result.deleted.length > 0 || result.missing.length > 0 || result.failed.length > 0) {
      debugLogger.info(
        "Retained audio delete complete",
        {
          deleted: result.deleted.length,
          missing: result.missing.length,
          failed: result.failed.length,
        },
        "audio-storage"
      );
    }

    return result;
  }

  cleanupExpiredAudio(retentionDays, databaseManager) {
    try {
      const files = fs.readdirSync(this.audioDir).filter(isRetainedAudioFile);
      if (retentionDays <= 0) {
        debugLogger.info(
          "Audio cleanup skipped",
          { kept: files.length, retentionDays },
          "audio-storage"
        );
        return { deleted: 0, kept: files.length };
      }

      const cutoffMs = Date.now() - retentionDays * 86400000;
      const expiredIds = [];
      const deletedFilenames = [];
      const remainingFilenames = [];
      let kept = 0;

      for (const file of files) {
        const filePath = path.join(this.audioDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.mtimeMs < cutoffMs) {
            fs.unlinkSync(filePath);
            deletedFilenames.push(file);
            // Extract ID from "SuperTing-...-{id}.webm" or legacy "{id}.webm"
            if (isDictationAudioFile(file)) {
              const basename = path.basename(file, ".webm");
              const lastDash = basename.lastIndexOf("-");
              const id = lastDash !== -1 ? basename.slice(lastDash + 1) : basename;
              expiredIds.push(id);
            }
          } else {
            kept++;
            remainingFilenames.push(file);
          }
        } catch (error) {
          debugLogger.error(
            "Failed to process audio file during cleanup",
            { file, error: error.message },
            "audio-storage"
          );
        }
      }

      if (expiredIds.length > 0 && databaseManager) {
        databaseManager.clearAudioFlags(expiredIds);
      }
      if (deletedFilenames.length > 0 && databaseManager?.removeNoteAudioFilesByFilename) {
        databaseManager.removeNoteAudioFilesByFilename(deletedFilenames, remainingFilenames);
      }

      debugLogger.info(
        "Audio cleanup complete",
        { deleted: deletedFilenames.length, kept, retentionDays },
        "audio-storage"
      );
      return { deleted: deletedFilenames.length, kept };
    } catch (error) {
      debugLogger.error("Audio cleanup failed", { error: error.message }, "audio-storage");
      return { deleted: 0, kept: 0 };
    }
  }

  deleteAllAudio() {
    try {
      const files = fs.readdirSync(this.audioDir).filter(isRetainedAudioFile);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(this.audioDir, file));
        } catch (error) {
          debugLogger.error(
            "Failed to delete audio file",
            { file, error: error.message },
            "audio-storage"
          );
        }
      }
      this.cleanupPendingDeleteAudio();
      debugLogger.info("All audio deleted", { count: files.length }, "audio-storage");
      return { deleted: files.length };
    } catch (error) {
      debugLogger.error("Failed to delete all audio", { error: error.message }, "audio-storage");
      return { deleted: 0 };
    }
  }

  cleanupPendingDeleteAudio() {
    const pendingDir = path.join(this.audioDir, PENDING_DELETE_DIR);
    const resolvedAudioDir = path.resolve(this.audioDir);
    const resolvedPendingDir = path.resolve(pendingDir);
    if (
      resolvedPendingDir !== path.join(resolvedAudioDir, PENDING_DELETE_DIR) ||
      !resolvedPendingDir.startsWith(`${resolvedAudioDir}${path.sep}`)
    ) {
      return { deleted: 0 };
    }

    try {
      if (!fs.existsSync(resolvedPendingDir)) {
        return { deleted: 0 };
      }

      let deleted = 0;
      const countFiles = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const entryPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            countFiles(entryPath);
          } else if (entry.isFile()) {
            deleted += 1;
          }
        }
      };
      countFiles(resolvedPendingDir);
      fs.rmSync(resolvedPendingDir, { recursive: true, force: true });
      if (deleted > 0) {
        debugLogger.info(
          "Pending-delete audio backups removed",
          { deleted },
          "audio-storage"
        );
      }
      return { deleted };
    } catch (error) {
      debugLogger.warn(
        "Failed to clean pending-delete audio backups",
        { error: error.message },
        "audio-storage"
      );
      return { deleted: 0, error: error.message };
    }
  }

  getStorageUsage() {
    try {
      const files = fs.readdirSync(this.audioDir).filter(isRetainedAudioFile);
      let totalBytes = 0;
      let uncompressedCount = 0;
      for (const file of files) {
        try {
          const stats = fs.statSync(path.join(this.audioDir, file));
          totalBytes += stats.size;
          if (path.extname(file).toLowerCase() !== ".webm") {
            uncompressedCount += 1;
          }
        } catch {
          // Skip files that can't be stat'd
        }
      }
      return { fileCount: files.length, totalBytes, uncompressedCount };
    } catch (error) {
      debugLogger.error("Failed to get storage usage", { error: error.message }, "audio-storage");
      return { fileCount: 0, totalBytes: 0, uncompressedCount: 0 };
    }
  }
}

module.exports = AudioStorageManager;
