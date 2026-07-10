# Local Transcription for Therapy (LoTT)

[日本語](README.md) | **English**

Local Transcription for Therapy is a desktop application that helps create Japanese transcripts and verbatim records for clinical psychology and counseling conversations, while keeping the workflow local.
It can run transcription, speaker diarization, and proofreading without sending conversation or audio data outside the PC.
The application is not intended to produce perfect verbatim transcripts automatically. It creates a rough draft that a human can finish while reviewing the original conversation audio.

![Main screen](docs/screenshots/main-window.png)
![Transcript editor](docs/screenshots/transcript-ui.png)

## Current Language Scope

LoTT currently assumes Japanese-language use. The primary UI labels, screenshots, setup flow, proofreading rules, transcript editing workflow, and output conventions are centered on Japanese clinical and counseling transcription. This English README is provided as a reference, but Japanese remains the main operating language of the app.

## Features

- **Fully local operation** - No internet connection is required during normal use. Conversation and audio data are not sent to external APIs
- **Japanese transcription** - faster-whisper with the Whisper turbo model
- **Speaker diarization** - Automatic speaker identification with pyannote.audio, using default labels such as Th / Cl / IP
- **Proofreading** - Rule-based checks plus a local LLM. The app highlights possible personal identifiers such as names and place names. The proofreading AI supports the standard model, Gemma 4 E4B, and an optional higher-accuracy model, Gemma 4 12B, which is available for both NVIDIA and AMD after download
- **Voice input** - Record up to 15 seconds from the microphone on any transcript row, and a local AI transcribes it and suggests up to 3 candidates to insert into the edit field (available after installing the "voice input pack" from the Settings tab)
- **Segment re-listen** - The AI re-transcribes the audio for a row's time range and suggests up to 3 candidates that replace the row's content, helping fix rows where the original transcription looks wrong
- Segment-table editing, splitting by Japanese punctuation, and per-segment audio playback
- Save as Word (.docx), Excel (.xlsx), or JSON

## Privacy and Offline Policy

- The app does not call external APIs while running transcription, speaker diarization, or proofreading.
- Internet access is needed only for the initial setup, including dependency and model downloads.
- Support for an "OpenAI-compatible API" means protocol compatibility only. The connection target is restricted to localhost / loopback. The design does not allow cloud inference endpoints.

### External LLM Apps (LM Studio / Ollama)

- Integration with external LLM apps such as LM Studio and Ollama is **disabled by default**. The built-in AI, Gemma 4 E4B, can handle proofreading without external app integration.
- Integration can be enabled **only when explicitly selected during installation**. The app does not provide an in-app switch to enable it later; changing this setting requires reinstalling.
- Even when integration is enabled, the connection target is restricted to loopback, but **the behavior of the connected app itself is outside LoTT's control**. Depending on the LM Studio or Ollama settings, conversation data could be sent externally. Keeping this integration disabled is recommended for normal use.

## Editions

| Edition | Description |
| --- | --- |
| **LoTT Full CUDA** | Main distribution. For NVIDIA RTX / CUDA. Includes transcription, speaker diarization, and proofreading |
| LoTT Full AMD (ROCm) | Experimental. For AMD GPUs. GPU operation has been confirmed for transcription, speaker diarization, and LLM proofreading |
| LoTT Editor | Lightweight edition focused on proofreading and editing, without the transcription or LLM runtime components |

## Requirements (Full CUDA Edition)

- Windows 10 / 11 64-bit
- NVIDIA GPU, RTX recommended, with CUDA Toolkit 12.x (13 or later is not supported) and cuDNN 9.x
- **At least 8 GB VRAM**
- About 1 GB for the installer, plus space for downloaded models

> **CPU-only operation is not supported.** Transcription, speaker diarization, and LLM proofreading all assume GPU execution through CUDA or ROCm. Environments without a supported GPU may not work correctly.

## Installation and Initial Setup

1. Run the NSIS installer, `*_x64-setup.exe`
2. After launching the app, run "Install Python packages" from the Setup tab. This requires an internet connection
3. Download the required models from the same Setup tab
   - Transcription model: Whisper turbo
   - Speaker diarization model: `pyannote-speaker-diarization-community-1`, which requires a Hugging Face token
   - Proofreading LLM: Gemma 4 E4B GGUF
   - Voice input pack (optional, required for voice input and segment re-listen)

After the models are downloaded, the app can be used offline.

## Usage

1. Select an audio file and run transcription
2. Listen to the audio while editing the conversation text and speaker labels. Default speaker labels include `SPEAKER_00 -> Th` and `SPEAKER_01 -> Cl`
   - While editing, you can also use microphone voice input and the "segment re-listen" feature, which lets the AI re-transcribe a row's time range (requires the voice input pack)
3. Save as Word, Excel, or JSON

## Technology Stack

- Desktop: Tauri 2 (Rust) / Frontend: Angular 21 + Angular Material / Sidecar: Python
- ASR: faster-whisper / Diarization: pyannote.audio
- LLM proofreading: Gemma 4 E4B by default / Gemma 4 12B QAT+MTP as the optional high-accuracy model, downloaded later. NVIDIA uses direct CUDA launch; AMD prefers ROCm with Vulkan fallback. The engine uses bundled or downloaded llama.cpp llama-server plus a local OpenAI-compatible API restricted to loopback

## Documentation

- Development environment setup and internal notes: [docs/development.md](docs/development.md)
- Troubleshooting, including CUDA and AMD ROCm: [docs/troubleshooting.md](docs/troubleshooting.md)
- Distribution builds, Windows NSIS: [docs/release-build-windows.md](docs/release-build-windows.md)
- FFmpeg / PyAV licensing policy: [docs/lgpl-pyav-build.md](docs/lgpl-pyav-build.md)

## License

This app is distributed under the [Apache License 2.0](LICENSE).
The bundled FFmpeg uses an LGPL build. See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for third-party license information.
