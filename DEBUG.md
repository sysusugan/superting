# Debug Mode

Enable verbose logging to diagnose issues like "no audio detected" or transcription failures.

## Enable Debug Logging

### Option 1: Command Line
```bash
# macOS
/Applications/SuperTing.app/Contents/MacOS/SuperTing --log-level=debug

# Windows
SuperTing.exe --log-level=debug
```

### Option 2: Environment File
Add to your `.env` file and restart:
```
SUPERTING_LOG_LEVEL=debug
```

**Env file locations:**
- macOS: `~/Library/Application Support/SuperTing/.env`
- Windows: `%APPDATA%\SuperTing\.env`
- Linux: `~/.config/SuperTing/.env`

## Log File Locations

- **macOS**: `~/Library/Application Support/SuperTing/logs/debug-*.log`
- **Windows**: `%APPDATA%\SuperTing\logs\debug-*.log`
- **Linux**: `~/.config/SuperTing/logs/debug-*.log`

## What Gets Logged

| Stage | Details |
|-------|---------|
| FFmpeg | Path resolution, permissions, ASAR unpacking |
| Audio Recording | Permission requests, chunk sizes, audio levels |
| Audio Processing | File creation, Whisper command, process output |
| IPC | Messages between renderer and main process |
| Agent Mode | Streaming responses, conversation management, model selection |
| Meeting Detection | Process monitoring, audio activity, calendar event matching |
| Meeting Transcription | WebSocket connection, Realtime API session, audio buffering |
| Google Calendar | OAuth flow, token refresh, event sync |
| Media Control | Pause/resume events, player detection (MediaRemote/GSMTC/MPRIS2) |
| Audio Storage | File retention, cleanup cycles, storage usage |

## Common Issues

### "No Audio Detected"
Look for:
- `maxLevel < 0.01` → Audio too quiet
- `Audio appears to be silent` → Microphone issue
- `FFmpeg not available` → Path resolution failed

### Transcription Fails
Look for:
- `Whisper stderr:` → whisper.cpp/FFmpeg errors
- `Process closed with code: [non-zero]` → Process failure
- `Failed to parse Whisper output` → Invalid JSON

### Permission Issues
Look for:
- `Microphone Access Denied`
- `isExecutable: false` → FFmpeg permission issue

## Sharing Logs

When reporting issues:
1. Enable debug mode and reproduce the issue
2. Locate the log file
3. Redact any sensitive information
4. Include relevant log sections in your issue report

## Disable Debug Mode

Debug mode is off by default. To ensure it's disabled:
- Remove `--log-level=debug` from command
- Remove `SUPERTING_LOG_LEVEL` from `.env`
