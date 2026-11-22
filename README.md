# YouTube Finish-By Speed Planner

A userscript that tells you how fast to play a YouTube video so you finish it by a clock time you choose. On livestreams it works out how to catch up to the live edge instead. An optional Auto-set mode applies the plan to the player for you.

Version 1.0.0 · License: CC0 1.0 (public domain) · By Arturopakastur & Claude

## Install

1. Install a userscript manager such as Tampermonkey or Violentmonkey.
2. Add `YouTube Finish-By Speed Planner-1.0.0.user.js` to it (open the file, or paste it into a new script).
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

On a live stream the panel switches to catch-up mode. The stream keeps growing while you watch, so catching up takes `gap ÷ (speed − 1)`.

- **Catch up within (optional)** takes a duration such as `10m`, `90s`, `1h 5m`, `5:30`, `1:30:00`, or a bare number (minutes). Leave it blank to catch up as fast as possible.
- **Safe window** (20–600 s, default 30) is how far behind still counts as "live".
- The panel shows how far behind you are, the speed needed, when you'll be caught up, and how much of the stream you watch meanwhile.

The script checks that the stream's live edge is really advancing before it shows a plan, so ended or stalled streams don't get a false catch-up plan.

## Auto-set speed

Tick **Auto-set speed** to have the script set the player speed for you, following the plan.

- It is **off by default**, and switches itself off whenever you open a different video or reload the page.
- It never plays slower than 1×.
- In Steady Pace it only speeds up (for example after a pause), never drifts back down. In Sprint Start it also drops to 1× when the sprint is done, and sprints again if you fall behind.
- On livestreams it watches quietly and starts catching up only if you fall further behind than the safe window. It stops and returns to 1× once the player reports you're live.
- If you change the speed yourself, Auto-set pauses and shows a **Resume** button.
- A small green dot on the ⏱ button shows that Auto-set is active.

## Settings

The panel's inputs are saved in the page's `localStorage` under keys starting with `ytFinishBy:` (finish time, mode, max speed, catch-up time, safe window, panel position and state). Auto-set is never saved.

At the top of the script, `CONFIG.showDebugButton` (default `false`) adds a **Copy debug info** button to the livestream controls. It copies raw player readings with no video ID, title or URL, which is handy for bug reports.

## Notes

- Stitched-in ad detection hooks `Array.prototype.push` to read YouTube's ad-timing data, the same technique used by SponsorBlock. It is wrapped so it can never break the page.
- The interface is built with DOM calls rather than `innerHTML`, because YouTube blocks the latter (Trusted Types).
- Because YouTube changes its player often, the live-stream readings in particular may need updates over time.

## License

CC0 1.0 Universal. To the extent possible under law, the authors have waived all copyright and related rights to this work.
