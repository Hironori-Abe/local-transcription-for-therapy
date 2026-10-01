# Local Transcription for Therapy (LoTT)

[日本語](README.md) | **English**

Local Transcription for Therapy is a desktop application that helps create Japanese transcripts and verbatim records for clinical psychology and counseling conversations, while keeping the workflow local.
It can run transcription, speaker diarization, and proofreading without sending conversation or audio data outside the PC.
The application is not intended to produce perfect verbatim transcripts automatically. It creates a rough draft that a human can finish while reviewing the original conversation audio.

![Main screen](docs/screenshots/main-window.png)
![Transcript editor](docs/screenshots/transcript-ui.png)

## Current Language Scope

Japanese remains LoTT's primary and default transcription language. The UI labels, screenshots, proofreading rules, transcript editing workflow, and output conventions are centered on Japanese clinical and counseling transcription. The transcription language can also be selected in Settings.

## Features

- **Fully local operation** - No internet connection is required during normal use. Conversation and audio data are not sent to internet-hosted APIs
- **Transcription** - whisper.cpp (Whisper large-v3-turbo + Silero VAD), with Japanese as the default and 24 selectable languages. Diarization still runs for options labeled "speaker diarization unsupported." It uses NVIDIA / AMD / Intel GPUs through Vulkan and runs on the CPU on PCs without a GPU. Optional audio adjustment before transcription (low-frequency noise removal, noise reduction, loudness normalization) is available (it can lower accuracy on good-quality recordings)
- **Speaker diarization** - Automatic speaker identification with NeMo-Speech.cpp + Nemotron-3-Diarization, using default labels such as Th / Cl / IP
- **Proofreading** - Japanese transcript punctuation is added automatically with local rules. The app also highlights possible personal identifiers such as names and place names. There is no AI (LLM) proofreading or overall proofreading
- **Voice input** - Record up to 15 seconds from the microphone on any transcript row; the local whisper.cpp transcribes it and suggests 1 candidate (the Full edition uses the GPU when available and the CPU otherwise; Editor always uses the CPU)
- Segment-table editing, splitting by Japanese punctuation, and per-segment audio playback
- Save as Word (.docx), Excel (.xlsx), SRT subtitles, or JSON. SRT can optionally be stored in an AES-256 encrypted ZIP with a password
- Light and dark themes with system-preference support, plus keyboard shortcuts for editing, playback, speaker changes, and voice input

## For Users of Older Versions

The CUDA, AMD (ROCm), and CPU editions, and AI proofreading / overall proofreading with Gemma 4 and similar models (including LM Studio / Ollama integration), have been discontinued. Two editions are now distributed, described below (Windows and Linux; the Linux editions are experimental and have not yet been verified on real hardware). Data left behind by older editions can be listed and deleted from the Settings tab of the Full edition.

## Privacy and Offline Policy

- The app does not call internet-hosted APIs while running transcription, speaker diarization, or proofreading.
- Internet access is needed only for the initial setup, that is, model downloads.
- The app has no AI (LLM) inference feature, so there is no path that hands conversation data to an inference server.
- The app itself does not communicate with external servers during normal operation. On Windows, WebView2 is configured not to automatically send crash dumps to Microsoft. However, the app cannot completely control required diagnostics, update checks, or other communications performed by system-level components such as the OS, the WebView runtime (WebView2), and GPU drivers. If your organization requires fully offline operation, enforce it additionally at the OS or firewall level (e.g., network isolation or proxy restrictions).
- For non-engineers, see the [plain-language privacy guide](docs/privacy-guide.md) (Japanese). To verify for yourself that nothing is sent, see the [offline verification steps](docs/offline-verification.md) (Japanese).

## Editions

| Edition | Description |
| --- | --- |
| **LoTT Full** | Main distribution. Includes transcription (whisper.cpp), speaker diarization (Nemotron-3-Diarization), rule-based punctuation, and voice input. A single installer supports NVIDIA / AMD / Intel GPUs (Vulkan). On PCs without a GPU it runs on the CPU (slower). No CUDA Toolkit, cuDNN, Python, or Hugging Face token is required |
| LoTT Editor | Lightweight edition for editing and proofreading imported JSON. Transcription and diarization are not included. Installing the optional voice input pack (Whisper large-v3-turbo + VAD, about 1.6 GB) enables whisper.cpp voice input on the CPU; no GPU is required |

The Full edition's initial setup downloads only the speech recognition model (about 1.6 GB, including whisper.cpp and VAD) and the Nemotron-3-Diarization speaker diarization model (about 0.1 GB, NVIDIA OpenMDW-1.1 license; the full text can be viewed on the setup screen), about 1.7 GB in total. Downloads use pinned revisions, SHA-256 verification, and resume after interruption. No Hugging Face account or token is needed.

On PCs with multiple GPUs, the audio engines automatically use the GPU with the most VRAM other than the integrated GPU. You can change it in the Settings tab.

## Requirements

- Windows 10 / 11 64-bit, or 64-bit Linux (x86_64; `.deb` / AppImage; experimental; GPU operation on real Linux hardware is not yet verified)
- On Linux, the host Vulkan loader (`libvulkan.so.1`; the `libvulkan1` package on Ubuntu / Debian) is no longer strictly required for CPU-only operation (a bundled fallback is used when it is missing; the `.deb` installs it automatically). To use a GPU you need the host loader plus a Mesa or NVIDIA Vulkan driver (without one, processing runs on the CPU)
- To use a GPU: an NVIDIA / AMD / Intel GPU with an up-to-date GPU driver that supports Vulkan (no CUDA Toolkit or cuDNN is needed)
- If the GPU driver is missing or outdated, a startup dialog and a banner tell you to install or update it (Windows only; not shown on Linux)
- Free space for model downloads (about 1.7 GB for Full; about 1.6 GB for the Editor voice input pack)

### Using a PC Without a GPU (CPU Execution)

When no Vulkan-capable GPU is found, the Full edition automatically processes on the CPU. **Because processing takes considerably longer, a PC with a GPU (NVIDIA / AMD / Intel) is recommended for regular, continuous use.** CPU execution is intended for trying LoTT with a small amount of audio.

| Item | Minimum |
| --- | --- |
| OS | Windows 10 / 11 64-bit, or 64-bit Linux |
| CPU | AVX2 support, 4 cores / 8 threads or more |
| RAM | **16 GB or more** |

- Only when no GPU can be used, the Full edition checks these minimum requirements at startup (at least 16 GB RAM, AVX2, and eight logical threads). If a requirement is not met, it identifies the shortage and exits. On supported systems, it still displays a notice about CPU processing and processing time at every launch.
- Expected processing time is approximately 1.5-2.5 times the audio duration, but slower CPUs or difficult audio may take longer.
- Systems with less than 16 GB RAM are unsupported because heavy swapping or out-of-memory failures are likely.
- Editor voice input always runs on the CPU and needs no GPU.

## Installation and Initial Setup

1. Run the Windows NSIS installer, `*_x64-setup.exe`, or install the Linux `.deb` / AppImage (`LoTT-vX.Y.Z-linux-x64-{vulkan|editor}.*`), to install the Full or Editor edition
2. Full edition: after launching the app, download the transcription models (Whisper large-v3-turbo and Silero VAD) and the speaker diarization model (Nemotron-3-Diarization) from the Setup tab. This requires an internet connection
3. Editor edition: no models are needed for JSON import, editing, and export. To use voice input, download the "voice input pack" (Whisper large-v3-turbo and Silero VAD, about 1.6 GB) from Settings

If a download is interrupted, run setup again to resume. After model downloads are complete, transcription, diarization, and proofreading can be used offline.

On a PC where an older edition was installed, the Settings tab of the Full edition may show a deletion list of leftover data from that edition (old Gemma models, the old Python environment, old proofreading-engine caches, and so on). These are unneeded runtime resources, not conversation data.

## Usage

1. Select an audio file and run transcription
2. Listen to the audio while editing the conversation text and speaker labels. Default speaker labels include `SPEAKER_00 -> Th` and `SPEAKER_01 -> Cl`
   - While editing, you can insert microphone-input candidates produced by the installed whisper.cpp model (for Editor, after installing the voice input pack)
   - Shortcuts include `Ctrl+Shift+Space` (continuous playback / pause), `Ctrl+Shift+A` / `D` (seek back / forward 5 seconds), `Ctrl+Shift+E` (change speaker), and `Ctrl+Shift+M` (voice input)
3. Save as Word, Excel, SRT subtitles, or JSON

Use the button at the left of the tab row to cycle among System (default), Light, and Dark themes. The selection is preserved across launches.

## Technology Stack

- Desktop: Tauri 2 (Rust) / Frontend: Angular 21 + Angular Material
- Transcription: whisper.cpp (large-v3-turbo, Silero VAD; Vulkan build bundled) / Speaker diarization: NeMo-Speech.cpp + Nemotron-3-Diarization (Vulkan build bundled) / Audio decoding: LGPL-configured ffmpeg CLI
- Punctuation: local Rust rules for Japanese. No LLM is used
- Voice input: whisper.cpp (one transcription pass in the selected language, giving 1 candidate; a filler-example prompt is used for Japanese, and context from surrounding lines is not sent)
- Python is neither bundled nor used

## Documentation

- Latest release notes (Japanese): [v0.9.8](docs/release-notes-v0.9.8.md)
- Plain-language privacy guide for non-engineers (Japanese): [docs/privacy-guide.md](docs/privacy-guide.md)
- Offline verification steps (Japanese): [docs/offline-verification.md](docs/offline-verification.md)
- Template for research ethics review (IRB) documents (Japanese): [docs/irb-template.md](docs/irb-template.md)
- Development environment setup and internal notes: [docs/development.md](docs/development.md)
- ggml speech engine design (Japanese): [docs/ggml-speech-engine-design.md](docs/ggml-speech-engine-design.md)
- Troubleshooting: [docs/troubleshooting.md](docs/troubleshooting.md)
- Distribution builds, Windows NSIS: [docs/release-build-windows.md](docs/release-build-windows.md)
- Linux distribution build (deb / AppImage; experimental): [docs/release-build-linux.md](docs/release-build-linux.md)

## License

This app is distributed under the [Apache License 2.0](LICENSE).
The bundled FFmpeg uses an LGPL build. See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for third-party license information.

## Disclaimer

- This software is a tool for assisting with transcription and record preparation. It is not a medical device and is not a substitute for diagnosis, treatment, clinical judgment, emergency response, or any other professional judgment.
- Outputs from transcription, speaker diarization, proofreading, voice input, and related features may contain recognition errors, omissions, speaker misattributions, or inappropriate corrections. Before relying on an output for an important record or decision, the user or an appropriately qualified professional must compare it with the original audio and review and correct it.
- Before processing audio or conversation data, obtain any required notice and consent and comply with applicable laws, professional ethics, and organizational policies. The user is responsible for securely managing the device, output files, backups, models, and credentials.
- This software is provided under the [Apache License 2.0](LICENSE), without warranties or conditions of any kind, express or implied. To the extent permitted by applicable law, the developers and contributors are not liable for decisions, records, losses, or other consequences arising from use of, or inability to use, this software.
