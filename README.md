# YouTube Finish-By Speed Planner

A userscript that tells you how fast to play a YouTube video so you finish it by a clock time you choose. On livestreams it reads the real live latency from "Stats for nerds" and works out how to catch up. An optional Auto-set mode applies the plan to the player for you.

License: CC0 1.0 (public domain) · By Arturopakastur & Claude

## Install

1. Install a userscript manager such as Tampermonkey or Violentmonkey.
2. Add `YouTube Finish-By Speed Planner-1.2.0.user.js` to it (open the file, or paste it into a new script).
3. Open any video on `youtube.com`.

The script needs no special permissions (`@grant none`) and only runs on YouTube.

## Using it

Open the panel with the ⏱ button next to the video title. On first run the panel is closed. If the title area can't be found, the button floats in the bottom-right corner instead.

The panel can be dragged by its header, collapsed with **–**, and closed with **✕**. It stays visible in fullscreen. Your settings are remembered between visits.

### Regular videos

Type the time you want to be done by, then choose a plan.

**Finish time formats** (your local time):

| You type | Meaning |
| --- | --- |
| `2026-11-20 15:34:30` | exact date and time |
| `2026/11/20 3:34 PM` | also accepted |
| `15:34`, `15:34:30`, `3:34pm` | today, or tomorrow if that time has already passed |

**Steady Pace** gives one constant speed to set now and keep. Speeds sit on YouTube's 0.05 grid, so you see the exact speed needed, plus what happens if you round it up (on time or early) or down (on time or late).

**Sprint Start** runs at your max speed first, then drops to 1× for the rest. The speed-up happens up front, so if you pause later you can make the time back without ever needing more than your max speed. The panel shows how long to stay at max, the clock time and video position of the switch, and the share of time spent at max.

If the deadline can't be reached even at your max speed, the panel says so and shows how late you'd be.

Other details:

- **Max speed** (1.05–4.00) caps every plan.
- Being less than a second late counts as on time.
- If the video would finish in time at 1×, the panel just says no speed-up is needed.
- Seconds of stitched-in (server-side) ads are excluded from the video length and position.

### Livestreams

On a live stream the panel switches to catch-up mode. The stream keeps growing while you watch, so catching up takes `gap ÷ (speed − 1)`. When available, the script reads the real live latency from "Stats for nerds" (and estimates it between readings) to show how far behind real time you are.

- **Catch up within (optional)** takes a duration such as `10m`, `90s`, `1h 5m`, `5:30`, `1:30:00`, or a bare number (minutes). Leave it blank to catch up as fast as possible.
- **Safe window** (default 30s) is how far behind in seconds still counts as "live."
- **Max speed until the buffer runs out** (on by default) catches up at your max speed until you're live and the buffer ahead of you is used up (YouTube stalls to buffer, or only ~2.5s remain), then drops back to 1×.
- **Desired latency (optional)** lets you specify a target number of seconds behind real time to stop at (must be below the safe window; ignored when buffer catch-up is ticked). Leave blank to stop once the player reports you're live.
- The panel shows how far behind live you are, your buffer ahead, the speed needed, when you'll be caught up, and how much of the stream you watch meanwhile.

The script checks that the stream's live edge is really advancing before it shows a plan, so ended or stalled streams don't get a false catch-up plan.

## Auto-set speed

Tick **Auto-set speed** to have the script set the player speed for you, following the plan.

- It is **off by default**, and switches itself off whenever you open a different video or reload the page.
- It never plays slower than 1×.
- In Steady Pace it only speeds up (for example after a pause), never drifts back down. In Sprint Start it also drops to 1× when the sprint is done, and sprints again if you fall behind.
- On livestreams it watches quietly and starts catching up only if you fall further behind than the safe window. Depending on your settings, it stops and returns to 1× once the buffer runs out, your desired latency is reached, or the player reports you're live.
- If you change the speed yourself, Auto-set pauses and shows a **Resume** button.
- A small green dot on the ⏱ button shows that Auto-set is active.

## Settings

The panel's inputs are saved in the page's `localStorage` under keys starting with `ytFinishBy:` (finish time, mode, max speed, catch-up time, safe window, buffer catch-up toggle, desired latency, panel position and state). Auto-set is never saved.

At the top of the script, `CONFIG` lets you tweak a few options:

- `showDebugButton` (default `false`): adds a **Copy debug info** button to the livestream controls that copies raw player readings (with no video ID, title, or URL) for bug reports.
- `useLiveLatency` (default `true`): reads real live latency from "Stats for nerds" and uses it for "Behind live by" and safe-window checks.
- `statsGraceSec` (default `5`): seconds to wait without a Stats for nerds reading while live before stopping a desired-latency catch-up.
- `bufferLowSec` (default `2.5`): buffer threshold in seconds at which buffer-mode catch-up stops to avoid causing a stall.

## Notes

- Stitched-in ad detection hooks `Array.prototype.push` to read YouTube's ad-timing data, the same technique used by SponsorBlock. It is wrapped so it can never break the page.
- The interface is built with DOM calls rather than `innerHTML`, because YouTube blocks the latter (Trusted Types).
- Because YouTube changes its player often, the live-stream readings in particular may need updates over time.

## License

CC0 1.0 Universal. To the extent possible under law, the authors have waived all copyright and related rights to this work.
