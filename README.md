# PC5 OS

A console OS built on Windows. It boots straight into a PS5-style interface you
use with a PS5, PS4 or Xbox controller. No keyboard or mouse is needed. Under
the hood it's still Windows, so Steam, Epic, GOG, Game Pass and games from
anywhere on the internet all run. When you want the PC side, you get a file
manager, your Windows apps and the full desktop, with the controller acting as
the mouse.

```
┌──────────────────────────── what you see ─────────────────────────────┐
│ Startup screen ─► Games | Media home rows ─► Control Center (PS btn)  │
│ Store (free games) · Library · Downloads (web + torrents) · Browser   │
│ Files · Windows Apps · Desktop Mode · Settings · Power / dual boot    │
├──────────────────────────── under the hood ───────────────────────────┤
│ PC5 Shell (Electron)       replaces Explorer as the Windows "shell"   │
│ PC5Input.exe               PS4/PS5 + Xbox pads system-wide, PS button,│
│                            controller-as-mouse for any Windows app    │
│ WebTorrent + Chromium      torrents and web downloads, no extra apps  │
│ Windows 11, debloated      auto-login, no lock screen, no OOBE        │
└───────────────────────────────────────────────────────────────────────┘
```

## What it does

**Console feel**
- **Startup screen:** the PC5 logo, then your profile with "Press PS to start".
- **Home screen:** Games and Media rows like the PS5. The focused tile grows, the game's art fills the background, and Play and Options sit underneath. L1/R1 switch between Games and Media.
- **Control Center:** the PS button opens it. It shows a live Downloads card, plus Home, Store, Wi-Fi, Controllers, Mouse Mode, Settings and Power.
- **Notifications:** pop up for downloads that start and finish. Navigation sounds come from a synthesized chime (no Sony audio).
- **Button prompts:** ✕ ○ □ △ on PlayStation pads, A B X Y on Xbox pads.

**Controllers, from the very first boot**
- PS5 DualSense, DualSense Edge, PS4 DualShock 4 and Xbox controllers all work, over USB (plug-and-play) or Bluetooth. You don't need DS4Windows.
- The PS button works everywhere: in a game, in an installer or on the desktop, it brings you back to PC5.
- **Pair a Bluetooth controller** from Settings → Controllers, using just the controller.
- **Mouse mode:** hold Share/Create for 1 second, or pick Control Center → Mouse Mode, and the controller drives the real Windows pointer.

  | Control | Action |
  |---|---|
  | Left stick | Moves the pointer |
  | ✕ | Click |
  | □ | Right-click |
  | Right stick | Scroll |
  | D-pad | Arrow keys |
  | Options | Enter |
  | ○ | Esc |
  | L1/R1 | Tab |
  | △ | Windows on-screen keyboard |

  Mouse mode switches on by itself when you run an installer or open Desktop Mode.

**Games from everywhere**
- **Store, free games:** limited-time giveaways from Steam, Epic, GOG, itch.io and more (via GamerPower), Epic's free games of the week, and Steam free-to-play games with a one-press **Install free**.
- **Store, paid games:** Steam top sellers, specials, new releases and search. Buying happens in Steam or Epic.
- **Web Browser:** use the left stick as a pointer, ✕ to click, and the right stick to scroll. Text boxes open the on-screen keyboard, with a Go key that submits the form. Bookmarks for free-game sites are included.
- **Downloads:** any download link or magnet/.torrent link you click goes here. Torrents are built in, so there's no qBittorrent to set up.
- **One press from download to playing:** ZIP/7z/RAR downloads have *Extract and add to Game Library*, which extracts the archive, finds the game's .exe (skipping redistributables and uninstallers) and asks for a name. Installers get *Run installer*, with the controller as a mouse.

**PS controllers in every added game**
- Games you add to PC5 from downloads, Files or Windows Apps are registered in Steam automatically as "non-Steam games", and PC5 launches them through Steam. Steam Input then translates your DualSense or DualShock 4 into an Xbox controller, which almost every PC game understands, including games that don't support PlayStation controllers natively.
- Your own non-Steam shortcuts are left untouched. Only entries tagged `PC5` are managed, and a backup (`shortcuts.vdf.pc5-backup`) is written before each change.
- Steam reads that list only at startup, so PC5 syncs before it starts Steam. If you add a game while Steam is running, PC5 closes Steam cleanly, updates the list, and reopens Steam in the background (you'll see a notification).
- You can turn this off in Settings → *Controller support for added games*. Added games then launch their `.exe` directly. Windows Apps shortcuts (`.lnk`) always launch directly.

**Installing games yourself**
- **Install from file** (Library, Files, Downloads, or the "For you" cards on Home) works with `.exe`, `.msi`, `.iso` disc images and `.zip`/`.7z`/`.rar` archives.
  - PC5 runs the installer, with your controller working as a mouse, and records what Windows had installed before and after.
  - The new game, and the right `.exe` to start it, go straight onto the front of Home.
  - If PC5 can't tell what was installed, it asks you to pick the `.exe`.
- **Game folders:** install or copy a game into any game folder and it appears on Home by itself, with a notification. PC5 checks at startup and every 2 minutes.
  - Watched by default: `C:\Games`, plus `Games` and `GOG Games` on every drive, and GOG Galaxy's folders.
  - Add your own in Settings → Game Library.
  - Removing an auto-found game stops it coming back.
- **GOG games** are picked up from the registry as a proper library source.
- **Artwork for every game:** added and GOG games get the game's official cover, background and logo by looking the title up on Steam.

**Mouse and keyboard**
- **Cursor:** the pointer appears as soon as you move the mouse (or the controller in mouse mode), and hides when you pick up the controller.
- **Pointing and clicking:** hovering highlights things like the D-pad does, and clicking selects.
- **Scrolling:** the wheel scrolls every list, scrolls rows sideways, and on Home moves between the tile row and the "For you" cards.
- **Right-click** opens a game's Options. Clicking outside a menu, the mouse back button and Esc all go back.

**Settings that actually work** (two panes: categories on the left, live controls on the right)

| Category | What's in it |
|---|---|
| Network | Wi-Fi, connection status, connection test |
| Sound | Volume slider, mute, output device (TV, headphones, speakers), navigation sounds |
| Screen and Video | Resolution and refresh rate (reverts after 15 s unless you keep it), brightness on laptops, interface size |
| Controllers | Connected pads, Bluetooth pairing, button prompts (auto, PlayStation or Xbox), mouse mode, Steam controller support |
| Game Library | Find new games now, rescan, install from file, game folders, hidden games |
| Storage and Downloads | Free space per drive, download folder, games folder, torrent sharing |
| Appearance | Accent colour (or "game colour", which follows the selected game), background (game art or calm), 24-hour clock |
| Accessibility | Interface size, reduce motion, always show button hints |
| Notifications | Show notifications, sounds |
| Power Saving | Rest mode timer, screen-off timer, rest, restart, turn off |
| Date and Time | Time zone, clock format |
| Profile | Name, avatar colour |
| System | PC details (Windows, CPU, GPU, RAM), Windows Update, Desktop Mode, Switch to Windows, restart into another OS, Exit PC5 |

Sliders move with left/right (or by dragging or the wheel); toggles flip with ✕.

**Switching between PC5 and Windows**
- **Desktop Mode** (Control Center → Desktop, or Settings → System):
  - Opens the real Windows desktop, with taskbar and Start menu, in the same session.
  - The controller works as a mouse there.
  - To come back: press PS or Ctrl+Alt+H, or open "PC5" from the Start menu. PC5 closes the desktop when it comes back.
- **Switch to Windows** (Power menu or Settings → System):
  - Signs you out. When you sign back in, you get normal Windows.
  - A **Return to PC5** icon on the desktop switches back.

**Performance monitor**
- **Performance page** (Media → Performance, or the Control Center card):
  - Live tiles for processor, graphics, memory, video memory, disk and network.
  - Each tile has a sparkline of the last 90 seconds. Hover a line to see the value at that moment.
  - CPU and GPU temperatures, with **Warm/Hot** labels.
  - Usage bars that turn amber or red when high.
- **Task manager:** the busiest apps with CPU and memory use. Select one → **End task**. Windows' own system processes are protected.
- **In-game overlay:** a small, click-through stats panel (CPU, GPU, RAM, VRAM, temperatures) that stays on top of your games.
  - Turn it on from the Control Center, the Performance page or Settings → Performance, and choose its corner.
  - It works with borderless and windowed games. Exclusive-fullscreen games draw over it.
- **Where the numbers come from:** Windows performance counters. NVIDIA cards also report GPU temperature and total VRAM through `nvidia-smi`.

**Themes, sounds and music**
- **9 themes** (Settings → Themes): Midnight, Nebula, Aurora, Ocean, Ember, Sakura, Synthwave, Prestige and OLED Black. Each sets the background, the moving colour glow, the accents and the glass tint, and you pick from a visual gallery.
- **Your own wallpaper:** a picture, or a video that loops silently behind Home.
- **Accent colour:** fixed, or "game colour" that follows the selected game's art.
- **Navigation tones** (Settings → Sounds and Music):
  - 5 built-in packs: Classic, Crystal, Soft, Retro and Minimal. You can preview them.
  - Or your own sound files for move, select and back.
  - Plus tone volume.
- **Startup music:** the PC5 chime, none, or your own song on the welcome screen. It fades out as you enter.
- **Home music:** a song that loops quietly on Home, and pauses automatically when a game, app, video or the browser is in front.

**Media player and captures**
- **Media Player** (Media row): videos, music and pictures from your PC, played full screen with the controller.

  | Control | Action |
  |---|---|
  | ✕ | Play / pause |
  | ◀ ▶ | Seek 10 seconds, or the previous/next picture |
  | ▲ ▼ | Volume |
  | L1/R1 | Previous / next file |
  | ○ | Close |

  Opening a video, song or picture in Files plays it here too.
- **Screenshots:** Control Center → Screenshot, or a quick tap of Create/Share (turn that on in Settings → Performance). They're saved to Pictures › PC5 Captures, and Media Player → Captures shows them.

**Hybrid PC side**
- **Files:** browse every drive and folder. Open, copy, cut and paste, rename, make new folders, move to the Recycle Bin, extract archives, install games, play media, or add any `.exe` to your library. All of it works with the controller.
- **Windows Apps:** every installed program, read from the Start menu. Open any of them, or add them to the Game Library.

**Dual boot**
- **Install alongside your current Windows:** `-InstallDisk/-InstallPartition` puts PC5 OS on a separate partition.
- **Switch OS from the controller:** Power → *Restart into another OS…* restarts into your other Windows or Linux once, then the next restart comes back to PC5. There's also *UEFI / BIOS settings*.

## Design language

PC5 follows the PS5's interaction model and visual structure closely:

- **Home:** a row of rounded square tiles where the focused one springs larger, gets a white focus ring and a light sweep, and shows its name beside it.
- **Hero:** full-bleed game art behind a large title with a white Play pill.
- **"For you" cards:** they peek in at the bottom, and pressing down past Play slides the whole screen up to reveal them.
- **Control Center:** a bottom panel with a card strip ("Jump back in", Downloads, Free games) and round icon buttons whose labels appear only on focus.
- **Store:** a large featured banner above rows of cards.
- **Library:** a grid of square covers with names underneath.
- **Keyboard:** docked at the bottom of the screen.
- **Hints:** no button hints on the home screen.

Everything you see is original:

| Element | Source |
|---|---|
| Line icons | Drawn for PC5 (`renderer/js/icons.js`) |
| Font | Inter, under the SIL Open Font License (`renderer/fonts/`) |
| Sounds | Synthesized in code |
| Startup particles, aurora background, logo | Made for PC5 |

No Sony logos, the PS5 system font, theme artwork or sounds are included. The ✕ ○ □ △ symbols appear only as button prompts for the controller in your hand.

## Install PC5 OS: the installer

This is how a user gets PC5 OS onto a PC. There's nothing to build or type:

1. **Get Windows:** download the Windows 11 ISO from [microsoft.com/software-download/windows11](https://www.microsoft.com/software-download/windows11) (free).
2. **Open the PC5 OS Installer:** Setup opens it; afterwards it's on the desktop. Choose one of:
   - **Install next to Windows** (recommended): PC5 OS gets its own partition and the boot menu offers PC5 OS or Windows. No USB stick needed.
   - **Make an install USB:** a UEFI USB stick that installs PC5 OS on any PC, including a whole-disk console PC.
   - **Save a PC5 OS ISO:** for virtual machines, Ventoy, or writing to USB later.
3. **Follow the five steps:**
   - **Windows:** drop the ISO and pick the edition.
   - **Strip down:** choose Light, Balanced or Minimal, or tick items yourself.
   - **Where:** pick a drive and a size, with a picture of the disk before and after.
   - **Account:** the player name for automatic sign-in.
   - **Review:** confirm the changes, then install.
4. **Restart into PC5 OS:** the first start sets Windows up for a few minutes, then the console opens.

What the installer does, in the engine (`windows/engine/PC5Engine.psm1`):

| Step | Next to Windows | USB / ISO |
|---|---|---|
| Room | shrinks the chosen drive (keeps 20 GB free for it) or uses unallocated space, makes an NTFS partition | wipes and formats the USB (FAT32, GPT) / temporary folder |
| Windows | `DISM /Apply-Image` of the chosen edition straight onto the partition | exports the edition, mounts it |
| Strip | removes the chosen provisioned apps, capabilities and features; applies the console settings | same, inside the image |
| PC5 | copies the installed PC5 app, sets it as the shell for new users, adds the first-boot script, Steam and 7-Zip, and `unattend.xml` (local account, auto sign-in, no setup screens) | same, with `autounattend.xml` on the media; optional TPM/Secure Boot bypass |
| Boot | `bcdboot /d` adds **PC5 OS** to the existing boot menu without changing the default. BitLocker is paused for two restarts and Fast Startup is turned off | install.wim is split for FAT32, or the ISO is written (oscdimg if installed, otherwise Windows' built-in IMAPI) |

Every step that changes a disk registers an undo, so a failure or **Cancel** puts the drive back the way it was. The installer's home screen lists PC5 OS installs on this PC, with **Restart into PC5 OS** and **Remove** (deletes the partition and boot entry, and gives the space back).

The engine runs elevated (one Windows permission prompt) and talks to the window over a private loopback connection with a one-time token. It can also be run directly: `windows\engine\pc5-engine.ps1 -Command targets`.

Requirements for "next to Windows": a UEFI PC with a GPT disk, and 60 GB free on a drive. A legacy BIOS PC can still use a USB stick.

`windows/build-iso.ps1` is the older command-line ISO builder; the installer replaces it for normal use.

## Publish it: GitHub + Vercel

PC5 OS is open source (MIT, see `LICENSE`). Users never need VS Code or Node.js. They get a website and an installer:

| What | Built by | Lives at |
|---|---|---|
| Website: landing page + live preview at `/play/` | Vercel, from your GitHub repo | `https://<project>.vercel.app` |
| `PC5-OS-Setup.exe` | GitHub Actions, on a Windows runner | your repo's **Releases** page |

### 1. Put the project on GitHub

Create an empty repository on github.com (for example `pc5-os`), then in the pc5-os folder:

```powershell
git remote add origin https://github.com/<you>/pc5-os.git
git push -u origin main
```

(The zip already contains a git repository with everything committed. If you start from a plain folder, run `git init`, `git add .` and `git commit -m "PC5 OS"` first.)

### 2. Release the installer

Releases are automatic. When `main` gets a `"version"` in `shell/package.json` that hasn't been released yet, the **Build installer** workflow (`.github/workflows/release.yml`) builds the controller service and the installer on Windows, creates the `v<version>` tag and release, and attaches `PC5-OS-Setup.exe`. For the next version, change `"version"` (for example to `0.2.0`) and push. Pushing a `v*` tag yourself also works. To build on your own PC instead, double-click **`Build Installer.cmd`**.

### 3. Turn the repo into a Vercel site

1. vercel.com → **Add New… → Project** → import your `pc5-os` repo.
2. Leave every setting as it is (the root `vercel.json` tells Vercel to build `web/` into `web/dist`) and press **Deploy**.

Every push to `main` redeploys the site. The **Download for Windows** buttons point at `https://github.com/<you>/pc5-os/releases/latest/download/PC5-OS-Setup.exe` automatically, so they always get the newest release. To link somewhere else, set `downloadUrl` in `web/site.config.json`.

To deploy from your PC without GitHub: `cd web`, `npm install`, `npm run deploy`. To preview locally: `npm run preview`, then open http://localhost:4173.

### What the user's Setup does

- installs the **PC5 OS Installer** per user, with no admin prompt, and opens it when Setup finishes;
- adds a desktop and Start-menu shortcut for the installer, plus **PC5 OS Console** to try the console on this Windows;
- Windows Settings → Apps → PC5 OS → Uninstall removes the app and, if console mode was on, puts the normal desktop back.

The installer isn't code-signed, so SmartScreen shows "Windows protected your PC" and users click *More info → Run anyway*. The website explains this. Open-source projects can get free signing through programmes such as SignPath Foundation.

### Button icons

On-screen prompts are drawn as vector buttons in the DualSense style (cross, circle, square, triangle, plus PS, Create, L1 and R1). They're original drawings of those basic shapes, not files taken from Sony. Settings → Controllers → **Button colours** switches between white (like the DualSense) and the classic colours; **Button prompts** switches to Xbox A/B/X/Y. Text anywhere in the UI can include a button by writing `⟦accept⟧`, `⟦back⟧`, `⟦alt⟧`, `⟦options⟧`, `⟦home⟧` or `⟦share⟧`, or by calling `PC5.glyph('accept')` in code.

## Build it (on a Windows 10/11 PC)

**1. Build the shell**

```powershell
# Requires Node.js 20+  (winget install OpenJS.NodeJS.LTS)
cd shell
npm install
npm run demo         # try it in a window with demo games (keyboard: arrows, Enter, Esc, Q/E, H, Tab, M)
npm run dist         # -> shell\dist\win-unpacked\PC5Shell.exe (+ helper\PC5Input.exe)
```

**2a. Try it on your current PC**

```powershell
# Administrator PowerShell
powershell -ExecutionPolicy Bypass -File .\windows\tools\install-shell.ps1 -Install    # run from the pc5-os folder; then sign out and back in
powershell -ExecutionPolicy Bypass -File .\windows\tools\install-shell.ps1 -Uninstall  # back to the normal desktop
```

**2b. Build the bootable PC5 OS installer**

You need:
- A Windows 11 ISO from <https://www.microsoft.com/software-download/windows11>.
- The [Windows ADK](https://learn.microsoft.com/windows-hardware/get-started/adk-install), "Deployment Tools" feature only.

```powershell
# Administrator PowerShell. Pick ONE way to choose where it installs:

# a) Setup asks you to pick a drive (needs a mouse/keyboard for that one screen)
.\windows\build-iso.ps1 -IsoPath D:\Win11.iso

# b) Dual boot next to your current Windows: first shrink a drive in Disk Management and
#    create an empty partition, then find its numbers with Get-Partition.
#    Only that partition is formatted.
.\windows\build-iso.ps1 -IsoPath D:\Win11.iso -InstallDisk 0 -InstallPartition 5

# c) A dedicated console PC: ERASES disk 0 with no questions
.\windows\build-iso.ps1 -IsoPath D:\Win11.iso -AutoWipeDisk0
```

Other options:

| Option | Effect |
|---|---|
| `-ProductKey` | Skips the product-key screen. PCs that already have a Windows digital licence activate automatically. |
| `-BypassHardwareChecks` | Installs on PCs without TPM 2.0 or Secure Boot. |
| `-IncludeEpic` | Also installs the Epic Games Launcher at first boot. |
| `-RemoveXbox` | Also removes the Xbox app and Store. Game Pass stops working. |
| `-KeepUacPrompts` | Keeps "allow changes?" prompts. They're off by default because a controller can't answer them. |
| `-Edition`, `-UserName`, `-Locale`, `-TimeZone` | Edition to keep, account name, language and time zone. |

Write `PC5OS.iso` to a USB stick with [Rufus](https://rufus.ie). Untick everything in Rufus's "Windows User Experience" dialog. Then boot from the USB stick.

**First boot:** Windows installs, signs in automatically, and installs Steam and 7-Zip. Then PC5 starts. Plug in a controller, or pair one in Settings → Controllers. If you're not on Ethernet, connect Wi-Fi from the Control Center. Then sign in to Steam once.

## Configuration

`%APPDATA%\PC5Shell\config.json`:

| Key | What it sets |
|---|---|
| `bookmarks` | Browser bookmarks. Defaults are free-game sites. |
| `homepage`, `searchUrl` | Browser start page and search engine (DuckDuckGo by default). |
| `downloadDir`, `gamesDir` | Default `Downloads\PC5` and `C:\Games`. Archives are extracted into `gamesDir`. |
| `torrentSeed` | Keep uploading finished torrents (default off, so online games aren't slowed). |
| `apps` | The Media row: web apps, URIs or programs. |
| `customGames` | Games added from downloads. Each is `{ title, exe, cover }`. |
| `steamInputForAdded` | Register added games in Steam and launch them through it, for PS controller support (default on). |
| `autostart`, `autostartSteam` | Programs started with the shell. Explorer's startup list doesn't run under a custom shell. |
| `elevateInput` | Run the controller service as admin so mouse mode works inside admin installers (default on). |

## What's tested and what isn't

**Tested here** (the real Electron app running under Xvfb on Linux, in demo mode):
- **Screens:** startup, home rows, control center, store, library, settings and file browsing.
- **Browser:** clicking a page's text box opens the on-screen keyboard, the text goes into the page and Go submits the form. The D-pad scrolls the page.
- **Downloads:** a web download and a magnet-link torrent (via a local tracker and seeder) both complete.
- **Download to library:** *Extract and add to Game Library* unpacks the ZIP, picks the game's .exe over the redistributable, and adds it to the library.
- **Settings:**
  - Every category builds its controls.
  - Sliders move with left/right, toggles flip, and pickers change values.
  - Changing the interface size rescales everything, and the accent colour and 24-hour clock apply.
  - Stepping right from a category lands on its first control.
- **Layout:** no overlaps at 1280×720, 1920×1080, 1920×1200, 2560×1440 and 2560×1080.
- **Mouse:** the cursor appears when the mouse moves, right-click opens Options, and clicking outside a menu closes it.
- **Game folders:** a game copied into `Games` was found and added to Home, with its real `.exe` picked over a crash-handler `.exe`.
- **This round:**
  - The Performance page shows live data from the test machine, and the graph hover readout works.
  - The overlay opens as an always-on-top window with live values.
  - End task works.
  - Themes apply, and a wallpaper picture is shown.
  - Switching the tone pack works.
  - A song plays, pauses and skips in the media player, and pictures step forward.
  - Copy and paste between folders works.
  - A screenshot is saved as a real PNG.
- **Unit tests** (`npm test`): Steam shortcut writing, and the install tracker's registry parsing and "what got installed" logic.

**Not tested yet, because it needs real Windows and real controllers:**
- `PC5Input.exe` compiles on Windows, but PS4/PS5 HID reading, the global PS button and mouse mode haven't been tried with a real controller yet.
- `PC5System.exe` (volume, output device, resolution) hasn't been compiled yet. This environment has no C# compiler, and here those settings use stand-in values.
- Running real installers, the desktop-mode switch, and Switch to Windows / Return to PC5.
- Bluetooth pairing.
- Wi-Fi.
- The boot-menu switch.
- The ISO build and first-boot scripts.
- The Steam, Epic and GamerPower store feeds, which this environment's network blocks.

Expect a round of fixes on the first real run. A Hyper-V VM is a safe place to try the ISO.

## Known limitations

- **PlayStation controllers in games:** Steam games and added games go through Steam Input, so Steam must be installed and signed in. PC5 installs it at first boot. Games started outside PC5 don't get this.
- **Windows Setup itself** can't be driven by a controller. Use option (b) or (c) above for a fully hands-off install.
- **The dual-boot boot menu** needs a keyboard. PC5 sets a 3-second timeout and gives you *Restart into another OS* instead.
- **Netflix / Disney+** need DRM (Widevine) that stock Electron lacks.
- **Wi-Fi setup** reads Windows' English-language output.
- **Security trade-offs:** auto-login, silent admin rights and a mouse-capable controller service are console conveniences. Don't use this setup on a shared or work PC.

## Legal

- You need your own Windows licence. This project modifies an ISO you download from Microsoft and never redistributes Windows.
- "PC5" and the PS5-style layout are original work. It uses no Sony or Microsoft logos, fonts, sounds or artwork. The name "PC5" is close to "PS5", so pick a more distinct name if you ever publish or sell this.
- The torrent client and browser are general-purpose tools, like qBittorrent or Chrome. Use them for content you're allowed to download, such as free and DRM-free games, giveaways, open-source games and your own backups.
