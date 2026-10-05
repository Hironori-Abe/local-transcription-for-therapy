# Local Transcription for Therapy (LoTT)

[日本語](README.md) | **English**

Local Transcription for Therapy is a desktop application that helps prepare verbatim transcripts of clinical psychology and counseling conversations, entirely on the local PC.
It runs **transcription, speaker diarization, and proofreading** on an audio file without sending conversation data outside the PC.

LoTT does not aim to produce perfect verbatim transcripts automatically. The app creates a rough draft, and a person finishes it while listening back to the audio. For that reason, the editor used for listening and correcting matters as much as the processing that creates the draft.

![Main screen](docs/screenshots/main-window.png)
![Transcript editor](docs/screenshots/transcript-ui.png)

## Features

- **Fully local operation** - No internet connection is needed except for the initial model download. Conversation and audio data are never sent to APIs outside the PC, and no AI (LLM) is used
- **Transcription** - whisper.cpp (Whisper large-v3-turbo + Silero VAD). Uses NVIDIA / AMD / Intel GPUs through Vulkan and falls back to the CPU on PCs without a GPU. Japanese is the default, and 24 languages can be selected in Settings
- **Speaker diarization** - NeMo-Speech.cpp + Nemotron-3-Diarization. Results are split into one sentence per row, and a speaker is assigned to each sentence (default labels: Th / Cl / IP ...)
- **Proofreading** - Produces a punctuated draft that keeps fillers and backchannels, and highlights words that could identify individuals, such as names and place names (see "How Proofreading Works" below)
- **Editor** - Per-row playback, loop playback, and continuous playback; keyboard shortcuts; splitting rows at Japanese full stops; microphone voice input
- **Save formats** - Word (.docx), Excel (.xlsx), SRT subtitles, and JSON. SRT can also be saved as an AES-256 encrypted ZIP with an optional password
- **Modest requirements** - About 4 GB of VRAM or more is recommended for GPU processing (measured peak usage is about 1.9 GB)

## How Proofreading Works

Proofreading was redesigned in v0.9.9. The former AI proofreading and overall proofreading with Gemma 4 have been removed. Proofreading now consists of three steps that do not use an AI (LLM):

1. **Punctuation and fillers (during transcription)** - For Japanese, a neutral example sentence containing punctuation and fillers is passed to whisper.cpp for every window. Whisper imitates that style, so it outputs punctuated sentences while keeping fillers and backchannels such as "eto" and "un" (in measurements, more than 99% of rows ended with punctuation). The example sentence contains no clinical content or proper nouns
2. **Finishing with local rules** - Half-width "?" and "!" directly after Japanese text are converted to full-width, and punctuation is added to the end of rows that lack it. The content of sentences is not rewritten
3. **Personal-information warnings** - Candidates such as personal names, place names that are also used as names, and local place names are shown in **red**. Words that tend to follow a specific name, such as "-byoin" (hospital), "-gakko" (school), and "-san", are shown in **yellow**. Some false positives are accepted in order to reduce misses

When a language other than Japanese is selected, the Japanese example sentence, punctuation rules, and symbol-width conversion are not applied (personal-information warnings still run).

> There is no "frequent words / key terms" setting. Passing words to whisper.cpp caused recognition errors in which words that were never spoken (such as clinical terms) appeared in the output.

## Privacy and Offline Policy

- Transcription, speaker diarization, proofreading, and voice input are completed entirely by whisper.cpp / NeMo-Speech.cpp and local rules on the PC. No internet-hosted APIs are called.
- Internet access is needed only for the initial setup (model downloads) and, in the Editor edition, for downloading the voice input pack. Models are pinned versions verified with SHA-256.
- The app has no AI (LLM) inference feature, so there is no path that hands conversation data to an inference server.
- The app itself does not communicate with external servers during normal operation. On Windows, WebView2 is configured not to automatically send crash dumps to Microsoft. However, the app cannot completely control required diagnostics, update checks, or other communications performed by system-level components such as the OS, the WebView runtime (WebView2), and GPU drivers. If your organization requires fully offline operation, enforce it additionally at the OS or firewall level (e.g., network isolation or proxy restrictions).
- For non-engineers, see the [plain-language privacy guide](docs/privacy-guide.md) (Japanese). To verify for yourself that nothing is sent, see the [offline verification steps](docs/offline-verification.md) (Japanese).

## Editions

| Edition | Description |
| --- | --- |
| **LoTT Full** | Main distribution. Includes transcription, speaker diarization, proofreading, and voice input. A single installer supports NVIDIA / AMD / Intel GPUs (Vulkan); on PCs without a GPU it processes on the CPU (slower). No CUDA Toolkit, cuDNN, Python, or Hugging Face token is required |
| LoTT Editor | Lightweight edition for importing, editing, and exporting saved JSON. Transcription and diarization are not included. Installing the optional voice input pack (about 1.6 GB) enables voice input that runs on the CPU |

In release file names, `vulkan` means the Full edition and `editor` means the Editor edition. Use the Full edition (`vulkan`) for NVIDIA GPUs as well.

## Requirements

### Full Edition

| Item | Requirement |
| --- | --- |
| OS | Windows 10 / 11 64-bit, or Linux x86-64 (`.deb` / AppImage; experimental) |
| For GPU processing | An NVIDIA / AMD / Intel GPU (**about 4 GB of VRAM or more** recommended) and an up-to-date GPU driver that supports Vulkan |
| Without a GPU | Processing runs on the CPU (minimum requirements below) |
| Disk | About 1.7 GB for models, in addition to the app itself |

- Basis for the VRAM figure: on an RTX 4060 Laptop GPU (Vulkan), measured peak usage was 1,879 MiB for transcription and 150 MiB for speaker diarization. The values were the same for 11.7-minute and 58-minute audio and do not grow with audio length. Transcription and diarization run one after the other, so only the larger of the two is used at a time. 4 GB or more is recommended to leave room for the display and other apps.
- Integrated GPUs (such as Intel Arc or AMD Radeon iGPUs) also work, although more slowly than discrete GPUs.
- On PCs with multiple GPUs, the GPU with the most VRAM other than the integrated GPU is used automatically. You can change it with "Audio engine GPU" in the Settings tab.
- If the GPU driver is missing or outdated, a startup dialog and a banner tell you to install or update it (Windows only).
- On Linux, GPU processing needs the host Vulkan loader (`libvulkan1` on Ubuntu / Debian; the `.deb` installs it automatically) and a Mesa or NVIDIA Vulkan driver. Without them, processing runs on the CPU (a bundled fallback loader is used).

### Using a PC Without a GPU (CPU Processing)

When no Vulkan-capable GPU is found, the Full edition automatically processes on the CPU. **Because processing takes considerably longer, a PC with a GPU is recommended for regular, continuous use.** CPU processing is intended for trying LoTT with a small amount of audio to check operation and quality.

| Item | Minimum |
| --- | --- |
| CPU | AVX2 support, 4 cores / 8 threads or more |
| RAM | **16 GB or more** |

- Only when no GPU can be used, the app checks these minimum requirements at startup. If a requirement is not met, it shows the shortage and exits. On supported systems, it still shows a notice about CPU processing and processing time at every launch.
- Expected processing time is about 1.5-2.5 times the audio duration. Slower CPUs or difficult audio may take longer.
- Systems with less than 16 GB RAM are unsupported.

### Editor Edition

- Windows 10 / 11 64-bit, or Linux x86-64 (experimental). No GPU is required.
- To use voice input, about 1.6 GB of free space is needed for the voice input pack.

## Installation and Initial Setup

1. From [Releases](https://github.com/Hironori-Abe/local-transcription-for-therapy/releases), get the Windows installer (`LoTT-vX.Y.Z-windows-x64-{vulkan|editor}-setup.exe`) or the Linux `.deb` / AppImage (`LoTT-vX.Y.Z-linux-x64-{vulkan|editor}.*`) and install it
2. **Full edition**: launch the app and download the transcription models (Whisper large-v3-turbo and Silero VAD, about 1.6 GB) and the speaker diarization model (Nemotron-3-Diarization, about 0.1 GB) from the Setup tab. This requires an internet connection
   - No Hugging Face account or token is needed. If a download is interrupted, run setup again to resume
   - Nemotron-3-Diarization is licensed under the NVIDIA OpenMDW-1.1 license. The full text can be viewed on the setup screen
3. **Editor edition**: no models are needed for JSON import, editing, and export. To use voice input, download the "voice input pack" from the Settings tab

After the models are downloaded, transcription, diarization, and proofreading can be used offline.

### Upgrading from v0.9.8 or Earlier

- The CUDA, AMD (ROCm), and CPU editions, and AI proofreading / overall proofreading with Gemma 4 and similar models (including LM Studio / Ollama integration), have been discontinued. Use the Full edition with any GPU.
- The Full edition installs over the former NVIDIA (CUDA) edition. The CPU and AMD editions remain installed as separate apps, so uninstall them from "Installed apps" in Windows Settings.
- Models and caches left by older editions (Gemma 4, the Python environment, and so on) can be reviewed and deleted from the list in the Settings tab. They are not conversation data.
- Previously saved JSON files can be opened as they are.

## Usage

1. **Transcribe** - In the Transcription tab, select an audio file, check the number of speakers, and run. Transcription, speaker diarization, and punctuation finishing run in sequence
   - The screen shows the name of the GPU used for processing (or, for the CPU, the reason)
   - For noisy recordings, you can choose an "audio adjustment" (low-frequency noise, strong noise, volume boost, or general improvement). It is applied only to the audio used for transcription. On good-quality recordings it can lower accuracy
2. **Edit** - Correct the text and speakers while listening to the audio (default speaker labels: `SPEAKER_00 -> Th`, `SPEAKER_01 -> Cl`, `SPEAKER_02 -> IP`, and so on)
   - The buttons on each row start loop playback of that row or continuous playback from it. Press again to pause, and once more to resume from the same position
   - Record up to 15 seconds with the microphone button on any row to get one candidate transcribed by whisper.cpp (the Full edition uses the GPU when available; Editor always uses the CPU)
   - Red and yellow warnings mark candidate words that could identify individuals. Mask or edit them as appropriate for how the transcript will be used
3. **Save** - Save as Word, Excel, SRT subtitles, or JSON. If you plan to continue editing later, save as JSON, which both the Full and Editor editions can open

### Keyboard Shortcuts (Editor Screen)

| Keys | Action |
| --- | --- |
| `Ctrl+Shift+Space` or `Ctrl+Shift+P` | Continuous playback / pause / resume |
| `Ctrl+Shift+A` / `Ctrl+Shift+D` | Seek back / forward 5 seconds |
| `Ctrl+Shift+E` | Change speaker |
| `Ctrl+Shift+M` | Voice input |

Use `Ctrl+Shift+P` if your IME uses `Ctrl+Shift+Space`.

Use the button at the left of the tab row to cycle among System (default), Light, and Dark themes. The selection is preserved across launches.

## Supported Languages

Japanese is the default. The following 24 languages can be selected with "Target language" in the Settings tab. Automatic language detection is not used.

Japanese, English, Chinese, Hindi, Telugu, Bengali, Kannada, Korean, Arabic, German, Spanish, French, Italian, Portuguese, Russian, Persian, Indonesian, Turkish, Vietnamese, Thai, Urdu, Tamil, Marathi, Swahili

- The UI, proofreading rules, and output conventions are designed for Japanese clinical and counseling records. Punctuation finishing and filler handling have been evaluated only for Japanese.
- Languages whose support cannot be confirmed in the diarization model's official materials are labeled "speaker diarization unsupported" (話者分離非対応). Diarization still runs for every language, but accuracy has not been verified for languages other than Japanese.

## Technology Stack

- Desktop: Tauri 2 (Rust) / Frontend: Angular 21 + Angular Material
- Transcription: whisper.cpp (Whisper large-v3-turbo, Silero VAD; Vulkan build bundled)
- Speaker diarization: NeMo-Speech.cpp + Nemotron-3-Diarization (Vulkan build bundled)
- Proofreading: guiding punctuation and fillers with an example sentence for Whisper, local Rust rules, and proper-noun warnings. No LLM is used
- Audio decoding and audio adjustment: LGPL-configured ffmpeg CLI
- Python is neither bundled nor used

## Documentation

- Latest release notes (Japanese): [v0.9.9](docs/release-notes-v0.9.9.md)
- Changelog (Japanese): [CHANGELOG.md](CHANGELOG.md)
- Plain-language privacy guide for non-engineers (Japanese): [docs/privacy-guide.md](docs/privacy-guide.md)
- Offline verification steps (Japanese): [docs/offline-verification.md](docs/offline-verification.md)
- Template for research ethics review (IRB) documents (Japanese): [docs/irb-template.md](docs/irb-template.md)
- Troubleshooting (Japanese): [docs/troubleshooting.md](docs/troubleshooting.md)
- Development environment setup and internal notes (Japanese): [docs/development.md](docs/development.md)
- ggml speech engine design and measurements (Japanese): [docs/ggml-speech-engine-design.md](docs/ggml-speech-engine-design.md)
- Distribution builds, Windows NSIS (Japanese): [docs/release-build-windows.md](docs/release-build-windows.md)
- Distribution builds, Linux deb / AppImage; experimental (Japanese): [docs/release-build-linux.md](docs/release-build-linux.md)

## License

This app is distributed under the [Apache License 2.0](LICENSE).
The bundled FFmpeg uses an LGPL build. The Nemotron-3-Diarization speaker diarization model is licensed under the NVIDIA OpenMDW-1.1 license. See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for third-party license information.

## Disclaimer

- This software is a tool for assisting with transcription and record preparation. It is not a medical device and is not a substitute for diagnosis, treatment, clinical judgment, emergency response, or any other professional judgment.
- Outputs from transcription, speaker diarization, proofreading, voice input, and related features may contain recognition errors, omissions, speaker misattributions, or inappropriate corrections. Before relying on an output for an important record or decision, the user or an appropriately qualified professional must compare it with the original audio and review and correct it.
- Before processing audio or conversation data, obtain any required notice and consent and comply with applicable laws, professional ethics, and organizational policies. The user is responsible for securely managing the device, output files, backups, models, and credentials.
- This software is provided under the [Apache License 2.0](LICENSE), without warranties or conditions of any kind, express or implied. To the extent permitted by applicable law, the developers and contributors are not liable for decisions, records, losses, or other consequences arising from use of, or inability to use, this software.
