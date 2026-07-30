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
# or multiple links at once
video-link-debugger test https://a.example.com/1.mp4 https://b.example.com/2.mp4
# or from a text file (one link per line)
video-link-debugger test --file links.txt
```

### Commands

- `test` — Tests one or more video links and reports link information, network timings, seek behavior, and single- vs. multi-connection download speed.

Links can be passed as positional arguments, with `--link`/`-l`, or with `--file`/`-f` pointing to a text file containing one link per line (blank lines and lines starting with `#` are ignored). All sources are combined and tested one after another.

When testing multiple links, each link uploads its own results and prints its **Results URL** as it completes; at the end, all results URLs are listed together with a **Combined Results URL** — a single PrivateBin paste containing every link's results.

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

### `speedtest`

Speed tests TorBox CDNs using test files from the [TorBox API](https://api-docs.torbox.app/). By default it tests only the closest CDN. Each CDN's test file is downloaded twice — once over a single connection and once over 4 connections (configurable with `--connections`) — and both speeds are reported. The results table is a leaderboard sorted by the best achieved speed, with the closest CDN marked `*`. When more than one CDN is tested, the fastest one is highlighted in green.

Before testing starts (and with `--list-regions`), a world map is drawn in the terminal showing where the CDNs are located, with a numbered marker and legend entry per location and the closest CDN highlighted. The map needs a terminal at least 74 columns wide and is skipped otherwise.

```bash
video-link-debugger speedtest                    # closest CDN, short test file
video-link-debugger speedtest -n 5               # top 5 CDNs, closest first
video-link-debugger speedtest --all              # every CDN
video-link-debugger speedtest -n 3 -c 8          # top 3, multi pass with 8 connections
video-link-debugger speedtest -c 1               # single-connection pass only
video-link-debugger speedtest -r weur            # only the weur region
video-link-debugger speedtest --test-length long # bigger test file
video-link-debugger speedtest --list-regions     # show available regions and exit
video-link-debugger speedtest --map-only         # show the CDN map and exit
```

#### `speedtest` flags

| Flag | Short | Meaning |
| --- | --- | --- |
| `--count <n>` | `-n` | Number of CDNs to test, closest first (default: 1) |
| `--all` | `-a` | Test every returned CDN |
| `--connections <n>` | `-c` | Connections for the multi-connection download; 1 disables it (default: 4) |
| `--test-length <short\|long>` | `-t` | Size of the speedtest file (default: `short`) |
| `--region <region>` | `-r` | Only test CDNs in this region (see `--list-regions`) |
| `--user-ip <ip>` | `-u` | IP used to determine the closest server (default: the calling IP) |
| `--list-regions` | `-R` | List the available regions and exit without testing |
| `--map-only` | `-M` | Show the CDN location map and exit without testing (respects `--region`) |

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
