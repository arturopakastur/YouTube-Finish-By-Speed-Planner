// ==UserScript==
// @name         YouTube Finish-By Speed Planner
// @namespace    https://youtube.com/
// @version      1.0.0
// @license      CC0 1.0
// @description  Enter a clock time you want to finish the current video by (or, on a livestream you're behind on, a catch-up time). Shows the playback speed needed (Steady Pace) or a "max speed first, then 1x" plan (Sprint Start). Optional Auto-set mode applies the plan for you (off by default).
// @author       Arturopakastur & Claude
// @match        https://www.youtube.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   *  CONFIG – edit these values
   * ------------------------------------------------------------------ */
  const CONFIG = {
    // Show the "Copy debug info" button in the livestream controls (and mention it in warnings).
    // Set to false to hide it completely.
    showDebugButton: false,
  };

  /* ------------------------------------------------------------------ *
   *  Pure logic (no DOM) – kept together so it is easy to test
   * ------------------------------------------------------------------ */
  // <pure>
  const STEP = 0.05;      // YouTube's playback-speed increment
  const MIN_RATE = 0.25;  // YouTube's slowest speed
  const MAX_RATE = 4;     // YouTube's fastest speed

  const pad = (n) => String(n).padStart(2, '0');

  /** Round a speed onto YouTube's 0.05 grid. dir: 'up' | 'down' | 'nearest' */
  function toGrid(x, dir) {
    const n = x / STEP;
    const r = dir === 'up' ? Math.ceil(n - 1e-9)
            : dir === 'down' ? Math.floor(n + 1e-9)
            : Math.round(n);
    return +(r * STEP).toFixed(2);
  }
  const clampRate = (r, cap) => Math.min(cap, Math.max(MIN_RATE, r));

  /** "1h 02m 03s" / "4m 05s" / "12s" */
  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return `${h}h ${pad(m)}m ${pad(s)}s`;
    if (m) return `${m}m ${pad(s)}s`;
    return `${s}s`;
  }
  /** Video timestamp: "1:02:03" / "4:05" */
  function fmtVid(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }
  /** Clock time; includes the date only when it differs from refMs's date. */
  function fmtClock(ms, refMs) {
    const d = new Date(Math.round(ms / 1000) * 1000), r = new Date(refMs);
    const t = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    if (d.toDateString() === r.toDateString()) return t;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${t}`;
  }
  const fmtRate = (r) => r.toFixed(2) + '×';

  /**
   * Parse the finish-by box. Accepts:
   *   2026-11-20 15:34:30   2026-11-20T15:34   2026/11/20 3:34 PM
   *   15:34:30   15:34   3:34pm      (time only → today, or tomorrow if already passed)
   * Returns { ms, rolled } or { error }.
   */
  function parseTarget(str, nowMs) {
    const s = (str || '').trim();
    if (!s) return { error: 'Enter a finish time.' };
    const m = s.match(/^(?:(\d{4})[-/](\d{1,2})[-/](\d{1,2})[\sT]+)?(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*([ap])?\.?m?\.?$/i);
    if (!m) return { error: 'Format: YYYY-MM-DD HH:MM:SS (or just HH:MM:SS).' };
    let [, Y, Mo, D, hh, mm, ss, ap] = m;
    hh = +hh; mm = +mm; ss = ss === undefined ? 0 : +ss;
    if (ap) {
      if (hh < 1 || hh > 12) return { error: 'Hour must be 1–12 with AM/PM.' };
      hh = (hh % 12) + (ap.toLowerCase() === 'p' ? 12 : 0);
    }
    if (hh > 23 || mm > 59 || ss > 59) return { error: 'That time is not valid.' };

    const now = new Date(nowMs);
    let d;
    if (Y) {
      d = new Date(+Y, +Mo - 1, +D, hh, mm, ss);
      if (d.getMonth() !== +Mo - 1 || d.getDate() !== +D) return { error: 'That date is not valid.' };
      return { ms: d.getTime(), rolled: false };
    }
    d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, ss);
    let rolled = false;
    if (d.getTime() <= nowMs) { d.setDate(d.getDate() + 1); rolled = true; }
    return { ms: d.getTime(), rolled };
  }

  /**
   * R   = remaining video seconds (at 1x)
   * T   = seconds until the deadline
   * cap = highest speed you're willing to use (0.05 grid, 1.05–4)
   * Returns a plain description of the plan for the given mode.
   */
  function plan(mode, R, T, cap) {
    const exact = R / T;

    if (R / cap > T + 1) {                       // even at max speed you'd be more than a second late
      return { kind: 'impossible', exact, cap, lateBy: R / cap - T };
    }

    if (mode === 'steady') {
      const lo = clampRate(toGrid(exact, 'down'), cap); // on time or late
      let hi = clampRate(toGrid(exact, 'up'), cap);     // on time or early
      if (R / lo - T <= 1) hi = lo;                     // under a second late counts as on time
      const out = { kind: 'steady', exact, hi, hiEarly: T - R / hi };
      if (lo !== hi) { out.lo = lo; out.loLate = R / lo - T; }
      return out;
    }

    // mode === 'sprint' (Sprint Start): the fastest allowed speed FIRST, then 1x for the rest.
    // Going fast up front means a later pause can be made up by sprinting again, without
    // ever needing more than the max speed. Less than a second behind schedule counts as on time.
    if (R - T < 1) {
      return { kind: 'normal', exact, early: T - R };
    }
    // cap*tFast + 1*(T - tFast) = R   →   tFast = (R - T) / (cap - 1)
    const tFast = Math.min(T, (R - T) / (cap - 1));
    return { kind: 'sprint', exact, cap, tFast, tSlow: T - tFast };
  }

  /**
   * The speed Auto-set should use for a plan. Always on YouTube's 0.05 grid, never above
   * the max speed, and never below 1× (it never plays slower than normal speed).
   */
  function autoRate(p) {
    let r;
    if (p.kind === 'steady') r = p.hi;                    // rounded UP → on time or early
    else if (p.kind === 'normal') r = 1;
    else if (p.kind === 'sprint') r = p.cap;              // sprint phase: max speed (the 1× part comes back as 'normal')
    else r = p.cap;                                       // impossible → best effort at the cap
    return +Math.min(MAX_RATE, Math.max(1, toGrid(r, 'nearest'))).toFixed(2);
  }
  /** Hold the speed: it may only go up (e.g. after a pause), never drift back down.
   *  allowDown is for Sprint Start, where dropping from the max speed to 1× is part of the plan. */
  function nextHeld(held, desired, canCommit, allowDown = false) {
    if (!canCommit) return held;
    return held === null || allowDown || desired > held + 1e-9 ? desired : held;
  }

  /** "10m", "1h 5m", "90s", "1h30m15s", "5:30" (m:ss), "1:05:30" (h:mm:ss), "10" (= minutes). */
  function parseDuration(str) {
    const s = (str || '').trim().toLowerCase();
    if (!s) return { value: null };
    let m = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
    let value;
    if (m) {
      value = m[3] === undefined ? +m[1] * 60 + +m[2] : +m[1] * 3600 + +m[2] * 60 + +m[3];
    } else if (/^\d+(\.\d+)?$/.test(s)) {
      value = parseFloat(s) * 60;
    } else {
      const compact = s.replace(/\s+/g, '');
      const unit = '(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)';
      if (!new RegExp(`^(?:\\d+(?:\\.\\d+)?${unit})+$`).test(compact)) {
        return { error: 'Try 10m, 90s, 1h 5m or 5:30.' };
      }
      value = 0;
      for (const [, n, u] of compact.matchAll(new RegExp(`(\\d+(?:\\.\\d+)?)(${unit})`, 'g'))) {
        value += parseFloat(n) * ({ h: 3600, m: 60, s: 1 }[u[0]]);
      }
    }
    return value > 0 ? { value } : { error: 'Must be longer than zero.' };
  }

  /**
   * Catching up to a livestream. The stream keeps growing while you watch, so at speed s the
   * gap L closes at (s − 1) seconds per second:  time = L / (s − 1),  stream watched = s × time.
   *   L         seconds behind the live edge
   *   cap       max speed
   *   threshold at or below this you count as "at live" (the safe window)
   *   D         wanted catch-up time in seconds, or null for "as fast as possible"
   */
  function planCatchUp(L, cap, threshold, D) {
    if (L <= threshold) return { kind: 'atlive', L };
    const tMin = L / (cap - 1);
    const base = { L, tMin, cap };
    if (D === null) return { ...base, kind: 'max', speed: cap, t: tMin };
    const exact = D > 0 ? 1 + L / D : Infinity;
    if (D <= 0 || tMin > D + 1) return { ...base, kind: 'tooFast', exact, speed: cap, t: tMin };   // > 1 s late even at max
    const lo = toGrid(exact, 'down');                              // 1.00 would never catch up
    let hi = Math.min(cap, Math.max(1.05, toGrid(exact, 'up')));   // arrives on time or early
    if (lo > 1 && L / (lo - 1) - D <= 1) hi = lo;                  // under a second late counts as on time
    return { ...base, kind: 'speed', exact, speed: hi, t: L / (hi - 1) };
  }

  /**
   * Is the live edge really advancing? samples = [{ t: ms, h: liveHeadSeconds }].
   *   true       it grew at ≥ 0.5 s per second (a real live stream grows ~1 s/s)
   *   false      ≥ 12 s of samples and it did not (ended, stalled or frozen)
   *   undefined  not enough data yet. Some sources update in steps every few seconds, so a short
   *              flat spell must not be mistaken for "frozen".
   */
  function growthState(samples) {
    if (samples.length < 2) return undefined;
    const a = samples[0], b = samples[samples.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt < 3) return undefined;
    if ((b.h - a.h) / dt >= 0.5) return true;
    return dt >= 12 ? false : undefined;
  }

  /**
   * Once a source has been seen advancing, don't let one flat spell flip it to "frozen": keep trusting it
   * for graceMs after the last time it was seen advancing.
   */
  function effectiveGrowth(raw, lastTrueAt, now, graceMs = 20000) {
    if (raw === true) return true;
    return lastTrueAt != null && now - lastTrueAt < graceMs ? true : raw;
  }

  /**
   * Smooth estimate of the live edge right now. YouTube moves the edge in chunks (a new segment every few
   * seconds) while your position advances smoothly, so raw "edge − position" saw-tooths: it falls at the full
   * playback speed, then jumps back up. The real edge advances 1 s per second, so take the highest
   * (edge − clock) offset seen recently – the moment the edge was freshest – and run it forward in real time.
   * samples = [{ t: ms, h: edgeSeconds }]. Never below the latest raw reading.
   */
  function smoothHead(samples, nowMs) {
    if (!samples.length) return NaN;
    let off = -Infinity;
    for (const x of samples) off = Math.max(off, x.h - x.t / 1000);
    return off + nowMs / 1000;
  }
  // </pure>

  /* ------------------------------------------------------------------ *
   *  Server-side (stitched-in) ad detection – same technique as
   *  maze-utils/SponsorBlock: YouTube pushes an object with
   *  namespace 'ssap' and a `start` offset (ms) into an array.
   * ------------------------------------------------------------------ */
  const currentVid = () => new URLSearchParams(location.search).get('v');
  const ssap = { vid: null, sec: 0 };
  try {
    if (!window.__ytfbPushHook) {
      window.__ytfbPushHook = true;
      Array.prototype.push = new Proxy(Array.prototype.push, {
        apply(target, thisArg, args) {
          try {
            const a = args[0];
            if (a && a !== window && typeof a.start === 'number' && a.end
                && a.namespace === 'ssap' && a.id && a.start !== 0) {
              ssap.vid = currentVid();
              ssap.sec = a.start / 1000;
            }
          } catch { /* never break the page */ }
          return Reflect.apply(target, thisArg, args);
        },
      });
    }
  } catch { /* ignore */ }
  /** Seconds of stitched-in ad time for the current video (0 if none seen). */
  const adOffset = () => (ssap.vid && ssap.vid === currentVid() ? ssap.sec : 0);

  /* ------------------------------------------------------------------ *
   *  Persistent settings (page localStorage, namespaced)
   * ------------------------------------------------------------------ */
  const LS = 'ytFinishBy:';
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem(LS + k); return v === null ? d : JSON.parse(v); }
      catch { return d; }
    },
    set(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };
  const state = {
    target: store.get('target', ''),
    mode: store.get('mode', 'steady'),
    cap: store.get('cap', MAX_RATE),
    collapsed: store.get('collapsed', false),
    // Closed unless you have explicitly opened it before: only a saved value of exactly `false` opens it.
    // No saved value (first run) – or anything unreadable – means closed.
    hidden: store.get('hidden', true) !== false,
    catchBy: store.get('catchBy', ''),
    safeWin: (() => { const v = Number(store.get('safeWin', 30)); return isFinite(v) && v >= 0 ? v : 30; })(),
    pos: store.get('pos', null),
  };

  // Auto-set runtime state. Deliberately NOT persisted: it always starts off on a page load,
  // so a stale deadline can never speed up a different video.
  const auto = {
    on: false, vid: undefined, key: '', held: null, debounceUntil: 0,
    overridden: false, applied: false, resetOnPlay: false, liveSince: null,
    lastWriteAt: 0, lastAdAt: 0, graceUntil: 0,
    // livestream catch-up
    catching: false, deadline: null, floor: null, prog: null, liveNote: null,
  };
  // lastTrue: when each source was last seen advancing. lastGoodAt: when we last rendered a verified live reading.
  // lastLiveAt: when the player itself last reported live (the flag can blink; see update()).
  const liveTrack = { vid: null, samples: {}, state: {}, lastTrue: {}, lastGoodAt: 0, lastLiveAt: 0 };

  /* ------------------------------------------------------------------ *
   *  Finding things on the page (approach borrowed from SponsorBlock)
   * ------------------------------------------------------------------ */
  function getVideo() {
    const list = document.querySelectorAll('#movie_player video, video.html5-main-video');
    for (const v of list) {
      if (v.closest('ytd-video-preview, #inline-preview-player')) continue; // hover previews
      if (v.offsetHeight && v.duration) return v;
    }
    return null;
  }
  const isAdPlaying = () => document.getElementsByClassName('ad-showing').length > 0;
  /**
   * 'live' | 'postlive' | 'vod'.
   * A stream that has ENDED but is still served "manifestless" (post-live) reports isLive = false,
   * so it never counts as live. The ytp-live-badge fallback is hidden on ended streams too.
   */
  function liveKind(video) {
    let data = null;
    try { data = document.getElementById('movie_player')?.getVideoData?.() || null; } catch { /* no player API */ }
    if (data) {
      if (data.isLive && !data.isPostLiveDvr) return 'live';
      if (data.isPostLiveDvr || data.isManifestless) return 'postlive';
      return 'vod';
    }
    // Fallback (same signal SponsorBlock uses). The miniplayer leaves a hidden stale copy of the badge,
    // so look at all of them rather than just the first.
    return [...document.querySelectorAll('.ytp-live-badge')].some((b) => b.offsetHeight) ? 'live' : 'vod';
  }

  /**
   * Candidate live-stream positions, best first. Each is { name, head, pos, start }: the live edge,
   * your position, and the earliest rewindable point (null if unknown), all on ONE clock.
   *  1. player progress state – YouTube's own seekableEnd / seekableStart / current (what its UI uses)
   *  2. video.seekable         – the media element's live seekable range
   * getDuration() is deliberately NOT used: for a live event it counts from when the stream began, which can
   * include time you can't rewind to (an hour off on some streams) and it needn't share a clock with your
   * position. A wrong "behind live" is worse than none, so with neither source above we show nothing.
   */
  function liveSources(video) {
    const out = [];
    const ok = (head, pos) => isFinite(head) && head > 0 && isFinite(pos) && pos >= 0 && head >= pos - 2;
    const pl = document.getElementById('movie_player');
    try {
      const ps = pl?.getProgressState?.();
      if (ps && ok(ps.seekableEnd, ps.current)) {
        out.push({ name: 'player progress', head: ps.seekableEnd, pos: ps.current,
          start: isFinite(ps.seekableStart) ? ps.seekableStart : null,
          atHead: typeof ps.isAtLiveHead === 'boolean' ? ps.isAtLiveHead : null });
      }
    } catch { /* ignore */ }
    try {
      const sk = video.seekable;
      if (sk && sk.length) {
        const head = sk.end(sk.length - 1), pos = video.currentTime;
        if (ok(head, pos)) out.push({ name: 'video.seekable', head, pos, start: sk.start(0), atHead: null });
      }
    } catch { /* ignore */ }
    return out;
  }
  /** Track each source's live edge over time. Returns { sourceName: true | false | undefined } (latched). */
  function trackGrowth(vid, sources, now) {
    if (liveTrack.vid !== vid) { liveTrack.vid = vid; liveTrack.samples = {}; liveTrack.lastTrue = {}; liveTrack.lastGoodAt = 0; liveTrack.lastLiveAt = 0; }
    const state = {};
    for (const src of sources) {
      const arr = (liveTrack.samples[src.name] ||= []);
      arr.push({ t: now, h: src.head });
      while (arr.length > 2 && now - arr[0].t > 30000) arr.shift();
      const recent = arr.filter((x) => now - x.t <= 15000);
      const raw = growthState(recent.length >= 2 ? recent : arr.slice(-2));
      if (raw === true) liveTrack.lastTrue[src.name] = now;
      state[src.name] = effectiveGrowth(raw, liveTrack.lastTrue[src.name], now);
    }
    liveTrack.state = state;
    return state;
  }

  /** Everything a bug report needs, with no video id / title / URL in it. */
  function debugInfo(video) {
    const pl = document.getElementById('movie_player');
    const safe = (fn) => { try { return fn(); } catch (e) { return 'ERR ' + e.message; } };
    const flags = {};
    safe(() => {
      for (const [k, v] of Object.entries(pl.getVideoData() || {})) {
        if (typeof v === 'boolean' || typeof v === 'number' || k === 'latencyClass') flags[k] = v;
      }
    });
    const ps = safe(() => pl.getProgressState());
    const sk = safe(() => Array.from({ length: video.seekable.length }, (_, i) => [video.seekable.start(i), video.seekable.end(i)]));
    const txt = (sel) => safe(() => [...document.querySelectorAll(sel)].map((n) => n.textContent.trim()));
    return JSON.stringify({
      script: '1.0.0',
      videoData: flags,
      progressState: ps && typeof ps === 'object' ? ps : String(ps),
      player: { getDuration: safe(() => pl.getDuration()), getCurrentTime: safe(() => pl.getCurrentTime()) },
      video: { currentTime: video.currentTime, duration: String(video.duration), paused: video.paused, rate: video.playbackRate, seekable: sk },
      ui: { timeCurrent: txt('.ytp-time-current'), timeDuration: txt('.ytp-time-duration'),
        liveBadges: safe(() => [...document.querySelectorAll('.ytp-live-badge')].map((n) => ({ visible: !!n.offsetHeight, disabled: n.hasAttribute('disabled') }))) },
      growth: liveTrack.state,
      samples: Object.fromEntries(Object.entries(liveTrack.samples).map(([k, v]) => [k, v.slice(-3).map((x) => [Math.round(x.t / 1000), x.h])])),
    }, null, 2);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
    try {
      const ta = h('textarea', { style: 'position:fixed;left:-9999px' });
      ta.value = text; document.body.append(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch { return false; }
  }

  /* ------------------------------------------------------------------ *
   *  UI (built with DOM calls – YouTube blocks innerHTML via Trusted Types)
   * ------------------------------------------------------------------ */
  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const kid of kids) if (kid != null) el.append(kid);
    return el;
  }

  const css = `
#ytfb{position:fixed;top:70px;right:16px;width:340px;max-height:calc(100vh - 90px);overflow:auto;z-index:2147483000;
 background:rgba(18,18,22,.95);color:#eee;border:1px solid #444;border-radius:10px;
 font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.5)}
#ytfb *{box-sizing:border-box}
#ytfb .hd{display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:move;user-select:none;border-bottom:1px solid #333}
#ytfb .hd b{font-size:13px}
#ytfb .hd .badge{margin-left:auto;font-weight:600;color:#7fd1ff;white-space:nowrap}
#ytfb .hd button{background:none;border:0;color:#aaa;font-size:16px;cursor:pointer;padding:0 4px;line-height:1}
#ytfb .bd{padding:10px}
#ytfb.col .bd{display:none}
#ytfb.col .hd{border-bottom:0}
#ytfb label{display:block;color:#aaa;font-size:11px;margin:8px 0 3px}
#ytfb input{width:100%;background:#0c0c0f;color:#fff;border:1px solid #555;border-radius:6px;padding:6px 8px;font:13px ui-monospace,Consolas,monospace}
#ytfb input:focus{outline:none;border-color:#7fd1ff}
#ytfb .hint{color:#8a8;font-size:11px;min-height:15px;margin-top:3px}
#ytfb .hint.err{color:#f88}
#ytfb .two{display:flex;gap:8px}
#ytfb .two>div{flex:1}
#ytfb .stats{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:10px 0;padding:8px;background:#111;border-radius:6px}
#ytfb .stats span:nth-child(odd){color:#999}
#ytfb .stats span:nth-child(even){text-align:right;font-variant-numeric:tabular-nums}
#ytfb .tabs{display:flex;gap:4px;margin-bottom:8px}
#ytfb .tabs button{flex:1;padding:6px 4px;background:#26262c;color:#ccc;border:1px solid #444;border-radius:6px;cursor:pointer;font:600 12px system-ui}
#ytfb .tabs button.on{background:#1b5e8c;color:#fff;border-color:#4aa8e0}
#ytfb .desc{color:#999;font-size:11px;margin-bottom:8px}
#ytfb .big{font-size:26px;font-weight:700;color:#7fd1ff;line-height:1.1}
#ytfb .big.bad{color:#ff8a80}
#ytfb .sub{color:#bbb;margin-bottom:6px}
#ytfb .row{display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-top:1px solid #2a2a30}
#ytfb .row span:first-child{color:#999;flex:none}
#ytfb .row span:last-child{text-align:right;font-variant-numeric:tabular-nums}
#ytfb .warn{color:#ffd27f;padding:6px 0}
#ytfb-btn{position:relative;background:transparent;border:0;padding:0;margin:0 6px 0 0;cursor:pointer;align-self:center;flex:none;
 display:inline-flex;align-items:center;color:var(--yt-spec-text-primary,#fff);opacity:.75;transition:opacity .2s,color .2s}
#ytfb-btn:hover{opacity:1}
#ytfb-btn.on{color:#4aa8e0;opacity:1}
#ytfb-btn.auto::after{content:'';position:absolute;right:-3px;top:-3px;width:7px;height:7px;border-radius:50%;background:#4cd964}
#ytfb-btn svg{width:20px;height:20px;fill:currentColor;display:block}
#ytfb-btn.float{position:fixed;bottom:16px;right:16px;z-index:2147483000;padding:8px;margin:0;border-radius:50%;
 background:rgba(18,18,22,.92);color:#fff;border:1px solid #444}
#ytfb label.autorow{display:flex;align-items:center;gap:7px;color:#eee;font-size:12px;margin:12px 0 2px;cursor:pointer}
#ytfb input[type=checkbox]{width:auto;margin:0;accent-color:#4aa8e0;cursor:pointer}
#ytfb .autoline{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px}
#ytfb .autostat{color:#8fd18f;font-size:11px;min-height:15px}
#ytfb .autostat.warn{color:#ffd27f}
#ytfb .autoline button{background:#26262c;color:#fff;border:1px solid #555;border-radius:5px;padding:2px 8px;cursor:pointer;font-size:11px;flex:none}
#ytfb .dbgbtn{margin-top:6px;background:#26262c;color:#bbb;border:1px solid #444;border-radius:5px;padding:2px 8px;cursor:pointer;font-size:11px}
#ytfb input[type=number]{font-family:ui-monospace,Consolas,monospace}
#ytfb .sys{color:#999;font-size:11px;text-align:right;font-variant-numeric:tabular-nums}
`;

  const el = {};
  const DEBUG_HINT = CONFIG.showDebugButton ? ' “Copy debug info” shows the raw readings.' : '';
  function buildPanel() {
    document.head.append(h('style', { id: 'ytfb-style', text: css }));

    el.badge = h('span', { class: 'badge' });
    el.toggle = h('button', { title: 'Collapse / expand', text: '–', onclick: () => setCollapsed(!state.collapsed) });
    el.close = h('button', { title: 'Hide (reopen with the ⏱ button next to the title)', text: '✕', onclick: () => setHidden(true) });
    el.header = h('div', { class: 'hd' }, h('b', { text: '⏱ Finish-By' }), el.badge, el.toggle, el.close);

    el.sys = h('div', { class: 'sys' });
    el.target = h('input', {
      type: 'text', autocomplete: 'off', spellcheck: 'false',
      placeholder: 'YYYY-MM-DD HH:MM:SS  or  HH:MM:SS',
    });
    el.target.value = state.target;
    el.target.addEventListener('input', () => { state.target = el.target.value; store.set('target', state.target); update(); });
    el.hint = h('div', { class: 'hint' });

    el.cap = h('input', { type: 'number', min: '1.05', max: '4', step: '0.05' });
    el.cap.value = Number(state.cap).toFixed(2);
    el.cap.addEventListener('input', () => {
      const v = parseFloat(el.cap.value);
      if (isFinite(v) && v >= 1.05 && v <= MAX_RATE) { state.cap = toGrid(v, 'down'); store.set('cap', state.cap); update(); }
    });
    el.cap.addEventListener('change', () => { el.cap.value = Number(state.cap).toFixed(2); });

    el.stats = h('div', { class: 'stats' });
    el.tabSteady = h('button', { text: 'Steady Pace', onclick: () => setMode('steady') });
    el.tabSprint = h('button', { text: 'Sprint Start', onclick: () => setMode('sprint') });
    el.desc = h('div', { class: 'desc' });
    el.result = h('div');
    el.autoToggle = h('input', { type: 'checkbox' });
    el.autoToggle.addEventListener('change', () => {
      auto.on = el.autoToggle.checked; auto.overridden = false; auto.catching = false; resetAutoPlan();
      update();
    });
    el.autoStatus = h('div', { class: 'autostat' });
    el.autoResume = h('button', { type: 'button', text: 'Resume', onclick: () => { auto.overridden = false; auto.catching = false; resetAutoPlan(); update(); } });
    el.autoResume.style.display = 'none';

    // Livestream controls (shown instead of the finish-by box / mode tabs when you're on a live stream)
    el.catchBy = h('input', {
      type: 'text', autocomplete: 'off', spellcheck: 'false',
      placeholder: 'e.g. 10m, 90s, 1:30:00  (blank = fastest)',
    });
    el.catchBy.value = state.catchBy;
    el.catchBy.addEventListener('input', () => { state.catchBy = el.catchBy.value; store.set('catchBy', state.catchBy); update(); });
    el.catchHint = h('div', { class: 'hint' });
    el.win = h('input', { type: 'number', min: '0', step: 'any' });
    el.win.value = state.safeWin;
    el.win.addEventListener('input', () => {
      const v = parseFloat(el.win.value);
      if (isFinite(v) && v >= 0) { state.safeWin = v; store.set('safeWin', state.safeWin); update(); }
    });
    el.win.addEventListener('change', () => { el.win.value = state.safeWin; });

    el.vodBox = h('div', {}, h('label', { text: 'Finish this video by (your local time)' }), el.target, el.hint);
    el.dbg = null;                                         // (h() skips null children)
    if (CONFIG.showDebugButton) {
      el.dbg = h('button', { type: 'button', class: 'dbgbtn', text: 'Copy debug info', title: 'Copies raw player readings (no video id or title) – handy if the numbers look wrong' });
      el.dbg.addEventListener('click', async () => {
        const v = getVideo();
        const ok = v && await copyText(debugInfo(v));
        el.dbg.textContent = ok ? 'Copied ✓' : 'Copy failed';
        setTimeout(() => { el.dbg.textContent = 'Copy debug info'; }, 2000);
      });
    }
    el.liveBox = h('div', {},
      h('label', { text: 'Catch up within (optional)' }), el.catchBy, el.catchHint,
      h('label', { text: 'Safe window – seconds behind that still count as “live”' }), el.win,
      h('div', { class: 'desc', text: 'The stream keeps growing while you watch, so catching up takes gap ÷ (speed − 1).' }),
      el.dbg);
    el.liveBox.style.display = 'none';
    el.tabsBox = h('div', {}, h('div', { class: 'tabs' }, el.tabSteady, el.tabSprint), el.desc);

    el.body = h('div', { class: 'bd' },
      el.sys,
      el.vodBox, el.liveBox,
      h('div', { class: 'two' }, h('div', {}, h('label', { text: 'Max speed (1.05 – 4.00)' }), el.cap)),
      el.stats,
      el.tabsBox,
      el.result,
      h('label', { class: 'autorow', title: 'Sets the video speed for you, following the plan above. Only ever speeds up (never below 1×).' },
        el.autoToggle, h('span', { text: 'Auto-set speed' })),
      h('div', { class: 'autoline' }, el.autoStatus, el.autoResume),
    );

    el.panel = h('div', { id: 'ytfb' }, el.header, el.body);
    if (state.hidden) el.panel.style.display = 'none';     // never paint it open before the saved state is applied
    // Keep YouTube's hotkeys / click-to-pause away from our panel
    for (const t of ['keydown', 'keyup', 'keypress', 'click', 'dblclick']) {
      el.panel.addEventListener(t, (e) => e.stopPropagation());
    }
    document.body.append(el.panel);

    // The on-page open/close button (placed next to the DeArrow buttons by ensureButton)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42C16.07 4.74 14.12 4 12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z');
    svg.append(path);
    el.pageBtn = h('button', { id: 'ytfb-btn', type: 'button', title: 'Finish-By speed planner' }, svg);
    el.pageBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); setHidden(!state.hidden); });

    setupDrag();
    setCollapsed(state.collapsed);
    el.pageBtn.classList.toggle('on', !state.hidden);
    setMode(state.mode);
    applyPos();

    // Stay visible in fullscreen (only the fullscreen element is rendered)
    document.addEventListener('fullscreenchange', () => {
      (document.fullscreenElement || document.body).append(el.panel);
    });
    window.addEventListener('resize', applyPos);
  }

  function setCollapsed(c) {
    state.collapsed = c; store.set('collapsed', c);
    el.panel.classList.toggle('col', c);
    el.toggle.textContent = c ? '+' : '–';
  }
  function setModeUI(isLiveStream) {
    el.vodBox.style.display = isLiveStream ? 'none' : '';
    el.tabsBox.style.display = isLiveStream ? 'none' : '';
    el.liveBox.style.display = isLiveStream ? '' : 'none';
  }
  function setHidden(hid) {
    state.hidden = hid; store.set('hidden', hid);
    el.pageBtn.classList.toggle('on', !hid);
    update();
  }
  let missingTicks = 0;
  /** Keep the page button at the front of DeArrow's title-button container (re-run every tick,
   *  because YouTube/DeArrow rebuild that area on navigation). Falls back to the title row,
   *  then to a floating corner button so the panel can always be reopened. */
  function ensureButton(onWatch) {
    const btn = el.pageBtn;
    if (!onWatch) { btn.remove(); missingTicks = 0; return; }

    const dearrow = document.querySelector('.cbTitleButtonContainer');
    if (dearrow) {
      missingTicks = 0;
      btn.classList.remove('float');
      if (dearrow.firstChild !== btn) dearrow.insertBefore(btn, dearrow.firstChild);
      return;
    }
    const titleRow = document.querySelector('ytd-watch-metadata #title, #title h1')?.closest('#title');
    if (titleRow) {
      missingTicks = 0;
      btn.classList.remove('float');
      if (btn.parentElement !== titleRow) {
        titleRow.append(btn);
        titleRow.style.setProperty('display', 'flex', 'important');
        titleRow.style.justifyContent = 'space-between';
        titleRow.style.alignItems = 'flex-start';
      }
      return;
    }
    if (++missingTicks > 6 && !(btn.classList.contains('float') && btn.isConnected)) {
      btn.classList.add('float');
      document.body.append(btn);
    }
  }

  function setMode(m) {
    state.mode = m; store.set('mode', m);
    el.tabSteady.classList.toggle('on', m === 'steady');
    el.tabSprint.classList.toggle('on', m === 'sprint');
    el.desc.textContent = m === 'steady'
      ? 'One constant speed from now until the end.'
      : 'Your max speed first, then 1× to the finish. If you pause, it sprints again to make up the time.';
    update();
  }

  function applyPos() {
    if (!state.pos) return;
    const w = el.panel.offsetWidth || 340, hgt = el.panel.offsetHeight || 40;
    const x = Math.min(Math.max(0, state.pos.x), Math.max(0, window.innerWidth - w));
    const y = Math.min(Math.max(0, state.pos.y), Math.max(0, window.innerHeight - hgt));
    el.panel.style.left = x + 'px'; el.panel.style.top = y + 'px'; el.panel.style.right = 'auto';
  }
  function setupDrag() {
    let drag = null;
    el.header.addEventListener('pointerdown', (e) => {
      if (e.target === el.toggle || e.target === el.close) return;
      const r = el.panel.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      el.header.setPointerCapture(e.pointerId);
    });
    el.header.addEventListener('pointermove', (e) => {
      if (!drag) return;
      state.pos = { x: e.clientX - drag.dx, y: e.clientY - drag.dy };
      applyPos();
    });
    el.header.addEventListener('pointerup', () => { if (drag) { drag = null; store.set('pos', state.pos); } });
  }

  /* ------------------------------------------------------------------ *
   *  Rendering
   * ------------------------------------------------------------------ */
  const row = (a, b) => h('div', { class: 'row' }, h('span', { text: a }), h('span', { text: b }));
  const setStats = (pairs) => {
    el.stats.replaceChildren(...pairs.flatMap(([a, b]) => [h('span', { text: a }), h('span', { text: b })]));
  };
  const showWarn = (msg, badge = '') => {
    el.result.replaceChildren(h('div', { class: 'warn', text: msg }));
    el.badge.textContent = badge;
    if (!auto.on) setAutoStatus('');
    else if (auto.overridden) setAutoStatus(PAUSED_MSG, true);
    else setAutoStatus('Auto-set: waiting…');
  };
  const earlyLate = (early) => (Math.abs(early) < 1 ? 'on time' : early > 0 ? `${fmtDur(early)} early` : `${fmtDur(-early)} late`);

  /* ------------------------------------------------------------------ *
   *  Auto-set speed. Modelled on the Speeder extension: it writes
   *  video.playbackRate directly, and resets to 1× when the video changes.
   *  Unlike Speeder it re-asserts the speed if YouTube resets it, but backs
   *  off ("paused") if it sees you change the speed yourself.
   * ------------------------------------------------------------------ */
  const hooked = new WeakSet();
  function hookVideo(video) {
    if (hooked.has(video)) return;
    hooked.add(video);
    video.addEventListener('ratechange', () => {
      if (!auto.on || auto.overridden || auto.held === null) return;
      const now = Date.now();
      if (Math.abs(video.playbackRate - auto.held) < 0.001) return;               // our own write
      if (isAdPlaying() || now < auto.graceUntil || now - auto.lastAdAt < 2500    // YouTube housekeeping
          || now - auto.lastWriteAt < 1000) return;
      auto.overridden = true;                                                      // you changed it
      update();
    });
    video.addEventListener('loadstart', () => { auto.graceUntil = Date.now() + 3000; });
    video.addEventListener('play', () => {
      if (auto.resetOnPlay) { auto.resetOnPlay = false; video.playbackRate = 1; }  // like Speeder
    });
  }

  /** Forget the held speed and any catch-up anchors, so the next tick plans from scratch. */
  function resetAutoPlan() { auto.held = null; auto.deadline = null; auto.floor = null; auto.prog = null; auto.liveNote = null; auto.liveSince = null; }

  function onVideoChange() {
    const wasApplied = auto.applied;
    auto.on = false; auto.overridden = false; auto.catching = false; auto.applied = false; resetAutoPlan();
    liveTrack.vid = null; liveTrack.samples = {}; liveTrack.state = {}; liveTrack.lastTrue = {}; liveTrack.lastGoodAt = 0; liveTrack.lastLiveAt = 0;
    auto.resetOnPlay = wasApplied;
    if (el.autoToggle) el.autoToggle.checked = false;
    const v = getVideo();
    if (wasApplied && v) v.playbackRate = 1;
  }

  function setAutoStatus(text, warn = false) {
    el.autoStatus.textContent = text;
    el.autoStatus.classList.toggle('warn', warn);
    el.autoResume.style.display = auto.on && auto.overridden ? '' : 'none';
  }
  const PAUSED_MSG = 'Paused – you changed the speed yourself.';

  function runAuto(video, p, now) {
    if (!auto.on) return setAutoStatus('');
    if (auto.overridden) return setAutoStatus(PAUSED_MSG, true);

    auto.held = nextHeld(auto.held, autoRate(p), now >= auto.debounceUntil, state.mode === 'sprint');
    if (auto.held === null) return setAutoStatus('Auto-set: applying…');

    if (Math.abs(video.playbackRate - auto.held) > 0.001) {
      auto.lastWriteAt = now; auto.applied = true;
      video.playbackRate = auto.held;
    }

    if (p.kind === 'impossible') {
      setAutoStatus(`Auto-set: best effort at ${fmtRate(auto.held)} (deadline out of reach)`, true);
    } else if (p.kind === 'sprint') {
      setAutoStatus(`Auto-set: ${fmtRate(p.cap)} now, switching to 1.00× at ${fmtClock(now + p.tFast * 1000, now)}`);
    } else if ((p.kind === 'normal' || (p.kind === 'steady' && p.hi < 1)) && auto.held <= 1) {
      setAutoStatus('Auto-set: holding 1.00× (no speed-up needed)');
    } else {
      setAutoStatus(`Auto-set: holding ${fmtRate(auto.held)}`);
    }
  }

  /* ------------------------------------------------------------------ *
   *  Livestream catch-up
   * ------------------------------------------------------------------ */
  function finishCatch(video, now, note) {
    auto.catching = false; auto.held = null; auto.deadline = null; auto.prog = null;
    auto.liveNote = note;
    if (auto.applied && video.playbackRate > 1.0001) { auto.lastWriteAt = now; video.playbackRate = 1; }
  }

  /**
   * Engage once you're further behind than the safe window (and the player doesn't say you're live);
   * then keep catching up until the PLAYER says you're live. If it doesn't report that, fall back to
   * "within half the safe window". After that the safe window applies again before re-triggering.
   */
  function liveAutoState(video, L, now, atHead) {
    if (!auto.on || auto.overridden) { auto.catching = false; return; }
    const W = state.safeWin;
    if (!auto.catching) {
      const engageAt = Math.max(W, auto.floor === null ? 0 : auto.floor + 10);
      if (atHead !== true && L > engageAt) { auto.catching = true; resetAutoPlan(); }
      return;
    }
    let caught;
    if (atHead === null) caught = L <= Math.max(10, W / 2);
    else {
      // "live" must hold for two consecutive ticks, so a one-tick flicker of the flag can't end the catch-up
      // early. (Kept short: at max speed every extra second pushes you further onto the live edge.)
      if (atHead) { if (auto.liveSince === null) auto.liveSince = now; } else auto.liveSince = null;
      caught = auto.liveSince !== null && now - auto.liveSince >= 400;
    }
    if (caught) return finishCatch(video, now, 'Auto-set: live – back to 1×');

    // Safety net: if the gap stops shrinking (you're already at the stream's real live edge), give up
    // instead of sitting at max speed forever.
    if (video.paused) { auto.prog = null; return; }
    if (!auto.prog) { auto.prog = { t: now, L }; return; }
    if (now - auto.prog.t >= 20000) {
      const expected = Math.max(0, (video.playbackRate - 1) * 20 * 0.3);
      if (auto.prog.L - L < expected) {
        const floorL = L;
        finishCatch(video, now, `Auto-set: at the stream's live edge (~${fmtDur(L)} behind) – back to 1×`);
        auto.floor = floorL;
      } else auto.prog = { t: now, L };
    }
  }

  function runAutoLive(video, lp, L, now) {
    if (!auto.on) return setAutoStatus('');
    if (auto.overridden) return setAutoStatus(PAUSED_MSG, true);
    if (!auto.catching) {
      return setAutoStatus(auto.liveNote || `Auto-set: watching – speeds up if you fall more than ${state.safeWin}s behind`);
    }
    const desired = lp.kind === 'speed' ? lp.speed : state.cap;
    auto.held = nextHeld(auto.held, desired, now >= auto.debounceUntil);
    if (auto.held === null) return setAutoStatus('Auto-set: applying…');
    if (Math.abs(video.playbackRate - auto.held) > 0.001) {
      auto.lastWriteAt = now; auto.applied = true;
      video.playbackRate = auto.held;
    }
    const left = L / Math.max(0.05, auto.held - 1);
    setAutoStatus(`Auto-set: catching up at ${fmtRate(auto.held)} – about ${fmtDur(left)} left${lp.kind === 'tooFast' ? ' (best effort)' : ''}`,
      lp.kind === 'tooFast');
  }

  function updateLive(video, now) {
    const sources = liveSources(video);
    // A reading that blips out for a moment right after a verified one must not flash a warning.
    const quietBlip = now - liveTrack.lastGoodAt < 10000;
    if (!sources.length) {
      if (quietBlip) return;
      setStats([['Live stream', 'no position yet']]);
      return showWarn('Can’t read a live position from the player (yet).' + DEBUG_HINT, 'live?');
    }
    const g = trackGrowth(auto.vid, sources, now);

    // Use the first source (best first) whose live edge is really advancing. If a better source is still
    // undecided, wait for it rather than flip between sources with different clocks.
    let best = null, undecided = false;
    for (const sr of sources) {
      if (g[sr.name] === true) { best = sr; break; }
      if (g[sr.name] === undefined) { undecided = true; break; }
    }
    const src = best || sources[0];
    const smooth = smoothHead(liveTrack.samples[src.name] || [], now);
    const edge = isFinite(smooth) ? smooth : src.head;          // continuous, so the numbers below don't saw-tooth
    const L = Math.max(0, edge - src.pos), W = state.safeWin, cap = state.cap;
    const win = src.start !== null ? src.head - src.start : null;

    setStats([
      ['Stream start (vs live)', win !== null ? `−${fmtVid(win)}` : 'unknown'],
      ['Behind live by', fmtDur(L)],
      ['Current speed', fmtRate(video.playbackRate || 1)],
      ['Safe window', `${W}s`],
      ...(src.atHead !== null ? [['Player says at live', src.atHead ? 'yes' : 'no']] : []),
      ['Position source', best ? best.name : '…'],
    ]);

    // Second guard against false positives: the stream's edge must really be advancing in real time.
    if (!best) {
      if (quietBlip) return;
      if (undecided) return showWarn('Checking that the stream is really live…', 'live?');
      return showWarn('Flagged as live, but no position source is advancing (ended or stalled) – no catch-up plan.' + DEBUG_HINT, 'not live');
    }

    liveTrack.lastGoodAt = now;
    const pd = parseDuration(state.catchBy);
    el.catchHint.textContent = pd.error ? pd.error : pd.value ? `→ within ${fmtDur(pd.value)}` : '';
    el.catchHint.classList.toggle('err', !!pd.error);
    if (pd.error) return showWarn('Fix the catch-up time above (or clear it).');
    const D = pd.value;                                   // seconds, or null = as fast as possible

    liveAutoState(video, L, now, src.atHead);
    const active = auto.on && auto.catching;
    if (active && D !== null && auto.deadline === null) auto.deadline = now + D * 1000;   // anchor the target
    const effD = D === null ? null : (active && auto.deadline !== null ? Math.max(0, (auto.deadline - now) / 1000) : D);
    // "At live": while catching up that means the player says so (else half the safe window);
    // otherwise it means the player says so or you're inside the safe window.
    const atLive = active ? (src.atHead !== null ? src.atHead : L <= Math.max(10, W / 2))
                          : (src.atHead === true || L <= W);
    const lp = planCatchUp(L, cap, atLive ? Infinity : 0, effD);

    const out = [];
    let badge = '';
    const rate = video.playbackRate || 1;
    // At the speed you're playing right now (not the planned one). The gap only closes at (speed − 1) s per s.
    const nowText = rate > 1.0001 ? `${fmtDur(L / (rate - 1))} at ${fmtRate(rate)}`
                  : rate < 0.9999 ? `falling behind at ${fmtRate(rate)}` : `never at ${fmtRate(rate)}`;
    const rows = (speed, t) => {
      out.push(row('Fully caught up at', fmtClock(now + t * 1000, now)));
      out.push(row('Time until caught up to live', nowText));
      out.push(row('Stream you watch meanwhile', fmtDur(speed * t)));
    };
    if (lp.kind === 'atlive') {
      badge = 'live';
      out.push(h('div', { class: 'big', text: 'At live' }));
      out.push(h('div', { class: 'sub', text: src.atHead === true
        ? `The player says you're live (${fmtDur(L)} behind).`
        : `${fmtDur(L)} behind – inside your ${W}s safe window.` }));
    } else if (lp.kind === 'tooFast') {
      badge = 'too slow';
      out.push(h('div', { class: 'big bad', text: 'Not possible' }));
      out.push(h('div', { class: 'sub', text: effD > 0
        ? `Needs ${lp.exact.toFixed(2)}× to catch up in ${fmtDur(effD)} – above your ${fmtRate(cap)} max.`
        : 'Out of time for your target.' }));
      out.push(row(`Fastest (${fmtRate(cap)}) takes`, fmtDur(lp.tMin)));
      rows(cap, lp.tMin);
    } else if (lp.kind === 'max') {
      badge = fmtRate(cap);
      out.push(h('div', { class: 'big', text: fmtRate(cap) }));
      out.push(h('div', { class: 'sub', text: `Fastest catch-up: ${fmtDur(lp.t)} to reach live.` }));
      out.push(row('Gap closes at', `${(cap - 1).toFixed(2)}× per second`));
      rows(cap, lp.t);
    } else { // 'speed'
      badge = fmtRate(lp.speed);
      out.push(h('div', { class: 'big', text: fmtRate(lp.speed) }));
      out.push(h('div', { class: 'sub', text: `Catches up in ${fmtDur(lp.t)} (target ${fmtDur(effD)}).` }));
      out.push(row('Exact speed needed', lp.exact.toFixed(4) + '×'));
      out.push(row(`Fastest (${fmtRate(cap)}) would take`, fmtDur(lp.tMin)));
      rows(lp.speed, lp.t);
    }
    el.result.replaceChildren(...out);
    el.badge.textContent = badge;
    runAutoLive(video, lp, L, now);
  }

  function update() {
    if (!el.panel) return;
    const onWatch = location.pathname === '/watch';
    const now = Date.now();

    const vid = currentVid();
    if (vid !== auto.vid) {
      const first = auto.vid === undefined;
      auto.vid = vid;
      if (!first) onVideoChange();               // new video: Auto-set switches off, speed back to 1×
    }
    // Changing the deadline / mode / max speed re-plans from scratch (after a short typing delay)
    const key = [vid, state.target, state.mode, state.cap, state.catchBy, state.safeWin].join('|');
    if (key !== auto.key) { auto.key = key; resetAutoPlan(); auto.debounceUntil = now + 800; }

    ensureButton(onWatch);
    el.pageBtn.classList.toggle('auto', auto.on && !auto.overridden);
    el.panel.style.display = onWatch && !state.hidden ? '' : 'none';
    if (!onWatch) return;     // (a hidden panel still updates, so Auto-set keeps working)

    const n = new Date(now);
    el.sys.textContent = `System time: ${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())} ${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;

    // --- parse the deadline
    const parsed = parseTarget(state.target, now);
    if (parsed.error) {
      el.hint.textContent = state.target.trim() ? parsed.error : '';
      el.hint.classList.toggle('err', !!state.target.trim());
    } else {
      const d = new Date(parsed.ms);
      const wd = d.toLocaleDateString(undefined, { weekday: 'short' });
      el.hint.textContent = `→ ${wd} ${fmtClock(parsed.ms, 0)}${parsed.rolled ? '  (tomorrow)' : ''}`;
      el.hint.classList.remove('err');
    }

    // --- video state
    const video = getVideo();
    if (!video) { setStats([['Video', 'waiting…']]); return showWarn('Waiting for the video…'); }
    hookVideo(video);
    if (isAdPlaying()) { auto.lastAdAt = now; setStats([['Video', 'ad playing']]); return showWarn('An ad is playing – numbers resume when the video starts.', 'ad'); }
    let kind = liveKind(video);
    // The live flag can blink for a tick (YouTube repopulates it); don't flip the whole panel for that.
    // Measured from the last time the PLAYER said live, so it can't keep itself alive.
    if (kind === 'live') liveTrack.lastLiveAt = now;
    else if (liveTrack.vid === vid && now - liveTrack.lastLiveAt < 5000) kind = 'live';
    setModeUI(kind === 'live');
    if (kind === 'live') return updateLive(video, now);
    if (!isFinite(video.duration)) { setStats([['Video', 'no fixed length']]); return showWarn('This video has no fixed length, so there is nothing to plan.'); }

    const ad = adOffset();                                // stitched-in ad seconds (0 if none)
    const dur = video.duration - ad, cur = Math.max(0, video.currentTime - ad), rate = video.playbackRate || 1;
    const R = Math.max(0, video.duration - video.currentTime); // ad offset cancels out of the remaining time
    const T = parsed.error ? NaN : (parsed.ms - now) / 1000;

    setStats([
      ['Video length', fmtVid(dur)],
      ['Current position', fmtVid(cur)],
      ['Remaining (at 1×)', fmtDur(R)],
      ['Current speed', fmtRate(rate)],
      ['Finish at current speed', fmtClock(now + (R / rate) * 1000, now)],
      ['Time until video finish', `${fmtDur(R / rate)} at ${fmtRate(rate)}`],
      ['Time until deadline', parsed.error ? '—' : fmtDur(Math.max(0, T))],
      ...(ad > 0 ? [['Stitched-in ads (excluded)', fmtDur(ad)]] : []),
      ...(kind === 'postlive' ? [['Note', 'post-live – length may change']] : []),
    ]);

    if (parsed.error) return showWarn(state.target.trim() ? parsed.error : 'Enter a finish time above.');
    if (R <= 0.5) return showWarn('The video has finished.', 'done');
    if (T <= 0) return showWarn('That deadline has already passed.', 'past');

    // --- the plan
    const p = plan(state.mode, R, T, state.cap);
    const out = [];
    let badge = '';

    if (p.kind === 'impossible') {
      badge = 'too late';
      out.push(h('div', { class: 'big bad', text: 'Not possible' }));
      out.push(h('div', { class: 'sub', text: `Needs ${p.exact.toFixed(2)}×, above your ${fmtRate(p.cap)} max.` }));
      out.push(row(`Fastest (${fmtRate(p.cap)}) finishes`, fmtClock(now + (R / p.cap) * 1000, now)));
      out.push(row('That is', `${fmtDur(p.lateBy)} late`));
    } else if (p.kind === 'steady') {
      badge = fmtRate(p.hi);
      out.push(h('div', { class: 'big', text: fmtRate(p.hi) }));
      out.push(h('div', { class: 'sub', text: 'Set this speed now and keep it.' }));
      out.push(row('Exact speed needed', p.exact.toFixed(4) + '×'));
      out.push(row(`${fmtRate(p.hi)} (rounded up) finishes`, `${fmtClock(now + (R / p.hi) * 1000, now)} · ${earlyLate(p.hiEarly)}`));
      if (p.lo !== undefined) {
        out.push(row(`${fmtRate(p.lo)} (rounded down) finishes`, `${fmtClock(now + (R / p.lo) * 1000, now)} · ${earlyLate(-p.loLate)}`));
      }
    } else if (p.kind === 'normal') {
      badge = '1.00×';
      out.push(h('div', { class: 'big', text: '1.00×' }));
      out.push(h('div', { class: 'sub', text: 'No speed-up needed.' }));
      out.push(row('Finishes at 1×', `${fmtClock(now + R * 1000, now)} · ${earlyLate(p.early)}`));
      out.push(row('Speed that lands exactly on time', p.exact.toFixed(2) + '×'));
    } else { // sprint start: max speed first, then 1x
      const switchAt = now + p.tFast * 1000;
      if (p.tSlow < 1) {
        badge = fmtRate(p.cap);
        out.push(h('div', { class: 'big', text: fmtRate(p.cap) }));
        out.push(h('div', { class: 'sub', text: 'Sprint all the way – no spare time for 1×.' }));
        out.push(row(`${fmtRate(p.cap)} until`, `${fmtClock(parsed.ms, now)} (video end)`));
      } else {
        badge = `${fmtRate(p.cap)} → 1×`;
        out.push(h('div', { class: 'big', text: `${fmtRate(p.cap)} now` }));
        out.push(h('div', { class: 'sub', text: `then 1.00× at ${fmtClock(switchAt, now)}` }));
        out.push(row(`${fmtRate(p.cap)} for`, `${fmtDur(p.tFast)} → until ${fmtClock(switchAt, now)}`));
        out.push(row('Switch at video time', fmtVid(cur + p.cap * p.tFast)));
        out.push(row('1.00× for', `${fmtDur(p.tSlow)} → until ${fmtClock(parsed.ms, now)}`));
        out.push(row('Share of time at max', `${Math.round((p.tFast / T) * 100)}%`));
      }
    }
    el.result.replaceChildren(...out);
    el.badge.textContent = badge;
    runAuto(video, p, now);
  }

  /* ------------------------------------------------------------------ *
   *  Boot
   * ------------------------------------------------------------------ */
  function init() {
    if (document.getElementById('ytfb')) return;
    buildPanel();
    update();
    setInterval(update, 500);
    document.addEventListener('yt-navigate-finish', update); // YouTube SPA navigation
    window.addEventListener('popstate', update);
  }
  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();