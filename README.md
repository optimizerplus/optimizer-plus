# Boosteroid Optimizer Plus

Userscript for [Boosteroid](https://boosteroid.com/go/b/fA5oF) cloud gaming. It adds resolution, codec and image options to the Boosteroid player.

Website: [optimizerplus.github.io](https://optimizerplus.github.io)

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open [Boosteroid-Optimizer-Plus.user.js](https://raw.githubusercontent.com/optimizerplus/optimizer-plus/main/Boosteroid-Optimizer-Plus.user.js) and confirm the install.

Updates are automatic: Tampermonkey checks this file and installs new versions.

## Features

- Resolution: native, 4K and ultrawide (21:9, 32:9), picked from the resolutions the Boosteroid server accepts.
- Codec: AV1 first when the GPU decodes it in hardware, otherwise HEVC or H.264.
- Network: raised receive ceiling in the SDP, NACK/PLI retransmission, tuned playout delay. The script never forces a minimum bitrate.
- Image: WebGPU renderer (in a worker on Chrome/Edge), WebGL2 fallback, AMD FSR 1 upscaling, sharpening, denoise, deband, vibrance and presets.
- 120 FPS stays available on every screen.
- Stretch mode (no black borders) and a performance mode for weaker GPUs.
- Interface in several languages, added to the Boosteroid in-game menu.

## Options

Set in the browser console on boosteroid.com, then reload the page:

| Key | Effect |
|-----|--------|
| `localStorage.setItem('optimizer_upscale', '0')` | Disable FSR upscaling |
| `localStorage.setItem('optimizer_worker', '0')` | Render on the main thread instead of a worker |
| `localStorage.setItem('optimizer_playout_ms', '10')` | Playout delay in ms (default 30) |
| `localStorage.setItem('optimizer_debug', '1')` | Debug logs |

## Development

`Boosteroid-Optimizer-Plus.user.js` is the published script. `node build.js` writes a private dev copy with a console stats report and no update URL. Do not install both at once.

Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
