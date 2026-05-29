const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("./debugLogger");
const {
  buildDictationAudioFilename,
  buildMeetingAudioFilename,
  isDictationAudioFile,
  isRetainedAudioFile,
  resolveRetainedAudioPath,
} = require("./audioStorageFiles");

class AudioStorageManager {
  constructor(options = {}) {
    this.audioDir = options.audioDir || path.join(app.getPath("userData"), "audio");
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

  saveMeetingPcmAudio(noteId, pcmPath, timestamp, options = {}) {
    const sampleRate = options.sampleRate || 24000;
    const channels = options.channels || 1;
    const bytesPerSample = 2;

    try {
      const stats = fs.statSync(pcmPath);
      if (stats.size <= 0) {
        return { success: false, error: "No meeting audio captured" };
      }

      const filename = buildMeetingAudioFilename(noteId, timestamp);
      const filePath = path.join(this.audioDir, filename);
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

      const out = fs.openSync(filePath, "w");
      try {
        fs.writeSync(out, header);
        const input = fs.openSync(pcmPath, "r");
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

      const durationSeconds = stats.size / (sampleRate * channels * bytesPerSample);
      debugLogger.debug(
        "Meeting audio saved",
        { noteId, filename, size: stats.size, durationSeconds },
        "audio-storage"
      );
      return { success: true, path: filePath, filename, durationSeconds };
    } catch (error) {
      debugLogger.error(
        "Failed to save meeting audio",
        { noteId, error: error.message },
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
