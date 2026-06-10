import React, { useState, useRef, useEffect, Suspense } from "react";
import { useTranslation } from "react-i18next";
import {
  Upload,
  FileAudio,
  X,
  AlertCircle,
  ChevronRight,
  FolderOpen,
  Plus,
  Settings,
} from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Input } from "../ui/input";
import type { FolderItem } from "../../types/electron";
import { findDefaultFolder } from "./shared";
import { useSettings } from "../../hooks/useSettings";
import { getAllReasoningModels } from "../../models/ModelRegistry";
import {
  useSettingsStore,
  selectIsCloudCleanupMode,
  getSettings,
} from "../../stores/settingsStore";
import { useUploadTranscriptionStore } from "../../stores/uploadTranscriptionStore";
import { generateNoteTitle } from "../../utils/generateTitle";

const TranscriptionModelPicker = React.lazy(() => import("../TranscriptionModelPicker"));

const SUPPORTED_EXTENSIONS = ["mp3", "wav", "m4a", "webm", "ogg", "oga", "flac", "aac"];

const BYOK_MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB — hard limit for bring-your-own-key

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface UploadAudioViewProps {
  onNoteCreated?: (noteId: number, folderId: number | null) => void;
  onOpenSettings?: (section: string) => void;
}

export default function UploadAudioView({ onNoteCreated, onOpenSettings }: UploadAudioViewProps) {
  const { t } = useTranslation();
  const [isDragOver, setIsDragOver] = useState(false);

  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const [setupDismissed, setSetupDismissed] = useState(
    () =>
      localStorage.getItem("uploadSetupComplete") === "true" ||
      localStorage.getItem("notesOnboardingComplete") === "true"
  );
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [providerReady, setProviderReady] = useState<boolean | null>(null);

  const {
    useLocalWhisper,
    setUseLocalWhisper,
    whisperModel,
    setWhisperModel,
    localTranscriptionProvider,
    setLocalTranscriptionProvider,
    parakeetModel,
    setParakeetModel,
    cloudTranscriptionProvider,
    setCloudTranscriptionProvider,
    cloudTranscriptionModel,
    setCloudTranscriptionModel,
    cloudTranscriptionBaseUrl,
    setCloudTranscriptionBaseUrl,
    setCloudTranscriptionMode,
    openaiApiKey,
    groqApiKey,
    mistralApiKey,
    customTranscriptionApiKey,
    customDictionary,
    customDictionaryAliases,
    updateTranscriptionSettings,
  } = useSettings();

  const isCloudCleanup = useSettingsStore(selectIsCloudCleanupMode);
  const effectiveCleanupModel = useSettingsStore((s) =>
    selectIsCloudCleanupMode(s) ? "" : s.cleanupModel
  );
  const useCleanupModel = useSettingsStore((s) => s.useCleanupModel);
  const {
    state,
    file,
    result,
    noteId,
    error,
    progress,
    chunkProgress,
    selectedFolderId,
    selectFile,
    setSelectedFolderId,
    setDefaultFolderId,
    reset: resetUploadState,
    runTranscription,
    cancelTranscription: cancelUploadTranscription,
  } = useUploadTranscriptionStore();

  const showSetup = !setupDismissed && state === "idle";
  const showModelPicker = true;

  // Mode-aware file size validation
  // Local: no limits at all
  // BYOK: 25 MB hard max regardless of plan
  // BYOK providers commonly reject very large single uploads.
  // Cloud pro: 500 MB max
  let fileTooLarge = false;
  let byokTooLarge = false;
  let isLargeFile = false;

  if (file) {
    if (useLocalWhisper) {
      // Local transcription: no file size restrictions
    } else if (cloudTranscriptionProvider === "custom") {
      // Custom endpoints (e.g. local whisper.cpp): no file size restrictions
    } else {
      byokTooLarge = file.sizeBytes > BYOK_MAX_FILE_SIZE;
    }
  }

  useEffect(() => {
    window.electronAPI.getFolders?.().then((f) => {
      setFolders(f);
      const personal = findDefaultFolder(f);
      if (personal) setDefaultFolderId(String(personal.id));
    });
  }, [setDefaultFolderId]);

  useEffect(() => {
    let cancelled = false;
    const checkProviderReady = async () => {
      if (!useLocalWhisper) {
        if (cloudTranscriptionProvider === "custom") {
          // Custom providers only need a base URL; API key is truly optional
          if (!cancelled) setProviderReady(!!cloudTranscriptionBaseUrl?.trim());
        } else {
          const key =
            cloudTranscriptionProvider === "openai"
              ? openaiApiKey
              : cloudTranscriptionProvider === "groq"
                ? groqApiKey
                : cloudTranscriptionProvider === "mistral"
                  ? mistralApiKey
                  : customTranscriptionApiKey;
          if (!cancelled) setProviderReady(!!key);
        }
        return;
      }
      if (localTranscriptionProvider === "nvidia") {
        const r = await window.electronAPI.listParakeetModels?.();
        if (!cancelled)
          setProviderReady(
            !!(r?.success && r.models.some((m: { downloaded?: boolean }) => m.downloaded))
          );
      } else {
        const r = await window.electronAPI.listWhisperModels?.();
        if (!cancelled)
          setProviderReady(
            !!(r?.success && r.models.some((m: { downloaded?: boolean }) => m.downloaded))
          );
      }
    };
    checkProviderReady();
    return () => {
      cancelled = true;
    };
  }, [
    useLocalWhisper,
    localTranscriptionProvider,
    cloudTranscriptionProvider,
    cloudTranscriptionBaseUrl,
    openaiApiKey,
    groqApiKey,
    mistralApiKey,
    customTranscriptionApiKey,
  ]);

  const getActiveModelLabel = (): string => {
    if (useLocalWhisper) {
      if (localTranscriptionProvider === "nvidia")
        return `Parakeet · ${parakeetModel || "default"}`;
      return `Whisper · ${whisperModel || "base"}`;
    }
    const name =
      cloudTranscriptionProvider === "custom"
        ? t("notes.upload.custom")
        : cloudTranscriptionProvider.charAt(0).toUpperCase() + cloudTranscriptionProvider.slice(1);
    return `${name} · ${cloudTranscriptionModel}`;
  };

  const getActiveApiKey = (): string => {
    switch (cloudTranscriptionProvider) {
      case "openai":
        return openaiApiKey;
      case "groq":
        return groqApiKey;
      case "mistral":
        return mistralApiKey;
      case "custom":
        return customTranscriptionApiKey || "";
      default:
        return "";
    }
  };

  const generateTitle = async (text: string): Promise<string> => {
    if (!useCleanupModel) return "";
    if (!getSettings().autoGenerateNoteTitle) return "";
    const model = isCloudCleanup ? "" : effectiveCleanupModel || getAllReasoningModels()[0]?.value;
    if (!model && !isCloudCleanup) return "";
    const settings = getSettings();
    return generateNoteTitle(text, model, settings.customDictionary, settings.uiLanguage);
  };

  const handleBrowse = async () => {
    const res = await window.electronAPI.selectAudioFile();
    if (!res.canceled && res.filePath) {
      const name = res.filePath.split(/[/\\]/).pop() || "audio";
      const sizeBytes = (await window.electronAPI.getFileSize?.(res.filePath)) ?? 0;
      selectFile({
        name,
        path: res.filePath,
        size: sizeBytes ? formatFileSize(sizeBytes) : "",
        sizeBytes,
      });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase() || "";
    if (SUPPORTED_EXTENSIONS.includes(ext)) {
      const filePath = window.electronAPI.getPathForFile(f);
      if (!filePath) return;
      selectFile({ name: f.name, path: filePath, size: formatFileSize(f.size), sizeBytes: f.size });
    }
  };

  const reset = () => {
    const personal = findDefaultFolder(folders);
    resetUploadState(personal ? String(personal.id) : "");
  };

  const handleTranscribe = () => {
    if (!file) return;

    const useChunkProgress = useLocalWhisper;

    runTranscription({
      useChunkProgress,
      registerProgress: (callback) => window.electronAPI.onUploadTranscriptionProgress?.(callback),
      cancelTranscription: () =>
        window.electronAPI.cancelUploadTranscription?.() ??
        Promise.resolve({ success: false, error: "Cancel is unavailable" }),
      transcribe: async () => {
        if (useLocalWhisper) {
          return window.electronAPI.transcribeAudioFile(file.path, {
            provider: localTranscriptionProvider as "whisper" | "nvidia",
            model: localTranscriptionProvider === "nvidia" ? parakeetModel : whisperModel,
            customDictionary,
            customDictionaryAliases,
          });
        }
        return window.electronAPI.transcribeAudioFileByok!({
          filePath: file.path,
          apiKey: getActiveApiKey(),
          baseUrl: cloudTranscriptionBaseUrl || "",
          model: cloudTranscriptionModel,
          customDictionary,
          customDictionaryAliases,
        });
      },
      generateTitle,
      saveNote: window.electronAPI.saveNote,
      afterNoteCreated: async ({ noteId, file }) => {
        const result = await window.electronAPI.attachUploadAudioToNote?.(noteId, file.path, {
          rediarize: true,
        });
        if (result && !result.success) {
          console.warn("Failed to attach uploaded audio to note", result.error);
        }
      },
      noSpeechMessage: t("notes.upload.noSpeechDetected"),
      transcriptionFailedMessage: t("notes.upload.transcriptionFailed"),
      errorOccurredMessage: t("notes.upload.errorOccurred"),
    });
  };

  const dismissSetup = () => {
    localStorage.setItem("uploadSetupComplete", "true");
    setSetupDismissed(true);
  };

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    const res = await window.electronAPI.createFolder(trimmed);
    if (res.success && res.folder) {
      setFolders((prev) => [...prev, res.folder!]);
      const newId = String(res.folder.id);
      setSelectedFolderId(newId);
      if (noteId != null) {
        window.electronAPI.updateNote(noteId, { folder_id: res.folder.id });
      }
    }
    setNewFolderName("");
    setShowNewFolderDialog(false);
  };

  const handleFolderChange = (val: string) => {
    if (val === "__create_new__") {
      setShowNewFolderDialog(true);
      return;
    }
    setSelectedFolderId(val);
    if (noteId != null) {
      window.electronAPI.updateNote(noteId, { folder_id: Number(val) });
    }
  };

  const getTranscribingLabel = (): string => {
    if (useLocalWhisper) return t("notes.upload.transcribingLocal");
    return t("notes.upload.transcribingProvider", { provider: cloudTranscriptionProvider });
  };

  const modeSelector = null;

  const modelPicker = showModelPicker ? (
    <Suspense fallback={null}>
      <TranscriptionModelPicker
        selectedCloudProvider={cloudTranscriptionProvider}
        onCloudProviderSelect={setCloudTranscriptionProvider}
        selectedCloudModel={cloudTranscriptionModel}
        onCloudModelSelect={setCloudTranscriptionModel}
        selectedLocalModel={localTranscriptionProvider === "nvidia" ? parakeetModel : whisperModel}
        onLocalModelSelect={(modelId) => {
          if (localTranscriptionProvider === "nvidia") {
            setParakeetModel(modelId);
          } else {
            setWhisperModel(modelId);
          }
        }}
        selectedLocalProvider={localTranscriptionProvider}
        onLocalProviderSelect={(id) => setLocalTranscriptionProvider(id as "whisper" | "nvidia")}
        useLocalWhisper={useLocalWhisper}
        onModeChange={(isLocal) => {
          setUseLocalWhisper(isLocal);
          updateTranscriptionSettings({ useLocalWhisper: isLocal });
          if (isLocal) setCloudTranscriptionMode("byok");
        }}
        cloudTranscriptionBaseUrl={cloudTranscriptionBaseUrl}
        setCloudTranscriptionBaseUrl={setCloudTranscriptionBaseUrl}
        variant="settings"
      />
    </Suspense>
  ) : null;

  return (
    <div className="ow-workspace-page overflow-y-auto">
      <div className="ow-page-column max-w-3xl">
        <div className="w-full shrink-0" style={{ animation: "float-up 0.4s ease-out" }}>
          {showSetup && (
            <div className="mb-6" style={{ animation: "float-up 0.3s ease-out" }}>
              <div className="flex flex-col items-center mb-5">
                <div className="w-10 h-10 rounded-md bg-muted border border-border flex items-center justify-center mb-3">
                  <Upload size={17} strokeWidth={1.5} className="text-muted-foreground" />
                </div>
                <h2 className="text-xs font-semibold text-foreground mb-1">
                  {t("notes.upload.setupTitle")}
                </h2>
                <p className="text-xs text-muted-foreground text-center leading-relaxed max-w-[280px]">
                  {t("notes.upload.setupDescription")}
                </p>
              </div>

              {modeSelector}
              {modelPicker}

              <div className="flex justify-center mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={dismissSetup}
                  className="h-8 text-xs px-6"
                >
                  {t("notes.upload.continue")}
                </Button>
              </div>

              <div className="h-px bg-border my-5" />
            </div>
          )}

          <div className="mx-auto w-full max-w-2xl">
            {state === "idle" && providerReady === false && (
              <NoProviderView t={t} onOpenSettings={() => onOpenSettings?.("transcription")} />
            )}

            {state === "idle" && providerReady !== false && (
              <IdleView
                t={t}
                getActiveModelLabel={getActiveModelLabel}
                handleDrop={handleDrop}
                handleBrowse={handleBrowse}
                isDragOver={isDragOver}
                setIsDragOver={setIsDragOver}
              />
            )}

            {state === "selected" && file && (
              <SelectedView
                t={t}
                file={file}
                getActiveModelLabel={getActiveModelLabel}
                reset={reset}
                handleTranscribe={handleTranscribe}
                fileTooLarge={fileTooLarge}
                isLargeFile={isLargeFile}
                byokTooLarge={byokTooLarge}
              />
            )}

            {state === "transcribing" && (
              <TranscribingView
                t={t}
                progress={progress}
                getTranscribingLabel={getTranscribingLabel}
                file={file}
                chunkProgress={chunkProgress}
                onCancel={cancelUploadTranscription}
              />
            )}

            {state === "complete" && result && (
              <CompleteView
                t={t}
                result={result}
                folders={folders}
                selectedFolderId={selectedFolderId}
                handleFolderChange={handleFolderChange}
                noteId={noteId}
                onNoteCreated={onNoteCreated}
                reset={reset}
              />
            )}

            {state === "error" && error && (
              <ErrorView t={t} error={error} reset={reset} handleTranscribe={handleTranscribe} />
            )}
          </div>

          {!showSetup && (state === "idle" || state === "selected") && (
            <div className="mx-auto mt-5" style={{ maxWidth: advancedOpen ? "560px" : "320px" }}>
              <button
                onClick={() => setAdvancedOpen(!advancedOpen)}
                className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors mx-auto"
              >
                <ChevronRight
                  size={10}
                  className={cn("transition-transform duration-200", advancedOpen && "rotate-90")}
                />
                {t("notes.upload.transcriptionSettings")}
              </button>

              {advancedOpen && (
                <div className="mt-3" style={{ animation: "float-up 0.2s ease-out" }}>
                  {modeSelector}
                  {modelPicker}
                </div>
              )}
            </div>
          )}
        </div>

        <Dialog open={showNewFolderDialog} onOpenChange={setShowNewFolderDialog}>
          <DialogContent className="sm:max-w-95">
            <DialogHeader>
              <DialogTitle>{t("notes.upload.newFolder")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/50">
                {t("notes.upload.folderName")}
              </label>
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder={t("notes.folders.folderName")}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateFolder();
                }}
              />
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowNewFolderDialog(false);
                  setNewFolderName("");
                }}
              >
                {t("notes.upload.cancel")}
              </Button>
              <Button onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
                {t("notes.upload.create")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

interface NoProviderViewProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  onOpenSettings: () => void;
}

function NoProviderView({ t, onOpenSettings }: NoProviderViewProps) {
  return (
    <div
      className="flex flex-col items-center gap-4 py-2"
      style={{ animation: "float-up 0.4s ease-out" }}
    >
      <div className="w-10 h-10 rounded-md bg-muted border border-border flex items-center justify-center">
        <Settings size={17} strokeWidth={1.5} className="text-muted-foreground" />
      </div>
      <div className="text-center">
        <h2 className="text-xs font-semibold text-foreground mb-1">
          {t("notes.upload.noProviderTitle")}
        </h2>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-60">
          {t("notes.upload.noProviderDescription")}
        </p>
      </div>
      <Button variant="outline" size="sm" className="h-7 text-xs px-4" onClick={onOpenSettings}>
        {t("notes.upload.noProviderAction")}
      </Button>
    </div>
  );
}

interface IdleViewProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  getActiveModelLabel: () => string;
  handleDrop: (e: React.DragEvent) => void;
  handleBrowse: () => void;
  isDragOver: boolean;
  setIsDragOver: (v: boolean) => void;
}

function IdleView({
  t,
  getActiveModelLabel,
  handleDrop,
  handleBrowse,
  isDragOver,
  setIsDragOver,
}: IdleViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    // Delegate to handleBrowse which uses Electron's file dialog;
    // the hidden input is for keyboard-triggered file selection only.
    handleBrowse();
    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleBrowse();
    }
  };

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-md bg-muted border border-border flex items-center justify-center">
          <Upload size={17} strokeWidth={1.5} className="text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{t("notes.upload.title")}</h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {t("notes.upload.using", { model: getActiveModelLabel() })}
          </p>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".mp3,.wav,.m4a,.webm,.ogg,.oga,.flac,.aac"
        onChange={handleFileInputChange}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />

      <div
        role="button"
        tabIndex={0}
        aria-label={t("notes.upload.dropOrBrowse")}
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setIsDragOver(false);
        }}
        onClick={handleBrowse}
        onKeyDown={handleKeyDown}
        className={cn(
          "group relative cursor-pointer rounded-md p-8 text-center transition-[background-color,border-color,transform] duration-300",
          "bg-muted/30",
          "border border-dashed border-border",
          "hover:bg-muted hover:border-border-hover",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30",
          isDragOver && "border-border-hover bg-muted/60 scale-[1.01]"
        )}
        style={isDragOver ? { animation: "drag-pulse 1.5s ease-in-out infinite" } : undefined}
      >
        <div className="absolute inset-0 rounded-md overflow-hidden pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500">
          <div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-foreground/[0.02] dark:via-white/[0.03] to-transparent"
            style={{ animation: "shimmer-slide 3s ease-in-out infinite" }}
          />
        </div>

        {!isDragOver ? (
          <div className="flex flex-col items-center gap-2 relative">
            <div className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center mb-1">
              <Upload
                size={14}
                className="text-muted-foreground group-hover:text-foreground transition-colors"
              />
            </div>
            <p className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
              {t("notes.upload.dropOrBrowse")}
            </p>
            <p className="text-xs text-muted-foreground tracking-wide">
              {t("notes.upload.supportedFormats")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 relative">
            <Upload size={18} className="text-foreground/55" />
            <p className="text-xs text-foreground/60 font-medium">
              {t("notes.upload.dropToUpload")}
            </p>
          </div>
        )}
      </div>
    </>
  );
}

interface SelectedViewProps {
  t: (key: string) => string;
  file: { name: string; path: string; size: string; sizeBytes: number };
  getActiveModelLabel: () => string;
  reset: () => void;
  handleTranscribe: () => void;
  fileTooLarge: boolean;
  isLargeFile: boolean;
  byokTooLarge: boolean;
}

function SelectedView({
  t,
  file,
  getActiveModelLabel,
  reset,
  handleTranscribe,
  fileTooLarge,
  byokTooLarge,
}: SelectedViewProps) {
  const canTranscribe = !fileTooLarge && !byokTooLarge;

  return (
    <div style={{ animation: "float-up 0.3s ease-out" }}>
      <div className="rounded-md border border-border bg-card p-4 mb-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-muted border border-border flex items-center justify-center shrink-0">
            <FileAudio size={15} className="text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-foreground truncate font-semibold">{file.name}</p>
            {file.size && <p className="text-xs text-muted-foreground mt-0.5">{file.size}</p>}
            <p className="text-xs text-muted-foreground mt-0.5">{getActiveModelLabel()}</p>
          </div>
          <button
            onClick={reset}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {fileTooLarge && (
        <div className="rounded-lg border border-destructive/12 dark:border-destructive/15 bg-destructive/[0.03] px-3 py-2.5 mb-3">
          <p className="text-xs text-destructive/60 leading-relaxed">
            {t("notes.upload.fileTooLarge")}
          </p>
        </div>
      )}

      {/* BYOK file too large — shared explanation */}
      {byokTooLarge && (
        <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2.5 mb-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("notes.upload.byokTooLarge")}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed mt-1.5">
            {t("notes.upload.byokTooLargeDetail")}
          </p>
          <p className="text-xs text-foreground leading-relaxed mt-1.5 font-medium">
            {t("notes.upload.useLocalOrSelfHosted")}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 justify-center flex-wrap">
        {canTranscribe && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleTranscribe}
            className="h-8 text-xs px-5"
          >
            {t("notes.upload.transcribe")}
          </Button>
        )}

        {/* Cancel button — always shown */}
        <Button
          variant="ghost"
          size="sm"
          onClick={reset}
          className="h-8 text-xs text-muted-foreground"
        >
          {t("notes.upload.cancel")}
        </Button>
      </div>
    </div>
  );
}

interface TranscribingViewProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  progress: number;
  getTranscribingLabel: () => string;
  file: { name: string; path: string; size: string; sizeBytes: number } | null;
  chunkProgress: { chunksTotal: number; chunksCompleted: number; chunksFailed?: number } | null;
  onCancel: () => void;
}

function TranscribingView({
  t,
  progress,
  getTranscribingLabel,
  file,
  chunkProgress,
  onCancel,
}: TranscribingViewProps) {
  const hasChunkInfo = chunkProgress !== null && chunkProgress.chunksTotal > 0;
  const processedChunks =
    chunkProgress && chunkProgress.chunksTotal > 0
      ? chunkProgress.chunksCompleted + (chunkProgress.chunksFailed || 0)
      : 0;

  return (
    <div className="flex flex-col items-center" style={{ animation: "float-up 0.3s ease-out" }}>
      <div className="flex items-end justify-center gap-[3px] h-10 mb-5">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="w-[3px] rounded-full bg-foreground/35 dark:bg-foreground/45 origin-bottom"
            style={{
              height: "100%",
              animation: `waveform-bar ${0.8 + i * 0.12}s ease-in-out infinite`,
              animationDelay: `${i * 0.08}s`,
            }}
          />
        ))}
      </div>

      <div className="w-full max-w-[200px] h-[3px] rounded-full bg-foreground/5 dark:bg-white/5 overflow-hidden mb-3">
        <div
          className="h-full rounded-full bg-foreground/55 transition-[width] duration-500 ease-out"
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>

      <p className="text-xs text-foreground font-medium">{getTranscribingLabel()}</p>
      {hasChunkInfo ? (
        <p className="text-xs text-muted-foreground mt-1">
          {t("notes.upload.chunkProgress", {
            completed: processedChunks,
            total: chunkProgress.chunksTotal,
          })}
        </p>
      ) : null}
      {!hasChunkInfo && file ? (
        <p className="text-xs text-muted-foreground mt-1 truncate max-w-50">{file.name}</p>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        onClick={onCancel}
        className="h-7 text-xs text-muted-foreground mt-4"
      >
        {t("notes.upload.cancel")}
      </Button>
    </div>
  );
}

interface CompleteViewProps {
  t: (key: string) => string;
  result: string;
  folders: FolderItem[];
  selectedFolderId: string;
  handleFolderChange: (val: string) => void;
  noteId: number | null;
  onNoteCreated?: (noteId: number, folderId: number | null) => void;
  reset: () => void;
}

function CompleteView({
  t,
  result,
  folders,
  selectedFolderId,
  handleFolderChange,
  noteId,
  onNoteCreated,
  reset,
}: CompleteViewProps) {
  return (
    <div className="flex flex-col items-center" style={{ animation: "float-up 0.3s ease-out" }}>
      <div className="relative w-12 h-12 mb-4">
        <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
          <circle
            cx="18"
            cy="18"
            r="15"
            fill="none"
            strokeWidth="1.5"
            className="stroke-success/15"
          />
          <circle
            cx="18"
            cy="18"
            r="15"
            fill="none"
            strokeWidth="1.5"
            className="stroke-success/60"
            strokeDasharray="94.25"
            strokeLinecap="round"
            style={{ animation: "ring-fill 0.8s ease-out forwards" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <svg className="w-5 h-5 text-success/70" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 13l4 4L19 7"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="24"
              strokeDashoffset="24"
              style={{ animation: "draw-check 0.4s ease-out 0.5s forwards" }}
            />
          </svg>
        </div>
      </div>

      <p className="text-xs text-foreground font-semibold mb-1">
        {t("notes.upload.transcriptionComplete")}
      </p>
      <p className="text-xs text-muted-foreground max-w-[240px] text-center line-clamp-2 mb-4">
        {result.slice(0, 150)}
      </p>

      {folders.length > 0 && (
        <div className="flex items-center justify-center gap-2 mb-4">
          <FolderOpen size={12} className="text-muted-foreground shrink-0" />
          <Select value={selectedFolderId} onValueChange={handleFolderChange}>
            <SelectTrigger className="h-7 w-44 text-xs rounded-lg px-2.5 [&>svg]:h-3 [&>svg]:w-3">
              <SelectValue placeholder={t("notes.upload.selectFolder")} />
            </SelectTrigger>
            <SelectContent>
              {folders.map((f) => (
                <SelectItem
                  key={f.id}
                  value={String(f.id)}
                  className="text-xs py-1.5 pl-2.5 pr-7 rounded-md"
                >
                  {f.name}
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem value="__create_new__" className="text-xs py-1.5 pl-2.5 pr-7 rounded-md">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Plus size={11} />
                  {t("notes.upload.newFolder")}
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex items-center gap-2">
        {noteId != null && onNoteCreated && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onNoteCreated(noteId, selectedFolderId ? Number(selectedFolderId) : null)
            }
            className="h-8 text-xs"
          >
            {t("notes.upload.openNote")}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={reset}
          className="h-8 text-xs text-muted-foreground"
        >
          {t("notes.upload.uploadAnother")}
        </Button>
      </div>
    </div>
  );
}

interface ErrorViewProps {
  t: (key: string) => string;
  error: string;
  reset: () => void;
  handleTranscribe: () => void;
}

function ErrorView({ t, error, reset, handleTranscribe }: ErrorViewProps) {
  return (
    <div style={{ animation: "float-up 0.3s ease-out" }}>
      <div className="rounded-md border border-destructive/15 dark:border-destructive/20 bg-destructive/[0.03] dark:bg-destructive/[0.05] p-4 mb-4">
        <div className="flex items-start gap-2.5">
          <AlertCircle size={14} className="text-destructive/50 shrink-0 mt-0.5" />
          <p className="flex-1 text-xs text-destructive/70 leading-relaxed">{error}</p>
          <button
            onClick={reset}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 p-0.5 rounded-md hover:bg-muted"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 justify-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleTranscribe}
          className="h-7 text-xs text-muted-foreground"
        >
          {t("notes.upload.retry")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={reset}
          className="h-7 text-xs text-muted-foreground"
        >
          {t("notes.upload.startOver")}
        </Button>
      </div>
    </div>
  );
}
