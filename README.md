# Video Link Debugger

## Install

### Quick install (one command)

**Linux / macOS** (also works in Git Bash or WSL on Windows):

```bash
curl -fsSL https://raw.githubusercontent.com/TorBox-App/video-link-debugger/main/install.sh | bash
```

**Windows** (PowerShell):

```powershell
powershell -c "irm https://raw.githubusercontent.com/TorBox-App/video-link-debugger/main/install.ps1 | iex"
```

The script detects your OS and CPU, downloads the right binary from the latest release, clears the OS security quarantine, and installs it to `~/.local/bin` (Linux/macOS) or `%LOCALAPPDATA%\video-link-debugger` (Windows).

You can also install and immediately run a test in one command:

```bash
curl -fsSL https://raw.githubusercontent.com/TorBox-App/video-link-debugger/main/install.sh | bash -s -- test https://example.com/video.mp4
```

To pin a version or change the install location, set `VERSION` and/or `INSTALL_DIR`:

```bash
VERSION=v1.1.0 INSTALL_DIR=/usr/local/bin curl -fsSL https://raw.githubusercontent.com/TorBox-App/video-link-debugger/main/install.sh | bash
```

### Manual install

Pre-built binaries are published to the [Releases page](https://github.com/TorBox-App/video-link-debugger/releases) for every push. Pick the file matching your OS and CPU:

| OS | File |
| --- | --- |
| macOS (Apple Silicon) | `video-link-debugger-darwin-arm64` |
| Linux x64 | `video-link-debugger-linux-x64` |
| Linux x64 (older CPUs) | `video-link-debugger-linux-x64-baseline` |
| Linux ARM64 | `video-link-debugger-linux-arm64` |
| Windows x64 | `video-link-debugger-windows-x64.exe` |
| Windows ARM64 | `video-link-debugger-windows-arm64.exe` |

The binaries are unsigned, so when downloaded manually (via a browser) the first run triggers a security warning. The install script handles this for you; for manual downloads, the one-time fix per platform:

#### macOS

If you see **"video-link-debugger-darwin-arm64 is damaged and can't be opened"**, that's macOS Gatekeeper rejecting the binary because it's unsigned. Run this once to remove the quarantine flag:

```bash
xattr -dr com.apple.quarantine ~/Downloads/video-link-debugger-darwin-arm64
chmod +x ~/Downloads/video-link-debugger-darwin-arm64
./video-link-debugger-darwin-arm64
```

#### Windows

If SmartScreen says **"Windows protected your PC"**, click **More info** → **Run anyway**.

You can also right-click the `.exe` → Properties → check **Unblock** → OK before launching.

#### Linux

No security prompts. Just make it executable:

```bash
chmod +x ~/Downloads/video-link-debugger-linux-x64
./video-link-debugger-linux-x64
```

## Usage

```bash
video-link-debugger test https://example.com/video.mp4
# or
video-link-debugger test --link https://example.com/video.mp4
```

### Commands

- `test` — Tests a video link and reports link information, network timings, seek behavior, and single- vs. multi-connection download speed.

#### `test` flags

By default `test` runs every phase. Pass any of these to disable a phase or behavior:

| Flag | Short | Disables |
| --- | --- | --- |
| `--skip-timings` | `-T` | DNS / TCP / TLS / TTFB measurement and the **Network Timings** table |
| `--skip-seek` | `-S` | Random seek probes and the **Seek Results** table |
| `--skip-download` | `-D` | Single- and multi-connection downloads and the **Download Comparison** table |
| `--skip-pastebin` | `-P` | Uploading results to PrivateBin and printing the **Results URL** |
| `--no-blur` | `-B` | Blurring of the file name — shows it in full |

Link information is always printed.

The file name is blurred by default, keeping only the first character and the extension (`movie.mp4` → `m****.mp4`) — both in the terminal output and in the uploaded PrivateBin results. Pass `--no-blur` (`-B`) to show it in full.

```bash
video-link-debugger test https://example.com/video.mp4              # everything
video-link-debugger test https://example.com/video.mp4 -D           # no downloads
video-link-debugger test https://example.com/video.mp4 -T -S        # only download tests
```

> Short flags can't be bundled — write `-T -S`, not `-TS`.

## Development

```bash
bun install
bun dev -- [command]
```

### Building

```bash
bun run build
```

### Testing

```bash
bun test
```

## License

MIT
