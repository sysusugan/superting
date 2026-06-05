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
  buildMeetingAudioFilename,
  buildMeetingWavFallbackFilename,
  isDictationAudioFile,
  isRetainedAudioFile,
  resolveRetainedAudioPath,
} = require("./audioStorageFiles");

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
      `openwhispr-${prefix}-${crypto.randomBytes(6).toString("hex")}${ext}`
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
    let tempWavPath = null;

    try {
      const stats = fs.statSync(pcmPath);
      if (stats.size <= 0) {
        return { success: false, error: "No meeting audio captured" };
      }

      const filename = buildMeetingAudioFilename(noteId, timestamp);
      const filePath = path.join(this.audioDir, filename);
      tempWavPath = this._makeTempAudioPath("meeting-wav", ".wav");
      this._writePcmAsWav(pcmPath, tempWavPath, stats, { sampleRate, channels });
      const durationSeconds = stats.size / (sampleRate * channels * bytesPerSample);

      try {
        await this.compressToOpusWebm(tempWavPath, filePath, {
          sampleRate,
          channels,
          bitrate: options.bitrate || "24k",
          application: "voip",
        });
        fs.unlinkSync(tempWavPath);
        tempWavPath = null;
        debugLogger.debug(
          "Meeting audio saved",
          { noteId, filename, size: stats.size, durationSeconds, compressed: true },
          "audio-storage"
        );
        return { success: true, path: filePath, filename, durationSeconds, compressed: true };
      } catch (compressionError) {
        const fallbackFilename = buildMeetingWavFallbackFilename(noteId, timestamp);
        const fallbackPath = path.join(this.audioDir, fallbackFilename);
        fs.renameSync(tempWavPath, fallbackPath);
        tempWavPath = null;
        debugLogger.warn(
          "Meeting audio Opus compression failed; saved WAV fallback",
          { noteId, error: compressionError.message, filename: fallbackFilename },
          "audio-storage"
        );
        return {
          success: true,
          path: fallbackPath,
          filename: fallbackFilename,
          durationSeconds,
          compressed: false,
          error: compressionError.message,
        };
      }
    } catch (error) {
      if (tempWavPath) {
        try {
          fs.unlinkSync(tempWavPath);
        } catch {}
      }
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
      await this.compressToOpusWebm(inputPath, outputPath, {
        sampleRate: options.sampleRate || 24000,
        channels: options.channels || 1,
        bitrate: options.bitrate || "24k",
        application: "voip",
      });

      debugLogger.debug(
        "Retained audio compressed",
        { filename, outputFilename },
        "audio-storage"
      );
      return { success: true, path: outputPath, filename: outputFilename };
    } catch (error) {
      debugLogger.error(
        "Failed to compress retained audio",
        { filename, error: error.message },
        "audio-storage"
      );
      return { success: false, error: error.message };
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
      const cutoffMs = Date.now() - retentionDays * 86400000;
      const files = fs.readdirSync(this.audioDir).filter(isRetainedAudioFile);
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
            // Extract ID from "OpenWhispr-...-{id}.webm" or legacy "{id}.webm"
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
      debugLogger.info("All audio deleted", { count: files.length }, "audio-storage");
      return { deleted: files.length };
    } catch (error) {
      debugLogger.error("Failed to delete all audio", { error: error.message }, "audio-storage");
      return { deleted: 0 };
    }
  }

  getStorageUsage() {
    try {
      const files = fs.readdirSync(this.audioDir).filter(isRetainedAudioFile);
      let totalBytes = 0;
      for (const file of files) {
        try {
          const stats = fs.statSync(path.join(this.audioDir, file));
          totalBytes += stats.size;
        } catch {
          // Skip files that can't be stat'd
        }
      }
      return { fileCount: files.length, totalBytes };
    } catch (error) {
      debugLogger.error("Failed to get storage usage", { error: error.message }, "audio-storage");
      return { fileCount: 0, totalBytes: 0 };
    }
  }
}

module.exports = AudioStorageManager;
