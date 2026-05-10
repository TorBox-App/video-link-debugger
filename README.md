# Video Link Debugger


## Install

Pre-built binaries are published to the [Releases page](https://github.com/TorBox-App/video-link-debugger/releases) for every push. Pick the file matching your OS and CPU:

| OS | File |
| --- | --- |
| macOS (Apple Silicon) | `video-link-debugger-darwin-arm64` |
| Linux x64 | `video-link-debugger-linux-x64` |
| Linux x64 (older CPUs) | `video-link-debugger-linux-x64-baseline` |
| Linux ARM64 | `video-link-debugger-linux-arm64` |
| Windows x64 | `video-link-debugger-windows-x64.exe` |
| Windows ARM64 | `video-link-debugger-windows-arm64.exe` |

The binaries are unsigned, so the first time you run one you'll see a security warning. The one-time fix per platform:

### macOS

If you see **"video-link-debugger-darwin-arm64 is damaged and can't be opened"**, that's macOS Gatekeeper rejecting the binary because it's unsigned. Run this once to remove the quarantine flag:

```bash
xattr -dr com.apple.quarantine ~/Downloads/video-link-debugger-darwin-arm64
chmod +x ~/Downloads/video-link-debugger-darwin-arm64
./video-link-debugger-darwin-arm64
```

### Windows

If SmartScreen says **"Windows protected your PC"**, click **More info** → **Run anyway**.

You can also right-click the `.exe` → Properties → check **Unblock** → OK before launching.

### Linux

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

By default `test` runs every phase. Pass any of these to skip a phase:

| Flag | Short | Skips |
| --- | --- | --- |
| `--skip-timings` | `-T` | DNS / TCP / TLS / TTFB measurement and the **Network Timings** table |
| `--skip-seek` | `-S` | Random seek probes and the **Seek Results** table |
| `--skip-download` | `-D` | Single- and multi-connection downloads and the **Download Comparison** table |

Link information is always printed.

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
