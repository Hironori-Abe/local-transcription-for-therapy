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

- **Fully local operation** - No internet connection is required during normal use. Conversation and audio data are not sent to internet-hosted APIs
- **Japanese transcription** - faster-whisper with the Whisper turbo model by default; the higher-accuracy large-v3 model can be downloaded and selected later
- **Speaker diarization** - Automatic speaker identification with pyannote.audio, using default labels such as Th / Cl / IP
- **Proofreading** - Rule-based checks plus a local LLM. The app highlights possible personal identifiers such as names and place names. The proofreading AI supports the standard model, Gemma 4 E4B, and an optional higher-accuracy model, Gemma 4 12B, which is available for both NVIDIA and AMD after download
- **Voice input** - Record up to 15 seconds from the microphone on any transcript row, and a local AI transcribes it and suggests up to 3 candidates to insert into the edit field (available after installing the "voice input pack" from the Settings tab)
- **Segment re-listen** - The AI re-transcribes the audio for a row's time range and suggests up to 3 candidates that replace the row's content, helping fix rows where the original transcription looks wrong
- Segment-table editing, splitting by Japanese punctuation, and per-segment audio playback
- Save as Word (.docx), Excel (.xlsx), or JSON

## Privacy and Offline Policy

- The app does not call internet-hosted APIs while running transcription, speaker diarization, or proofreading.
- Internet access is needed only for the initial setup, including dependency and model downloads.
- Support for an "OpenAI-compatible API" means protocol compatibility only. The connection target is restricted to localhost / loopback. The design does not allow cloud inference endpoints.
- The app itself does not communicate with external servers during normal operation. However, system-level components such as the OS, the WebView runtime (WebView2 / WebKitGTK), and GPU drivers may communicate externally independently of this app. If your organization requires fully offline operation, enforce it additionally at the OS or firewall level (e.g., network isolation or proxy restrictions).
- For non-engineers, see the [plain-language privacy guide](docs/privacy-guide.md) (Japanese). To verify for yourself that nothing is sent, see the [offline verification steps](docs/offline-verification.md) (Japanese).

### Local AI Apps (LM Studio / Ollama)

- Integration with local AI apps running on the same PC, such as LM Studio and Ollama, is **disabled in the official installers**. There is no installer prompt or in-app switch for enabling it. The built-in Gemma 4 E4B model handles proofreading by default.
- If this integration is required, build a dedicated installer from source with the Cargo feature `local-llm-apps`. See the [Windows release build guide](docs/release-build-windows.md#ローカルaiアプリ連携を有効にした専用ビルド).
- Even when integration is enabled, the connection target is restricted to loopback, but **the behavior of the connected app itself is outside LoTT's control**. Depending on the LM Studio or Ollama settings, conversation data could be sent outside the PC. Keeping this integration disabled is recommended for normal use.

## Editions

| Edition | Description |
| --- | --- |
| **LoTT Full CUDA** | Main distribution. For NVIDIA RTX / CUDA. Includes transcription, speaker diarization, and proofreading |
| LoTT Full AMD (ROCm / Vulkan) | Experimental / source-build only. For AMD GPUs (the LLM prefers ROCm with Vulkan fallback) |
| LoTT CPU | Trial edition. Runs transcription, speaker diarization, and simple punctuation on the CPU. Overall proofreading is not included. Voice input and segment re-listen become available after installing the voice input pack. Expected processing time is approximately 1.5–2.5 times the audio duration |
| LoTT Editor | Lightweight edition focused on proofreading and editing. Full transcription and the LLM proofreading runtime are not included. Installing the optional voice input pack enables voice input and segment re-listen with a CPU-based local AI (not recommended on PCs with less than 16 GB RAM) |

### AMD GPU Edition

Compatibility varies substantially across GPU generations, operating systems, ROCm versions, and drivers, so an AMD installer is not currently distributed for general use. **To use LoTT with an AMD GPU, prepare an environment that supports the target GPU and build the AMD edition from source.** This edition remains experimental, and operation on every AMD GPU is not guaranteed. See the [Windows release build guide](docs/release-build-windows.md) for the Windows development setup and build configuration.

The AMD GPU edition requires GPU execution for transcription, speaker diarization, and built-in AI processing. If GPU processing fails, the job stops and a dialog reports the failure; it does not fall back to CPU. The only permitted fallback is from ROCm to Vulkan for the built-in LLM when its ROCm path cannot start.

## Requirements (Full CUDA Edition)

- Windows 10 / 11 64-bit
- NVIDIA GPU, RTX recommended, with CUDA Toolkit 12.x (13 or later is not supported) and cuDNN 9.x
- **At least 8 GB VRAM**
- About 1 GB for the installer, plus space for downloaded models

## CPU Edition (Trial Use)

LoTT CPU provides fully local transcription on PCs without a supported GPU. It includes transcription, speaker diarization, and simple punctuation. Overall proofreading is not included. Installing the optional voice input pack also enables CPU-based voice input and segment re-listen.

**Because processing takes considerably longer, this edition is not recommended for regular, continuous use.** It is intended for trying LoTT with a small amount of audio or as a supplementary option when a supported GPU is unavailable.

| Item | Minimum | Recommended |
| --- | --- | --- |
| OS | Windows 10 / 11 64-bit | Windows 11 64-bit |
| CPU | AVX2 support, 4 cores / 8 threads | 6 cores / 12 threads or more |
| RAM | **16 GB** | **24 GB or more** |
| Free disk space | About 10 GB | About 15 GB or more |
| GPU | Not required | Not required |

- 16 GB RAM is the practical minimum for transcription, diarization, and simple punctuation. Running many other applications at the same time may cause slowdowns or out-of-memory failures.
- Voice input and segment re-listen also load the Gemma 4 E4B model and audio mmproj, so 24 GB RAM or more is recommended. On a 16 GB system, close other applications before using these features.
- Systems with less than 16 GB RAM are unsupported because heavy swapping or out-of-memory failures are likely.
- At startup, the CPU edition checks its minimum requirements (at least 16 GB RAM, AVX2, and eight logical threads). If a requirement is not met, it identifies the shortage and exits. On supported systems, it still displays the trial-use and processing-time notice at every launch.
- Expected processing time is approximately 1.5–2.5 times the audio duration, but slower CPUs or difficult audio may take longer. On the development PC (Ryzen AI 9 HX 370, 12 cores / 24 threads), transcription with CPU `float32` plus diarization took about 19 minutes 16 seconds for 11 minutes 43 seconds of audio, or 1.64 times the audio duration.

## Installation and Initial Setup

1. Run the NSIS installer, `*_x64-setup.exe`
2. After launching the app, run "Install Python packages" from the Setup tab. This requires an internet connection
3. Download the required models from the same Setup tab
   - Transcription model: Whisper turbo (the higher-accuracy large-v3 model can optionally be added later)
   - Speaker diarization model: `pyannote-speaker-diarization-community-1`, which requires a Hugging Face token
   - Proofreading LLM: Gemma 4 E4B GGUF (Full editions only)
   - Voice input pack (optional, required for voice input and segment re-listen)

After the models are downloaded, the app can be used offline.

## Usage

1. Select an audio file and run transcription
2. Listen to the audio while editing the conversation text and speaker labels. Default speaker labels include `SPEAKER_00 -> Th` and `SPEAKER_01 -> Cl`
   - While editing, you can also use microphone voice input and the "segment re-listen" feature, which lets the AI re-transcribe a row's time range (requires the voice input pack)
3. Save as Word, Excel, or JSON

## Technology Stack

- Desktop: Tauri 2 (Rust) / Frontend: Angular 21 + Angular Material / Sidecar: Python
- ASR: faster-whisper (turbo by default / optional higher-accuracy large-v3, downloaded later) / Diarization: pyannote.audio / Audio decoding: LGPL-configured ffmpeg CLI
- Voice input & segment re-listen: Gemma 4 E4B with an audio mmproj (llama.cpp llama-server, OpenAI-compatible `input_audio`, loopback only)
- LLM proofreading: Gemma 4 E4B by default / Gemma 4 12B QAT+MTP as the optional high-accuracy model, downloaded later. NVIDIA uses direct CUDA launch; AMD prefers ROCm with Vulkan fallback. The engine uses bundled or downloaded llama.cpp llama-server plus a local OpenAI-compatible API restricted to loopback

## Documentation

- Plain-language privacy guide for non-engineers (Japanese): [docs/privacy-guide.md](docs/privacy-guide.md)
- Offline verification steps (Japanese): [docs/offline-verification.md](docs/offline-verification.md)
- Template for research ethics review (IRB) documents (Japanese): [docs/irb-template.md](docs/irb-template.md)
- Development environment setup and internal notes: [docs/development.md](docs/development.md)
- Troubleshooting, including CUDA and AMD ROCm: [docs/troubleshooting.md](docs/troubleshooting.md)
- Distribution builds, Windows NSIS: [docs/release-build-windows.md](docs/release-build-windows.md)
- FFmpeg / PyAV licensing policy: [docs/lgpl-pyav-build.md](docs/lgpl-pyav-build.md)

## License

This app is distributed under the [Apache License 2.0](LICENSE).
The bundled FFmpeg uses an LGPL build. See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for third-party license information.
