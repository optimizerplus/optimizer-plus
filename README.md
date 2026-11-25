<div align="center">

<img src=".github/logo.png" alt="Optimizer Plus" width="420">

**Sharper image, lower latency and the right resolution for Boosteroid cloud gaming.**

A free userscript that adds resolution, codec and image controls to the Boosteroid player.

[![Latest release](https://img.shields.io/github/v/release/optimizerplus/optimizer-plus?style=flat-square&label=version&color=0a84ff)](https://github.com/optimizerplus/optimizer-plus/releases/latest)
[![License](https://img.shields.io/github/license/optimizerplus/optimizer-plus?style=flat-square&color=0a84ff)](LICENSE)

[![Install](https://img.shields.io/badge/Install-Optimizer%20Plus-0a84ff?style=for-the-badge&logo=tampermonkey&logoColor=white)](https://raw.githubusercontent.com/optimizerplus/optimizer-plus/main/Boosteroid-Optimizer-Plus.user.js)
[![Join Boosteroid](https://img.shields.io/badge/Join-Boosteroid-ff6a00?style=for-the-badge)](https://boosteroid.com/go/b/fA5oF)
[![Website](https://img.shields.io/badge/Website-optimizerplus.github.io-24292f?style=for-the-badge)](https://optimizerplus.github.io)

</div>

---

## Quick install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or [Violentmonkey](https://violentmonkey.github.io/)).
2. **[Click here to install Optimizer Plus](https://raw.githubusercontent.com/optimizerplus/optimizer-plus/main/Boosteroid-Optimizer-Plus.user.js)** and confirm.
3. Open [Boosteroid](https://cloud.boosteroid.com), start a game and open the in-game menu.

Updates install automatically. No account, no data collection.

## Features

| | |
|---|---|
| **Resolution** | Native, 4K and ultrawide (21:9, 32:9), matched to the resolutions the Boosteroid server accepts |
| **Codec** | AV1 first when your GPU decodes it in hardware, HEVC or H.264 otherwise |
| **Upscaling** | AMD FSR 1 (EASU + RCAS) when the stream is smaller than your screen |
| **Image filters** | Sharpening, denoise, deband, clarity, vibrance, with Cinematic, Competitive, Comfort and Perfect Quality presets |
| **Rendering** | WebGPU in a worker on Chrome and Edge, so mouse input never stalls the video. WebGL2 fallback elsewhere |
| **Network** | Higher receive ceiling, packet retransmission and a tuned jitter buffer. The bitrate is never forced |
| **120 FPS** | Always available, on every screen |
| **Display** | Stretch mode without black borders, performance mode for weaker GPUs |
| **Languages** | 15: English, Français, Deutsch, Español, Italiano, Português, Русский, Polski, Українська, Türkçe, Čeština, Magyar, Română, Slovenčina, Svenska |

## Requirements

- Chrome, Edge, Brave, Opera or Firefox. WebGPU features need Chrome or Edge 113+.
- [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
- A [Boosteroid](https://boosteroid.com/go/b/fA5oF) subscription.

## Not on Boosteroid yet?

Boosteroid streams PC games to any browser, with no download and no gaming PC needed.

**[Join Boosteroid](https://boosteroid.com/go/b/fA5oF)**

<details>
<summary><b>Advanced options</b></summary>

<br>

Run in the browser console on boosteroid.com, then reload the page:

| Command | Effect |
|---------|--------|
| `localStorage.setItem('optimizer_upscale', '0')` | Turn off FSR upscaling |
| `localStorage.setItem('optimizer_worker', '0')` | Render on the main thread instead of a worker |
| `localStorage.setItem('optimizer_playout_ms', '10')` | Playout delay in ms (default 30) |
| `localStorage.setItem('optimizer_debug', '1')` | Debug logs |

Use `localStorage.removeItem('<key>')` to go back to the default.

</details>

<details>
<summary><b>Development</b></summary>

<br>

`Boosteroid-Optimizer-Plus.user.js` is the published script. `node build.js` writes a private dev copy with a console stats report and no update URL. Do not install both at once.

Changes are listed in [CHANGELOG.md](CHANGELOG.md).

</details>

## Support the project

If Optimizer Plus improves your sessions, **star the repository**. It helps other Boosteroid players find it.

Bugs and ideas: [open an issue](https://github.com/optimizerplus/optimizer-plus/issues).

---

<div align="center">

MIT © [Derfog](https://github.com/Derfogd) · Free for the Boosteroid community · Not an official Boosteroid product

[Website](https://optimizerplus.github.io) · [Boosteroid](https://boosteroid.com/go/b/fA5oF) · [Releases](https://github.com/optimizerplus/optimizer-plus/releases)

</div>
