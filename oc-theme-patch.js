#!/usr/bin/env node
// Clean replacement for the agent's patch-*.js pile.
// Layout overhaul: user rail, message grouping, collapsible outputs, inline unified diffs,
// animated agent dot, vim status bar above the chat input with context sparkline, log search (ctrl+f),
// receipt spark summary, context overlay (ctrl+r), searchable prompt history (alt+h), git changes panel (alt+g) + existing: busy shimmer, tool verbs,
// toasts, yap placeholder, time-of-day tint, exit stats, agent rail, ctrl+x fold/group.
//
//   node oc-theme-patch.js            apply patches (from the pristine .orig copy)
//   node oc-theme-patch.js --restore  put the original file back
//   node oc-theme-patch.js --status   say whether the tui chunk / editor.js are patched, pristine, or updated since the last run
//   node oc-theme-patch.js --probe    print where the guessed hook points live (paste me the output if a patch says MISS)
//   node oc-theme-patch.js --configure|--setup open the keyboard-driven settings dashboard, save, then apply the patch
//   node oc-theme-patch.js --auto     quiet: patch only when needed (pristine / updated). exits 0 when already patched.
//   node oc-theme-patch.js /other/openclaw/path
//
// keep the theme across openclaw updates with a shell wrapper:
//   alias openclaw='node /path/to/oc-theme-patch.js --auto >/dev/null 2>&1 || true; command openclaw'
//
// keys: ctrl+\ or alt+d density · ctrl+x tool view · ctrl+r context overlay · ctrl+f search
//       ctrl+y copy last reply (OSC 52) · alt+y copy last code block · alt+x list images · alt+c clear images
//       alt+h searchable prompt history · alt+g changes review (alt+j/k move, alt+r refresh)
//
// Vimpel design-system pass: one warm-ink / oxide-red palette, consistent thin rules, muted metadata,
// and shared visual tokens across chat, activity, receipts, status, popups, and configuration.
// Agent approvals/subagent controls are not simulated: OpenClaw must expose their APIs.
// Finds the tui chunk by content (no hardcoded hash), never writes a file that
// fails a syntax check or loses its export list.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const args = process.argv.slice(2);
// printed on every run so it is obvious which copy of the script is executing
const OC_PATCH_VERSION = "2026.11.02-port25-vimpel-design-system-pass";
// the openclaw release this port was written against
const OC_TARGET_VERSION = "2026.10.6";
const RESTORE = args.includes("--restore");
const PROBE = args.includes("--probe");
const STATUS = args.includes("--status");
const CONFIGURE = args.includes("--configure") || args.includes("-c") || args.includes("--setup");
const AUTO = args.includes("--auto");
const KEEP_FOOTER = false; // true = also keep the old text footer under the chat box
const TOAST_SWALLOW = true; // true = short "model set / renamed / copied" system lines become toasts only (not logged)
const FOLD_KEY = "***"; // documented only; the raw bytes are matched in the editor patch below
// ---CFG-START
// everything you will want to tweak lives here
const CFG = {
brand: "vimpel", // what the tui calls itself: header, terminal title, exit messages, pairing hint (commands, env vars and paths keep their real openclaw names)
// layout profiles, picked live from the terminal size (so resizing / tmux panes just work).
// large = wide ssh window (centred column if maxWidth is set). small = termux: compact, full width.
profiles: {
large: { minCols: 100, minRows: 28, maxWidth: 0, padTop: 0, padBottom: 0 }, // maxWidth 0 = edge to edge (set e.g. 110 to centre a column again)
medium: { minCols: 76, minRows: 18, padTop: 0, padBottom: 0 }, // not a phone, not a wide window: keeps the full status line and toast row (below minCols/minRows = the phone layout)
small: { padTop: 0, padBottom: 0 }
},
// $ per 1M tokens, matched (regex, case-insensitive) against the model label in the chat bar. empty = no cost shown
// unless openclaw itself reports a cost for the session. example: "claude-sonnet": { in: 3, out: 15 }
prices: {},
palette: "oganesson", // oganesson | tokyonight | daylight | gruvbox | catppuccin | auto
receiptColor: "", // "" = follow the palette's dim colour. set a hex to override.
receiptIndent: 2, // columns the "└ 8.2s · 3 tools · +1.4k tokens" line is indented (2 = lines up with the reply text)
terminalTitle: true, // sets the terminal/tmux tab title to "vimpel · working…" / "vimpel · idle" (cleared on exit)
bellAfterMs: 30000, // ring the terminal bell when a run that took at least this long finishes. 0 = never
collapseHeader: "always", // after the first message the 3-row header folds to one line. "small" = only on the phone profile, "never" = keep it
groupTools: true, // Antigravity-inspired low-noise activity stream; ctrl+x cycles grouped / expanded / folded.
receiptTimeline: true, // mini bar in each receipt: coloured blocks for tool calls sized by duration, dots = the model thinking
receiptGlyph: "\u25b0", // block used for tool calls in the receipt timeline (dots are the model thinking)
// visual glyph packs: braille (default), blocks, minimal, ascii. individual glyph overrides still win.
glyphPack: "blocks",
// context-window bar glyph ladder (8 levels, low->high). "pack" follows glyphPack; a string overrides it; [] = classic blocks.
sparkGlyphs: "pack",
// loader frames. "pack" follows glyphPack; a custom array can provide any frames you like.
loaderFrames: ["|", "/", "-", "\\"], // classic rotating ASCII spinner
receiptLegend: true, // small legend row under the timeline (think / read / edit / exec ...)
receiptVia: "auto", // "via <model>" in the receipt: "auto" = only when the answering model differs from the session's model (router), "always", "never"
awayDigest: true, // one line when the tui opens: cron runs, new messages and other session activity since you last had it open
// vim-style status bar above the chat input
vimStatusBar: true, // enable the status bar
vimStatusMode: true, // show the mode indicator (IDLE / BUSY / CMD / QUEUED - real state, not fake vim modes)
vimStatusTokens: true, // show token count / context usage
vimStatusCost: true, // show session cost
vimStatusSession: false, // session id lives in the box's bottom rule now; enable to duplicate it in the bar
vimStatusClock: true, // show clock
vimStatusGit: true, // show git branch (requires git in $PATH; the result is cached, a miss too)
vimStatusProject: true, // show the current project/directory in the status bar
awayMinMs: 600000, // only show the digest after being away at least this long (10 min)
groupMin: 3, // smallest run that collapses (failed and still-running calls never collapse)
density: "full", // starting layout density. ctrl+\ (or alt+d) cycles it live: full / compact (one-line header, status inside the bar) / zen (just the log and the box)
agentRail: true, // replies get a ▎ rail and ◆ marker in a colour derived from the agent's name (the first agent you see keeps the accent colour)
timeGapMs: 1800000, // a faint "── 14:05 ──" rule above a message that arrives after this long a silence. 0 = off
diffSplitMin: 140, // with inlineDiff "auto": terminals at least this wide show edit diffs side by side (old | new), narrower ones unified. 0 = always split
nowStrip: true, // while a tool runs the busy line reads "exec npm test · 4s   ✓ read ✓ edit  41s" instead of a rotating verb
statusRight: ["ago"], // right-aligned bits on the busy status row: "ago", "model", "clock", "run"
userRightGutter: 4, // columns of empty space on the right of user prompts (messaging-app style)
// header artwork intentionally removed; keep the header typographic and uncluttered.
completionVerbs: ["all tied off", "ship it", "clean run", "that's in the bag", "job done; tabs still open", "sorted. next?", "neatly handled", "and we're cooking", "wrapped with intent", "the machine delivers"],
// keys match ocToolIcons names. "a|b" shares one list. verbs rotate every ~4s
toolVerbs: {
"read": ["reading the fine print", "following the paper trail", "peeking under the hood", "eyes on the source", "dusting off the files"],
"write": ["putting thought to disk", "making it official", "ink to filesystem", "drafting the next move"],
"edit|apply_patch": ["precision surgery", "making the diff behave", "one careful cut", "straightening the wiring", "less chaos, more craft"],
"bash|exec|process": ["asking the shell nicely", "letting the terminal cook", "rattling the pipes", "hands on the machinery"],
"code_execution": ["testing the theory", "science, but reproducible", "checking the landing", "running the numbers"],
"web_search": ["out past the local filesystem", "consulting the wider world", "following a lead", "trawling the signal"],
"web_fetch|api": ["waiting on the wire", "bringing back the bytes", "knocking on the endpoint", "pulling the thread"],
"browser|canvas": ["taking the scenic route through the web", "driving the browser", "clicking with intent"],
"image": ["reading the pixels", "inspecting the evidence", "looking closer"],
"image_generate": ["teaching pixels some manners", "building a picture from a thought", "mixing light and math"],
"pdf": ["turning pages without the paper cuts", "working through the document", "reading the tiny print"],
"memory_search|memory_get": ["checking the memory shelves", "retracing our steps", "looking up the old notes"],
"cron": ["setting the clockwork", "tending the schedule", "putting time to work"],
"sessions_list|sessions_send|sessions_history|sessions_spawn|sessions_yield|subagents|agents_list|transcripts": ["getting the crew in sync", "passing the baton", "checking in with the other minds"],
"message": ["sending it down the line", "composing the signal", "putting words in motion"],
"update_plan|get_goal|create_goal|update_goal": ["plotting the route", "turning the mess into a plan", "finding the next rung"],
"music_generate|video_generate|tts": ["opening the little studio", "tuning the output", "setting the scene"],
"nodes|gateway": ["checking the connection", "tapping the wire", "calling home"],
"attach": ["bringing the file aboard", "checking the payload"],
"session_status": ["taking the system's pulse", "checking the gauges"],
"skill_workshop": ["at the workbench", "sharpening the toolkit"],
"_default": ["working the problem", "turning the gears", "making a little progress", "on it; one thing at a time"]
},
// dim text in the empty chat box, rotates ~every 20s
yaps: [
"✦ alright, what are we building?", "give me a problem with interesting edges", "I brought a terminal and questionable confidence",
"your move. I'll bring the tools", "/ opens the command hatch", "esc interrupts me mid-monologue",
"ctrl+x: fold the machinery into a quieter view", "ctrl+\\ or alt+d: full / compact / zen", "ctrl+f: find the line that started it all",
"ctrl+y: copy the last answer", "alt+h: dig up an old prompt", "alt+g: inspect the git fallout",
"small prompt, big consequences", "let's make the computer earn its electricity", "no ceremony. just the work.",
"the pixels are warm; the shell is ready", "I can be concise. I can also show my working."
],
closers: ["✦ vimpel signing off", "the shell goes quiet", "until the next interesting problem", "leaving the terminal tidier than we found it", "ctrl+c, with dignity", "go give your eyes a rest"],
// short system lines matching these (and not looking like errors) become toasts
toastPatterns: ["^model\\b.*\\b(set|switch|chang)", "\\bcop(y|ied)\\b", "\\brenam", "^session (label|name)"],
// vim status bar segment toggles (order: mode · project · git on the left, tokens · cost · clock on the right)
vimStatusLeft: ["mode", "project", "git"],
vimStatusRight: ["tokens", "cost", "clock"],
// ---- layout options ----
// user avatar: coloured rail + marker on user messages (matches agent rail)
userRail: true,
// user avatar icon shown as the rail prefix (empty = no rail)
userIcon: ">",
// message grouping: tighter spacing between same-side consecutive messages
messageGrouping: true,
// collapsible long outputs: auto-collapse tool outputs longer than this many lines. 0 = off (preserve full output unless explicitly enabled).
outputCollapseThreshold: 0,
// animated agent dot: pulse the rail dot during generation
agentPulseDot: true,
// auto-fold vim bar into chat box border only on ultra-narrow terminals
vimAutoFoldNarrow: true,
// zen context sliver: show a thin context bar in zen mode (the vim bar falls back to it)
zenContextSliver: true,
// log search: ctrl+f opens a query strip, matches highlight live across the whole screen
searchEnabled: true,
keySearch: "ctrl+f", // search hotkey (a bare "/" would eat slash commands, so it is a chord)
// diff style: "auto" = unified below diffSplitMin, side-by-side above. true = always unified. false = legacy
inlineDiff: "auto",
// receipt sparkline in summary line (tool duration bars)
receiptSparkSummary: true,
// shortcut keys
keyCtxOverlay: "ctrl+r", // toggle context overlay. NOT ctrl+t: openclaw binds ctrl+t itself (toggle thinking)
keyDensity: "ctrl+\\", // layout cycle (alt+d fallback for termux/tmux)
keyDensityAlt: "alt+d",
keyCopyReply: "ctrl+y", // copy the last assistant reply via OSC 52
keyCopyCode: "alt+y", // copy the last code block of the last reply via OSC 52
keyImagesList: "alt+x", // toast the queued image filenames
keyImagesClear: "alt+c", // drop all queued images
maxCollapseLines: 5, // lines to show before truncation
// ---- Vimpel composer design: corner-only Vim bar, adaptive multiline input, attachment chips, slash-command completion ----
// input char counter in the bottom-right of the bar (hidden while the box is empty,
// budget "/2000" only appears once you pass ~60% of it)
inputCounter: true,
// character budget for the counter (0 = no budget, just counter)
inputBudget: 2000,
// show live token estimate (chars/4) in the bar
tokenEstimate: true,
// show multi-line overflow count in the right gutter
multiLineIndicator: true,
// flash paste indicator briefly when text is pasted
pasteIndicator: true,
// show the message/command mode marker inside the Vim bar header (not beside the typed text)
cmdPrefix: true,
// floating bar: indent from edges (0 = edge to edge)
barMargin: 0,
// color for the input mode indicator
cmdPrefixColor: "", // empty follows the active palette accent
// paste indicator timeout in ms
pasteTimeout: 2000,
// ---- notifications ----
notifyOnCompletion: true, // desktop notification (OSC 9 / OSC 777 / notify-send) when a long run finishes
notifyAfterMs: 20000, // only notify for runs at least this long
focusReporting: true, // enable terminal focus events (?1004h) so notifications only fire when unfocused
// ---- discord rich presence ----
discordPresence: true, // enable discord RPC integration (requires discord-presence.js)
discordClientId: "1550776928091381790",
discordIdleTimeout: 300000, // ms before showing "idle" status (default: 5 min)
discordReconnectInterval: 5000,
// ---- image paste ----
imagePaste: true, // paste images into the chat: clipboard key, or paste / drag-drop an image file path. sent as chat.send attachments
keyPasteImage: ["ctrl+v", "alt+v", "ctrl+shift+v"], // image clipboard; Alt+V is the reliable fallback when the terminal intercepts Ctrl+V
imageMaxBytes: 8388608, // refuse single images bigger than this (8 MB)
imageMaxCount: 8 // images that can be queued for one message
};
// ---CFG-END
// ---- colour palettes ----
// chrome colours for the whole theme. the patcher rewrites openclaw's own palette object
// with these values and injects the same table as __ocPalette for the custom widgets.
// daylight assumes your terminal background is light; the dark ones assume a dark bg.
const PALETTES = {
oganesson: {
text: "#EBE0DE", dim: "#CEC4C2", accent: "#F23625", accentSoft: "#FF5033",
border: "#52443D", userBg: "#302826", userText: "#EBE0DE", systemText: "#CEC4C2",
toolPendingBg: "#302826", toolSuccessBg: "#262A1B", toolErrorBg: "#351D1D",
toolTitle: "#FF5033", toolOutput: "#CEC4C2", quote: "#988F8C", quoteBorder: "#52443D",
code: "#F5B49F", codeBlock: "#19120F", codeBorder: "#52443D", link: "#FF806B",
error: "#FF4E52", success: "#9C9152"
},
tokyonight: {
text: "#C0CAF5", dim: "#8B94B8", accent: "#E0AF68", accentSoft: "#EBC17C",
border: "#3B4261", userBg: "#24283B", userText: "#C0CAF5", systemText: "#8B94B8",
toolPendingBg: "#1F2335", toolSuccessBg: "#1E2A2A", toolErrorBg: "#2E2030",
toolTitle: "#E0AF68", toolOutput: "#8B94B8", quote: "#8B94B8", quoteBorder: "#565F89",
code: "#7DCFFF", codeBlock: "#1F2335", codeBorder: "#3B4261", link: "#7DCFFF",
error: "#F7768E", success: "#9ECE6A"
},
daylight: {
text: "#242C44", dim: "#6B7394", accent: "#8C6C3E", accentSoft: "#A9834F",
border: "#C6CAD6", userBg: "#DCDFE9", userText: "#242C44", systemText: "#6B7394",
toolPendingBg: "#E4E6EE", toolSuccessBg: "#D7E7DB", toolErrorBg: "#F2D7DE",
toolTitle: "#8C6C3E", toolOutput: "#565F89", quote: "#6B7394", quoteBorder: "#9AA2C0",
code: "#007197", codeBlock: "#E4E6EE", codeBorder: "#C6CAD6", link: "#007197",
error: "#D41E57", success: "#2E6B5E"
},
gruvbox: {
text: "#EBDBB2", dim: "#A89984", accent: "#D79921", accentSoft: "#FABD2F",
border: "#504945", userBg: "#3C3836", userText: "#EBDBB2", systemText: "#A89984",
toolPendingBg: "#32302F", toolSuccessBg: "#2E3B2C", toolErrorBg: "#3E2A28",
toolTitle: "#D79921", toolOutput: "#A89984", quote: "#928374", quoteBorder: "#665C54",
code: "#83A598", codeBlock: "#32302F", codeBorder: "#504945", link: "#83A598",
error: "#FB4934", success: "#B8BB26"
},
catppuccin: {
text: "#CDD6F4", dim: "#A6ADC8", accent: "#F9E2AF", accentSoft: "#FAE3B0",
border: "#45475A", userBg: "#313244", userText: "#CDD6F4", systemText: "#A6ADC8",
toolPendingBg: "#262637", toolSuccessBg: "#26332E", toolErrorBg: "#3B2731",
toolTitle: "#F9E2AF", toolOutput: "#A6ADC8", quote: "#A6ADC8", quoteBorder: "#585B70",
code: "#89B4FA", codeBlock: "#262637", codeBorder: "#45475A", link: "#74C7EC",
error: "#F38BA8", success: "#A6E3A1"
}
};
// ask the terminal for its background colour (OSC 11). runs in a short-lived child so a
// non-responding terminal can never hang the patcher. true = light background.
function detectLightTerminal() {
try {
if (!process.stdout.isTTY) return false;
const script = [
"let done = false;",
"const finish = (v) => { if (!done) { done = true; try { process.stdout.write(v || \"\"); } catch (e) {} process.exit(0); } };",
"const t = setTimeout(() => finish(null), 600); if (t.unref) t.unref();",
"try {",
"  if (!process.stdin.isTTY) { finish(null); }",
"  else {",
"    process.stdin.setRawMode(true);",
"    let buf = \"\";",
"    process.stdin.on(\"data\", (d) => {",
"      buf += String(d);",
"      const m = buf.match(/\\]11;rgb:([0-9a-f]{2,4})\\/([0-9a-f]{2,4})\\/([0-9a-f]{2,4})/i);",
"      if (m) {",
"        const w = [0.2126, 0.7152, 0.0722];",
"        let lum = 0;",
"        for (let i = 1; i <= 3; i++) lum += (parseInt(m[i].slice(0, 2), 16) || 0) * w[i - 1];",
"        finish(lum > 140 ? \"light\" : \"dark\");",
"      }",
"    });",
"    process.stdout.write(\"\\x1b]11;?\\x07\");",
"  }",
"} catch (e) { finish(null); }"
].join("\n");
const r = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 1200 });
return r.status === 0 && r.stdout === "light";
} catch { return false; }
}
let PALETTE_NAME = null;
function paletteName() {
if (PALETTE_NAME) return PALETTE_NAME;
const want = CFG.palette || "tokyonight";
if (want === "auto") PALETTE_NAME = detectLightTerminal() ? "daylight" : "oganesson";
else PALETTE_NAME = PALETTES[want] ? want : "oganesson";
return PALETTE_NAME;
}
function darkPalette() { return PALETTES[paletteName()]; }
// ---WIZARD-START
// The wizard writes selected values back into the CFG block above, keeping this script portable.
// ---SETUP-FIX: prompts run in a child process (readline) so Enter works everywhere
function ocConfigure() {
const tty = require("tty");
if (!tty.isatty(0) || !tty.isatty(1)) {
console.error("--configure needs an interactive terminal.");
process.exit(1);
}
console.log("\n✦ VIMPEL / OPENCLAW TUI PATCHER — configuration dashboard");
const Q = (key, question, choices) => ({ key, question, choices, current: CFG[key] });
// presets: one answer and skip the rest (pick "custom" to answer everything)
const PRESETS = {
minimal: { glyphPack: "minimal", collapseHeader: "always", groupTools: true, receiptLegend: false, terminalTitle: false, density: "compact", userRail: false, messageGrouping: true, outputCollapseThreshold: 20, inlineDiff: "auto", receiptSparkSummary: false, agentPulseDot: false, zenContextSliver: false, searchEnabled: false, inputCounter: false, tokenEstimate: false, multiLineIndicator: false, cmdPrefix: false, barMargin: 0 },
dev: { glyphPack: "braille", collapseHeader: "always", groupTools: false, receiptLegend: true, terminalTitle: true, density: "full", userRail: true, messageGrouping: true, outputCollapseThreshold: 0, inlineDiff: "auto", receiptSparkSummary: true, agentPulseDot: true, zenContextSliver: true, searchEnabled: true, inputCounter: true, tokenEstimate: true, multiLineIndicator: true, cmdPrefix: true, barMargin: 1, vimStatusGit: true },
full: { glyphPack: "blocks", collapseHeader: "always", groupTools: true, receiptLegend: true, terminalTitle: true, density: "full", userRail: true, messageGrouping: true, outputCollapseThreshold: 20, inlineDiff: "auto", receiptSparkSummary: true, agentPulseDot: true, zenContextSliver: true, searchEnabled: true, inputCounter: true, tokenEstimate: true, multiLineIndicator: true, cmdPrefix: true, barMargin: 0 }
};
const items = [
{ preset: { question: "start from a preset? (or answer each setting)", PRESETS, custom: "answer each setting" } },
Q("palette", "colour palette", [
{ value: "oganesson", label: "oganesson — oxide red, warm paper, brutalist edges (default)" },
{ value: "tokyonight", label: "tokyo night — stormy navy" },
{ value: "daylight", label: "daylight — bright paper ink (for light terminal backgrounds)" },
{ value: "gruvbox", label: "gruvbox — warm retro earth tones" },
{ value: "catppuccin", label: "catppuccin mocha — pastels on espresso" },
{ value: "auto", label: "auto — ask the terminal (OSC 11) and pick light/dark" }
]),
Q("glyphPack", "glyph and loader style", [
{ value: "braille", label: "braille — dense, smooth motion" },
{ value: "blocks", label: "blocks — familiar terminal bars" },
{ value: "minimal", label: "minimal — restrained moving dot" },
{ value: "ascii", label: "ascii — portable plain text" }
]),
Q("collapseHeader", "header density", [
{ value: "always", label: "compact after the first message (saves rows)" },
{ value: "small", label: "compact on narrow terminals only" },
{ value: "never", label: "always show the full header" }
]),
Q("groupTools", "finished tool calls", [
{ value: true, label: "group consecutive calls" },
{ value: false, label: "always show every call" }
]),
Q("receiptLegend", "run receipts", [
{ value: true, label: "show timeline legend" },
{ value: false, label: "timeline only" }
]),
Q("terminalTitle", "terminal title", [
{ value: true, label: "show working / idle state" },
{ value: false, label: "leave it alone" }
]),
Q("density", "starting layout density (ctrl+\\ or alt+d cycles it live)", [
{ value: "full", label: "full — header, status in the box rules, bar info" },
{ value: "compact", label: "compact — one-line header, status inside the bar" },
{ value: "zen", label: "zen — just the log and the box" }
]),
Q("vimStatusBar", "bottom status bar", [
{ value: true, label: "enabled — pinned to terminal bottom" },
{ value: false, label: "disabled — original footer layout" }
]),
Q("vimStatusTokens", "status bar context and tokens", [
{ value: true, label: "show token count and context usage" },
{ value: false, label: "hide token and context figures" }
]),
Q("vimStatusCost", "status bar session cost", [
{ value: true, label: "show session cost when available" },
{ value: false, label: "hide session cost" }
]),
Q("vimStatusClock", "status bar clock", [
{ value: true, label: "show current time" },
{ value: false, label: "hide clock" }
]),
Q("vimStatusGit", "status bar git branch", [
{ value: true, label: "show git branch when available" },
{ value: false, label: "hide git branch" }
]),
Q("vimStatusProject", "status bar project name", [
{ value: true, label: "show current directory/project" },
{ value: false, label: "hide project name" }
]),
Q("userRail", "user message rail", [
{ value: true, label: "show coloured rail + marker on user messages" },
{ value: false, label: "no user rail" }
]),
Q("messageGrouping", "message grouping", [
{ value: true, label: "tighter spacing between same-side consecutive messages" },
{ value: false, label: "uniform spacing" }
]),
Q("outputCollapseThreshold", "auto-collapse long outputs", [
{ value: 20, label: "collapse outputs over 20 lines" },
{ value: 0, label: "never collapse" }
]),
Q("inlineDiff", "diff style for edit tools", [
{ value: "auto", label: "auto — unified on narrow, side-by-side on wide (recommended)" },
{ value: true, label: "always unified -/+ colour diff" }
]),
Q("receiptSparkSummary", "receipt sparkline summary", [
{ value: true, label: "tool duration spark bars in the summary line" },
{ value: false, label: "no spark bars in summary" }
]),
Q("agentPulseDot", "animated agent dot", [
{ value: true, label: "pulse the agent indicator dot during generation" },
{ value: false, label: "static dot" }
]),
Q("zenContextSliver", "zen context sliver", [
{ value: true, label: "thin context bar visible in zen mode" },
{ value: false, label: "no context in zen mode" }
]),
Q("searchEnabled", "log search (ctrl+f)", [
{ value: true, label: "enable ctrl+f search: highlights matches across the log" },
{ value: false, label: "disable log search" }
]),
{ note: [
"\nkeyboard shortcuts:",
"  ctrl+\\ or alt+d — cycle layout density (full / compact / zen)",
"  ctrl+x  — cycle tool view (grouped / expanded / folded)",
"  ctrl+r  — toggle context overlay (expand spark/usage chart)",
"  alt+h   — search and reuse a previous prompt",
"  alt+g   — toggle the git changes panel",
"  ctrl+f  — search the log (esc closes)",
"  ctrl+y  — copy last reply (OSC 52) · alt+y — copy last code block",
"  alt+x   — list queued images · alt+c — clear them",
"  ctrl+v  — paste an image from the clipboard"
] },
Q("inputCounter", "input char counter", [
{ value: true, label: "show counter (hidden while empty, budget appears near the limit)" },
{ value: false, label: "hide counter" }
]),
Q("tokenEstimate", "live token estimate", [
{ value: true, label: "show ~tok estimate in bar" },
{ value: false, label: "hide estimate" }
]),
Q("multiLineIndicator", "multi-line overflow indicator", [
{ value: true, label: "show +N more when input wraps" },
{ value: false, label: "hide overflow count" }
]),
Q("cmdPrefix", "command prefix indicator", [
{ value: true, label: "show ⌘ prefix for / commands" },
{ value: false, label: "no prefix" }
]),
Q("barMargin", "bar margin (floating)", [
{ value: 0, label: "edge to edge (current)" },
{ value: 1, label: "1-col floating" }
])
];
// Full-screen, keyboard-driven dashboard inspired by archinstall's section/menu flow.
// Arrow keys are primary; optional Vim aliases are H/J/K/L (left/down/up/right).
// Enter/Space selects or changes, Tab/Shift+Tab switch sections, P cycles presets,
// M/D/F choose presets, S saves and applies, and Q/Esc cancels without saving.
const askChild = function () {
const fsx = require("fs"), readline = require("readline");
const list = JSON.parse(process.argv[1]), out = process.argv[2];
const input = process.stdin, output = process.stdout;
const presetItem = list.find(x => x.preset);
const questions = list.filter(x => x.key && Array.isArray(x.choices));
const presets = presetItem ? presetItem.preset.PRESETS : {};
const presetNames = ["custom"].concat(Object.keys(presets));
const categories = [
 { name: "00  Overview", keys: [] },
 { name: "01  Appearance", keys: ["palette", "glyphPack"] },
 { name: "02  Layout", keys: ["collapseHeader", "density", "userRail", "messageGrouping", "barMargin"] },
 { name: "03  Status bar", keys: ["vimStatusBar", "vimStatusTokens", "vimStatusCost", "vimStatusClock", "vimStatusGit", "vimStatusProject", "terminalTitle"] },
 { name: "04  Tools & output", keys: ["groupTools", "outputCollapseThreshold", "inlineDiff", "receiptLegend", "receiptSparkSummary", "agentPulseDot"] },
 { name: "05  Input", keys: ["inputCounter", "tokenEstimate", "multiLineIndicator", "cmdPrefix"] },
 { name: "06  Navigation", keys: ["searchEnabled", "zenContextSliver"] }
];
for (const q of questions) if (!categories.some(c => c.keys.includes(q.key))) categories[2].keys.push(q.key);
const values = Object.fromEntries(questions.map(q => [q.key, q.current]));
let section = 0, cursor = 0, presetName = "custom", done = false, dirty = false;
const settings = () => categories[section].keys.map(k => questions.find(q => q.key === k)).filter(Boolean);
const width = () => Math.max(60, Math.min(output.columns || 80, 120));
const plain = s => String(s == null ? "" : s).replace(/\x1b\[[0-9;]*m/g, "");
const fit = (s, n) => {
 s=String(s==null?"":s); let out="", visible=0, i=0;
 while(i<s.length && visible<n) {
  if(s[i]==="\x1b" && s[i+1]==="[") { const m=s.slice(i).match(/^\x1b\[[0-9;]*m/); if(m){out+=m[0];i+=m[0].length;continue;} }
  out+=s[i++]; visible++;
 }
 if(i<s.length && visible===n && n>0) { out=out.slice(0,Math.max(0,out.length-1))+"…"; }
 return out+"\x1b[0m"+" ".repeat(Math.max(0,n-visible));
};
// Vimpel terminal palette: warm near-black, paper text, oxide-red accent, green secondary.
const reset = "\x1b[0m";
const dim = s => "\x1b[38;2;152;143;140m"+s+reset; // muted warm stone
const cyan = s => "\x1b[38;2;242;54;37m"+s+reset; // Vimpel oxide red
const green = s => "\x1b[38;2;156;145;82m"+s+reset; // muted success olive
const bold = s => "\x1b[1m\x1b[38;2;235;224;222m"+s+reset; // warm paper
const rev = s => "\x1b[48;2;165;45;34m\x1b[38;2;255;248;246m\x1b[1m"+s+reset; // selected row
function label(q) { const c=q.choices.find(x=>Object.is(x.value,values[q.key])); return c?c.label:String(values[q.key]); }
function draw() {
 const w=width(), leftW=Math.min(22,Math.max(16,Math.floor(w*0.25))), rightW=w-leftW-7, rows=[];
 const full=s=>"│ "+fit(s,w-4)+" │";
 const split=(l,r)=>"│ "+fit(l,leftW)+" │ "+fit(r,rightW)+" │";
 const rule="─".repeat(w-2), thin=rule;
 rows.push("┌"+rule+"┐");
 rows.push(full(cyan("✦ VIMPEL")+bold("  /  OPENCLAW TUI PATCHER")+dim("  CONFIG")));
 rows.push(full(dim("RAW STRUCTURE  ·  WARM INK  ·  NO FILLER")));
 rows.push("├"+rule+"┤");
 const state=dirty?cyan("◆ UNSAVED CHANGES"):green("◆ CONFIG IN SYNC");
 rows.push(full("PROFILE  "+cyan(presetName.toUpperCase())+"     "+state));
 rows.push("├"+"─".repeat(leftW+2)+"┼"+"─".repeat(rightW+2)+"┤");
 rows.push(split(bold(" SECTIONS"),bold(" SETTING  /  VALUE")));
 rows.push("├"+thin.slice(0,leftW+2)+"┼"+thin.slice(0,rightW+2)+"┤");
 const available=Math.max(5,Math.min(categories.length,(output.rows||24)-12));
 const catStart=Math.max(0,Math.min(section-Math.floor(available/2),categories.length-available));
 const qs=settings();
 let itemStart=section===0?0:Math.max(0,Math.min(cursor-Math.floor(available/2),Math.max(0,qs.length-available)));
 for(let i=0;i<available;i++) {
  const ci=catStart+i, c=categories[ci];
  let left=c?((ci===section?cyan("✦ "):"  ")+c.name):"";
  let right="";
  if(section===0) {
   right=["Choose a section on the left to get started.","ARROWS  primary navigation and option changes.","H/J/K/L  optional Vim keys (left/down/up/right).","ENTER / SPACE  open a section or change an option.","PRESETS  M minimal · D developer · F full · P cycle","SAVE & APPLY  S       CANCEL  Q or ESC"][i]||"";
   if(i===0) right=bold(right);
   if(i===4) right=green(right);
  } else {
   const qi=itemStart+i, q=qs[qi];
   if(q) {
    const v=label(q), marker=qi===cursor?"✦ ":"  ";
    const line=marker+q.question+"   [ "+v+" ]";
    right=qi===cursor?rev(fit(line,rightW)):line;
   }
  }
  rows.push(split(ci===section?rev(fit(left,leftW)):left,right));
 }
 rows.push("├"+rule+"┤");
 rows.push(full(dim("ARROWS  Move/change (primary)     H/J/K/L  Vim aliases     ENTER/SPACE  Select/change")));
 rows.push(full(dim("TAB/SHIFT+TAB  Sections     P  Presets     S  Save & apply     Q/ESC  Cancel")));
 rows.push("└"+rule+"┘");
 output.write("\x1b[?25l\x1b[2J\x1b[H"+rows.join("\n")+"\n");
}
function change(d) { const q=settings()[cursor]; if(!q)return; const i=q.choices.findIndex(c=>Object.is(c.value,values[q.key])); values[q.key]=q.choices[(i+d+q.choices.length)%q.choices.length].value; presetName="custom"; dirty=true; }
function applyPreset(n) { if(!presets[n])return; Object.assign(values,presets[n]); presetName=n; dirty=true; cursor=0; }
function finish(save) { if(done)return; done=true; try{input.setRawMode(false)}catch{} input.pause(); output.write("\x1b[?25h\x1b[0m\n"); if(save)fsx.writeFileSync(out,JSON.stringify(values)); else {try{fsx.unlinkSync(out)}catch{}} }
function onData(chunk) {
 const k=String(chunk);
 if(k==="\u0003"){finish(false);process.exit(130)}
 if(k==="q"||k==="Q"||k==="\u001b"){finish(false);return}
 if(k==="s"||k==="S"){finish(true);return}
 if(k==="\t"||k==="\u001b[Z"){section=(section+(k==="\t"?1:-1)+categories.length)%categories.length;cursor=0;draw();return}
 if(k==="p"||k==="P"){const i=presetNames.indexOf(presetName);const n=presetNames[(i+1)%presetNames.length];if(n==="custom"){presetName="custom"}else applyPreset(n);draw();return}
 if(k.toLowerCase()==="m"){applyPreset("minimal");draw();return}
 if(k.toLowerCase()==="d"){applyPreset("dev");draw();return}
 if(k.toLowerCase()==="f"){applyPreset("full");draw();return}
 if(k==="\u001b[A"||k==="k"||k==="K"){if(section===0)section=(section+categories.length-1)%categories.length;else cursor=Math.max(0,cursor-1);draw();return}
 if(k==="\u001b[B"||k==="j"||k==="J"){if(section===0)section=(section+1)%categories.length;else cursor=Math.min(Math.max(0,settings().length-1),cursor+1);draw();return}
 if(k==="\u001b[C"||k==="\u001b[D"||k==="l"||k==="L"||k==="h"||k==="H"){const d=(k==="\u001b[C"||k==="l"||k==="L")?1:-1;if(section===0)section=(section+d+categories.length)%categories.length;else change(d);draw();return}
 if(k===" "||k==="\r"||k==="\n"){if(section===0)section=1;else change(1);draw();}
}
if(!input.isTTY||!output.isTTY){fsx.writeFileSync(out,JSON.stringify(values));return;}
readline.emitKeypressEvents(input);try{input.setRawMode(true)}catch{}input.resume();input.on("data",onData);output.on("resize",draw);draw();
};
const tmp = path.join(require("os").tmpdir(), "oc-setup-" + process.pid + ".json");
spawnSync(process.execPath, ["-e", "(" + askChild.toString() + ")()", JSON.stringify(items), tmp], { stdio: "inherit" });
let selected = null;
try { selected = JSON.parse(fs.readFileSync(tmp, "utf8")); } catch {}
try { fs.unlinkSync(tmp); } catch {}
if (!selected) {
console.log("\nsetup cancelled, nothing changed.");
process.exit(1);
}
const self = fs.readFileSync(__filename, "utf8");
const start = self.indexOf("// ---CFG-START");
const end = self.indexOf("// ---CFG-END");
if (start === -1 || end === -1 || end <= start) throw new Error("could not locate the CFG block");
let block = self.slice(start, end);
for (const [key, value] of Object.entries(selected)) {
const json = JSON.stringify(value);
const re = new RegExp("(^\\s*" + key + ":\\s*)[^,\n]+(,.*$)", "m");
if (!re.test(block)) { console.log("note: could not save " + key + " (setting not in CFG block)"); continue; }
block = block.replace(re, "$1" + json + "$2");
}
fs.writeFileSync(__filename, self.slice(0, start) + block + self.slice(end));
console.log("\nsaved. applying your chosen tui now…\n");
// CFG above is the OLD in-memory copy, so run the patch again as a fresh process to apply the new values
const rerun = spawnSync(process.execPath, [__filename].concat(args.filter((a) => a !== "--configure" && a !== "--setup" && a !== "-c")), { stdio: "inherit" });
process.exit(rerun.status == null ? 1 : rerun.status);
}
if (CONFIGURE) ocConfigure();
// ---WIZARD-END
// ---RUNTIME-START
const RUNTIME = String.raw`
// ---- oc theme runtime (injected): state for shimmer, mascot, on-air chip, toasts, yap lines, exit stats
const OC_CFG = ${JSON.stringify(CFG)};
// __ocPalette is injected just before this blob (see runtime helpers group); read chrome
// colours from it so a palette swap is live even if tuiTheme captured the old values.
const OC_GLYPH_PACKS = {
braille: { spark: "⠀⡀⡄⡆⡇⣇⣧⣿", loader: ["⠁⠃⠇⠏⠟⠿⠟⠏", "⠃⠇⠏⠟⠿⠟⠏⠁", "⠇⠏⠟⠿⠟⠏⠁⠃", "⠏⠟⠿⠟⠏⠁⠃⠇", "⠟⠿⠟⠏⠁⠃⠇⠏", "⠿⠟⠏⠁⠃⠇⠏⠟", "⠟⠏⠁⠃⠇⠏⠟⠿", "⠏⠁⠃⠇⠏⠟⠿⠟"] },
blocks: { spark: "▁▂▃▄▅▆▇█", loader: null },
minimal: { spark: "·······●", loader: ["····●···", "·····●··", "······●·", "·······●", "●·······", "·●······", "··●·····", "···●····"] },
ascii: { spark: ".:-=+*#@", loader: ["[>       ]", "[=>      ]", "[==>     ]", "[===>    ]", "[====>   ]", "[=====>  ]", "[======> ]", "[=======>]"] }
};
function ocGlyphPack() { return OC_GLYPH_PACKS[OC_CFG.glyphPack] || OC_GLYPH_PACKS.braille; }
function ocLoaderFrames() {
const own = OC_CFG.loaderFrames;
if (Array.isArray(own) && own.length) return own;
const pack = ocGlyphPack();
if (own === "pack" && Array.isArray(pack.loader)) return pack.loader;
const bars = pack.spark || "▁▂▃▄▅▆▇█";
return Array.from({ length: 8 }, (_, k) => Array.from({ length: 8 }, (_, i) => bars[Math.round((bars.length - 1) / 2 + (bars.length - 1) / 2 * Math.sin((i + k) * Math.PI / 4))]).join(""));
}
const OC_TOAST_SWALLOW = ${TOAST_SWALLOW ? "true" : "false"};
const ocStats = { start: Date.now(), tools: 0, failed: 0, ctxHits: 0 };
let ocRun = null, ocRunning = false, ocDone = null, ocCtxPct = 0;
let ocToast = null, ocTickTimer = null;
const ocToastQ = [];
const ocLive = [];
const ocRand = (n) => Math.floor(Math.random() * n);
// ANSI-aware hard clip: every custom row renderer ends with ocFit() so a mis-measured line
// can never exceed the terminal width and crash doRender.
// zero-width sequences: SGR/CSI, OSC (hyperlinks), APC (cursor marker)
const OC_ZW = "\\x1b\\[[0-9;?]*[A-Za-z]|\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)|\\x1b_[^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)";
function ocCpw(cp) {
if (cp < 0x300) return 1;
if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfe0f) return 0;
if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff) || (cp >= 0x20000 && cp <= 0x3fffd)) return 2;
return 1;
}
const ocVisLen = (s) => {
let w = 0;
for (const ch of String(s).replace(new RegExp(OC_ZW, "g"), "")) w += ocCpw(ch.codePointAt(0));
return w;
};
function ocFit(line, width) {
const s = String(line == null ? "" : line);
if (!(width > 0)) return "";
const zw = new RegExp(OC_ZW, "y");
let out = "", vis = 0, i = 0, sawSgr = false;
while (i < s.length) {
zw.lastIndex = i;
const m = zw.exec(s);
if (m) { out += m[0]; i += m[0].length; if (m[0][1] === "[") sawSgr = true; continue; }
const ch = String.fromCodePoint(s.codePointAt(i));
const w = ocCpw(ch.codePointAt(0));
if (vis + w > width) break;
out += ch; vis += w; i += ch.length;
}
return sawSgr ? out + "\x1b[0m" : out;
}
function ocHexRgb(hex, fallback) {
const raw = String(hex || fallback || "#988F8C").replace(/^#/, "");
return /^[0-9a-f]{6}$/i.test(raw) ? [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)] : [152, 143, 140];
}
// safety net for the whole screen: clip any row wider than the terminal and log who it was.
// rate-limited: one bad row must not rewrite the log on every 90ms frame.
let ocClampLogAt = 0;
function ocClampAll(lines, width) {
return lines.map((l, idx) => {
const w = ocVisLen(l);
if (w <= width) return l;
if (Date.now() - ocClampLogAt > 1000) {
ocClampLogAt = Date.now();
try {
process.getBuiltinModule("fs").appendFileSync((process.env.TMPDIR || "/tmp") + "/oc-clamp.log", JSON.stringify({ at: new Date().toISOString(), row: idx, width: w, max: width, text: String(l).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").slice(0, 160) }) + "\n");
} catch {}
}
return ocFit(l, width);
});
}
function ocDur(ms) {
const s = Math.max(0, Math.round(ms / 1000));
if (s < 60) return s + "s";
const m = Math.floor(s / 60);
if (m < 60) return m + "m " + String(s % 60).padStart(2, "0") + "s";
return Math.floor(m / 60) + "h " + String(m % 60).padStart(2, "0") + "m";
}
let ocTitleLast = null;
function ocSetTitle(state) {
try {
if (!OC_CFG.terminalTitle || !process.stdout.isTTY) return;
const t = state === null ? "" : OC_CFG.brand + " \u00b7 " + state;
if (t === ocTitleLast) return;
ocTitleLast = t;
process.stdout.write("\x1b]0;" + t + "\x07");
} catch {}
}
function ocRender() {
try { if (globalThis.__ocRender) globalThis.__ocRender(); } catch {}
}
function ocTickWanted() {
const now = Date.now();
// Do not run a permanent animation redraw loop while the main-screen TUI is busy.
// TuiMainScreen writes updates at the live cursor; repeated timer-only redraws can
// keep pulling a terminal's native scrollback viewport back to the bottom. Real
// stream/tool/status changes still request renders through the normal event path.
return ocToastQ.length > 0 || !!(ocToast && now - ocToast.at < ocToast.ms);
}
function ocTickEnsure() {
if (ocTickTimer) return;
ocTickTimer = setInterval(() => {
ocRender();
if (!ocTickWanted()) {
clearInterval(ocTickTimer);
ocTickTimer = null;
ocRender();
}
}, 90);
if (ocTickTimer.unref) ocTickTimer.unref();
}
// ---- focus reporting + completion notifications ----
// ?1004h makes the terminal send \x1b[I / \x1b[O on focus change; the editor patch swallows
// those events (they never reach the text input) and tracks focus here, so the notification
// only fires when you are NOT looking at the window. without focus reporting the notify
// always fires for long runs.
let ocFocused = true;
globalThis.__ocFocusEvent = (f) => { ocFocused = !!f; };
function ocNotifyInit() {
if (!OC_CFG.focusReporting || !process.stdout.isTTY) return;
try { process.stdout.write("\x1b[?1004h"); } catch {}
process.once("exit", () => { try { if (process.stdout.isTTY) process.stdout.write("\x1b[?1004l"); } catch {} });
}
function ocNotifyDone(ms) {
if (!OC_CFG.notifyOnCompletion) return;
if (!(ms >= (OC_CFG.notifyAfterMs == null ? 20000 : OC_CFG.notifyAfterMs))) return;
if (OC_CFG.focusReporting && ocFocused) return;
const title = OC_CFG.brand + " done";
const body = ocDur(ms) + (ocRun && ocRun.tools ? " \u00b7 " + ocRun.tools + " tools" : "");
// OSC 9 (iterm2 / wezterm / conemu) and OSC 777 (urxvt); notify-send for local X/wayland
try { process.stdout.write("\x1b]9;" + title + " (" + body + ")\x07"); } catch {}
try { process.stdout.write("\x1b]777;notify;" + title + ";" + body + "\x07"); } catch {}
if (!process.env.SSH_CLIENT && (process.env.DISPLAY || process.env.WAYLAND_DISPLAY)) {
try {
const cp = process.getBuiltinModule("child_process");
const ch = cp.spawn("notify-send", [title, body], { stdio: "ignore", detached: true });
if (ch.unref) ch.unref();
} catch {}
}
}
// ---- OSC 52 copy: last reply / last code block. works over ssh and termux with no tools ----
function ocCopyOSC52(text, label) {
try {
if (!text) { ocToastShow("nothing to copy yet"); return; }
const b64 = Buffer.from(String(text), "utf8").toString("base64");
if (process.stdout.isTTY) process.stdout.write("\x1b]52;c;" + b64 + "\x07");
ocToastShow((label || "copied") + " \u00b7 " + String(text).length + " chars" + (process.env.TMUX ? " (tmux: set -g set-clipboard on)" : ""), 3500);
} catch {}
}
function ocLastCodeBlock() {
  const t = String(globalThis.__ocLastReply || "");
  const BT = String.fromCharCode(96);
  const re = new RegExp(BT + BT + BT + "[^\\n]*\\n([\\s\\S]*?)" + BT + BT + BT, "g");
  let last = null, m;
  while ((m = re.exec(t))) last = m[1];
  return last;
}
globalThis.__ocCopyLast = (kind) => {
if (kind === "code") ocCopyOSC52(ocLastCodeBlock(), "code block copied");
else ocCopyOSC52(globalThis.__ocLastReply, "reply copied");
};
function ocDiscordInit() {
try {
if (!OC_CFG.discordPresence) return;
const fs = process.getBuiltinModule("fs");
const p = process.getBuiltinModule("path");
const dpPath = p.join(__dirname, "discord-presence.js");
if (fs.existsSync(dpPath)) {
const rpc = require(dpPath);
const modelName = (globalThis.__ocSessModel || "").replace(/^.*\//, "") || OC_CFG.brand;
if (OC_CFG.discordClientId) {
process.env.DISCORD_CLIENT_ID = OC_CFG.discordClientId;
}
rpc.init(modelName);
globalThis.__ocDiscordRpc = rpc;
}
} catch (e) {}
}
function ocDiscordBusy(busy, verb) {
const rpc = globalThis.__ocDiscordRpc;
if (rpc && typeof rpc.onBusyChanged === "function") rpc.onBusyChanged(busy, verb);
}
function ocDiscordTool(name) {
const rpc = globalThis.__ocDiscordRpc;
if (rpc && typeof rpc.onToolSeen === "function") rpc.onToolSeen(name);
}
function ocDiscordError() {
const rpc = globalThis.__ocDiscordRpc;
if (rpc && typeof rpc.onToolError === "function") rpc.onToolError();
}
function ocDiscordClear() {
const rpc = globalThis.__ocDiscordRpc;
if (!rpc) return;
if (typeof rpc.clearActivity === "function") rpc.clearActivity();
if (typeof rpc.disconnect === "function") rpc.disconnect();
}
function ocInit() {
if (globalThis.__ocInit) return;
globalThis.__ocInit = true;
ocStats.start = Date.now();
ocSetTitle("idle");
ocNotifyInit();
ocDiscordInit();
process.once("exit", () => {
ocSetTitle(null);
ocDiscordClear();
try {
if (process.stdout.isTTY && Date.now() - ocStats.start > 3000) process.stdout.write(ocExitText());
} catch {}
});
}
function ocBusyChanged(b) {
ocRunning = !!b;
ocSetTitle(b ? "working\u2026" : "idle");
const verb = ocToolVerb() || null;
ocDiscordBusy(b, verb);
ocLive.length = 0;
if (!b) {
if (ocRun) ocRun.idleAt = Date.now();
return;
}
// a short idle blip in the middle of a turn (history refresh, tool hand-off) resumes the same run instead of zeroing the clock and counters
if (ocRun && !ocRun.receipted && ocRun.idleAt && Date.now() - ocRun.idleAt < 5000) {
ocRun.idleAt = 0;
} else {
if (ocLastReceipt && ocLastReceipt.tok1 == null) ocLastReceipt.tok1 = ocTotalTokens;
if (ocLastReceipt && ocLastReceipt.cost1 == null) ocLastReceipt.cost1 = globalThis.__ocSessCost != null ? globalThis.__ocSessCost : null;
globalThis.__ocDigestText = null;
ocRun = { start: Date.now(), tools: 0, failed: 0, lastFail: 0, tok0: ocTotalTokens, files: new Set(), add: 0, del: 0, idleAt: 0, calls: [], cost0: globalThis.__ocSessCost != null ? globalThis.__ocSessCost : null, replySeen: false, providerError: null };
globalThis.__ocLastCompletion = null;
globalThis.__ocLastCompletionError = false;
}
// The busy state itself must not start a periodic redraw timer. While busy,
// renders are driven by actual stream/tool/status events; toast timers remain separate.
if (!b) ocTickEnsure();
}
// called from every place that knows the status: the busy ticker (running) and renderStatus (idle).
// only a real change starts/ends a run, so repeated calls never reset the clock.
function ocBusyTick(b) {
if (!!b === ocRunning) return;
ocBusyChanged(b);
}
function ocIsBusy() { return ocRunning; }
function ocSetCtx(p) {
if (p >= 80 && ocCtxPct < 80) ocStats.ctxHits++;
// one toast per upward crossing (re-arms once the percentage drops back, e.g. after /new)
if (p >= 95 && ocCtxPct < 95) ocToastShow("context " + p + "% full, /compact or /new now", 6000);
else if (p >= 80 && p < 95 && ocCtxPct < 80) ocToastShow("context " + p + "% full, consider /compact or /new", 5000);
ocCtxPct = p;
}
function ocToolSeen(c) {
if (!ocRunning) return;
if (c && c.toolName) ocDiscordTool(c.toolName);
if (c && c.isError) ocDiscordError();
if (!c.__ocSeen) {
c.__ocSeen = true;
c.__ocSeed = ocRand(997);
c.__ocT0 = Date.now();
ocStats.tools++;
if (ocRun) {
ocRun.tools++;
c.__ocCall = { name: String(c.toolName || ""), t0: Date.now(), t1: null, failed: false };
if (ocRun.calls) ocRun.calls.push(c.__ocCall);
}
}
const i = ocLive.indexOf(c);
if (c.isPartial) {
if (i < 0) ocLive.push(c);
} else if (i >= 0) {
ocLive.splice(i, 1);
}
if (!c.isPartial && c.__ocCall && c.__ocCall.t1 == null) { c.__ocCall.t1 = Date.now(); c.__ocCall.failed = !!c.isError; }
if (!c.isPartial && !c.isError && !c.__ocStat) {
c.__ocStat = true;
const st = ocDiffStat(c.toolName, c.args);
if (st && ocRun) {
for (const f of st.files) ocRun.files.add(f);
ocRun.add += st.add;
ocRun.del += st.del;
}
}
if (!c.isPartial && c.isError && !c.__ocFailed) {
c.__ocFailed = true;
ocStats.failed++;
if (ocRun) { ocRun.failed++; ocRun.lastFail = Date.now(); }
}
}
const ocToolVerbMap = {};
for (const k of Object.keys(OC_CFG.toolVerbs)) for (const n of k.split("|")) ocToolVerbMap[n] = OC_CFG.toolVerbs[k];
function ocToolVerb() {
const c = ocLive[ocLive.length - 1];
if (!c) return null;
const key = String(c.toolName || "").toLowerCase().replace(/^.*[.:\/]/, "");
const list = ocToolVerbMap[key] || ocToolVerbMap._default;
if (!list || !list.length) return null;
return list[(c.__ocSeed + Math.floor((Date.now() - c.__ocT0) / 4000)) % list.length];
}
// files touched + lines added/removed by one finished edit/write/apply_patch call, from the call's own args
function ocDiffStat(toolName, args) {
try {
let a = args;
if (typeof a === "string") { try { a = JSON.parse(a); } catch { return null; } }
if (!a || typeof a !== "object") return null;
const name = String(toolName || "").toLowerCase().replace(/^.*[.:\/]/, "");
const files = new Set();
let add = 0, del = 0;
const pathOf = (x) => ocDiffPick(x, ["path", "file_path", "filePath", "file", "filename"]) || "?";
if (/^(edit|str_replace|replace|multiedit|multi_edit)$/.test(name)) {
const OLD = ["oldText", "old_string", "oldString", "old_str", "oldStr", "old"];
const NEW = ["newText", "new_string", "newString", "new_str", "newStr", "new"];
for (const e of Array.isArray(a.edits) ? a.edits : [a]) {
const o = ocDiffPick(e, OLD), n = ocDiffPick(e, NEW);
if (o === null || n === null) continue;
for (const op of ocDiffOps(o, n)) { if (op[0] === "+") add++; else if (op[0] === "-") del++; }
files.add(pathOf(e) !== "?" ? pathOf(e) : pathOf(a));
}
} else if (/^(write|create|create_file|write_file)$/.test(name)) {
const c = ocDiffPick(a, ["content", "text", "contents", "data"]);
if (c === null) return null;
add = c ? c.replace(/\n$/, "").split("\n").length : 0;
files.add(pathOf(a));
} else if (/^(apply_patch|patch)$/.test(name)) {
const t = ocDiffPick(a, ["input", "patch", "diff", "content"]);
if (t === null) return null;
for (const l of t.split("\n")) {
let m;
if ((m = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/.exec(l))) files.add(m[1].trim());
else if ((m = /^\+\+\+ (?:b\/)?(.+)$/.exec(l))) files.add(m[1].trim());
else if (/^\*\*\* /.test(l) || /^--- /.test(l)) continue;
else if (l.startsWith("+")) add++;
else if (l.startsWith("-")) del++;
}
} else return null;
return files.size || add || del ? { files, add, del } : null;
} catch { return null; }
}
// session cost for the chat bar: openclaw's own figure if the session carries one, else tokens x CFG.prices
function ocPriceFor(names) {
const list = [].concat(names).filter(Boolean).map(String);
const prices = OC_CFG.prices || {};
for (const k of Object.keys(prices)) {
let re = null;
try { re = new RegExp(k, "i"); } catch {}
if (list.some((n) => (re ? re.test(n) : false) || n.toLowerCase().includes(k.toLowerCase()))) return prices[k];
}
return null;
}
// accepts { in, out } or { input, output } or { prompt, completion } ($ per 1M tokens)
const ocPriceIn = (pr) => Number(pr.in ?? pr.input ?? pr.prompt ?? 0) || 0;
const ocPriceOut = (pr) => Number(pr.out ?? pr.output ?? pr.completion ?? 0) || 0;
function ocCost(info, label) {
if (!info) return "";
const num = (k) => (typeof info[k] === "number" && isFinite(info[k]) ? info[k] : null);
const keys = Object.keys(info);
const names = [label, info.model, info.modelProvider && info.model ? info.modelProvider + "/" + info.model : null];
// any numeric field that looks like a cost (estimatedCostUsd, costUsd, usage.cost ...), exact names first
let usd = null, costKey = null, why = "";
for (const k of ["estimatedCostUsd", "costUsd", "totalCostUsd", "cost"].concat(keys.filter((k) => /cost|usd/i.test(k)))) {
if (num(k) != null) { usd = num(k); costKey = k; break; }
}
let inKey = null, outKey = null;
if (usd == null) {
const price = ocPriceFor(names);
inKey = ["inputTokens", "promptTokens"].concat(keys.filter((k) => /^(input|prompt).*tokens$/i.test(k))).find((k) => num(k) != null) || null;
outKey = ["outputTokens", "completionTokens"].concat(keys.filter((k) => /^(output|completion).*tokens$/i.test(k))).find((k) => num(k) != null) || null;
if (!price) why = "price";          // no CFG.prices key matched the model name
else if (!inKey || !outKey) why = "tokens"; // session has no input/output split to multiply
else usd = (num(inKey) * ocPriceIn(price) + num(outKey) * ocPriceOut(price)) / 1e6;
}
if (process.env.OC_COST_DEBUG) {
try {
const snap = {};
for (const k of keys) snap[k] = typeof info[k] === "number" || typeof info[k] === "boolean" ? info[k] : Array.isArray(info[k]) ? "array" : info[k] && typeof info[k] === "object" ? "object{" + Object.keys(info[k]).join(",") + "}" : typeof info[k];
const line = JSON.stringify({ tried: names.filter(Boolean), priceKeys: Object.keys(OC_CFG.prices || {}), why, costKey, inKey, outKey, result: usd, fields: snap });
if (line !== globalThis.__ocCostDbg) {
globalThis.__ocCostDbg = line;
process.getBuiltinModule("fs").appendFileSync((process.env.TMPDIR || "/tmp") + "/oc-cost-debug.log", line + "\n");
}
} catch {}
if (why) return "$? " + why;
}
globalThis.__ocSessCost = usd != null && usd >= 0 ? usd : null;
globalThis.__ocSessModel = [info.modelProvider, info.model].filter(Boolean).join("/") || String(label || "");
if (usd == null || !(usd > 0)) return "";
return usd < 0.01 ? "<$0.01" : (costKey ? "$" : "~$") + (usd < 10 ? usd.toFixed(2) : usd.toFixed(1));
}
let ocTotalTokens = null, ocLastReceipt = null;
function ocSetTotal(n) { ocTotalTokens = typeof n === "number" ? n : null; }
// context history: one point per turn (samples inside the same run overwrite the last point), reset when the session changes
let ocCtxHist = [], ocCtxHistRun = null, ocCtxHistSession = null;
function ocCtxSample(total, max, session) {
if (typeof total !== "number" || !max) return;
if (session !== ocCtxHistSession) { ocCtxHist = []; ocCtxHistRun = null; ocCtxHistSession = session; }
const pt = { tok: total, pct: Math.max(0, Math.min(100, total / max * 100)) };
const key = ocRun || "idle";
if (ocCtxHist.length && ocCtxHistRun === key) ocCtxHist[ocCtxHist.length - 1] = pt;
else { ocCtxHist.push(pt); ocCtxHistRun = key; }
if (ocCtxHist.length > 60) ocCtxHist.shift();
}
// width tiers: phone gets a short spark, tablet a medium one, desktop a long one
function ocSparkTier(width) {
const tier = width < 60 ? { name: "phone", cells: 6 } : width < 100 ? { name: "tablet", cells: 10 } : { name: "desktop", cells: 16 };
const g = OC_CFG.sparkGlyphs;
const pack = typeof ocGlyphPack === "function" ? ocGlyphPack() : { spark: "▁▂▃▄▅▆▇█" };
tier.glyphs = g === "pack" ? pack.spark : (typeof g === "string" ? g : (Array.isArray(g) && g.length ? g.join("") : "▁▂▃▄▅▆▇█"));
return tier;
}
function ocSpark(width) {
const tier = ocSparkTier(width);
const cells = tier.cells;
const pts = ocCtxHist.slice(-cells);
const lv = tier.glyphs;
const P = __ocPalette;
let out = pts.length < cells ? chalk.hex(P.dim)("·".repeat(cells - pts.length)) : "";
for (const p of pts) {
const i = Math.max(0, Math.min(lv.length - 1, Math.ceil(p.pct / 100 * lv.length) - 1));
out += (p.pct >= 80 ? chalk.hex(P.error) : p.pct >= 60 ? chalk.hex(P.accent) : chalk.hex(P.success))(lv[i]);
}
return out;
}
function ocDurFine(ms) { return ms < 60000 ? (ms / 1000).toFixed(1) + "s" : ocDur(ms); }
function ocTokFmt(n) { return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n); }
// one receipt per finished run, attached to the final assistant message
function ocMakeReceipt() {
const r = ocRun;
if (!r || r.receipted) return null;
r.receipted = true;
const L = globalThis.__ocLive;
ocLastReceipt = { ms: Date.now() - r.start, tools: r.tools, failed: r.failed, files: r.files ? r.files.size : 0, add: r.add || 0, del: r.del || 0, tok0: r.tok0, tok1: null, est: L && L.chars && L.lastTs >= r.start ? Math.round(L.chars / 4) : 0 };
const fm = globalThis.__ocFinalMsg;
globalThis.__ocFinalMsg = null;
Object.assign(ocLastReceipt, {
t0: r.start,
calls: (r.calls || []).map((c) => Object.assign({}, c)),
cost0: r.cost0 != null ? r.cost0 : null,
cost1: null,
model: fm && typeof fm.model === "string" && fm.model ? fm.model : null,
msgCost: fm && fm.usage && fm.usage.cost && typeof fm.usage.cost.total === "number" ? fm.usage.cost.total : null
});
return ocLastReceipt;
}
const ocReceiptStore = [];
function ocRecNorm(text) { return String(text || "").replace(/\s+/g, " ").trim().slice(-300); }
// rebuilt history text can gain or lose a leading "[thinking]" block (ctrl+t), so match on the reply's tail, either direction
function ocRecMatch(a, b) {
if (!a || !b) return false;
if (a === b) return true;
const [short, long] = a.length <= b.length ? [a, b] : [b, a];
return short.length >= 12 && long.endsWith(short);
}
function ocReceiptFor(text, live) {
const norm = ocRecNorm(text);
if (live) {
const rec = ocMakeReceipt();
if (rec) {
ocReceiptStore.push({ txt: norm, rec });
if (ocReceiptStore.length > 300) ocReceiptStore.shift();
return rec;
}
}
for (let k = ocReceiptStore.length - 1; k >= 0; k--) if (ocRecMatch(ocReceiptStore[k].txt, norm)) return ocReceiptStore[k].rec;
return null;
}
// ---- run timeline: one coloured block per tool call, sized by how long it ran; the gaps are the model thinking ----
const OC_TL_COLORS = { read: __ocPalette.success, write: __ocPalette.accentSoft, exec: __ocPalette.code, web: __ocPalette.link, other: __ocPalette.dim };
const OC_TL_LABELS = { read: "read", write: "edit", exec: "exec", web: "web", other: "tool", fail: "failed" };
function ocToolFamily(name) {
const k = String(name || "").toLowerCase().replace(/^.*[.:\/]/, "");
if (/^(bash|exec|process|shell|run)/.test(k)) return "exec";
if (/^(write|edit|str_replace|apply_patch|multiedit|multi_edit|replace|create)/.test(k)) return "write";
if (/^(web_|browser|fetch|http|api)/.test(k)) return "web";
if (/^(read|ls|list|glob|grep|find|search|cat|memory_)/.test(k)) return "read";
return "other";
}
function ocTimeline(rec, cells) {
const calls = (rec.calls || []).filter((c) => c && c.t0 != null);
if (!calls.length || !(rec.ms >= 1500) || cells < 6) return null;
const grid = new Array(cells).fill(null);
const dt = rec.ms / cells;
for (const c of calls) {
const t1 = c.t1 == null ? rec.t0 + rec.ms : c.t1;
let s = Math.floor((c.t0 - rec.t0) / dt), e = Math.ceil((t1 - rec.t0) / dt) - 1;
s = Math.max(0, Math.min(cells - 1, s));
e = Math.max(s, Math.min(cells - 1, e));
const fam = c.failed ? "fail" : ocToolFamily(c.name);
for (let i = s; i <= e; i++) if (grid[i] !== "fail") grid[i] = fam;
}
const dimFn = OC_CFG.receiptColor ? chalk.hex(OC_CFG.receiptColor) : chalk.hex(__ocPalette.dim);
const seen = [];
const G = OC_CFG.receiptGlyph || "\u25b0";
let out = "";
for (const g of grid) {
if (!g) { out += dimFn("·"); continue; }
if (!seen.includes(g)) seen.push(g);
out += g === "fail" ? chalk.hex(__ocPalette.error)(G) : chalk.hex(OC_TL_COLORS[g])(G);
}
return { text: out, fams: seen };
}
function ocUsd(x) { return x < 0.01 ? "<$0.01" : "$" + (x < 10 ? x.toFixed(x < 0.1 ? 3 : 2) : x.toFixed(1)); }
// "via <model> · $cost": the model that actually answered (the final message's own model field, which differs from the session's
// model when a router picks) and what the turn cost (session cost growth over the run, else the final message's own usage)
function ocReceiptVia(rec) {
const mode = OC_CFG.receiptVia || "auto";
const out = { via: "", cost: "" };
if (mode !== "never" && rec.model) {
const full = String(rec.model).toLowerCase();
const shown = String(rec.model).replace(/^.*\//, "");
const cur = String(globalThis.__ocSessModel || "").toLowerCase();
const same = cur && (cur === full || cur === shown.toLowerCase() || cur.endsWith("/" + shown.toLowerCase()));
if (mode === "always" || !same) out.via = "via " + shown;
}
let usd = null, approx = false;
const end = rec.cost1 != null ? rec.cost1 : globalThis.__ocSessCost;
if (rec.cost0 != null && end != null && end - rec.cost0 > 0) usd = end - rec.cost0;
else if (rec.msgCost != null && rec.msgCost > 0) { usd = rec.msgCost; approx = true; }
if (usd != null) out.cost = (approx ? "~" : "") + ocUsd(usd);
return out;
}
// receipt rows: the main line (duration + timeline + counts) and an optional legend line, fitted to the width
function ocReceiptLines(rec, width) {
width = width > 0 ? width : (process.stdout.columns || 80);
const dimFn = OC_CFG.receiptColor ? chalk.hex(OC_CFG.receiptColor) : chalk.hex(__ocPalette.dim);
const pad = " ".repeat(OC_CFG.receiptIndent == null ? 2 : OC_CFG.receiptIndent);
const plainLen = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
const tools = rec.tools ? rec.tools + (rec.tools === 1 ? " tool" : " tools") : "";
let files = "";
if (rec.files || rec.add || rec.del) {
const fp = [];
if (rec.files) fp.push(rec.files + (rec.files === 1 ? " file" : " files"));
if (rec.add || rec.del) fp.push("+" + rec.add + " \u2212" + rec.del);
files = fp.join(" ");
}
const vc = ocReceiptVia(rec);
// display order first; r = how long a piece survives on a narrow screen (lowest r is dropped first)
const parts = [{ t: tools, r: 4 }, { t: files, r: 2 }, { t: ocReceiptTokens(rec), r: 1 }, { t: vc.via, r: 0 }, { t: vc.cost, r: 3 }];
const fail = rec.failed ? chalk.hex(__ocPalette.error)(rec.failed + " failed") : "";
let cells = OC_CFG.receiptTimeline === false ? 0 : (width < 60 ? 10 : width < 100 ? 18 : 26);
let tl = null, line = "";
const make = () => {
tl = cells ? ocTimeline(rec, cells) : null;
const ocSparkSum = typeof ocReceiptSparkSummary === "function" ? ocReceiptSparkSummary(rec, width) : "";
const head = dimFn(pad + "\u2514 " + ocDurFine(rec.ms)) + (tl ? dimFn(" ") + tl.text : "") + ocSparkSum;
const rest = parts.filter((p) => p.t).map((p) => dimFn(p.t));
if (fail) rest.push(fail);
line = head + (rest.length ? (tl ? dimFn(" ") : dimFn(" \u00b7 ")) + rest.join(dimFn(" \u00b7 ")) : "");
};
make();
// too wide for the terminal: drop the least important pieces first, then shrink the timeline
while (plainLen(line) > width - 1) {
const alive = parts.filter((p) => p.t).sort((x, y) => x.r - y.r);
if (alive.length) alive[0].t = "";
else if (cells > 8) cells = 8;
else if (cells) cells = 0;
else break;
make();
}
const rows = [ocFit(line, width)];
if (tl && OC_CFG.receiptLegend !== false) {
const leg = [dimFn("· think")].concat(tl.fams.map((f) => (f === "fail" ? chalk.hex(__ocPalette.error)(OC_CFG.receiptGlyph || "\u25b0") : chalk.hex(OC_TL_COLORS[f])(OC_CFG.receiptGlyph || "\u25b0")) + " " + dimFn(OC_TL_LABELS[f])));
const text = pad + "  " + leg.join("  ");
if (plainLen(text) <= width - 1) rows.push(ocFit(text, width));
}
return rows;
}
// ---- while you were away: one line when the tui opens ----
function ocAgo(ms) {
const m = Math.round(ms / 60000);
if (m < 60) return m + "m";
const h = Math.round(m / 60);
return h < 48 ? h + "h" : Math.round(h / 24) + "d";
}
function ocSeenFile() {
try {
const osm = process.getBuiltinModule("os"), pm = process.getBuiltinModule("path");
return pm.join(process.env.OPENCLAW_STATE_DIR || pm.join(osm.homedir(), ".openclaw"), "vimpel-tui-seen");
} catch { return null; }
}
function ocSeenRead() {
try {
const f = ocSeenFile();
const n = f ? Number(process.getBuiltinModule("fs").readFileSync(f, "utf8").trim()) : 0;
return n > 0 ? n : null;
} catch { return null; }
}
function ocSeenWrite() {
try {
const f = ocSeenFile();
if (f) process.getBuiltinModule("fs").writeFileSync(f, String(Date.now()));
} catch {}
}
function ocSeenStart() {
if (globalThis.__ocSeenTimer) return;
ocSeenWrite();
globalThis.__ocSeenTimer = setInterval(ocSeenWrite, 60000);
if (globalThis.__ocSeenTimer.unref) globalThis.__ocSeenTimer.unref();
process.once("exit", ocSeenWrite);
}
async function ocAwayDigest(client, state, record, since) {
const bits = [];
const stamp = (m) => { const v = m && (typeof m.timestamp === "number" ? m.timestamp : Date.parse(m.timestamp)); return v > 0 ? v : 0; };
const msgs = (record && Array.isArray(record.messages) ? record.messages : []).filter((m) => m && (m.role === "user" || m.role === "assistant") && stamp(m) > since).length;
try {
const res = await client.client.request("cron.runs", { scope: "all", limit: 200, sortDir: "desc" });
const runs = (res && Array.isArray(res.entries) ? res.entries : []).filter((e) => e && e.ts > since);
if (runs.length) {
const bad = runs.filter((e) => /error|fail|timeout/i.test(String(e.status || ""))).length;
bits.push(runs.length + " cron run" + (runs.length === 1 ? "" : "s") + (bad ? " (" + bad + " failed)" : ""));
}
} catch {}
if (msgs) bits.push(msgs + " new message" + (msgs === 1 ? "" : "s"));
try {
const res = await client.listSessions({ limit: 60 });
const rows = Array.isArray(res) ? res : res && Array.isArray(res.sessions) ? res.sessions : [];
const n = rows.filter((r) => r && r.key !== state.currentSessionKey && Number(r.updatedAt) > since).length;
if (n) bits.push(n + " other session" + (n === 1 ? "" : "s") + " active");
} catch {}
return bits.length ? "\u263e since you left (" + ocAgo(Date.now() - since) + "): " + bits.join(" \u00b7 ") : "";
}
function ocDigestAtLoad(chatLog, client, state, record) {
try {
if (!OC_CFG.awayDigest) return;
if (globalThis.__ocDigestText) { chatLog.addSystem(globalThis.__ocDigestText); return; }
if (globalThis.__ocDigestStarted) return;
globalThis.__ocDigestStarted = true;
const since = ocSeenRead();
ocSeenStart();
if (!since || Date.now() - since < (OC_CFG.awayMinMs || 600000)) return;
ocAwayDigest(client, state, record, since).then((text) => {
if (!text || ocRunning) return;
globalThis.__ocDigestText = text;
chatLog.addSystem(text);
ocRender();
}).catch(() => {});
} catch {}
}
function ocReceiptTokens(rec) {
// real growth of the session token count when we have it (can land a moment after the reply), else the streamed estimate
const end = rec.tok1 != null ? rec.tok1 : ocTotalTokens;
if (rec.tok0 != null && end != null && end > rec.tok0) return "+" + ocTokFmt(end - rec.tok0) + " tokens";
return rec.est ? "~" + ocTokFmt(rec.est) + " tokens" : "";
}
function ocReceiptLine(rec) {
const dimFn = OC_CFG.receiptColor ? chalk.hex(OC_CFG.receiptColor) : chalk.hex(__ocPalette.dim);
const bits = [ocDurFine(rec.ms)];
if (rec.tools) bits.push(rec.tools + (rec.tools === 1 ? " tool" : " tools"));
if (rec.files || rec.add || rec.del) {
const fp = [];
if (rec.files) fp.push(rec.files + (rec.files === 1 ? " file" : " files"));
if (rec.add || rec.del) fp.push("+" + rec.add + " \u2212" + rec.del);
bits.push(fp.join(" "));
}
const tok = ocReceiptTokens(rec);
if (tok) bits.push(tok);
let line = dimFn(" ".repeat(OC_CFG.receiptIndent == null ? 2 : OC_CFG.receiptIndent) + "\u2514 " + bits.join(" \u00b7 "));
if (rec.failed) line += dimFn(" \u00b7 ") + chalk.hex(__ocPalette.error)(rec.failed + " failed");
return ocFit(line, process.stdout.columns || 80);
}
function ocFinishRun(verb) {
const r = ocRun || { start: Date.now(), tools: 0, failed: 0 };
const ms = Date.now() - r.start;
globalThis.__ocLastDoneAt = Date.now();
if (OC_CFG.bellAfterMs > 0 && ms >= OC_CFG.bellAfterMs) { try { if (process.stdout.isTTY) process.stdout.write("\x07"); } catch {} }
ocNotifyDone(ms);
const failRatio = r.tools > 0 && r.failed * 2 >= r.tools;
const providerError = String(r.providerError || "").replace(/\s+/g, " ").trim().slice(0, 100);
const noResponse = !r.replySeen && !providerError;
const isError = !!providerError || noResponse || failRatio;
const kind = isError ? "meltdown" : r.failed ? "sad" : (r.tools >= 6 || ms >= 60000) ? "bigwin" : "win";
ocDone = { at: Date.now(), kind, seed: ocRand(997) };
globalThis.__ocLastCompletionError = isError;
const bits = [isError ? "error" : verb, ocDur(ms)];
if (providerError) bits.push("provider: " + providerError);
if (noResponse) bits.push("agent finished without a response");
if (failRatio) bits.push(r.failed + "/" + r.tools + " tools failed");
if (!isError && r.tools) bits.push(r.tools + (r.tools === 1 ? " tool" : " tools"));
if (!isError && r.failed) bits.push(r.failed + " failed");
return bits.join(" \u00b7 ");
}
// scrolling gradient for the box rules while busy: follows the palette's link -> code -> accent, looping
// (null when idle -> caller falls back to the plain border)
const OC_STOPS = [__ocPalette.link, __ocPalette.code, __ocPalette.accent].map((h) => ocHexRgb(h, __ocPalette.accent));
globalThis.__ocShim = (text, col) => {
if (!ocRunning) return null;
const t0 = Date.now() / 1400;
const chars = Array.from(text);
let out = "";
for (let i = 0; i < chars.length; i++) {
const p = ((((col + i) / 14 - t0) % 3) + 3) % 3;
const k = Math.floor(p), f = p - k;
const a = OC_STOPS[k], b = OC_STOPS[(k + 1) % 3];
out += chalk.rgb(Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f))(chars[i]);
}
return out;
};
function ocToastShow(text, ms, now) {
const t = String(text || "").replace(/\x1b\[[0-9;]*m/g, "").trim();
if (!t) return;
const item = { text: t.slice(0, 110), ms: ms || 2600 };
// a toast is still on screen: queue this one behind it (same text dropped, queue capped at 4) instead of overwriting it.
// now = true (ctrl+x feedback) replaces whatever is showing and clears the queue
if (!now && ocToast && Date.now() - ocToast.at < ocToast.ms) {
if (ocToast.text === item.text || ocToastQ.some((q) => q.text === item.text)) return;
ocToastQ.push(item);
if (ocToastQ.length > 4) ocToastQ.shift();
ocTickEnsure();
return;
}
if (now) ocToastQ.length = 0;
ocToast = Object.assign(item, { at: Date.now() });
ocTickEnsure();
ocRender();
}
function ocToastLine(width) {
if (ocToast && Date.now() - ocToast.at >= ocToast.ms) ocToast = ocToastQ.length ? Object.assign(ocToastQ.shift(), { at: Date.now() }) : null;
if (!ocToast) return "";
const age = Date.now() - ocToast.at;
const fadeAt = ocToast.ms * 0.55;
const k = age < fadeAt ? 0 : (age - fadeAt) / (ocToast.ms - fadeAt);
const from = ocHexRgb(__ocPalette.accentSoft, __ocPalette.accent), to = ocHexRgb(__ocPalette.quote, __ocPalette.dim);
const c = from.map((v, i) => Math.round(v + (to[i] - v) * k));
return chalk.rgb(c[0], c[1], c[2])(("  \u2726 " + ocToast.text).slice(0, Math.max(0, width - 1)));
}
const ocToastRes = OC_CFG.toastPatterns.map((p) => new RegExp(p, "i"));
function ocMaybeToast(text) {
const t = String(text || "").replace(/\x1b\[[0-9;]*m/g, "").trim();
if (!t || t.length > 80 || t.indexOf("\n") !== -1) return false;
if (/error|fail|unknown|usage|invalid|denied|unable|cannot|can't/i.test(t)) return false;
if (!ocToastRes.some((re) => re.test(t))) return false;
ocToastShow(t);
return OC_TOAST_SWALLOW;
}
const ocYapOffset = ocRand(1000);
function ocPlaceholder(maxw) {
const list = OC_CFG.yaps;
if (!list.length || maxw < 6) return "";
let t = list[(ocYapOffset + Math.floor(Date.now() / 20000)) % list.length];
if (t.length > maxw) t = t.slice(0, Math.max(0, maxw - 1)) + "\u2026";
return chalk.hex(__ocPalette.dim)(t);
}
function ocExitText() {
const crises = ocStats.failed + ocStats.ctxHits;
const bits = [
ocDur(Date.now() - ocStats.start),
ocStats.tools + " tool call" + (ocStats.tools === 1 ? "" : "s"),
crises + " existential " + (crises === 1 ? "crisis" : "crises")
];
const line = "\u263e " + bits.join(" \u00b7 ");
const closer = OC_CFG.closers.length ? OC_CFG.closers[ocRand(OC_CFG.closers.length)] : "";
return "\n" + (typeof ocGradient === "function" ? ocGradient(line) : line) + (closer ? chalk.hex(__ocPalette.dim)(" \u2014 " + closer) : "") + "\n";
}
// ---- diff blocks for edit / write / apply_patch calls, built from the call's own args ----
// pipeline: ocDiffBuild -> ops ("+"/"-"/" "/"@"/"#"/"~") -> ocDiffRenderUnified | ocDiffRenderSplit.
// ops are cached per call so the 90ms render loop never re-diffs; both renderers keep the
// @@ hunk headers and apply_patch filenames and pad backgrounds to the full width.
function ocDiffPick(a, names) {
for (const n of names) if (a && typeof a[n] === "string") return a[n];
return null;
}
function ocDiffOps(oldText, newText) {
const A = oldText.split("\n"), B = newText.split("\n");
let p = 0;
while (p < A.length && p < B.length && A[p] === B[p]) p++;
let q = 0;
while (q < A.length - p && q < B.length - p && A[A.length - 1 - q] === B[B.length - 1 - q]) q++;
const a = A.slice(p, A.length - q), b = B.slice(p, B.length - q);
const ops = [];
for (let i = Math.max(0, p - 2); i < p; i++) ops.push([" ", A[i]]);
if (a.length * b.length <= 40000) {
const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
let i = 0, j = 0;
while (i < a.length && j < b.length) {
if (a[i] === b[j]) { ops.push([" ", a[i]]); i++; j++; }
else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(["-", a[i++]]);
else ops.push(["+", b[j++]]);
}
while (i < a.length) ops.push(["-", a[i++]]);
while (j < b.length) ops.push(["+", b[j++]]);
} else {
for (const l of a) ops.push(["-", l]);
for (const l of b) ops.push(["+", l]);
}
for (let i = A.length - q; i < Math.min(A.length, A.length - q + 2); i++) ops.push([" ", A[i]]);
return ops;
}
function ocDiffBuild(toolName, args) {
try {
let a = args;
if (typeof a === "string") { try { a = JSON.parse(a); } catch { return []; } }
if (!a || typeof a !== "object") return [];
if (process.env.OC_DIFF_DEBUG) {
const seen = globalThis.__ocDiffDbg || (globalThis.__ocDiffDbg = new WeakSet());
if (!seen.has(a)) {
seen.add(a);
try { process.getBuiltinModule("fs").appendFileSync((process.env.TMPDIR || "/tmp") + "/oc-diff-debug.log", JSON.stringify({ tool: toolName, keys: Object.keys(a), types: Object.values(a).map((v) => Array.isArray(v) ? "array" : typeof v) }) + "\n"); } catch {}
}
}
const name = String(toolName || "").toLowerCase().replace(/^.*[.:\/]/, "");
let ops = [];
const OLD = ["oldText", "old_string", "oldString", "old_str", "oldStr", "old"];
const NEW = ["newText", "new_string", "newString", "new_str", "newStr", "new"];
if (/^(edit|str_replace|replace|multiedit|multi_edit)$/.test(name)) {
const pairs = Array.isArray(a.edits) ? a.edits : [a];
pairs.forEach((e, idx) => {
const o = ocDiffPick(e, OLD), n = ocDiffPick(e, NEW);
if (o === null || n === null) return;
if (idx > 0) ops.push(["~", ""]);
ops = ops.concat(ocDiffOps(o, n));
});
} else if (/^(write|create|create_file|write_file)$/.test(name)) {
const c = ocDiffPick(a, ["content", "text", "contents", "data"]);
if (c === null) return [];
const ls = c.split("\n");
for (const l of ls.slice(0, 8)) ops.push(["+", l]);
if (ls.length > 8) ops.push(["~", "\u2026 +" + (ls.length - 8) + " more lines"]);
} else if (/^(apply_patch|patch)$/.test(name)) {
const t = ocDiffPick(a, ["input", "patch", "diff", "content"]);
if (t === null) return [];
for (const l of t.split("\n")) {
if (/^\*\*\* (Begin|End) Patch/.test(l)) continue;
if (/^\*\*\* /.test(l)) ops.push(["#", l.slice(4)]);
else if (/^(\+\+\+|---) /.test(l)) ops.push(["#", l]);
else if (l.startsWith("@@")) ops.push(["@", l]);
else if (l.startsWith("+")) ops.push(["+", l.slice(1)]);
else if (l.startsWith("-")) ops.push(["-", l.slice(1)]);
else if (l.startsWith(" ")) ops.push([" ", l.slice(1)]);
}
}
if (!ops.length) return [];
// collapse long unchanged runs: keep 2 lines at each end of the run
const squashed = [];
for (let i = 0; i < ops.length;) {
if (ops[i][0] !== " ") { squashed.push(ops[i++]); continue; }
let j = i;
while (j < ops.length && ops[j][0] === " ") j++;
if (j - i > 5) squashed.push(ops[i], ops[i + 1], ["~", ""], ops[j - 2], ops[j - 1]);
else for (let k = i; k < j; k++) squashed.push(ops[k]);
i = j;
}
return squashed;
} catch {
return [];
}
}
// ops only change when the call's args do: compute once per block instead of every 90ms frame
function ocDiffCached(c) {
const k = c.args, h = c.__ocDC;
if (h && h.k === k) return h.ops;
const ops = ocDiffBuild(c.toolName, k);
c.__ocDC = { k, ops };
return ops;
}
function ocDiffMode(width) {
const m = OC_CFG.inlineDiff;
if (m === true || m === "inline") return "inline";
// "auto" (default) and false (legacy): side-by-side once the terminal is wide enough
return width >= (OC_CFG.diffSplitMin || 140) ? "split" : "inline";
}
function ocDiffRenderFor(c, width) {
const ops = ocDiffCached(c);
if (!ops.length) return [];
return ocDiffMode(width) === "split" ? ocDiffRenderSplit(ops, width) : ocDiffRenderUnified(ops, width);
}
function ocDiffRenderUnified(ops, width) {
const MAX = 30;
const clip = (t) => Array.from(String(t).replace(/\t/g, "  ").replace(/\r/g, "")).slice(0, Math.max(0, width - 6)).join("");
const rows = [];
let hidden = 0;
for (const op of ops) {
const k = op[0], t = op[1];
if (rows.length >= MAX) { hidden++; continue; }
if (k === "+" || k === "-") {
const plain = "  " + k + " " + clip(t);
const pad = " ".repeat(Math.max(0, width - Array.from(plain).length));
rows.push(chalk.bgHex(k === "+" ? __ocPalette.toolSuccessBg : __ocPalette.toolErrorBg)((k === "+" ? chalk.hex(__ocPalette.success) : chalk.hex(__ocPalette.error))(plain + pad)));
} else if (k === " ") rows.push(ocTheme.dim("    " + clip(t)));
else if (k === "@") rows.push(chalk.hex(__ocPalette.link)("  " + clip(t)));
else if (k === "#") rows.push(chalk.bold(ocTheme.dim("  " + clip(t))));
else rows.push(ocTheme.dim("    " + (t ? clip(t) : "\u22ef")));
}
if (hidden) rows.push(ocTheme.dim("    \u2026 +" + hidden + " more lines"));
return rows;
}
// side-by-side: deleted lines on the left, added lines on the right, context on both
function ocDiffRenderSplit(ops, width) {
const colW = Math.floor((width - 5) / 2);
const clip = (t, w) => Array.from(String(t).replace(/\t/g, "  ").replace(/\r/g, "")).slice(0, Math.max(0, w)).join("");
const padTo = (t, w) => t + " ".repeat(Math.max(0, w - Array.from(t).length));
const bgDel = chalk.bgHex(__ocPalette.toolErrorBg), bgAdd = chalk.bgHex(__ocPalette.toolSuccessBg);
const bar = ocTheme.dim(" \u2502 ");
const rows = [];
let dels = [], adds = [];
const flush = () => {
const n = Math.max(dels.length, adds.length);
for (let i = 0; i < n; i++) {
const l = i < dels.length ? bgDel(chalk.hex(__ocPalette.error)(padTo("- " + clip(dels[i], colW - 2), colW))) : " ".repeat(colW);
const r = i < adds.length ? bgAdd(chalk.hex(__ocPalette.success)(padTo("+ " + clip(adds[i], colW - 2), colW))) : " ".repeat(colW);
rows.push("  " + l + bar + r);
}
dels = []; adds = [];
};
for (const op of ops) {
const k = op[0], t = op[1];
if (k === "-") { dels.push(t); continue; }
if (k === "+") { adds.push(t); continue; }
flush();
if (k === " ") { const c = ocTheme.dim(padTo("  " + clip(t, colW - 2), colW)); rows.push("  " + c + bar + c); }
else if (k === "@") rows.push(chalk.hex(__ocPalette.link)("  " + clip(t, width - 4)));
else if (k === "#") rows.push(chalk.bold(ocTheme.dim("  " + clip(t, width - 4))));
else rows.push(ocTheme.dim("    " + (t ? clip(t, width - 6) : "\u22ef")));
}
flush();
const MAX = 28;
const out = rows.slice(0, MAX);
if (rows.length > MAX) out.push(ocTheme.dim("    \u2026 +" + (rows.length - MAX) + " more rows"));
return out;
}
// ---- end diff blocks
// shorten uuids to their first 8 hex chars ("tui-d17db705-889d-..." -> "tui-d17db705")
function ocShortIds(t) {
return typeof t === "string" ? t.replace(/\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "$1") : t;
}
function ocProfile() {
const cols = process.stdout.columns || 80, rows = process.stdout.rows || 24;
const L = OC_CFG.profiles.large, M = OC_CFG.profiles.medium || { minCols: 76, minRows: 18, padTop: 0, padBottom: 0 };
if (cols >= L.minCols && rows >= L.minRows) return Object.assign({ name: "large" }, L);
if (cols >= (M.minCols || 76) && rows >= (M.minRows || 18)) return Object.assign({ name: "medium" }, M);
return Object.assign({ name: "small" }, OC_CFG.profiles.small);
}
globalThis.__ocPad = () => { const P = ocProfile(); return { top: P.padTop || 0, bottom: P.padBottom || 0 }; };
// large profile: render the whole UI in a centred column of maxWidth instead of edge to edge.
// also applies the live search highlight so matches glow on the final composed screen.
function ocWrapRoot(root) {
if (!root || root.__ocWrapped || typeof root.render !== "function") return;
root.__ocWrapped = true;
const orig = root.render.bind(root);
root.render = (width) => {
const P = ocProfile();
let lines, innerWidth = width, pad = "";
if (P.name === "large" && P.maxWidth && width > P.maxWidth + 2) {
  innerWidth = P.maxWidth;
  pad = " ".repeat(Math.floor((width - P.maxWidth) / 2));
  lines = orig(innerWidth).map((l) => (l ? pad + l : l));
} else lines = orig(width);
lines = ocClampAll(lines, width);
// Preserve the component tree's own viewport/scroll window. The previous wrapper
// cropped the rendered transcript to the last terminal rows after ChatLog had already
// selected its scroll window; that second crop made scrolling appear stuck at the bottom.
// Only pad short screens at the top so the composer remains bottom-aligned. Never trim
// overflow here: pi-tui's renderer owns clipping and ChatLog owns transcript scrolling.
const rows = Math.max(1, process.stdout.rows || 24);
if (lines.length < rows) lines = Array(rows - lines.length).fill("").concat(lines);
return typeof ocSearchApply === "function" ? ocSearchApply(lines) : lines;
};
}
globalThis.__ocPlaceholder = ocPlaceholder;
globalThis.__ocToast = ocToastShow;
// right-align a child component's rendered lines inside the given width,
// leaving 'gutter' columns of empty space on the right edge (messaging-app user prompts)
function ocRightAlign(child, gutter) {
return {
invalidate() { child.invalidate?.(); },
render(width) {
const g = Math.max(0, gutter | 0);
const inner = Math.max(1, width - g);
const lines = child.render(inner);
return lines.map((line) => {
const vis = String(line).replace(/\x1b\[[0-9;]*m/g, "").length;
return " ".repeat(Math.max(0, width - g - vis)) + line;
});
}
};
}
if (globalThis.__ocFold === undefined) globalThis.__ocFold = false;
// ---- chat-level state: header folds after the first message, tool-run grouping, ctrl+x view cycle, phone status segment
globalThis.__ocHasMsgs = false;
function ocMsgSeen() {
if (globalThis.__ocHasMsgs) return;
globalThis.__ocHasMsgs = true;
try { if (globalThis.__ocUpdateHeader) globalThis.__ocUpdateHeader(); } catch {}
ocRender();
}
function ocChatReset() {
globalThis.__ocHasMsgs = false;
globalThis.__ocResetAt = Date.now();
ocGroupCur = null;
// a history rebuild sets the flag again straight away; an empty session (/new) gets its full header back a moment later
const t = setTimeout(() => {
if (globalThis.__ocHasMsgs) return;
try { if (globalThis.__ocUpdateHeader) globalThis.__ocUpdateHeader(); } catch {}
ocRender();
}, 150);
if (t.unref) t.unref();
}
function ocHeaderCollapsed() {
if (ocDensity() !== "full") return true;
const m = OC_CFG.collapseHeader || "always";
if (m === "never" || !globalThis.__ocHasMsgs) return false;
return m === "always" || ocProfile().name === "small";
}
// consecutive tool calls (no user/assistant message in between) form a run; finished ok calls of a run of groupMin+ collapse into one line
let ocGroupCur = null;
function ocGroupJoin(c) {
if (c.__ocGroup) return;
if (!ocGroupCur) ocGroupCur = { members: [] };
ocGroupCur.members.push(c);
c.__ocGroup = ocGroupCur;
}
function ocGroupClose() { ocGroupCur = null; }
function ocGroupActive() { return !!OC_CFG.groupTools && (globalThis.__ocViewName || "grouped") === "grouped"; }
function ocGroupState(c) {
const g = c.__ocGroup;
if (!g || !ocGroupActive() || c.isPartial || c.isError) return null;
const ok = g.members.filter((m) => !m.isPartial && !m.isError);
if (ok.length < (OC_CFG.groupMin || 3)) return null;
return ok[0] === c ? "first" : "rest";
}
function ocGroupGap(c) { return ocGroupState(c) === "rest" ? [] : [""]; }
function ocGroupRender(c, width) {
const st = ocGroupState(c);
if (!st) return null;
if (st === "rest") return [];
const ok = c.__ocGroup.members.filter((m) => !m.isPartial && !m.isError);
const counts = new Map(), files = new Set();
let add = 0, del = 0;
for (const m of ok) {
const k = String(m.toolName || "tool").toLowerCase().replace(/^.*[.:\/]/, "");
counts.set(k, (counts.get(k) || 0) + 1);
if (m.__ocGS === undefined) m.__ocGS = ocDiffStat(m.toolName, m.args) || null;
if (m.__ocGS) { for (const f of m.__ocGS.files) files.add(f); add += m.__ocGS.add; del += m.__ocGS.del; }
}
const head = ok.length + " tools";
const names = Array.from(counts, ([k, n]) => (n > 1 ? k + " \u00d7" + n : k)).join(" \u00b7 ");
const extra = files.size || add || del ? "  " + (files.size ? files.size + (files.size === 1 ? " file " : " files ") : "") + "+" + add + " \u2212" + del : "";
const tail = "  \u25b8 ctrl+x";
let body = names + extra;
const room = width - (2 + head.length + 2);
if (room >= body.length + tail.length) body += tail;
else if (body.length > room) body = body.slice(0, Math.max(0, room - 1)) + "\u2026";
return [ocFit(chalk.hex(__ocPalette.success)("\u25cf") + " " + ocTheme.bold(head) + "  " + ocTheme.dim(body), width)];
}
// ctrl+x cycles the tool view: grouped -> expanded -> folded (no "grouped" stop when groupTools is off)
function ocViewNext() {
const modes = OC_CFG.groupTools ? ["grouped", "expanded", "folded"] : ["expanded", "folded"];
const cur = globalThis.__ocViewName || modes[0];
const nxt = modes[(modes.indexOf(cur) + 1) % modes.length];
globalThis.__ocViewName = nxt;
globalThis.__ocFold = nxt === "folded";
return nxt;
}
globalThis.__ocViewNext = ocViewNext;
// phone profile: "connected . idle" lives in the chat bar's top rule instead of its own line
function ocConnSeg() {
if (ocRunning || !ocTight()) return "";
return globalThis.__ocConnText || "";
}
// ---- layout features: density (ctrl+\), agent rail, time gaps, split diffs, right-aligned status, now strip
if (globalThis.__ocDensity === undefined) globalThis.__ocDensity = OC_CFG.density || "full";
function ocDensity() { return globalThis.__ocDensity || "full"; }
function ocDensityNext() {
const modes = ["full", "compact", "zen"];
const nxt = modes[(modes.indexOf(ocDensity()) + 1) % modes.length];
globalThis.__ocDensity = nxt;
try { if (globalThis.__ocUpdateHeader) globalThis.__ocUpdateHeader(); } catch {}
ocRender();
return nxt;
}
globalThis.__ocDensityNext = ocDensityNext;
// "tight" = phone profile or a denser-than-full layout: status line moves into the bar, spare rows are given back
function ocTight() { return ocProfile().name === "small" || ocDensity() !== "full"; }
// agent rail: a colour per agent name. the first agent seen keeps the accent colour (null), the others hash into the list
const OC_AGENT_TONES = [__ocPalette.accent, __ocPalette.success, __ocPalette.code, __ocPalette.link, __ocPalette.accentSoft, __ocPalette.quote];
function ocAgentTone(name) {
const n = String(name || "").toLowerCase();
if (OC_CFG.agentRail === false || !n) return null;
if (!globalThis.__ocBaseAgent) globalThis.__ocBaseAgent = n;
if (n === globalThis.__ocBaseAgent) return null;
let h = 0;
for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
return OC_AGENT_TONES[h % OC_AGENT_TONES.length];
}
function ocRail(child, toneFn) {
return {
invalidate() { child.invalidate?.(); },
render(width) {
const t = toneFn ? toneFn() : null;
const mark = OC_CFG.agentRail === false ? "  " : (t ? chalk.hex(t) : (ocTheme.accent || String))("\u258e") + " ";
return child.render(Math.max(1, width - 2)).map((l) => mark + l);
}
};
}
// time gaps: a faint centred rule with the time above a message that arrives after a long silence.
// remembered by message text, so the rule survives the history rebuild after each turn
const ocGapStore = new Map();
function ocGapRow(kind, text) {
const gap = OC_CFG.timeGapMs, now = Date.now(), last = globalThis.__ocLastMsgAt || 0;
globalThis.__ocLastMsgAt = now;
if (!gap) return null;
const key = kind + ":" + ocRecNorm(text);
let label = ocGapStore.get(key) || null;
if (!label && last && now - last >= gap && now - (globalThis.__ocResetAt || 0) >= 2500) {
const d = new Date(now);
const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
label = d.toDateString() === new Date(last).toDateString() ? hm : d.toLocaleDateString([], { weekday: "short" }) + " " + hm;
ocGapStore.set(key, label);
if (ocGapStore.size > 200) ocGapStore.delete(ocGapStore.keys().next().value);
}
if (!label) return null;
return {
invalidate() {},
render(width) {
const dimFn = OC_CFG.receiptColor ? chalk.hex(OC_CFG.receiptColor) : chalk.hex(__ocPalette.dim);
const t = " " + label + " ";
const side = Math.max(2, Math.floor((width - t.length) / 2));
const rest = Math.max(0, width - side - t.length);
const row = dimFn("\u2500".repeat(side) + t + "\u2500".repeat(rest));
const fitted = ocFit(row, width);
return kind === "u" ? [fitted, ""] : [fitted];
}
};
}
// idle status row: bits pushed to the right edge (statusRight in CFG)
function ocStatusRight(lines, width) {
if (!lines || lines.length !== 1) return lines;
const want = Array.isArray(OC_CFG.statusRight) ? OC_CFG.statusRight : [];
const bits = [];
for (const k of want) {
if (k === "ago" && globalThis.__ocLastDoneAt) bits.push("last reply " + ocAgo(Date.now() - globalThis.__ocLastDoneAt) + " ago");
else if (k === "model" && globalThis.__ocSessModel) bits.push(String(globalThis.__ocSessModel).replace(/^.*\//, ""));
else if (k === "clock") bits.push(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }));
else if (k === "run" && ocLastReceipt) bits.push(ocDurFine(ocLastReceipt.ms) + (ocLastReceipt.tools ? " \u00b7 " + ocLastReceipt.tools + (ocLastReceipt.tools === 1 ? " tool" : " tools") : ""));
}
if (!bits.length) return lines;
const right = chalk.hex(__ocPalette.dim)(bits.join(" \u00b7 "));
const strip = (t) => String(t).replace(/\x1b\[[0-9;]*m/g, "");
const left = String(lines[0]).replace(/(?:\s|\x1b\[[0-9;]*m)+$/, "");
const lw = Array.from(strip(left)).length, rw = Array.from(strip(right)).length;
if (lw + rw + 3 > width) return lines.map((l) => ocFit(l, width));
return [ocFit(left + "\x1b[0m" + " ".repeat(Math.max(0, width - lw - rw)) + right, width)];
}
// busy line while a tool runs: what it is doing, how long, what just finished
function ocArgBrief(c) {
let a = c.args;
if (typeof a === "string") { try { a = JSON.parse(a); } catch { return ""; } }
if (!a || typeof a !== "object") return "";
for (const k of ["command", "cmd", "path", "file_path", "filePath", "file", "query", "url", "pattern", "name", "text"]) {
if (typeof a[k] === "string" && a[k].trim()) return a[k].replace(/\s+/g, " ").trim();
}
return "";
}
function ocNowStrip(elapsed) {
if (!OC_CFG.nowStrip) return "";
const c = ocLive[ocLive.length - 1];
if (!c) return "";
const name = String(c.toolName || "tool").toLowerCase().replace(/^.*[.:\/]/, "");
const dur = ocDur(Date.now() - (c.__ocT0 || Date.now()));
const done = (ocRun && ocRun.calls ? ocRun.calls : []).filter((x) => x.t1 != null).slice(-6);
const groups = [];
for (const x of done) {
const n = String(x.name || "tool").toLowerCase().replace(/^.*[.:\/]/, "");
const g = groups[groups.length - 1];
if (g && g.n === n && g.bad === !!x.failed) g.k++;
else groups.push({ n, k: 1, bad: !!x.failed });
}
const ticks = groups.slice(-4).map((g) => (g.bad ? chalk.hex(__ocPalette.error)("\u2717 " + g.n) : "\u2713 " + g.n) + (g.k > 1 ? "\u00d7" + g.k : ""));
const plainLen = (t) => Array.from(String(t).replace(/\x1b\[[0-9;]*m/g, "")).length;
const tail = elapsed ? "  " + elapsed : "";
const room = Math.max(20, (process.stdout.columns || 80) - 14);
let brief = ocArgBrief(c);
const mk = (b, withTicks) => name + (b ? " " + b : "") + " \u00b7 " + dur + (withTicks && ticks.length ? "   " + ticks.join(" ") : "") + tail;
let out = mk(brief, true);
if (plainLen(out) > room) out = mk(brief, false);
if (plainLen(out) > room && brief) {
const over = plainLen(out) - room;
brief = brief.length > over + 2 ? brief.slice(0, brief.length - over - 1) + "\u2026" : "";
out = mk(brief, false);
}
return ocFit(out, process.stdout.columns || 80);
}
// a mode that means something: IDLE / BUSY / CMD / QUEUED (no fake vim states - the editor is not modal)
function ocMode() {
try {
const text = typeof globalThis.__ocEditorText === "function" ? globalThis.__ocEditorText() : "";
if (text && (text[0] === "/" || text[0] === "?")) return "CMD";
} catch {}
if (ocRunning) return "BUSY";
if (typeof ocImageCount === "function" && ocImageCount() > 0) return "QUEUED";
return "IDLE";
}
globalThis.__ocMode = ocMode;
// vim-style status bar above the chat input. The chat box keeps its own bottom rule;
// the bar carries mode, model, context/tokens, cost, and clock.
function ocVimStatusBar(width) {
// This is the terminal's pinned bottom row; keep it in compact and zen layouts too.
if (!OC_CFG.vimStatusBar) return [];
const dimFn = (t) => chalk.hex(__ocPalette.dim)(t);
const clean = (t) => String(t == null ? "" : t).replace(/\x1b\[[0-9;]*m/g, "");
// Approximate terminal columns after ANSI removal. The final ocFit is the hard width guard.
const vw = (t) => typeof ocVisLen === "function" ? ocVisLen(t) : Array.from(clean(t)).length;
const sep = dimFn(" • ");
const left = [];
const right = [];
if (OC_CFG.vimStatusMode !== false) {
  const mode = typeof ocMode === "function" ? ocMode() : "IDLE";
  const tone = mode === "BUSY" ? chalk.hex(__ocPalette.accent) : mode === "CMD" ? chalk.hex(__ocPalette.link) : mode === "QUEUED" ? chalk.hex(__ocPalette.success) : dimFn;
  left.push(tone(" " + mode + " "));
}
if (OC_CFG.vimStatusProject !== false) {
  let project = "";
  try { const p0 = process.getBuiltinModule("path"); project = p0.basename(process.cwd()); } catch {}
  if (project) left.push(dimFn("in:" + project));
}
if (OC_CFG.vimStatusGit) {
  if (globalThis.__ocGitBranch === undefined) {
    globalThis.__ocGitBranch = null;
    try {
      const cp = require("child_process");
      const r = cp.spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", timeout: 1500 });
      if (r.status === 0 && r.stdout.trim()) globalThis.__ocGitBranch = r.stdout.trim();
    } catch {}
  }
  if (globalThis.__ocGitBranch) left.push(dimFn("git:" + globalThis.__ocGitBranch));
}
// The model is now a first-class status-bar segment, rather than hidden in the editor border.
let model = clean(globalThis.__ocSessModel || "");
if (!model) {
  const bottom = globalThis.__ocBarInfo && globalThis.__ocBarInfo.bottom;
  const seg = Array.isArray(bottom) ? bottom.find((x) => x && x.p === 2 && x.t) : null;
  model = clean(seg && seg.t ? seg.t : "").trim();
}
model = model.replace(/^model\s*[:=]?\s*/i, "").trim();
const modelShort = model.replace(/^.*\//, "");
const total = ocTotalTokens;
let tokenText = "";
if (OC_CFG.vimStatusTokens !== false && total != null) {
  const top = globalThis.__ocBarInfo && globalThis.__ocBarInfo.top;
  const ctx = Array.isArray(top) ? top.find((x) => x.t && String(x.t).indexOf("%") !== -1) : null;
  const tok = total >= 1000 ? (total / 1000).toFixed(1) + "k" : String(total);
  tokenText = ctx && ctx.t ? tok + " tok · " + clean(ctx.t).trim() : tok + " tok";
}
// Keep the original live context meter in tokenText; do not add a second historical sparkline.
if (model) right.push({ key: "model", text: model, short: modelShort, priority: 1 });
if (tokenText) right.push({ key: "tokens", text: tokenText, priority: 3 });
if (OC_CFG.vimStatusCost !== false && globalThis.__ocSessCost != null) right.push({ key: "cost", text: ocUsd(globalThis.__ocSessCost), priority: 4 });
if (OC_CFG.vimStatusSession !== false) {
  const bottom = globalThis.__ocBarInfo && globalThis.__ocBarInfo.bottom;
  const session = Array.isArray(bottom) ? bottom.find((x) => x.k === "session") : null;
  if (session && session.t) right.push({ key: "session", text: clean(session.t).trim(), priority: 5 });
}
if (OC_CFG.vimStatusClock !== false) right.push({ key: "clock", text: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }), priority: 6 });
const join = (ls) => ls.map((x) => typeof x === "string" ? x : x.text).join(sep);
const maxWidth = Math.max(1, width - 2);
const lineWidth = () => vw(join(left)) + (left.length && right.length ? vw(sep) : 0) + vw(join(right));
// Shed optional details first; retain the model and context/tokens as long as possible.
while (lineWidth() > maxWidth) {
  let idx = -1;
  for (let i = 0; i < right.length; i++) {
    if (right[i].priority > 2 && (idx < 0 || right[i].priority > right[idx].priority)) idx = i;
  }
  if (idx < 0) break;
  right.splice(idx, 1);
}
// Shorten the provider/model before sacrificing the sparkline.
if (lineWidth() > maxWidth) {
  const m = right.find((x) => x.key === "model");
  if (m) m.text = m.short || m.text;
}
if (lineWidth() > maxWidth) {
  const m = right.find((x) => x.key === "model");
  if (m) m.text = m.text.length > 8 ? m.text.slice(0, 7) + "…" : m.text;
}
let line = join(left) + (left.length && right.length ? sep : "") + join(right);
if (vw(line) > maxWidth) {
  // Emergency compact mode: preserve mode and the context sparkline on very narrow panes.
  const modeText = left.length ? left[0] : "";
  const spark = right.find((x) => x.key === "spark");
  const modePlain = clean(modeText);
  const roomForSpark = Math.max(1, maxWidth - vw(modePlain) - (modePlain ? 3 : 0));
  const sparkPlain = spark ? Array.from(clean(spark.text)).slice(-roomForSpark).join("") : "";
  line = modePlain + (modePlain && sparkPlain ? " • " : "") + sparkPlain;
  if (vw(line) > maxWidth) line = Array.from(line).slice(0, maxWidth).join("");
}
const padded = line + " ".repeat(Math.max(0, width - vw(line)));
return [ocFit(chalk.bgHex(__ocPalette.toolPendingBg)(dimFn(padded)), width)];
}
// ---- layout widgets ----
// user rail: coloured icon prefix on every line of a user message (matches the agent rail)
function ocUserRail(child) {
return {
invalidate() { child.invalidate?.(); },
render(width) {
const t = OC_CFG.userRail !== false ? (OC_CFG.userIcon || ">") : null;
if (!t) return child.render(width);
const icon = chalk.hex(__ocPalette.accent)(t) + " ";
return child.render(Math.max(1, width - 2)).map((l) => icon + l);
}
};
}
// message grouping: one blank row between different senders, none between same-side runs.
// the message class uses these rows INSTEAD of its default spacer, so no doubling.
let ocLastSender = null;
function ocMessageSpacer(sender) {
const same = sender === ocLastSender;
ocLastSender = sender;
if (!OC_CFG.messageGrouping || !same) return [""];
return [];
}
function ocMessageSpacerAfter(sender) {
ocLastSender = sender;
}
// collapsible long outputs
function ocCollapsedOutput(lines, width) {
if (!OC_CFG.outputCollapseThreshold || lines.length <= OC_CFG.outputCollapseThreshold) return lines;
const maxLines = OC_CFG.maxCollapseLines || 5;
const head = lines.slice(0, maxLines);
const rest = lines.length - maxLines;
head.push(ocTheme.dim("  \u25bc " + rest + " more lines"));
return head;
}
// animated agent dot: pulse between filled and hollow while the model is generating
function ocAgentDot(tone, running) {
const c = tone || __ocPalette.accent;
if (!OC_CFG.agentPulseDot || !running) return chalk.hex(c)("\u25c6");
const phase = Math.floor(Date.now() / 500) % 2;
return chalk.hex(c)(phase ? "\u25c7" : "\u25c6");
}
// vim auto-fold + zen context
function ocVimAutoFold(width) {
// The statusline is now part of the pinned bottom region; never fold it away on resize.
return false;
}
function ocZenContext(width) {
if (!OC_CFG.zenContextSliver || ocDensity() !== "zen") return [];
const dimFn = (t) => chalk.hex(__ocPalette.dim)(t);
const top = globalThis.__ocBarInfo && globalThis.__ocBarInfo.top;
const ctx = top ? top.find((x) => x.t && String(x.t).indexOf("%") !== -1) : null;
const model = (globalThis.__ocSessModel || "").replace(/^.*\//, "");
if (!model && !ctx) return [];
const bits = [model ? dimFn(model) : null, ctx ? dimFn(String(ctx.t)) : null].filter(Boolean);
bits.push(dimFn(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })));
return [ocFit(dimFn(bits.join(" \u00b7 ")), width)];
}
// ---- log search (ctrl+f): state lives on globalThis so the editor module can drive it.
// matches highlight live across the whole composed screen (inverse video), the strip shows
// the query + match count, esc/enter close.
function ocSearchState() { return globalThis.__ocSearch || (globalThis.__ocSearch = { active: false, q: "", n: 0 }); }
function ocSearchStart() { const st = ocSearchState(); st.active = true; st.q = ""; st.n = 0; ocRender(); }
function ocSearchStop() { const st = ocSearchState(); st.active = false; st.q = ""; st.n = 0; ocRender(); }
globalThis.__ocSearchStart = ocSearchStart;
globalThis.__ocSearchStop = ocSearchStop;
function ocEscRe(s) { let out = ""; const sp = "\\^$.*+?()[]{}"; for (const ch of String(s)) { if (sp.indexOf(ch) !== -1) out += "\\"; out += ch; } return out; }
function ocSearchApply(lines) {
const st = globalThis.__ocSearch;
if (!OC_CFG.searchEnabled || !st || !st.active || !st.q) return lines;
const seq = /(\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b_[^\x07\x1b]*(?:\x07|\x1b\\))/;
let re = null;
try { re = new RegExp(ocEscRe(st.q), "gi"); } catch { return lines; }
let n = 0;
const out = lines.map((line) => String(line).split(seq).map((piece, i) => {
if (i % 2 === 1 || !piece) return piece;
return piece.replace(re, (m) => { n++; return "\x1b[7m" + m + "\x1b[27m"; });
}).join(""));
st.n = n;
return out;
}
function ocSearchStrip(width) {
const st = globalThis.__ocSearch;
if (!OC_CFG.searchEnabled || !st || !st.active) return [];
const dimFn = (t) => chalk.hex(__ocPalette.dim)(t);
const cur = Date.now() % 1000 < 500 ? "\u258c" : " ";
const bit = st.n ? chalk.hex(__ocPalette.accent)(" \u00b7 " + st.n + " match" + (st.n === 1 ? "" : "es")) : "";
return [ocFit(dimFn("/" + st.q + cur) + bit + dimFn(" \u00b7 esc close"), width)];
}
// ---- context overlay (ctrl+r): expandable session/context summary ----
function ocToggleCtxOverlay() {
  globalThis.__ocCtxOverlayOpen = !globalThis.__ocCtxOverlayOpen;
  if (typeof globalThis.__ocRender === "function") globalThis.__ocRender();
}
function ocCtxOverlayRender(width) {
  if (!globalThis.__ocCtxOverlayOpen) return [];
  const P = globalThis.__ocPalette || {};
  const accent = (s) => chalk.hex(P.accent || "#F23625")(s);
  const dim = (s) => chalk.hex(P.quote || P.dim || "#988F8C")(s);
  const plain = (s) => String(s == null ? "" : s).replace(/\x1b\[[0-9;]*m/g, "");
  const info = globalThis.__ocBarInfo || {};
  const top = Array.isArray(info.top) ? info.top : [];
  const bottom = Array.isArray(info.bottom) ? info.bottom : [];
  const rows = [];
  rows.push(accent("  ◈ SESSION / CONTEXT") + dim("  · ctrl+r to close"));
  for (const seg of top) if (seg && seg.t) rows.push("  " + plain(seg.t));
  for (const seg of bottom) if (seg && seg.t) rows.push("  " + plain(seg.t));
  const model = globalThis.__ocSessModel;
  if (model && !rows.some((r) => plain(r).includes(String(model)))) rows.push("  " + dim("model") + "  " + String(model));
  const usage = top.find((x) => x && x.t && /%/.test(plain(x.t)));
  if (usage) rows.push("  " + dim("context usage") + "  " + plain(usage.t));
  return rows.map((r) => ocFit(r, Math.max(1, width)));
}
// Shared popup styling for custom pickers: match the slash-command/suggestions menu.
function ocPopupPanel(rows, width, title) {
  const P = globalThis.__ocPalette || {};
  const edge = (s) => chalk.hex(P.border || "#52443D")(s);
  const inner = Math.max(8, Math.floor(width) - 4);
  const topLabel = " " + String(title || "activity").toUpperCase() + " ";
  const top = "\u250c\u2500" + topLabel + "\u2500".repeat(Math.max(0, inner + 1 - topLabel.length)) + "\u2510";
  const out = [edge(top)];
  for (const raw of rows) {
    const line = ocFit(String(raw == null ? "" : raw), inner);
    const pad = " ".repeat(Math.max(0, inner - ocVisLen(line)));
    out.push(edge("\u2502") + " " + line + pad + " " + edge("\u2502"));
  }
  out.push(edge("\u2514" + "\u2500".repeat(inner + 2) + "\u2518"));
  return out;
}
// ---- searchable prompt history (Alt+H) ----
// pi-tui already keeps the last 100 submitted prompts on its editor instance. We expose
// that native buffer rather than maintaining a second, divergent history store.
function ocPromptHistoryState() { return globalThis.__ocPromptHistoryUI || (globalThis.__ocPromptHistoryUI = { active: false, q: "", selected: 0, draft: "" }); }
function ocPromptHistoryOpen(draft) {
  const st = ocPromptHistoryState(); st.active = true; st.q = ""; st.selected = 0; st.draft = String(draft || "");
  if (typeof globalThis.__ocRender === "function") globalThis.__ocRender();
}
function ocPromptHistoryClose() { const st = ocPromptHistoryState(); st.active = false; st.q = ""; st.selected = 0; if (typeof globalThis.__ocRender === "function") globalThis.__ocRender(); }
function ocPromptHistoryRows(width) {
  const st = globalThis.__ocPromptHistoryUI;
  if (!st || !st.active) return [];
  const P = globalThis.__ocPalette || {};
  const accent = (s) => chalk.hex(P.accent || "#F23625")(s);
  const dim = (s) => chalk.hex(P.quote || P.dim || "#988F8C")(s);
  const plain = (s) => String(s == null ? "" : s).replace(/\x1b\[[0-9;]*m/g, "").replace(/[\r\n\t]+/g, " ");
  const all = Array.isArray(globalThis.__ocPromptHistory) ? globalThis.__ocPromptHistory : [];
  const q = String(st.q || "").toLowerCase();
  const matches = all.filter((x) => !q || String(x).toLowerCase().includes(q)).slice(0, 100);
  if (st.selected >= matches.length) st.selected = Math.max(0, matches.length - 1);
  const rows = [dim("  type to filter · ↑/↓ select · enter use · alt+h close")];
  rows.push(dim("  /" + st.q + (st.q ? "" : " filter prompts") + "  · " + matches.length + " match" + (matches.length === 1 ? "" : "es")));
  if (!matches.length) rows.push(dim("  no matching prompts in this editor's history"));
  else {
    const start = Math.max(0, Math.min(st.selected - 2, matches.length - 5));
    for (let i = start; i < Math.min(matches.length, start + 5); i++) {
      const item = plain(matches[i]);
      const max = Math.max(8, width - 7);
      const shown = item.length > max ? item.slice(0, max - 1) + "…" : item;
      rows.push((i === st.selected ? accent("  ❯ ") : "    ") + (i === st.selected ? accent(shown) : shown));
    }
  }
  return ocPopupPanel(rows, width, "prompt history");
}
globalThis.__ocPromptHistoryOpen = ocPromptHistoryOpen;
globalThis.__ocPromptHistoryClose = ocPromptHistoryClose;
globalThis.__ocPromptHistoryRender = ocPromptHistoryRows;
// ---- git changes panel (Alt+G) ----
// Read-only and cached: it never stages, edits, or discards files. git status includes
// untracked files; numstat provides compact additions/deletions for tracked changes.
function ocChangesState() { return globalThis.__ocChangesUI || (globalThis.__ocChangesUI = { open: false, cacheAt: 0, rows: [], summary: "", selected: 0, preview: [] }); }
function ocChangesRefresh(force) {
  const st = ocChangesState();
  if (!force && Date.now() - st.cacheAt < 1200) return st;
  st.cacheAt = Date.now(); st.rows = []; st.preview = []; st.summary = "";
  try {
    const cp = process.getBuiltinModule("child_process");
    const run = (args) => cp.spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8", timeout: 1200, maxBuffer: 1024 * 1024 });
    const root = run(["rev-parse", "--show-toplevel"]);
    if (root.status !== 0) { st.summary = "not inside a git repository"; return st; }
    const status = run(["status", "--short", "--untracked-files=all"]);
    if (status.status !== 0) { st.summary = "git status failed"; return st; }
    const entries = String(status.stdout || "").split("\n").filter(Boolean);
    if (!entries.length) { st.summary = "working tree clean"; return st; }
    const numstat = (args) => {
      const result = run(args), map = new Map();
      for (const line of String(result.stdout || "").split("\n")) {
        const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
        if (m) map.set(m[3], { add: m[1] === "-" ? null : Number(m[1]), del: m[2] === "-" ? null : Number(m[2]) });
      }
      return map;
    };
    const unstaged = numstat(["diff", "--numstat", "--"]);
    const staged = numstat(["diff", "--cached", "--numstat", "--"]);
    st.rows = entries.slice(0, 60).map((line) => {
      const statusCode = line.slice(0, 2), file = line.slice(3).replace(/^.* -> /, "");
      const u = unstaged.get(file), c = staged.get(file);
      const vals = [u, c].filter(Boolean);
      const addVals = vals.map((v) => v.add).filter((v) => v != null);
      const delVals = vals.map((v) => v.del).filter((v) => v != null);
      return { status: statusCode, file, add: addVals.length ? addVals.reduce((a,b) => a+b, 0) : null, del: delVals.length ? delVals.reduce((a,b) => a+b, 0) : null, untracked: statusCode.includes("?"), staged: statusCode[0] !== " " && statusCode[0] !== "?", unstaged: statusCode[1] !== " " && statusCode[1] !== "?" };
    });
    st.selected = Math.max(0, Math.min(st.selected || 0, st.rows.length - 1));
    const stagedCount = st.rows.filter((x) => x.staged).length;
    const unstagedCount = st.rows.filter((x) => x.unstaged).length;
    const untrackedCount = st.rows.filter((x) => x.untracked).length;
    st.summary = entries.length + " paths  ·  staged " + stagedCount + "  ·  unstaged " + unstagedCount + "  ·  new " + untrackedCount;
    const previewFile = st.rows[st.selected] || st.rows[0];
    if (previewFile) {
      let diff = null;
      if (!previewFile.untracked) {
        diff = run(["diff", "--no-ext-diff", "--unified=2", "--", previewFile.file]);
        if (diff.status !== 0 || !String(diff.stdout || "").trim()) diff = run(["diff", "--cached", "--no-ext-diff", "--unified=2", "--", previewFile.file]);
      }
      let previewLines = [];
      if (previewFile.untracked) {
        try {
          const fs0 = process.getBuiltinModule("fs"), path0 = process.getBuiltinModule("path"), full = path0.resolve(process.cwd(), previewFile.file);
          const buf = fs0.readFileSync(full);
          if (buf.length <= 16384 && !buf.includes(0)) previewLines = buf.toString("utf8").split("\n").slice(0, 10).map((line) => "+" + line);
          else previewLines = ["(binary or larger than 16 KiB; preview omitted)"];
        } catch { previewLines = ["(preview unavailable)"]; }
      } else if (diff && diff.status === 0) {
        previewLines = String(diff.stdout || "").split("\n").filter((line) => /^(\+\+\+|---|@@|\+|-| )/.test(line)).slice(0, 10);
      }
      st.preview = previewLines.map((line) => ({ file: previewFile.file, line }));
      st.previewFile = previewFile.file;
    }
  } catch (e) { st.summary = "git unavailable: " + String(e && e.message || e).slice(0, 60); }
  return st;
}
function ocChangesMove(delta) {
  const st = ocChangesState(); if (!st.open || !st.rows.length) return false;
  st.selected = (Math.max(0, st.selected || 0) + delta + st.rows.length) % st.rows.length;
  ocChangesRefresh(true);
  if (typeof globalThis.__ocRender === "function") globalThis.__ocRender();
  return true;
}
function ocChangesForceRefresh() { const st = ocChangesState(); if (!st.open) return false; ocChangesRefresh(true); if (typeof globalThis.__ocRender === "function") globalThis.__ocRender(); return true; }
function ocToggleChangesPanel() { const st = ocChangesState(); st.open = !st.open; if (st.open) ocChangesRefresh(true); if (typeof globalThis.__ocRender === "function") globalThis.__ocRender(); }
function ocChangesPanelRender(width) {
  const st = ocChangesState(); if (!st.open) return [];
  ocChangesRefresh(false);
  const P = globalThis.__ocPalette || {};
  const accent = (s) => chalk.hex(P.accent || "#F23625")(s);
  const dim = (s) => chalk.hex(P.quote || P.dim || "#988F8C")(s);
  const good = (s) => chalk.hex(P.success || "#9C9152")(s);
  const bad = (s) => chalk.hex(P.error || "#FF4E52")(s);
  const plain = (s) => String(s == null ? "" : s).replace(/\x1b\[[0-9;]*m/g, "");
  const rows = [dim("  alt+g close · alt+j/k select · alt+r refresh · read-only")];
  rows.push(dim("  " + (st.summary || "checking git…")));
  if (!st.rows.length) rows.push(dim("  " + (st.summary || "no changes")));
  const selected = st.rows[st.selected];
  const start = Math.max(0, Math.min((st.selected || 0) - 3, st.rows.length - 8));
  for (let i = start; i < Math.min(st.rows.length, start + 8); i++) {
    const item = st.rows[i];
    const marker = item.untracked ? "?" : item.status.includes("D") ? "D" : item.status.includes("A") ? "A" : item.status.includes("R") ? "R" : item.status.includes("U") ? "!" : "M";
    const stage = item.staged && item.unstaged ? "S+W" : item.staged ? "STAGED" : item.unstaged ? "WORK" : item.untracked ? "NEW" : "FILE";
    const stat = item.add == null ? (item.untracked ? "new" : "—") : good("+" + item.add) + " " + bad("-" + item.del);
    const prefix = i === st.selected ? accent("  ❯ ") : "    ";
    const mark = marker === "D" ? bad(marker) : marker === "M" || marker === "A" ? accent(marker) : dim(marker);
    const max = Math.max(8, width - 24 - plain(stat).length - stage.length);
    let file = item.file;
    if (file.length > max) file = "…" + file.slice(-(max - 1));
    rows.push(prefix + mark + " " + file + dim("  " + stage) + "  " + stat);
  }
  if (st.rows.length > 8) rows.push(dim("  … " + (st.rows.length - Math.min(8, st.rows.length)) + " other paths; selection scrolls"));
  if (selected && st.preview && st.preview.length) {
    rows.push(accent("  ── PREVIEW  /  " + (st.previewFile || selected.file).toUpperCase() + " ──"));
    for (const item of st.preview.slice(0, 7)) {
      const line = item.line;
      const tone = line.startsWith("+") && !line.startsWith("+++") ? good : line.startsWith("-") && !line.startsWith("---") ? bad : line.startsWith("@@") ? accent : dim;
      rows.push("  " + tone(line.length > width - 4 ? line.slice(0, Math.max(1, width - 5)) + "…" : line));
    }
  }
  rows.push(dim("  previews are read-only; untracked text files are sampled up to 16 KiB"));
  return ocPopupPanel(rows, width, "git changes");
}
globalThis.__ocToggleChangesPanel = ocToggleChangesPanel;
globalThis.__ocChangesMove = ocChangesMove;
globalThis.__ocChangesForceRefresh = ocChangesForceRefresh;
globalThis.__ocChangesPanelRender = ocChangesPanelRender;
// ---- chat bar runtime helpers ----
// Kept as a no-op for compatibility: mode markers now live in the Vim bar header.
function ocBarPrefix(raw) { return String(raw == null ? "" : raw); }
// Compact attachment chips above the composer. Only show a clear-all hint because
// individual chip removal is not wired to the editor's input events.
function ocAttachmentChips(width) {
  if (!ocImages.length) return [];
  const P = __ocPalette || {};
  const accent = (t) => chalk.hex(P.accent || "#F23625")(t);
  const dim = (t) => chalk.hex(P.quote || P.dim || "#988F8C")(t);
  const max = Math.max(12, Number(width) || 80);
  const names = ocImages.map((x) => String(x.fileName || "image").replace(/[\r\n]/g, ""));
  let line = "  " + names.map((n) => "[▧ " + n + "]").join(" ");
  const hint = "  alt+c clears";
  if (Array.from(line.replace(/\x1b\[[0-9;]*m/g, "")).length + hint.length > max) {
    const first = names[0] || "image";
    const extra = names.length > 1 ? " +" + (names.length - 1) : "";
    line = "  " + "[▧ " + first.slice(0, Math.max(4, max - hint.length - extra.length - 9)) + (first.length > Math.max(4, max - hint.length - extra.length - 9) ? "…" : "") + extra + "]";
  }
  return [accent(line) + dim(hint)];
}
// input char counter + token estimate. hidden while the box is empty; the "/budget" half
// only appears once you pass ~60% of the budget (before that it is just noise).
let ocInputLen = 0, ocInputChanged = 0;
let ocPasteFlash = 0;
function ocBarRightText(width, getText, hidden) {
const P = __ocPalette || {};
const dimFn = OC_CFG.receiptColor ? chalk.hex(OC_CFG.receiptColor) : (t) => chalk.hex(P.quote || P.dim || "#988F8C")(t);
const err = (t) => chalk.hex(P.error || "#FF4E52")(t);
const parts = [];
const len = typeof getText === "function" ? getText().length : 0;
if (OC_CFG.inputCounter && len > 0) {
const showBudget = OC_CFG.inputBudget && len >= OC_CFG.inputBudget * 0.6;
const raw = showBudget ? len + "/" + OC_CFG.inputBudget : String(len);
const over = OC_CFG.inputBudget && len > OC_CFG.inputBudget;
parts.push(over ? err(raw) : dimFn(raw));
}
if (OC_CFG.tokenEstimate && len > 0) {
const tok = Math.max(1, Math.round(len / 4));
parts.push(dimFn("\u2248" + (tok >= 1000 ? (tok / 1000).toFixed(1) + "k" : String(tok)) + " tok"));
}
if (typeof ocImageCount === "function" && ocImageCount() > 0) parts.unshift(chalk.hex(P.accent || "#F23625")("img \u00d7" + ocImageCount()));
if (OC_CFG.multiLineIndicator && hidden > 0) parts.push(dimFn("+" + hidden + " more"));
if (OC_CFG.pasteIndicator && Date.now() - ocPasteFlash < (OC_CFG.pasteTimeout || 2000)) {
const secs = Math.ceil(((OC_CFG.pasteTimeout || 2000) - (Date.now() - ocPasteFlash)) / 1000);
if (secs > 0) parts.push(dimFn("\ud83d\udccb +" + ocPasteChars + "c"));
}
const joined = parts.length ? parts.join(dimFn(" \u00b7 ")) : "";
return joined ? ocFit(joined, Math.max(0, width - 2)) : "";
}
function ocBarOverflow(text, contentWidth) {
if (!OC_CFG.multiLineIndicator || !text) return "";
const lineEst = Math.max(1, Math.ceil(text.length / Math.max(1, contentWidth - 4)));
const hidden = lineEst - 1;
return hidden > 0 ? "+" + hidden + " more" : "";
}
function ocCmdPrefix(text) {
if (!OC_CFG.cmdPrefix || !text) return "";
if (text.startsWith("/")) return chalk.hex(OC_CFG.cmdPrefixColor || __ocPalette.accent || "#F23625")("\u2318 ");
if (text.startsWith("?")) return chalk.hex(OC_CFG.cmdPrefixColor || __ocPalette.accent || "#F23625")("? ");
return "";
}
// paste detection. a paste arrives as ONE insert call with the whole chunk, while typing
// arrives one character at a time, so a big chunk in a single insert is the paste signal.
// returning true means "this was an image path, swallow the insert".
let ocPasteChars = 0;
function ocCheckPaste(inserted) {
if (typeof inserted === "string" && inserted.length > 3 && typeof ocImagePathPaste === "function" && ocImagePathPaste(inserted)) return true;
if (!OC_CFG.pasteIndicator) return;
const n = typeof inserted === "string" ? inserted.length : 0;
if (n > 50) {
ocPasteFlash = Date.now();
ocPasteChars = n;
}
}
// ---- image paste: queue images from the clipboard / pasted file paths, send them with the next message ----
const OC_IMG_EXT = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const ocImages = [];
function ocImgSniff(buf) {
if (!buf || buf.length < 12) return null;
if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
if (buf.slice(0, 3).toString("latin1") === "GIF") return "image/gif";
if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return "image/webp";
return null;
}
function ocImgExt(mime) { return mime === "image/jpeg" ? "jpg" : String(mime).replace("image/", ""); }
function ocClipboardImage() {
// Do not use --no-newline for binary clipboard data: it is a text convenience and can
// mutate the final byte of some payloads. Probe native MIME targets and validate the magic.
const cp = process.getBuiltinModule ? process.getBuiltinModule("child_process") : require("child_process");
const run = (cmd, args2, timeout = 7000) => {
try {
const r = cp.spawnSync(cmd, args2, { encoding: null, maxBuffer: 64 * 1024 * 1024, timeout, windowsHide: true });
return r.status === 0 && r.stdout && r.stdout.length ? r.stdout : null;
} catch { return null; }
};
const supported = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const fromTypes = (types, read) => {
if (!types) return null;
const listed = types.toString("utf8").split(/[\r\n]+/).map((x) => x.trim()).filter(Boolean);
for (const t of [...supported, ...listed.filter((x) => /^image\//i.test(x))]) {
if (!listed.includes(t)) continue;
const data = read(t);
if (data && ocImgSniff(data)) return data;
}
return null;
};
let buf = null;
if (process.platform === "darwin") {
  buf = run("pngpaste", ["-"]);
  if (!buf) {
    const types = run("osascript", ["-e", 'clipboard info']);
    if (types) buf = run("pngpaste", ["-"]);
  }
} else {
  // Wayland: enumerate MIME types, prioritise formats we can send directly.
  const wlTypes = run("wl-paste", ["--list-types"]);
  if (wlTypes) buf = fromTypes(wlTypes, (t) => run("wl-paste", ["--type", t]));
  // X11: ask the owner for TARGETS first; older xclip versions also accept -t.
  if (!buf) {
    const targets = run("xclip", ["-selection", "clipboard", "-o", "-target", "TARGETS"]);
    if (targets) buf = fromTypes(targets, (t) => run("xclip", ["-selection", "clipboard", "-o", "-target", t]));
  }
  if (!buf) for (const t of supported) {
    buf = run("xclip", ["-selection", "clipboard", "-o", "-target", t]) || run("xclip", ["-selection", "clipboard", "-t", t, "-o"]);
    if (buf && ocImgSniff(buf)) break;
    buf = null;
  }
}
return buf && ocImgSniff(buf) ? buf : null;
}
function ocAddImage(buf, name, quiet) {
const mime = ocImgSniff(buf);
if (!mime) { if (!quiet) ocToastShow("not a png / jpeg / gif / webp image"); return false; }
if (buf.length > (OC_CFG.imageMaxBytes || 8388608)) { ocToastShow("image too big (" + Math.round(buf.length / 1024) + " kB, max " + Math.round((OC_CFG.imageMaxBytes || 8388608) / 1024) + " kB)"); return false; }
if (ocImages.length >= (OC_CFG.imageMaxCount || 8)) { ocToastShow("max " + (OC_CFG.imageMaxCount || 8) + " images per message"); return false; }
ocImages.push({ type: "image", mimeType: mime, fileName: name || "pasted-" + Date.now() + "." + ocImgExt(mime), content: buf.toString("base64"), origin: "paste", sizeBytes: buf.length });
ocToastShow("image attached (" + ocImages.length + ") \u00b7 " + ocImgExt(mime) + " " + Math.round(buf.length / 1024) + " kB");
ocRender();
return true;
}
// quiet = true for ctrl+v (a text paste should fall through without a toast); returns whether an image was queued
function ocPasteImage(quiet) {
if (!OC_CFG.imagePaste) return false;
const buf = ocClipboardImage();
if (!buf) {
if (!quiet) ocToastShow("no image on the clipboard (needs wl-paste, xclip or pngpaste)");
return false;
}
return ocAddImage(buf, null, quiet);
}
// Match the small, explicit key-chord syntax used by OC_CFG (ctrl+x / alt+x).
// Terminal Ctrl+A..Z bytes are 0x01..0x1a; Alt+key is commonly ESC followed by the key.
function ocKeyMatches(data, key) {
if (typeof data !== "string" || typeof key !== "string") return false;
const chord = key.trim().toLowerCase().replace(/\s+/g, "");
if (!chord) return false;
const parts = chord.split("+");
const base = parts.pop();
const mods = new Set(parts);
if (mods.size !== parts.length || [...mods].some((m) => m !== "ctrl" && m !== "control" && m !== "alt" && m !== "meta" && m !== "shift")) return false;
const ctrl = mods.has("ctrl") || mods.has("control");
const alt = mods.has("alt") || mods.has("meta");
const shift = mods.has("shift");
const aliases = { escape: "esc", return: "enter", newline: "enter", spacebar: "space" };
const k = aliases[base] || base;
let expected;
if (k === "esc") expected = "\x1b";
else if (k === "enter") expected = "\r";
else if (k === "tab") expected = "\t";
else if (k === "space") expected = " ";
else if (k.length === 1) expected = k;
else return false;
if (ctrl) {
if (expected.length !== 1) return false;
const c = expected.toLowerCase();
if (c >= "a" && c <= "z") expected = String.fromCharCode(c.charCodeAt(0) - 96);
else if (c === "[") expected = "\x1b";
else if (c === "\\") expected = "\x1c";
else if (c === "]") expected = "\x1d";
else if (c === "^") expected = "\x1e";
else if (c === "_") expected = "\x1f";
else if (c === " ") expected = "\x00";
else return false;
} else if (shift && k.length === 1) expected = k.toUpperCase();
if (alt) expected = "\x1b" + expected;
return data === expected;
}
function ocKeyAny(data, keys) {
for (const k of [].concat(keys || [])) if (ocKeyMatches(data, k)) return true;
return false;
}
// text that looks like a dropped / pasted path to an image file becomes an attachment instead of text
function ocImagePathPaste(text) {
try {
if (!OC_CFG.imagePaste) return false;
let t = String(text || "").trim();
if (!t || t.indexOf("\n") !== -1 || t.length > 1024) return false;
t = t.replace(/^(['"])(.*)\1$/, "$2").replace(/^file:\/\//, "").replace(/\\(.)/g, "$1");
try { t = decodeURIComponent(t); } catch {}
const ext = (/\.([A-Za-z0-9]+)$/.exec(t) || [])[1];
if (!ext || !OC_IMG_EXT[ext.toLowerCase()]) return false;
const fsx = process.getBuiltinModule("fs"), pathx = process.getBuiltinModule("path");
if (t.startsWith("~/")) t = pathx.join(process.getBuiltinModule("os").homedir(), t.slice(2));
if (!fsx.existsSync(t) || !fsx.statSync(t).isFile()) return false;
return ocAddImage(fsx.readFileSync(t), pathx.basename(t), false);
} catch { return false; }
}
// handed to chat.send for the next real message; slash commands keep the images queued
function ocTakeImages(text) {
if (!ocImages.length || /^\s*\//.test(String(text || ""))) return {};
const out = ocImages.splice(0).map((x) => ({ type: x.type, mimeType: x.mimeType, fileName: x.fileName, content: x.content, origin: x.origin, sizeBytes: x.sizeBytes }));
ocRender();
return { attachments: out };
}
function ocImageCount() { return ocImages.length; }
function ocImageClear() { const n = ocImages.length; ocImages.length = 0; if (n) ocRender(); return n; }
globalThis.__ocImageCount = ocImageCount;
// image management keys: alt+x lists what is queued, alt+c drops it all
function ocImagesListToast() {
if (!ocImages.length) { ocToastShow("no images queued (ctrl+v pastes one)"); return; }
const names = ocImages.map((x) => x.fileName).join(", ");
ocToastShow((names.length > 96 ? names.slice(0, 95) + "\u2026" : names) + " \u00b7 alt+c clears", 4500);
}
globalThis.__ocImagesList = ocImagesListToast;
globalThis.__ocImagesClear = () => {
const n = ocImageClear();
ocToastShow(n ? "cleared " + n + " image" + (n === 1 ? "" : "s") : "no images queued");
};
// ---- end image paste
`;
// ---RUNTIME-END
const TERMUX_ROOT = "/data/data/com.termux/files/usr/lib/node_modules/openclaw";
// a directory is an openclaw package when it has both dist/ and package.json
const isRoot = (c) => !!(c && fs.existsSync(path.join(c, "dist")) && fs.existsSync(path.join(c, "package.json")));
// openclaw's own installer does NOT use the npm global root: it installs into
// $OPENCLAW_PREFIX (default ~/.openclaw) as <prefix>/lib/node_modules/openclaw, with the
// launcher at <prefix>/bin/openclaw. so `npm root -g` alone is not enough to find it.
// every package layout that can live under a given prefix dir
function layoutRoots(dir) {
const out = [];
const add = (c) => { if (c && !out.includes(c)) out.push(c); };
add(path.join(dir, "lib", "node_modules", "openclaw"));
add(path.join(dir, "node_modules", "openclaw"));
add(path.join(dir, "tools", "node", "lib", "node_modules", "openclaw"));
try {
for (const e of fs.readdirSync(path.join(dir, "tools"))) {
if (!/^node/.test(e)) continue;
add(path.join(dir, "tools", e, "lib", "node_modules", "openclaw"));
}
} catch {}
return out;
}
function prefixRoots() {
const out = [];
const prefixes = [process.env.OPENCLAW_PREFIX, process.env.OPENCLAW_HOME, path.join(os.homedir(), ".openclaw")];
for (const p of prefixes) {
if (!p) continue;
for (const c of layoutRoots(p)) out.push(c);
}
return out;
}
// run a command the way the USER's shell does. a login shell sources their profile,
// which is where a custom npm prefix (npm_config_prefix) and a custom PATH order live.
function shellOut(cmd) {
for (const sh of ["bash", "zsh", "sh"]) {
try {
const r = spawnSync(sh, ["-lc", cmd], { encoding: "utf8" });
if (r.status === 0 && r.stdout && r.stdout.trim()) return r.stdout.trim();
} catch {}
}
try {
const win = process.platform === "win32";
const r = spawnSync(win ? "cmd" : "sh", [win ? "/c" : "-c", cmd], { encoding: "utf8", shell: win });
if (r.status === 0 && r.stdout && r.stdout.trim()) return r.stdout.trim();
} catch {}
return null;
}
function whichOpenclaw() {
// command -v, not which: which ignores shell aliases and can disagree with the
// resolution the interactive shell actually uses
const p = shellOut("command -v openclaw 2>/dev/null");
if (p) {
const first = p.split(/\r?\n/)[0].trim();
if (first && fs.existsSync(first)) { try { return fs.realpathSync(first); } catch { return first; } }
}
try {
const win = process.platform === "win32";
const w = spawnSync(win ? "where" : "which", ["openclaw"], { encoding: "utf8", shell: win });
if (w.status === 0 && w.stdout.trim()) return fs.realpathSync(w.stdout.trim().split(/\r?\n/)[0]);
} catch {}
return null;
}
// every place an openclaw package can live, most likely first
function findCandidates() {
const cands = [];
const add = (c) => { if (c && !cands.includes(c)) cands.push(c); };
add(process.env.OPENCLAW_ROOT);
for (const c of prefixRoots()) add(c);
try {
const win = process.platform === "win32";
const r = spawnSync(win ? "npm.cmd" : "npm", ["root", "-g"], { encoding: "utf8", shell: win });
if (r.status === 0 && r.stdout.trim()) add(path.join(r.stdout.trim(), "openclaw"));
} catch {}
const nr = shellOut("npm root -g 2>/dev/null");
if (nr) add(path.join(nr.split(/\r?\n/)[0].trim(), "openclaw"));
const bin = whichOpenclaw();
if (bin) {
let d = path.dirname(bin);
for (let i = 0; i < 8; i++) {
add(d);
for (const c of layoutRoots(d)) add(c);
d = path.dirname(d);
}
}
add(TERMUX_ROOT);
return cands;
}
// the package the `openclaw` on PATH actually loads (null when it is not a js install)
function runningRoot() {
const bin = whichOpenclaw();
if (!bin) return null;
let d = path.dirname(bin);
for (let i = 0; i < 8; i++) {
for (const c of [d, ...layoutRoots(d)]) {
if (isRoot(c)) return c;
}
d = path.dirname(d);
}
return null;
}
const CANDIDATES = findCandidates();
if (args.includes("--all-roots")) {
const roots = CANDIDATES.filter(isRoot);
if (!roots.length) {
console.log("no openclaw install found. run --list-roots to see where we looked.");
process.exit(1);
}
console.log("patching " + roots.length + " openclaw install(s):");
for (const r of roots) {
console.log("\n=== " + r + " ===");
spawnSync(process.execPath, [__filename, r].concat(args.filter((a) => a !== "--all-roots")), { stdio: "inherit" });
}
process.exit(0);
}
if (args.includes("--list-roots")) {
const shown = CANDIDATES.filter((c) => path.basename(c) === "openclaw");
console.log("openclaw installs found:");
for (const c of shown) console.log((isRoot(c) ? "  [x] " : "      ") + c);
const rr = runningRoot();
console.log("\nthe `openclaw` on your PATH loads: " + (rr || "(not a js install - a compiled binary cannot be patched)"));
if (shown.length > 1) console.log("\n(more than one install: pass the folder you want as an argument)");
process.exit(0);
}
const EXPLICIT = args.find((a) => !a.startsWith("--"));
const RUNNING = runningRoot();
const ROOT = EXPLICIT || RUNNING || CANDIDATES.find(isRoot) || TERMUX_ROOT;
const DIST = path.join(ROOT, "dist");
// second target: pi-tui's editor component (slash menu placement)
const EDITOR = path.join(ROOT, "node_modules/@earendil-works/pi-tui/dist/components/editor.js");
// ---- group accounting: a partial patch must not look like success ----
let G_OK = 0, G_FAIL = 0;
if (!AUTO) console.log("oc-theme-patch " + OC_PATCH_VERSION + "  (" + __filename + ")");
{
const bin = whichOpenclaw();
if (!AUTO) {
console.log("openclaw on your PATH : " + (bin || "(not found)"));
console.log("openclaw loads        : " + (RUNNING || "(unknown)"));
console.log("patching              : " + ROOT);
}
let v = null;
try { v = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version; } catch {}
if (!AUTO) {
console.log("openclaw in this root : " + (v || "(unknown version)"));
console.log("palette               : " + paletteName() + (CFG.palette === "auto" ? " (auto-detected)" : ""));
}
if (v && v !== OC_TARGET_VERSION && !AUTO) {
console.log("note: this port targets openclaw " + OC_TARGET_VERSION + ". a different release has a");
console.log("      different tui, so some groups will not match - that is expected, not a bug.");
}
}
const read = (f) => fs.readFileSync(f, "utf8");
// Backups live OUTSIDE dist on purpose: openclaw's own postinstall prunes every file in
// dist/ that is not in the installed inventory, which silently deleted a .orig sitting next
// to a patched chunk (and left no way to restore it).
const BACKUP_DIR = path.join(ROOT, ".oc-theme-backups");
const MANIFEST = path.join(BACKUP_DIR, "manifest.json");
function loadManifest() { try { return JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { return {}; } }
function saveManifest(m) { try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2)); } catch {} }
function backupPath(file) { return path.join(BACKUP_DIR, path.basename(file) + ".orig"); }
// remember where the backup of <file> lives, so --restore can put every target back.
function ensureBackup(file, label) {
const bak = backupPath(file);
const legacy = file + ".orig";
const readSafe = (f) => { try { return read(f); } catch { return ""; } };
if (!fs.existsSync(bak)) {
fs.mkdirSync(BACKUP_DIR, { recursive: true });
if (fs.existsSync(legacy)) {
fs.copyFileSync(legacy, bak);
if (!AUTO) console.log("migrated the old " + label + " backup -> " + bak);
} else {
fs.copyFileSync(file, bak);
}
} else if (fs.existsSync(legacy)) {
const bakText = readSafe(bak), legText = readSafe(legacy);
if (legText && legText !== bakText && !legText.includes("// oc-patched")) {
fs.copyFileSync(legacy, bak);
if (!AUTO) console.log("replaced the " + label + " backup with the pristine .orig -> " + bak);
}
}
const m = loadManifest(); m[file] = path.basename(bak); saveManifest(m);
return bak;
}
// the pi-tui editor is a separate package, so its pristine copy is not on disk. when the
// base we would patch from has already been patched (an old run consumed the anchors), pull
// the matching version from npm and use that instead.
function fetchPristineEditor(root) {
try {
const pkgDir = path.join(root, "node_modules", "@earendil-works", "pi-tui");
const ver = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oc-pitui-"));
const win = process.platform === "win32";
const r = spawnSync(win ? "npm.cmd" : "npm", ["install", "--no-save", "--prefix", tmp, "@earendil-works/pi-tui@" + ver], { encoding: "utf8", shell: win });
if (r.status !== 0) return null;
const f = path.join(tmp, "node_modules", "@earendil-works", "pi-tui", "dist", "components", "editor.js");
if (!fs.existsSync(f)) return null;
return read(f);
} catch { return null; }
}
if (!fs.existsSync(DIST)) {
console.log("no dist folder at " + DIST + ".");
console.log("\nplaces looked:");
for (const c of CANDIDATES) console.log((isRoot(c) ? "  [x] " : "      ") + c);
const rr0 = runningRoot();
console.log("\nthe `openclaw` on your PATH loads: " + (rr0 || "(not a js install - a compiled binary cannot be patched)"));
console.log("\npass the openclaw package folder as an argument, or set OPENCLAW_ROOT.");
console.log("run with --list-roots to see the same list.");
process.exit(1);
}
// find the tui chunk by content anywhere under dist (the filename is no longer reliable)
function walk(dir, out = []) {
for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
const p = path.join(dir, e.name);
if (e.isDirectory()) { if (e.name !== "node_modules") walk(p, out); }
else if (/\.(c|m)?js$/.test(e.name)) out.push(p); // .orig backups never match
}
return out;
}
// --restore runs BEFORE target discovery: a stale signature must never be able to block the undo.
if (RESTORE) {
let n = 0;
const done = new Set();
const man = loadManifest();
for (const [file, bakName] of Object.entries(man)) {
const bak = path.join(BACKUP_DIR, bakName);
if (fs.existsSync(bak) && fs.existsSync(file)) { fs.copyFileSync(bak, file); n++; done.add(path.resolve(file)); }
}
for (const f of walk(DIST)) {
if (!f.endsWith(".orig")) continue;
const target = f.slice(0, -5);
if (done.has(path.resolve(target))) continue;
fs.copyFileSync(f, target); n++; done.add(path.resolve(target));
}
const eo = EDITOR + ".orig";
if (fs.existsSync(eo) && !done.has(path.resolve(EDITOR))) { fs.copyFileSync(eo, EDITOR); n++; }
console.log(n ? "restored " + n + " file(s) from their backups" : "no backup found");
process.exit(0);
}
const SIGS = ["MarkdownMessageComponent", "ToolExecutionComponent"];
const allJs = walk(DIST);
const safeRead = (f) => { try { return read(f); } catch { return ""; } };
const matches = allJs.filter((f) => { const t = safeRead(f); return SIGS.every((x) => t.includes(x)); });
if (matches.length !== 1) {
console.log("expected exactly one tui chunk containing " + SIGS.join(" + ") + ", found:", matches);
console.log("files containing at least one of them:", allJs.filter((f) => { const t = safeRead(f); return SIGS.some((x) => t.includes(x)); }));
process.exit(1);
}
const target = matches[0];
const orig = backupPath(target);
if (!AUTO) console.log("target:", target);
// backup bookkeeping. every write ends with an "// oc-patched" line, so the state is right
// even when only some groups applied.
const OC_MARK = "\n// oc-patched\n";
const isPatchedChunk = (t) => t.includes("// oc-patched") || t.includes("completionVerbs");
const isPatchedEditor = (t) => t.includes("// oc-patched") || t.includes("oc patch");
function backupState(file, bak, isPatched) {
if (!fs.existsSync(file)) return "missing";
const cur = read(file);
const patched = isPatched(cur);
if (!fs.existsSync(bak)) return patched ? "patched-no-backup" : "pristine-no-backup";
if (patched) return "patched";
return cur === read(bak) ? "pristine" : "stale-backup";
}
const STATE_TEXT = {
"missing": "not found",
"patched": "patched (backup ok)",
"patched-no-backup": "patched but NO backup (reinstall openclaw before patching again)",
"pristine": "pristine, not patched yet",
"pristine-no-backup": "pristine, not patched yet",
"stale-backup": "UPDATED since the last patch, the backup is old (running the script refreshes it and repatches)"
};
// same path check
function realOf(p) { try { return fs.realpathSync(p); } catch { return path.resolve(p); } }
function sameDir(a, b) { return realOf(a) === realOf(b); }
if (args.includes("--verify")) {
const t = safeRead(target);
const markers = {
"oc runtime injected (OC_CFG)": t.includes("const OC_CFG ="),
"tool icon table": t.includes("const ocToolIcons ="),
"theme alias (ocTheme)": t.includes("const ocTheme = tuiTheme;"),
"branding (OC_CFG.brand)": t.includes("OC_CFG.brand"),
"agent rail / receipts": t.includes("ocRail(") || t.includes("ocReceiptLines"),
"user rail wired": t.includes("ocUserRail("),
"vim status bar": t.includes("ocVimStatusBar"),
"chat bar counter": t.includes("ocBarRightText"),
"context overlay key": t.includes("ocKeyMatches"),
"log search (ctrl+f)": t.includes("ocSearchApply"),
"osc52 copy": t.includes("ocCopyOSC52"),
"unfocus notify": t.includes("ocNotifyDone"),
"root layout rewrite": t.includes("ocToastRow"),
"palette exposed (__ocPalette)": t.includes("__ocPalette"),
"image paste (clipboard key + send hook)": t.includes("ocPasteImage(") && t.includes("ocTakeImages(text)"),
"patch marker (// oc-patched)": t.includes("// oc-patched")
};
console.log("tui chunk: " + target);
console.log("modified : " + fs.statSync(target).mtime.toISOString());
console.log();
for (const [k, v] of Object.entries(markers)) console.log("  " + (v ? "[x]" : "   ") + " " + k);
const rr = runningRoot();
const chunkRoot = path.dirname(path.dirname(target));
console.log("\nrunning openclaw loads : " + (rr || "(unknown)"));
console.log("this chunk belongs to : " + chunkRoot);
console.log("same install?          : " + (rr && sameDir(chunkRoot, rr) ? "YES" : "NO  <-- you are running a different copy"));
const ed = safeRead(EDITOR);
console.log("\neditor.js: " + EDITOR);
console.log("  " + (ed.includes("oc patch") || ed.includes("oc-patched") ? "[x]" : "   ") + " patched");
const fmtName = (safeRead(target).match(/from\s*"\.\/(tui-formatters-[A-Za-z0-9_.-]+\.mjs)"/) || [])[1];
const fmt = fmtName ? path.join(DIST, fmtName) : null;
if (fmt && fs.existsSync(fmt)) {
const ft = safeRead(fmt);
console.log("\nformatters chunk: " + fmt);
console.log("  " + (ft.includes("ocComposeOrig") ? "[x]" : "   ") + " thinking fold patched");
}
process.exit(0);
}
if (STATUS) {
console.log("tui chunk: " + STATE_TEXT[backupState(target, orig, isPatchedChunk)]);
console.log("editor.js: " + STATE_TEXT[backupState(EDITOR, backupPath(EDITOR), isPatchedEditor)]);
process.exit(0);
}
for (const [file, bak, isP, label] of [[target, orig, isPatchedChunk, "tui chunk"], [EDITOR, backupPath(EDITOR), isPatchedEditor, "editor.js"]]) {
if (backupState(file, bak, isP) === "stale-backup") {
fs.copyFileSync(file, bak);
if (!AUTO) console.log(label + " changed since the last run (update?): refreshed its backup from the live file");
}
}
// --auto: quiet mode. exit 0 when everything is already patched; otherwise patch with
// minimal output and exit non-zero if any group misses (a wrapper can ignore 0 and run on).
if (AUTO) {
const stT = backupState(target, orig, isPatchedChunk);
const stE = !fs.existsSync(EDITOR) ? "missing" : backupState(EDITOR, backupPath(EDITOR), isPatchedEditor);
if (stT === "patched" && (stE === "patched" || stE === "missing")) {
console.log("vimpel theme: already patched (" + ROOT + ")");
process.exit(0);
}
console.log("vimpel theme: " + ROOT + " -> " + (stT === "stale-backup" || stE === "stale-backup" ? "re-patching after update" : "patching"));
}
if (PROBE) {
const show = (label, text, needles) => {
console.log("\n== " + label + " (" + text.length + " bytes)");
for (const n of needles) {
const hits = [];
let i = -1;
while ((i = text.indexOf(n, i + 1)) !== -1 && hits.length < 40) hits.push(i);
console.log(JSON.stringify(n) + ": " + hits.length + (hits.length >= 40 ? "+" : "") + " hit(s)");
for (const h of hits.slice(0, 2)) console.log("    ..." + text.slice(Math.max(0, h - 70), h + n.length + 90).replace(/\s+/g, " ") + "...");
}
};
show("tui chunk", read(fs.existsSync(orig) ? orig : target), [
"UserMessageComponent", "addSystem(", "composeThinkingAndContent",
"userLabel:", "MarkdownMessageComponent", "assistantLabel:",
"appendNonSystem(new UserMessageComponent", "new UserMessageComponent(text",
"estimatedCostUsd", "inputTokens", "outputTokens", "toolPendingBg"
]);
const eo = fs.existsSync(backupPath(EDITOR)) ? backupPath(EDITOR) : EDITOR;
if (fs.existsSync(eo)) show("pi-tui editor.js", read(eo), ["handleInput(", "getText()", "const layoutWidth", "// Add autocomplete list if active", "visibleWidth"]);
else console.log("\neditor.js not found at " + EDITOR);
process.exit(0);
}
if (!fs.existsSync(orig)) {
ensureBackup(target, "tui chunk");
if (!AUTO) console.log("backed up original ->", orig);
}
const original = read(orig);
let s = original;
const log = [];
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const loose = (str) => new RegExp(str.trim().split(/\s+/).map(esc).join("\\s+"), "g");
// whitespace-tolerant replace, must match exactly once
function rep(name, find, make) {
const re = find instanceof RegExp ? new RegExp(find.source, "g") : loose(find);
const m = s.match(re);
if (!m) { log.push("MISS   " + name); return false; }
if (m.length > 1) { log.push("AMBIG  " + name + " (" + m.length + ")"); return false; }
s = s.replace(re, () => make);
log.push("ok     " + name);
return true;
}
// all-or-nothing group (counted for the N/M summary)
function group(name, fn) {
const snap = s;
if (!fn()) { s = snap; log.push("SKIP   group: " + name + " (reverted)"); G_FAIL++; return false; }
G_OK++;
return true;
}
const has = (id) => new RegExp("\\b" + id + "\\b").test(original);
// 0. session cost: the TUI only copies a few fields from the session row onto sessionInfo.
group("session cost passthrough", () => {
const a = rep("session cost passthrough", `"inputTokens",
"outputTokens",
"displayName",`, `"inputTokens",
"outputTokens",
"estimatedCostUsd",
"displayName",`);
const b = rep("session cost in ui compare", "left.totalTokens === right.totalTokens &&", "left.totalTokens === right.totalTokens && left.estimatedCostUsd === right.estimatedCostUsd &&");
if (a) { log.push("ok     session cost passthrough (field-by-field assembly)"); return true; }
const re = /(\btotalTokens:\s*)(\w+)(\?\.|\.)totalTokens(\s*\?\?\s*(?:null|undefined|void 0))?(?=\s*[,}\n])/g;
const m = s.match(re);
if (!m) {
log.push("MISS   sessionInfo assembly (no cost passthrough hook found), run --probe");
return false;
}
s = s.replace(re, (all, _k, v, op) => all + ", estimatedCostUsd: " + v + op + "estimatedCostUsd ?? null");
log.push("ok     session cost passthrough (" + m.length + " place" + (m.length === 1 ? "" : "s") + ")");
return true;
});
// 1. theme helpers
group("theme helpers", () => {
return rep("theme helpers", "italic: (text) => chalk.italic(text) };",
`italic: (text) => chalk.italic(text),
userLabel: (text) => chalk.bold((tuiTheme.accent || String)(text)),
assistantLabel: (text) => chalk.bold((tuiTheme.dim || String)(activeAgentName || text)),
};`);
});
// 1b. messages: role-parameterised MarkdownMessageComponent. user messages get the user rail
// (OC_CFG.userIcon) + right-aligned block; assistant messages get the agent rail, a live
// pulsing dot header and the receipt row. grouping rows REPLACE the default spacer (no doubling).
group("message class", () => {
if (!s.includes("userLabel:")) { log.push("SKIP   message class needs theme helpers"); return false; }
const re = /var MarkdownMessageComponent = class extends Container \{[\s\S]*?\n\};/;
if (!re.test(s)) { log.push("MISS   message class (shape changed, run --probe for MarkdownMessageComponent)"); return false; }
s = s.replace(re, () => `var MarkdownMessageComponent = class extends Container {
constructor(role, text, imageRenderer) {
super();
this.role = role;
const user = role === "user";
if (typeof ocMsgSeen === "function") ocMsgSeen();
if (typeof ocGroupClose === "function") ocGroupClose();
{ const ocGap = typeof ocGapRow === "function" ? ocGapRow(user ? "u" : "a", text) : null; if (ocGap) this.addChild(ocGap); }
this.agentTone = !user && typeof ocAgentTone === "function" ? ocAgentTone(activeAgentName) : null;
const ocGapRows = typeof ocMessageSpacer === "function" ? ocMessageSpacer(user ? "u" : "a") : [""];
for (const ocR of ocGapRows) this.addChild({ invalidate() {}, render: () => [ocR] });
this.body = new HyperlinkMarkdown(text, 0, 0, markdownTheme, user ? {
color: (line) => tuiTheme.userText(line)
} : { color: (line) => tuiTheme.assistantText(line) }, user ? {
preserveOrderedListMarkers: true,
preserveBackslashEscapes: true
} : void 0);
this.__ocLastVisibleText = text == null ? "" : String(text);
if (user) {
const ocShowUserMarker = OC_CFG.userRail !== false;
const ocMarker = ocShowUserMarker ? chalk.hex(__ocPalette.accent)((OC_CFG.userIcon || ">") + " ") : "";
const head = new Text(ocMarker + tuiTheme.userLabel("you"), 0, 0);
const block = new Container();
block.addChild(head);
// Align the body with the start of "you" (two columns after the marker).
const ocUserBody = {
  invalidate: () => this.body.invalidate(),
  render: (width) => this.body.render(Math.max(1, width - 2)).map((line) => "  " + line)
};
block.addChild(ocUserBody);
this.addChild(block);
} else {
this.header = { invalidate() {}, render: (width) => [ocFit((typeof ocAgentDot === "function" ? ocAgentDot(this.agentTone, typeof ocIsBusy === "function" && ocIsBusy()) : fg(this.agentTone || palette.link || palette.accent)("\\u25c6")) + " " + tuiTheme.assistantLabel("assistant"), width)] };
this.addChild(this.header);
this.addChild(typeof ocRail === "function" ? ocRail(this.body, () => this.agentTone) : this.body);
this.receiptRow = { invalidate() {}, render: (width) => (this.rec && typeof ocReceiptLines === "function" ? ocReceiptLines(this.rec, width) : this.rec && typeof ocReceiptLine === "function" ? [ocReceiptLine(this.rec)] : []) };
this.addChild(this.receiptRow);
this.addChild(new Spacer(1));
this.setTs(Date.now());
}
this.images = new MessageImages(imageRenderer);
this.addChild(this.images);
}
setText(text) {
// Some stream/tool transition events carry a temporary empty display payload.
// Do not let that transient update erase the last visible assistant text.
const next = text == null ? "" : String(text);
if (!next.trim() && this.__ocLastVisibleText && this.__ocLastVisibleText.trim()) return;
this.__ocLastVisibleText = next;
this.body.setText(next);
}
setTs(ts) {
if (!this.__ocSpaced && typeof ocMessageSpacerAfter === "function") { this.__ocSpaced = true; ocMessageSpacerAfter("a"); }
}
setReceipt(rec) {
this.rec = rec || null;
}
setImages(images) {
this.images.setImages(images);
}
dispose() {
this.images.dispose();
}
};`);
log.push("ok     message class (rails, grouping, pulse dot)");
return true;
});
// 1c. assistant call sites
group("message call sites", () => {
const a = rep("assistant finalize", `			lastAssistant = existing ?? new MarkdownMessageComponent("assistant", segmentText, this.imageRenderer);
if (existing) existing.setText(segmentText);
else this.appendNonSystem(lastAssistant);`, `			lastAssistant = existing ?? new MarkdownMessageComponent("assistant", segmentText, this.imageRenderer);
if (existing) existing.setText(segmentText);
else this.appendNonSystem(lastAssistant);
lastAssistant.setTs?.(Date.now());
lastAssistant.setReceipt?.(typeof ocReceiptFor === "function" ? ocReceiptFor(segmentText, true) : null);`);
const b = rep("assistant streaming", `		const component = new MarkdownMessageComponent("assistant", segmentText, this.imageRenderer);
run.streaming = component;`, `		const component = new MarkdownMessageComponent("assistant", segmentText, this.imageRenderer);
component.setTs?.(Date.now());
run.streaming = component;`);
return a && b;
});
// 1d. tool calls: Claude-style inline activity rows by default; Ctrl+X expands full
// arguments/output. Status + duration, diffs, and consecutive-call grouping are retained.
group("tool dots", () => {
const a = rep("tool box", `this.box = new Box(1, 1, tuiTheme.toolPendingBg);`,
`this.box = new Box(0, 0, (line) => line);`);
const b = rep("tool args store", `this.setArgs(args);
this.setResult(void 0, { partial: true });`, `this.args = args;
this.setArgs(args);
this.setResult(void 0, { partial: true });`);
const c = rep("tool spacer", `this.addChild(new Spacer(1));
this.addChild(this.box);`, String.raw`this.addChild(new Spacer(1));
this.addChild({
invalidate: () => this.box.invalidate?.(),
render: (width) => {
const ocG = typeof ocGroupRender === "function" ? ocGroupRender(this, width) : null;
if (ocG) return ocG;
const tone = this.isPartial ? tuiTheme.accent : this.isError ? tuiTheme.error : tuiTheme.success;
const diffy = /edit|patch|write|diff/i.test(String(this.toolName || ""));
const paint = (line, i) => {
if (!diffy || i === 0) return line;
const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
const m = plain.match(/^\s*([+-])(?![+-]{2})/);
if (!m) return line;
const add = m[1] === "+";
const op = globalThis.__ocPalette || {};
return chalk.bgHex(add ? (op.toolSuccessBg || "#262A1B") : (op.toolErrorBg || "#351D1D"))((add ? tuiTheme.success : tuiTheme.error)(plain + " ".repeat(Math.max(0, width - plain.length))));
};
const ocLines = this.box.render(width);
const ocCollapsed = typeof ocCollapsedOutput === "function" && !this.isPartial && !this.isError ? ocCollapsedOutput(ocLines, width) : ocLines;
// Claude-style inline activity: keep each call to one readable row by default.
// Ctrl+X -> expanded reveals the full arguments/output; errors remain expanded for visibility.
if (globalThis.__ocViewName !== "expanded" && !this.isError && ocLines.length > 0) {
const head = ocLines[0].replace(/(?:\s|\x1b\[[0-9;]*m)+$/, "");
const brief = typeof ocArgBrief === "function" ? ocArgBrief(this) : "";
const detail = brief || String(this.toolName || this.title || "tool call");
return [ocFit(head + "\x1b[0m" + tuiTheme.dim("  \u00b7 " + detail), width)];
}
const ocDiff = diffy && !this.isPartial && !this.isError && typeof ocDiffRenderFor === "function" ? ocDiffRenderFor(this, width) : [];
return ocCollapsed.map(paint).concat(ocDiff).map((line, i) => i === 0 ? line : line === "" ? tone("\u2502") : line.replace(/^((?:\x1b\[[0-9;]*m)*) /, (_, pre) => pre + tone("\u2502")));
}
});
this.addChild({ invalidate() {}, render: () => (typeof ocGroupGap === "function" ? ocGroupGap(this) : [""]) });`);
const d = rep("tool output indent", `this.output = new ToolOutputComponent("", 0, 0, markdownTheme,`,
`this.output = new ToolOutputComponent("", 2, 0, markdownTheme,`);
const e = rep("tool refresh header", /refreshTitle\(\) \{[\s\S]*?this\.header\.setText\(tuiTheme\.toolTitle\(tuiTheme\.bold\(title\)\)\);/,
`refreshTitle() {
if (typeof ocGroupJoin === "function") ocGroupJoin(this);
if (typeof ocToolSeen === "function") ocToolSeen(this);
this.box.setBgFn((line) => line);
const ocStatus = this.activity && this.activity.status ? this.activity.status : this.isError ? "failed" : this.isPartial ? "running" : "done";
const ocTone = ocStatus === "failed" ? tuiTheme.error : this.isPartial ? tuiTheme.accent : tuiTheme.success;
const ocLabel = this.title || this.toolName || "tool";
const ocDurBit = !this.isPartial && this.__ocCall && this.__ocCall.t1 != null && typeof ocDurFine === "function" ? " " + tuiTheme.dim(ocDurFine(this.__ocCall.t1 - this.__ocCall.t0)) : "";
this.header.setText(ocTone(ocToolIcon(this.toolName)) + " " + tuiTheme.bold(ocLabel) + " " + tuiTheme.dim(ocStatus) + ocDurBit);`);
const f = rep("tool refresh result bg", `this.box.setBgFn(this.isActive ? tuiTheme.toolPendingBg : this.activity ? status === "failed" ? tuiTheme.toolErrorBg : status === "completed" ? tuiTheme.toolSuccessBg : void 0 : this.isError ? tuiTheme.toolErrorBg : tuiTheme.toolSuccessBg);`,
`this.box.setBgFn((line) => line);`);
const g = rep("tool args line", `this.argsLine.setText(argLine ? tuiTheme.dim(argLine) : tuiTheme.dim(" "));`,
`this.argsLine.setText(argLine ? "  " + tuiTheme.dim(argLine) : "");`);
return a && b && c && d && e && f && g;
});
// 1e. tool icons + active agent name
group("tool icons", () => {
const DARK0 = darkPalette();
const a = rep("agent var", "const tuiTheme = {", String.raw`const ocToolIcons = {
bash: "\uf120",
exec: "\uf120",
process: "\uf120",
read: "\uf02d",
write: "\uf040",
edit: "\uf044",
apply_patch: "\uf0ad",
attach: "\uf0c6",
api: "\uf0ac",
web_fetch: "\uf0ac",
web_search: "\uf002",
browser: "\uf14e",
canvas: "\uf03e",
image: "\uf03e",
image_generate: "\uf1fc",
nodes: "\uf10b",
cron: "\uf017",
get_goal: "\uf140",
create_goal: "\uf140",
update_goal: "\uf140",
update_plan: "\uf0cb",
skill_workshop: "\uf085",
gateway: "\uf1e6",
tool_call: "\uf013",
tool_call_update: "\uf013",
session_status: "\uf080",
sessions_list: "\uf022",
sessions_send: "\uf1d8",
sessions_history: "\uf1da",
transcripts: "\uf130",
sessions_spawn: "\uf126",
subagents: "\uf0e8",
agents_list: "\uf0c0",
memory_search: "\uf1c0",
memory_get: "\uf1c0",
code_execution: "\uf1ec",
message: "\uf0e0",
music_generate: "\uf001",
video_generate: "\uf008",
pdf: "\uf1c1",
tts: "\uf028",
sessions_yield: "\uf04c"
};
function ocToolIcon(name) {
const key = String(name || "").toLowerCase().replace(/^.*[.:\/]/, "");
return ocToolIcons[key] || "\uf12e";
}
let activeAgentName = null;
const tuiTheme = {`);
return a;
});
group("active agent name", () => {
const b = rep("agent from header", `const agentLabel = formatAgentLabel(state.currentAgentId);
const text = `, `const agentLabel = formatAgentLabel(state.currentAgentId);
activeAgentName = agentNames.get(state.currentAgentId) || state.currentAgentId;
const text = `);
const c = rep("agent from footer", `const agentLabel = formatAgentLabel(state.currentAgentId);
footer.setText(`, `const agentLabel = formatAgentLabel(state.currentAgentId);
activeAgentName = agentNames.get(state.currentAgentId) || state.currentAgentId;
footer.setText(`);
return b && c;
});
// 1f. runtime: shared state for everything below. __ocPalette carries the resolved palette.
group("runtime helpers", () => rep("runtime", "};\nconst markdownTheme = {",
"};\nconst ocTheme = tuiTheme;\nconst __ocPalette = " + JSON.stringify(darkPalette()) + ";\nglobalThis.__ocPalette = __ocPalette;\n"
+ RUNTIME.replace(/\btheme\b/g, "ocTheme").replace(/__dirname/g, JSON.stringify(__dirname))
+ "\nglobalThis.__ocCfg = OC_CFG;\nglobalThis.__ocToggleCtxOverlay = ocToggleCtxOverlay;\nglobalThis.__ocCtxOverlayRender = ocCtxOverlayRender;\nglobalThis.__ocBarRightText = ocBarRightText;\nglobalThis.__ocBarPrefix = ocBarPrefix;\nglobalThis.__ocAttachmentChips = ocAttachmentChips;\nglobalThis.__ocCheckPaste = ocCheckPaste;\nglobalThis.__ocPromptHistory = [];\nglobalThis.__ocPromptHistoryRender = ocPromptHistoryRows;\nglobalThis.__ocChangesPanelRender = ocChangesPanelRender;\nconst markdownTheme = {"));
// completion verbs live at module scope so the run-lifecycle factory (a different scope) can reach them.
group("completion verbs", () => rep("completion verbs", "const defaultWaitingPhrases = [", `const completionVerbs = ${JSON.stringify(CFG.completionVerbs)};
function pickCompletionVerb() {
return completionVerbs[Math.floor(Math.random() * completionVerbs.length)];
}
const defaultWaitingPhrases = [`));
// 2. spinner verbs + completion verb in footer
group("spinner + completion verb", () => {
const a = rep("waiting phrases", /defaultWaitingPhrases\s*=\s*\[[^\]]*\];/,
`defaultWaitingPhrases = [
"thinking",
"noodling",
"reasoning",
"percolating",
"searching",
"flibbertigibbeting",
"reading files",
"consulting the oracle",
"analyzing",
"marinating",
"drafting",
"herding tokens",
"compiling",
"bamboozling",
"checking work",
"cogitating furiously",
"untangling spaghetti",
"asking the rubber duck",
"polishing neurons",
"wiggling the wires"
];
const busyVerbs = {
sending: ["sending", "dispatching", "yeeting", "launching the pigeons", "beaming it up"],
running: ["running", "working", "executing", "crunching", "tinkering", "poking things", "wrangling gremlins", "jiggling the handle", "bonking buttons", "spinning the hamster wheel", "reticulating splines", "greasing the gears", "feeding the server hamsters", "negotiating with the compiler", "shaking the magic 8-ball", "sprinkling semicolons", "stirring the cauldron", "dusting off the abacus", "tickling the CPU", "summoning daemons", "pressing buttons authoritatively", "convincing the bits", "doing science at it", "rummaging in the stack", "applying percussive maintenance", "bribing the scheduler", "untwisting the cables", "poking it with a stick"],
streaming: ["writing", "drafting", "composing", "responding", "scribbling", "spinning yarns", "slinging words", "yapping", "conjuring prose", "typing with gusto"]
};
const busyOrders = {};
function shuffleInPlace(list) {
for (let i = list.length - 1; i > 0; i--) {
const j = Math.floor(Math.random() * (i + 1));
[list[i], list[j]] = [list[j], list[i]];
}
return list;
}
function busyVerb(status, startedAt) {
if (status === "running" && typeof ocToolVerb === "function") {
const tv = ocToolVerb();
if (tv) return tv;
}
const list = busyVerbs[status];
if (!list) return status;
let o = busyOrders[status];
if (!o || o.at !== startedAt) o = busyOrders[status] = { at: startedAt, order: shuffleInPlace(list.slice()) };
const secs = Math.floor((Date.now() - (startedAt || Date.now())) / 1000);
return o.order[Math.floor(secs / 4) % o.order.length];
}`);
const b = rep("completion decl", "let waitingTick = 0;", "let waitingTick = 0;\n\tglobalThis.__ocLastCompletion = null;");
const c = rep("completion fire", `const settleRunActivity = (params, reconcileIdle) => {`, `const settleRunActivity = (params, reconcileIdle) => {
globalThis.__ocLastCompletion = typeof ocFinishRun === "function" ? ocFinishRun(pickCompletionVerb()) : pickCompletionVerb();`);
const d = rep("busy status message", 'statusLoader.setMessage(`${state.activityStatus} • ${elapsed} | ${state.connectionStatus}`);',
'statusLoader.setMessage((typeof ocNowStrip === "function" ? ocNowStrip(elapsed) : "") || (busyVerb(state.activityStatus, statusStartedAt) + "… · " + elapsed + (typeof ocLiveBit === "function" ? ocLiveBit() : "") + (/^connected/i.test(String(state.connectionStatus || "")) ? "" : " | " + state.connectionStatus)));');
const e = rep("rotate waiting phrases", "phrases: waitingPhrase ? [waitingPhrase] : void 0", "phrases: void 0")
&& rep("shuffle waiting phrases", `waitingPhrase = defaultWaitingPhrases[idx] ?? defaultWaitingPhrases[0] ?? "waiting";
waitingTick = 0;`, `waitingPhrase = defaultWaitingPhrases[idx] ?? defaultWaitingPhrases[0] ?? "waiting";
shuffleInPlace(defaultWaitingPhrases);
waitingTick = 0;`);
return a && b && c && d && e;
});
// 4b. palette rewrite: whichever palette resolved (tokyonight/daylight/gruvbox/catppuccin/auto)
// replaces openclaw's palette values. brace-scanner matcher: key order / value shape don't matter.
group("palette values", () => {
const DARK = darkPalette();
const keyNames = Object.keys(DARK);
const keyRe = new RegExp("\\b(" + keyNames.join("|") + ")\\s*:\\s*", "g");
const assignRe = /((?:const|let|var)\s+\w*palette\w*\s*=\s*|palette\s*:\s*)\{/gi;
let hit = null, best = 0;
for (let m; (m = assignRe.exec(s));) {
const open = s.indexOf("{", m.index);
if (open < 0) continue;
let depth = 0, i = open, inStr = false, q = "";
for (; i < s.length; i++) {
const c = s[i];
if (inStr) { if (c === "\\") { i++; continue; } if (c === q) inStr = false; continue; }
if (c === '"' || c === "'" || c === "`") { inStr = true; q = c; continue; }
if (c === "{") depth++;
else if (c === "}") { depth--; if (depth === 0) { i++; break; } }
}
const body = s.slice(open, i);
const n = (body.match(keyRe) || []).length;
if (n > best) { best = n; hit = { open, end: i, body }; }
}
if (!hit || best < 10) {
log.push("MISS   palette (no palette object with >=10 keys found)");
return false;
}
let body = hit.body, n = 0;
for (const [k, v] of Object.entries(DARK)) {
const pairRe = new RegExp("(\\b" + k + "\\s*:\\s*color\\(\\s*)\"(#[0-9A-Fa-f]{6})\"(\\s*,\\s*\"(#[0-9A-Fa-f]{6})\"\\s*\\))", "g");
const flatRe = new RegExp("(\\b" + k + "\\s*:\\s*)\"(#[0-9A-Fa-f]{6})\"", "g");
if (pairRe.test(body)) { body = body.replace(pairRe, (_, p, _d, tail) => p + '"' + v + '"' + tail); n++; }
else if (flatRe.test(body)) { body = body.replace(flatRe, (_, p) => p + '"' + v + '"'); n++; }
}
s = s.slice(0, hit.open) + body + s.slice(hit.end);
log.push("ok     palette " + paletteName() + ": " + n + "/" + keyNames.length + " values set" + (n < keyNames.length ? " (some keys not found)" : ""));
return n > 0;
});
// 2b. title: time-of-day greeting + brand line
group("greeting header", () => {
const a = rep("greeting fn", /const completionVerbs = \[[^\]]*\];/, String.raw`const completionVerbs = ${JSON.stringify(CFG.completionVerbs)};
const ocGreetCache = { bucket: null, text: "" };
function ocGreeting() {
const hour = new Date().getHours();
const bucket = Math.floor(hour / 2) + (hour === 17 ? 100 : 0);
if (ocGreetCache.bucket === bucket) return ocGreetCache.text;
const user = process.env.USER || process.env.LOGNAME || process.env.USERNAME || "you";
const opts = ["That's a lot, maybe not, maybe not", "Bangaranga", "Hello", "Welcome back", "Back at it"];
const add = (...xs) => opts.push(...xs);
if (hour < 2) add("Midnight oil burning", "Late night grind", "Still awake", "More cough medicine in my soda lime");
else if (hour < 4) add("Deep night", "Still awake", "Ghost hour", "Up, down");
else if (hour < 6) add("Early bird", "You're watching sport", "Pre-dawn productivity", "Dawn is coming", "Strategy and technique, ten-ten");
else if (hour < 8) add("Good morning", "Rise and shine", "First light", "2194 be the home, be the best");
else if (hour < 10) add("Morning hustle", "Coffee mode", "Start your engines", "I'm in it");
else if (hour < 12) add("Late morning", "Peak focus", "It's brunch time", "Reach the final level, reach the final level");
else if (hour < 14) add("High noon", "Mid-day break", "Good afternoon", "Icey, icey");
else if (hour < 16) add("Afternoon slump", "Powering through", "Stay steady", "Kicking, kicking");
else if (hour < 18) {
if (hour === 17) add("17:00 sharp", "It's happy hour", "Nearly there", "New stylist, I don't do repeats");
add("Sunset approaching", "Golden hour coding", "Winding down work", "When I get home");
} else if (hour < 20) add("Good evening", "Twilight", "Dusk", "I got money, I'm knee deep");
else if (hour < 22) add("Night mode", "Relaxing time", "Stars are out", "And I'll be more than you ever could dream of");
else add("Late evening", "Final tasks", "Get ready for bed", "Sleep");
const greet = opts[Math.floor(Math.random() * opts.length)];
const bolt = "\udb85\udc8b ";
const variants = [bolt + user + " returns!", bolt + greet + ", " + user, bolt + "you don't really know c squared you larp", bolt + "hi terminal freak"];
ocGreetCache.bucket = bucket;
ocGreetCache.text = variants[Math.floor(Math.random() * variants.length)];
return ocGreetCache.text;
}
function ocGradient(text) {
// warm gradient follows the palette: link -> code -> accent
const stops = [__ocPalette.link, __ocPalette.code, __ocPalette.accent].map((h) => ocHexRgb(h, __ocPalette.accent));
const chars = Array.from(text);
const n = Math.max(1, chars.length - 1);
return chars.map((ch, i) => {
if (ch === " ") return ch;
const t = i / n * (stops.length - 1);
const k = Math.min(stops.length - 2, Math.floor(t));
const f = t - k;
const c = stops[k].map((v, j) => Math.round(v + (stops[k + 1][j] - v) * f));
return chalk.rgb(c[0], c[1], c[2])(ch);
}).join("");
}
function ocHeaderLayout(lines) {
// No logo or reserved artwork column: let the greeting and metadata use the full width.
const cols = process.stdout.columns || 80;
return lines.map((line) => ocFit(line, cols)).join("\n");
}
function ocHeaderCompact(url, clock) {
const cols = process.stdout.columns || 80;
const lead = OC_CFG.brand;
let rest = " \u2022 " + url + " \u2022 " + clock;
if (lead.length + rest.length > cols - 1) rest = " \u2022 " + clock;
if (lead.length + rest.length > cols - 1) rest = "";
return ocFit(chalk.bold(ocGradient(lead)) + tuiTheme.dim(rest), process.stdout.columns || 80);
}`);
const b = rep("header text", 'header.setText(tuiTheme.header(sanitizeRenderableLine(text)));',
String.raw`const clock = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
try { globalThis.__ocUpdateHeader = updateHeader; } catch {}
header.setText(typeof ocDensity === "function" && ocDensity() === "zen" ? "" : typeof ocHeaderCollapsed === "function" && ocHeaderCollapsed() ? ocHeaderCompact(client.connection.url, clock) : ocHeaderLayout([chalk.bold(ocGradient(ocGreeting())), tuiTheme.dim(OC_CFG.brand + " \u2022 " + client.connection.url + " \u2022 " + clock), tuiTheme.dim("esc interrupt \u00b7 / commands \u00b7 ctrl+c exit")]));
if (!globalThis.__ocClock) {
const timer = setInterval(() => {
try {
updateHeader();
tui.requestRender();
} catch {}
}, 30000);
timer.unref?.();
globalThis.__ocClock = timer;
}`);
return a && b;
});
// 3. footer: rebuilt from sessionInfo. ROWS RECLAIMED: agent name, connection dot and context %
// move into the box's TOP rule (barTop), model + session into the BOTTOM rule; tokens + cost +
// clock live in the vim bar instead, so nothing is shown twice.
group("footer", () => {
return rep("footer rewrite", `footer.setText(tuiTheme.dim(formatTuiFooter({
agentLabel,
sessionLabel,
sessionInfo: state.sessionInfo,
thinkingLevel: thinkingLevelOverride ?? state.sessionInfo.thinkingLevel,
deliver: deliverDefault
})));`,
String.raw`const ocFooterParts = (() => {
const sessionInfo = state.sessionInfo;
const total = sessionInfo.totalTokens ?? null;
if (typeof ocSetTotal === "function") ocSetTotal(total);
const ctxMax = sessionInfo.contextTokens ?? null;
let tokSeg = null, ctxF = null, tokF = null;
let ctxSeg = null; // hidden until the token count is known
if (total != null && ctxMax) {
const pct = Math.max(0, Math.min(100, Math.round(total / ctxMax * 100)));
if (typeof ocSetCtx === "function") ocSetCtx(pct);
const tone = pct >= 80 ? tuiTheme.error : pct >= 50 ? tuiTheme.accent : tuiTheme.success;
const unitDiv = ctxMax >= 1e6 ? 1e6 : ctxMax >= 1e3 ? 1e3 : 1, unitSuf = unitDiv === 1e6 ? "m" : unitDiv === 1e3 ? "k" : "";
const num = (n) => { const v = n / unitDiv; return (v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "")) + unitSuf; };
if (typeof ocCtxSample === "function") ocCtxSample(total, ctxMax, sessionLabel);
ctxF = (w) => (typeof ocSpark === "function" ? ocSpark(w) + " " : "") + tone(pct + "%");
tokF = (w) => (typeof ocSparkTier === "function" && ocSparkTier(w).name === "phone" ? "" : tuiTheme.dim(num(total) + "/" + num(ctxMax)));
ctxSeg = ctxF(80);
tokSeg = tokF(80);
}
const modelLabel = sessionInfo.model || "unknown";
const costBit = typeof ocCost === "function" ? ocCost(sessionInfo, modelLabel) : "";
const done = globalThis.__ocLastCompletion || null;
const think = thinkingLevelOverride ?? sessionInfo.thinkingLevel ?? "off";
const verbose = sessionInfo.verboseLevel ?? "off";
const reasoning = sessionInfo.reasoningLevel ?? "off";
const fastLabel = sessionInfo.fastMode === "auto" || sessionInfo.fastMode === "ultrafast" ? "fast:" + sessionInfo.fastMode : sessionInfo.fastMode === true ? "fast" : null;
const sessBit = tuiTheme.dim("session " + (typeof ocShortIds === "function" ? ocShortIds(sessionLabel) : sessionLabel));
const segs = [
{ p: 0, t: tuiTheme.bold(tuiTheme.accent(activeAgentName || agentLabel)) },
{ p: 0.1, t: "\u25cf", f: () => (typeof ocConnSeg === "function" ? ocConnSeg() : "") },
{ p: 1, t: ctxSeg, f: ctxF },
{ p: 1.2, t: tokSeg, f: tokF },
{ p: 1.4, t: costBit ? tuiTheme.dim(costBit) : null },
{ p: 2, t: tuiTheme.dim(modelLabel) },
{ p: 2.5, t: sessBit, k: "session" },
{ p: 3, t: think && think !== "off" ? tuiTheme.dim("think " + think) : null },
{ p: 4, t: fastLabel ? tuiTheme.dim(fastLabel) : null },
{ p: 5, t: done ? (globalThis.__ocLastCompletionError ? tuiTheme.error("\u2717") : tuiTheme.success("\u2713")) + " " + (globalThis.__ocLastCompletionError ? tuiTheme.error(done) : tuiTheme.dim(done)) : null },
{ p: 7, t: verbose !== "off" && verbose !== "full" ? tuiTheme.dim("verbose " + verbose) : null },
{ p: 8, t: reasoning !== "off" ? tuiTheme.dim("reasoning " + reasoning) : null },
{ p: 9, t: tuiTheme.dim("deliver:" + (deliverDefault ? "on" : "off")) }
].filter((x) => x && x.t);
// top rule: agent + connection + context %. bottom rule: session + optional controls.
// model, tokens, and cost live in the vim bar so they are not duplicated in the border.
const barTop = [0, 0.1, 1];
const barBottomSkip = [1.2, 1.4, 2];
globalThis.__ocBarInfo = { top: segs.filter((x) => barTop.includes(x.p)), bottom: segs.filter((x) => !barTop.includes(x.p) && barBottomSkip.indexOf(x.p) === -1) };
if (typeof renderStatus === "function" && !isTuiBusyActivityStatus(state.activityStatus)) renderStatus();
const ansi = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
const width = Math.max(20, (process.stdout.columns || 80) - 2);
const fits = () => segs.map((x) => x.t.replace(ansi, "")).join(" \u00b7 ").length <= width;
while (!fits() && segs.length > 1) {
let idx = 0;
for (let i = 1; i < segs.length; i++) if (segs[i].p >= segs[idx].p) idx = i;
segs.splice(idx, 1);
}
return segs.map((x) => x.t).join(tuiTheme.dim(" \u00b7 "));
})();
footer.setText(${KEEP_FOOTER ? "ocFooterParts" : '""'});`);
});
// 3b. Keep the status bar on the final line of the TUI, with breathing room above it.
group("layout: status bar on final line", () => {
const a = rep("root layout", `const root = new Container();
for (const component of [
header,
chatLog,
statusContainer,
footer,
questionStatus,
editor
]) root.addChild(component);`, String.raw`const root = new Container();
const ocStatusRow = { invalidate() { statusContainer.invalidate?.(); }, render(width) { if (!isTuiBusyActivityStatus(state.activityStatus)) return []; const ls = statusContainer.render(width); return typeof ocStatusRight === "function" ? ocStatusRight(ls, width) : ls; } };
const ocToastRow = { invalidate() {}, render(width) { const t = typeof ocToastLine === "function" ? ocToastLine(width) : ""; return t ? [t] : []; } };
const ocVimRow = { invalidate() {}, render(width) { const v = typeof ocVimStatusBar === "function" ? ocVimStatusBar(width) : []; return v.length ? v : (typeof ocZenContext === "function" ? ocZenContext(width) : []); } };
const ocVimSpacer = { invalidate() {}, render() { return [""]; } };
const ocCtxRow = { invalidate() {}, render(width) { return typeof globalThis.__ocCtxOverlayRender === "function" ? globalThis.__ocCtxOverlayRender(width) : []; } };
const ocHistoryRow = { invalidate() {}, render(width) { return typeof globalThis.__ocPromptHistoryRender === "function" ? globalThis.__ocPromptHistoryRender(width) : []; } };
const ocChangesRow = { invalidate() {}, render(width) { return typeof globalThis.__ocChangesPanelRender === "function" ? globalThis.__ocChangesPanelRender(width) : []; } };
const ocSearchRow = { invalidate() {}, render(width) { return typeof ocSearchStrip === "function" ? ocSearchStrip(width) : []; } };
for (const component of [
header,
chatLog,
ocStatusRow,
ocCtxRow,
ocHistoryRow,
ocChangesRow,
ocSearchRow,
footer,
questionStatus,
editor,
ocToastRow,
ocVimSpacer,
ocVimRow
]) root.addChild(component);
// The input stays just above a spacer, and the status bar is pinned to the final TUI line.
root.__ocStickyTail = [ocToastRow, ocVimSpacer, ocVimRow];
if (typeof ocWrapRoot === "function") ocWrapRoot(root);`);
return a;
});
// 3c. chat bar rules: dim while idle, accent while the agent is busy
group("chat bar border", () => {
const a = rep("editor border", "borderColor: tuiTheme.border,",
"borderColor: (text) => ((typeof ocIsBusy === \"function\" ? ocIsBusy() : ocBusy) ? tuiTheme.accent : tuiTheme.border)(text),");
const b = rep("editor theme var", "const editorTheme = {", "let ocBusy = false;\nconst editorTheme = {");
const c = rep("busy flag", "const renderStatus = () => {",
"const renderStatus = () => {\n\t\tglobalThis.__ocRender = () => tui.requestRender();\n\t\tif (typeof ocInit === \"function\") ocInit();\n\t\tconst busyNow = isTuiBusyActivityStatus(state.activityStatus);\n\t\tif (typeof ocBusyTick === \"function\") ocBusyTick(busyNow);\n\t\tif (busyNow !== ocBusy) {\n\t\t\tocBusy = busyNow;\n\t\t\ttui.requestRender();\n\t\t}");
return a && b && c;
});
// 3g-b. send hook: queued images ride along on the next real message as chat.send attachments
group("image send hook", () => {
return rep("sendChat attachments", `				sessionId: sendSessionId,
message: text,
thinking: opts.thinking,`, `				sessionId: sendSessionId,
message: text,
...(typeof ocTakeImages === "function" ? ocTakeImages(text) : {}),
thinking: opts.thinking,`);
});
// 3g. CustomEditor hooks: focus events swallowed first (they must never reach the shortcut
// table or the text input), then the context overlay key, then image paste.
group("context overlay key", () => {
return rep("ctx overlay key", `	handleInput(data) {
if (isKeyRelease(data)) return;
for (const [key, property] of SHORTCUT_HANDLERS) {`, `	handleInput(data) {
if (isKeyRelease(data)) return;
// focus reporting events (\x1b[I / \x1b[O): track focus, never feed them to the editor
if (data === "\x1b[I" || data === "\x1b[O") { if (globalThis.__ocFocusEvent) globalThis.__ocFocusEvent(data === "\x1b[I"); return; }
// oc context overlay (the configured key; ctrl+t belongs to openclaw upstream)
if (typeof ocKeyMatches === "function" && ocKeyMatches(data, OC_CFG.keyCtxOverlay)) {
if (typeof globalThis.__ocToggleCtxOverlay === "function") globalThis.__ocToggleCtxOverlay();
return;
}
// Alt+G toggles the read-only changes review panel. Alt+J/K move between files; Alt+R refreshes.
if (data === "\x1bg" || data === "\x1b[103;3u") {
if (typeof globalThis.__ocToggleChangesPanel === "function") globalThis.__ocToggleChangesPanel();
return;
}
if (globalThis.__ocChangesUI && globalThis.__ocChangesUI.open) {
// Alt+G toggles this panel closed above; keep Escape from cancelling the active agent run.
if (data === "\x1b") return;
if (data === "\x1bj" || data === "\x1b[106;3u") { if (globalThis.__ocChangesMove) globalThis.__ocChangesMove(1); return; }
if (data === "\x1bk" || data === "\x1b[107;3u") { if (globalThis.__ocChangesMove) globalThis.__ocChangesMove(-1); return; }
if (data === "\x1br" || data === "\x1b[114;3u") { if (globalThis.__ocChangesForceRefresh) globalThis.__ocChangesForceRefresh(); return; }
}
// oc image paste: grab an image from the clipboard; no image = fall through to the normal text paste
if (OC_CFG.imagePaste && typeof ocKeyAny === "function" && (ocKeyAny(data, OC_CFG.keyPasteImage) || data === "\x1b[118;5u" || data === "\x1b[118;6u")) {
// Kitty keyboard protocol can encode Ctrl+V instead of sending the legacy 0x16 byte.
const isCtrlV = data === "\x16" || data === "\x1b[118;5u" || data === "\x1b[118;6u";
if (ocPasteImage(!isCtrlV)) return;
}
for (const [key, property] of SHORTCUT_HANDLERS) {`);
});
// 3d. idle status line: coloured connection dot + moon (only rendered while busy now; the idle
// text lives in the box rules)
group("idle status icon", () => {
return rep("idle status text", "const text = state.activityStatus ? `${state.connectionStatus} | ${state.activityStatus}` : state.connectionStatus; statusText?.setText(tuiTheme.dim(text));",
String.raw`const conn = String(state.connectionStatus || "");
const dotTone = /disconnect|error|fail|closed/i.test(conn) ? tuiTheme.error : /^connected/i.test(conn) ? tuiTheme.success : tuiTheme.accent;
const actBit = state.activityStatus === "idle" ? tuiTheme.dim("\u263e idle") : state.activityStatus ? tuiTheme.dim(String(state.activityStatus)) : "";
const idBits = ((globalThis.__ocBarInfo && globalThis.__ocBarInfo.top) || []).filter((x) => !x.f).map((x) => x.t).filter(Boolean);
globalThis.__ocConnText = dotTone("\u25cf") + " " + tuiTheme.dim(conn) + (actBit ? tuiTheme.dim(" \u00b7 ") + actBit : "");
statusText?.setText(dotTone("\u25cf") + " " + tuiTheme.dim(conn) + (actBit ? tuiTheme.dim(" \u00b7 ") + actBit : "") + (idBits.length ? tuiTheme.dim(" \u00b7 ") + idBits.join(tuiTheme.dim(" \u00b7 ")) : ""));`);
});
// 3h. edge to edge
group("edge to edge", () => {
const a = rep("header padding", 'const header = new Text("", 1, 0);', 'const header = new Text("", 0, 0);');
const b = rep("footer padding", 'const footer = new Text("", 1, 0);', 'const footer = new Text("", 0, 0);');
const c = rep("status text padding", 'statusText = new Text("", 1, 0);', 'statusText = new Text("", 0, 0);');
const d = rep("loader padding", 'statusLoader = new Loader(tui, (spinner) => tuiTheme.accent(spinner), (text) => tuiTheme.bold(tuiTheme.accentSoft(text)), "");',
'statusLoader = new Loader(tui, (spinner) => tuiTheme.accent(spinner), (text) => tuiTheme.bold(tuiTheme.accentSoft(text)), "", { frames: (typeof ocLoaderFrames === "function" ? ocLoaderFrames() : ["|", "/", "-", "\\\\"]).map((frame) => tuiTheme.accent(frame)), intervalMs: 100 });\n\t\tstatusLoader.paddingX = 0;');
return a && b && c && d;
});
// 3i. live stats
group("live stats", () => {
const a = rep("count streamed chars", `const displayText = streamAssembler.ingestDelta(evt.runId, evt.message, state.showThinking);
if (displayText === null && evt.replace !== true) return;`,
String.raw`const displayText = streamAssembler.ingestDelta(evt.runId, evt.message, state.showThinking);
{
const L = (globalThis.__ocLive = globalThis.__ocLive || { runId: null, chars: 0, last: 0, first: 0, lastTs: 0 });
if (L.runId !== evt.runId) { L.runId = evt.runId; L.chars = 0; L.last = 0; L.first = 0; }
const n = (displayText || "").length;
if (n) {
if (!L.first) L.first = Date.now();
L.chars += n >= L.last ? n - L.last : n;
L.last = n;
L.lastTs = Date.now();
}
}
if (displayText === null && evt.replace !== true) return;`);
const b = rep("live stats text", "const updateBusyStatusMessage = () => {", String.raw`const ocLiveBit = () => {
const L = globalThis.__ocLive;
if (!L || !L.chars || !L.first || L.runId !== state.activeChatRunId) return "";
const tok = Math.max(1, Math.round(L.chars / 4));
const end = state.activityStatus === "streaming" ? Date.now() : (L.lastTs || Date.now());
const secs = Math.max(1, (end - L.first) / 1000);
const shown = tok >= 1000 ? (tok / 1000).toFixed(1) + "k" : String(tok);
return " \u00b7 " + shown + " tok \u00b7 " + Math.round(tok / secs) + "/s";
};
const updateBusyStatusMessage = () => {`);
return a && b;
});
group("busy tick", () => rep("busy tick", "const updateBusyStatusMessage = () => {",
"const updateBusyStatusMessage = () => {\n\t\tif (typeof ocBusyTick === \"function\" && isTuiBusyActivityStatus(state.activityStatus)) ocBusyTick(true);"));
// 3j. capture the final message (answering model for receipts) AND the final text (OSC 52 copy)
group("run extras: answering model", () => {
return rep("capture final message", "const finalText = streamAssembler.finalize(evt.runId, evt.message, state.showThinking, evt.errorMessage);",
"const finalText = streamAssembler.finalize(evt.runId, evt.message, state.showThinking, evt.errorMessage);\n\t\t\tglobalThis.__ocFinalMsg = evt.message && typeof evt.message === \"object\" && !Array.isArray(evt.message) ? evt.message : null;\n\t\t\tif (finalText) globalThis.__ocLastReply = finalText;\n\t\t\tif (typeof ocRun !== \"undefined\" && ocRun) { if (finalText && String(finalText).trim()) ocRun.replySeen = true; if (evt.errorMessage) ocRun.providerError = String(evt.errorMessage); }");
});
// 3k. brand
group("brand", () => {
const a = rep("default window title", 'opts.title ?? "openclaw tui"', 'OC_CFG.brand + " tui"');
const b = rep("exit message 1", 'process.stderr.write("openclaw tui forcing process exit after return\n");', 'process.stderr.write(OC_CFG.brand + " tui forcing process exit after return\n");');
const c = rep("exit message 2", 'process.stderr.write("openclaw tui forcing exit\n");', 'process.stderr.write(OC_CFG.brand + " tui forcing exit\n");');
const d = rep("exit message 3", "process.stderr.write(`openclaw tui shutdown failed: ${formatTuiErrorMessage(err)}\n`);", "process.stderr.write(`${OC_CFG.brand} tui shutdown failed: ${formatTuiErrorMessage(err)}\n`);");
return a && b && c && d;
});
group("no session banner", () => {
const a = rep("banner on clear", "chatLog.addSystem(`session ${state.currentSessionKey}`);\n\t\t\tstate.historyLoaded = true;", "if (typeof ocChatReset === \"function\") ocChatReset();\n\t\t\tstate.historyLoaded = true;");
const b = rep("banner on history load", "chatLog.addSystem(`session ${state.currentSessionKey}`);\n\t\t\tconst activityByMessageId = new Map(record.activity?.map((entry) => [entry.messageId, entry.items]));", "if (typeof ocChatReset === \"function\") ocChatReset();\n\t\t\tif (typeof ocDigestAtLoad === \"function\") ocDigestAtLoad(chatLog, client, state, record);\n\t\t\tconst activityByMessageId = new Map(record.activity?.map((entry) => [entry.messageId, entry.items]));");
return a && b;
});
// 4c. picker menus
group("picker theme", () => {
const a = rep("picker selected row colour", "selectedText: tuiTheme.header,",
"selectedText: (text) => chalk.bold(fg(palette.link || palette.accent)(text)),");
rep("picker marker", `renderItemLine(item, isSelected, width, patterns) {
const prefix = isSelected ? "→ " : "  ";`, `renderItemLine(item, isSelected, width, patterns) {
const prefix = isSelected ? "▌ " : "  ";`);
return a; // marker is cosmetic, dont revert the colour if only the marker misses
});
// 4d. toasts
group("toasts", () => {
const re = /addSystem\((\w+)(?:[^)]*)\)\s*\{/g;
const m = s.match(re);
if (!m || m.length !== 1) { log.push("MISS   addSystem hook (" + (m ? m.length : 0) + " matches), run --probe"); return false; }
s = s.replace(re, (all, p) => all + "\n\t\tif (typeof ocShortIds === \"function\") " + p + " = ocShortIds(" + p + ");\n\t\tif (typeof ocMaybeToast === \"function\" && ocMaybeToast(" + p + ")) return;");
log.push("ok     addSystem hook");
return true;
});
// 5. safety net before writing
const exportRe = /export\s*\{[^}]*\}/;
const oe = original.match(exportRe), ne = s.match(exportRe);
if (!oe || !ne || oe[0] !== ne[0]) {
console.log(log.join("\n"));
console.log("\nABORT: export list changed or not found, nothing written");
process.exit(1);
}
// syntax gate
function syntaxCheck(code, name) {
if (process.env.OC_SKIP_CHECK) return { ok: true, skipped: true, err: "" };
const tmp = path.join(DIST, name);
fs.writeFileSync(tmp, code);
try {
let r = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
if (r.error) r = spawnSync("/system/bin/linker64", [process.execPath, "--check", tmp], { encoding: "utf8" });
if (r.error) return { ok: true, skipped: true, err: String(r.error) };
return { ok: r.status === 0, err: r.stderr || "" };
} finally {
try { fs.unlinkSync(tmp); } catch {}
}
}
s += OC_MARK;
const chkMain = syntaxCheck(s, "__oc_chunk_check.mjs");
if (!chkMain.ok) {
console.log(log.join("\n"));
console.log("\nABORT: patched chunk fails node --check, nothing written (OC_SKIP_CHECK=1 bypasses the gate)\n" + chkMain.err);
process.exit(1);
}
if (chkMain.skipped && !AUTO) console.log("note: syntax gate skipped (could not launch node --check, or OC_SKIP_CHECK is set)");
fs.writeFileSync(target, s);
if (!AUTO) {
console.log(log.join("\n"));
console.log("\nwritten. exports untouched. undo any time with --restore");
console.log("patched root: " + ROOT);
console.log("if the tui still looks unpatched, clear the node compile cache:");
console.log("  rm -rf \"$(node -p 'require(\"os\").tmpdir()')\"/node-compile-cache/openclaw");
} else {
for (const l of log) if (!l.startsWith("ok")) console.log(l);
}
function sameDir2(a, b) {
try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return path.resolve(a) === path.resolve(b); }
}
{
const rr = runningRoot();
if (rr && !sameDir2(rr, ROOT)) {
console.log("\nWARNING: the `openclaw` on your PATH loads a DIFFERENT install:");
console.log("         running from: " + rr);
console.log("         patched:       " + ROOT);
console.log("         run this script again with " + rr + " to patch the one you actually run.");
} else if (!rr && !AUTO) {
console.log("\nnote: could not resolve which install the `openclaw` on your PATH loads (not a js install?).");
}
const seenReal = new Set([realOf(ROOT)]);
const others = [];
for (const c of CANDIDATES.filter(isRoot)) {
const r = realOf(c);
if (seenReal.has(r)) continue;
seenReal.add(r);
others.push(c);
}
if (others.length && !AUTO) {
console.log("\nthese other openclaw installs were NOT patched - you may be running one of them:");
for (const o of others) console.log("  " + o);
console.log("  run this script with --all-roots to theme them too.");
}
}
// 5b. third target: the formatters chunk (thinking fold)
{
const importRe = /from\s*"\.\/(tui-formatters-[A-Za-z0-9_.-]+\.mjs)"/;
const im = original.match(importRe);
if (!im) {
if (!AUTO) console.log("\nformatters chunk not referenced by the tui chunk, skipping thinking-fold patch");
} else {
const fmtPath = path.join(DIST, im[1]);
if (!fs.existsSync(fmtPath)) {
if (!AUTO) console.log("\nformatters chunk " + im[1] + " not found, skipping thinking-fold patch");
} else {
const fmtOrig = ensureBackup(fmtPath, "formatters chunk");
let fs2 = read(fmtOrig);
const fmtLog = [];
const frep = (name, find, make) => {
const re = find instanceof RegExp ? new RegExp(find.source, "g") : loose(find);
const m = fs2.match(re);
if (!m) { fmtLog.push("MISS   " + name); return false; }
if (m.length > 1) { fmtLog.push("AMBIG  " + name + " (" + m.length + ")"); return false; }
fs2 = fs2.replace(re, () => make);
fmtLog.push("ok     " + name);
return true;
};
const ok = frep("thinking fold", /function composeThinkingAndContent\(/g, String.raw`function composeThinkingAndContent(...ocArgs) {
const p = ocArgs[0];
if (globalThis.__ocFold && p && typeof p === "object" && p.thinkingText && String(p.thinkingText).trim()) {
const n = String(p.thinkingText).trim().split("\n").length;
ocArgs[0] = { ...p, thinkingText: "\u25cc thinking folded \u00b7 " + n + (n === 1 ? " line" : " lines") };
}
return ocComposeOrig(...ocArgs);
}
function ocComposeOrig(`);
if (!ok) {
G_FAIL++;
if (!AUTO) console.log("\nthinking fold: " + fmtLog.join(", "));
} else {
G_OK++;
const fmtExportRe = /export\s*\{[^}]*\}/;
const foe = read(fmtOrig).match(fmtExportRe), fne = fs2.match(fmtExportRe);
if (!foe || !fne || foe[0] !== fne[0]) {
console.log("\nABORT: formatters export list changed, nothing written");
} else {
fs2 += OC_MARK;
const chkFmt = syntaxCheck(fs2, "__oc_fmt_check.mjs");
if (!chkFmt.ok) {
console.log("\nABORT: patched formatters chunk fails node --check, nothing written\n" + chkFmt.err);
} else {
fs.writeFileSync(fmtPath, fs2);
if (!AUTO) {
console.log("\n" + fmtLog.join("\n"));
console.log("formatters chunk written. thinking now folds to a one-line stub (--restore undoes it)");
}
}
}
}
}
}
// 5c. fourth target: the gateway chat client (image attachments forwarding)
{
const gwFile = allJs.find((f) => { const t = safeRead(f); return t.includes('client.request("chat.send"') && t.includes("idempotencyKey: runId") && t.includes("async sendChat(opts)"); });
if (!gwFile) {
if (!AUTO) console.log("\ngateway chat chunk not found, image attachments will not reach the gateway (run --probe)");
} else {
const gwOrig = ensureBackup(gwFile, "gateway chat chunk");
let gs = read(gwOrig);
const gwLog = [];
const gre = loose(`message: opts.message,
thinking: opts.thinking,
deliver: opts.deliver,
timeoutMs: opts.timeoutMs,
idempotencyKey: runId`);
const gm = gs.match(gre);
if (!gm || gm.length !== 1) {
G_FAIL++;
console.log("\ngateway chat chunk: MISS chat.send params (" + (gm ? gm.length : 0) + " matches), attachments not forwarded");
} else {
gs = gs.replace(gre, () => `message: opts.message,
...Array.isArray(opts.attachments) && opts.attachments.length ? { attachments: opts.attachments } : {},
thinking: opts.thinking,
deliver: opts.deliver,
timeoutMs: opts.timeoutMs,
idempotencyKey: runId`);
gwLog.push("ok     gateway chat.send attachments");
G_OK++;
const gx = /export\s*\{[^}]*\}/;
const a1 = read(gwOrig).match(gx), a2 = gs.match(gx);
if (!a1 || !a2 || a1[0] !== a2[0]) console.log("\nABORT: gateway chunk export list changed, nothing written");
else {
gs += OC_MARK;
const chkG = syntaxCheck(gs, "__oc_gw_check.mjs");
if (!chkG.ok) console.log("\nABORT: patched gateway chunk fails node --check, nothing written\n" + chkG.err);
else {
fs.writeFileSync(gwFile, gs);
if (!AUTO) {
console.log("\n" + gwLog.join("\n"));
console.log("gateway chat chunk written. queued image attachments are forwarded to chat.send (--restore undoes it)");
}
}
}
}
}
}
// 6. second target: slash-command / autocomplete menu ABOVE the chat bar + rounded chat box.
if (!fs.existsSync(EDITOR)) {
if (!AUTO) console.log("\neditor.js not found at " + EDITOR + ", skipping slash-menu patch");
} else {
const eOrig = ensureBackup(EDITOR, "editor.js");
if (eOrig && !AUTO) console.log("\nbackup ->", eOrig);
s = read(eOrig);
if (!s.includes("result.push(`${leftPadding}${displayText}${padding}${lineRightPadding}`);")) {
const pristine = fetchPristineEditor(ROOT);
if (pristine) {
fs.writeFileSync(eOrig, pristine);
s = pristine;
if (!AUTO) console.log("editor base was not usable - fetched a pristine editor.js from npm");
} else {
if (!AUTO) {
console.log("note: the editor base is already patched and no pristine copy could be fetched.");
console.log("      the editor groups below will skip; reinstall openclaw for a clean base.");
}
}
}
log.length = 0;
group("rounded chat box", () => {
const a = rep("box layout width", "const layoutWidth = Math.max(1, contentWidth - (paddingX ? 0 : 1));",
"const layoutWidth = Math.max(1, width - 3);");
const b = rep("box side borders", "result.push(`${leftPadding}${displayText}${padding}${lineRightPadding}`);",
String.raw`{ const ocPh = (!this.autocompleteState && typeof this.getText === "function" && this.getText() === "" && globalThis.__ocPlaceholder) ? globalThis.__ocPlaceholder(Math.max(0, width - 3 - lineVisibleWidth)) : ""; result.push("  " + displayText + ocPh); }`);
const e = rep("paste detection", `    insertTextAtCursorInternal(text) {
if (!text)
return;`, `    insertTextAtCursorInternal(text) {
if (typeof globalThis.__ocCheckPaste === "function" && globalThis.__ocCheckPaste(text) === true) return;
if (!text)
return;`);
const c = rep("box top/bottom rules", "// Add autocomplete list if active", String.raw`// oc patch: rounded chat box, info lives in the rules
{
const edge = (t) => this.borderColor(t);
const ansiRe0 = /\x1b\[[0-9;]*m/g;
// editor.js is a separate module; use ANSI directly for its border metadata.
const ocInfoInk = (value) => {
const palette = globalThis.__ocPalette || {};
const hex = String(palette.quote || palette.dim || "#988F8C").replace(/^#/, "");
if (!/^[0-9a-f]{6}$/i.test(hex)) return String(value);
const n = parseInt(hex, 16);
return "\x1b[38;2;" + ((n >> 16) & 255) + ";" + ((n >> 8) & 255) + ";" + (n & 255) + "m" + String(value) + "\x1b[39m";
};
const clipVis = (s, w) => {
s = String(s);
if (w <= 0) return "";
const sgr = /\x1b\[[0-9;]*m/y;
let out = "", vis = 0, i = 0, esc = false;
while (i < s.length) {
sgr.lastIndex = i;
const m = sgr.exec(s);
if (m) { out += m[0]; i += m[0].length; esc = true; continue; }
if (vis >= w) break;
const ch = String.fromCodePoint(s.codePointAt(i));
out += ch; vis++; i += ch.length;
}
return esc ? out + "\x1b[0m" : out;
};
const rule = (side, original) => {
const l = side === "top" ? "\u250c" : "\u2514", r = side === "top" ? "\u2510" : "\u2518";
const inner = Math.max(0, width - 2);
const sc = original.replace(ansiRe0, "").match(/([\u2191\u2193]) (\d+) more/);
if (sc) {
const label = "\u2500\u2500\u2500 " + sc[1] + " " + sc[2] + " more ";
return edge(l + label + "\u2500".repeat(Math.max(0, inner - visibleWidth(label))) + r);
}
// oc chat bar gutter: input counter / token estimate / paste flash / hidden line count
const ocRight = (side === "bottom" && typeof globalThis.__ocBarRightText === "function") ? globalThis.__ocBarRightText(width, () => (typeof this.getText === "function" ? this.getText() : ""), this.scrollOffset + linesBelow) : "";
const ocRightW = ocRight ? visibleWidth(ocRight) : 0;
const info = globalThis.__ocDensity === "zen" ? null : globalThis.__ocBarInfo;
let segs = (info ? (side === "top" ? info.top : info.bottom) : []).map((x) => (typeof x.f === "function" ? { p: x.p, t: x.f(width) } : x)).filter((x) => x.t);
segs = segs.map((x) => (typeof x.f === "function" ? { p: x.p, t: x.f() } : x)).filter((x) => x && x.t);
// Border metadata (model/session/think/delivery) uses a darker ink than the primary identity/status.
segs = segs.map((x) => x.p >= 2 ? { ...x, t: ocInfoInk(String(x.t).replace(ansiRe0, "")) } : x);
const total = () => segs.reduce((n, x) => n + visibleWidth(x.t), 0) + 3 * Math.max(0, segs.length - 1);
while (segs.length > 1 && total() + 5 + ocRightW > width) {
let idx = 0;
for (let i = 1; i < segs.length; i++) if (segs[i].p >= segs[idx].p) idx = i;
segs.splice(idx, 1);
}
// while busy, __ocShim paints a scrolling gradient (null when idle -> normal border)
const shim = globalThis.__ocShim;
let col = 0;
const E = (t) => { const o = (shim && shim(t, col)) || edge(t); col += visibleWidth(t); return o; };
if (!segs.length || total() + 5 + ocRightW > width) {
if (ocRight) {
const bare = clipVis(ocRight, Math.max(0, width - 8));
return E(l + "\u2500 " + bare + " " + "\u2500".repeat(Math.max(0, width - visibleWidth(bare) - 5)) + r);
}
return E(l + "\u2500".repeat(inner) + r);
}
let out = E(l + "\u2500 ");
segs.forEach((x, i) => { if (i) out += E(" \u00b7 "); out += x.t; col += visibleWidth(x.t); });
if (ocRight) {
const bare = clipVis(ocRight, Math.max(0, width - total() - 8));
return out + E(" " + "\u2500".repeat(Math.max(0, width - total() - visibleWidth(bare) - 6)) + bare + " " + r);
}
return out + E(" " + "\u2500".repeat(Math.max(0, width - total() - 5)) + r);
};
const ocTopScroll = /[\u2191\u2193] \d+ more/.test(result[0].replace(ansiRe0, ""));
if (ocTopScroll) result[0] = rule("top", result[0]);
{
const ocBottomExact = () => {
const shim = globalThis.__ocShim;
let col = 0;
const E = (t) => { const o = (shim && shim(t, col)) || edge(t); col += visibleWidth(t); return o; };
const info = globalThis.__ocDensity === "zen" ? null : globalThis.__ocBarInfo;
let segs = (info ? info.bottom : []).map((x) => (typeof x.f === "function" ? { p: x.p, t: x.f(width) } : x)).filter((x) => x && x.t);
segs = segs.map((x) => x.p >= 2 ? { ...x, t: ocInfoInk(String(x.t).replace(/\x1b\[[0-9;]*m/g, "")) } : x);
const right = typeof globalThis.__ocBarRightText === "function" ? globalThis.__ocBarRightText(width, () => (typeof this.getText === "function" ? this.getText() : ""), this.scrollOffset + linesBelow) : "";
let bare = right ? clipVis(right, Math.max(0, width - 8)) : "";
const sw = () => segs.reduce((n, x) => n + visibleWidth(x.t), 0) + 3 * Math.max(0, segs.length - 1);
const fixed = () => (segs.length ? 3 + sw() + 1 : 1) + (bare ? visibleWidth(bare) + 1 : 0) + 1;
while (width - fixed() < 1 && (segs.length || bare)) {
if (segs.length) {
let idx = 0;
for (let i = 1; i < segs.length; i++) if (segs[i].p >= segs[idx].p) idx = i;
segs.splice(idx, 1);
} else bare = "";
}
const dashes = "\u2500".repeat(Math.max(0, width - fixed()));
let out = E(segs.length ? "\u2514\u2500 " : "\u2514");
segs.forEach((x, i) => { if (i) out += E(" \u00b7 "); out += x.t; col += visibleWidth(x.t); });
out += E((segs.length ? " " : "") + dashes);
if (bare) { out += bare; col += visibleWidth(bare); out += E(" "); }
return out + E("\u2518");
};
const ocScrollNow = /[\u2191\u2193] \d+ more/.test(String(result[result.length - 1]).replace(ansiRe0, ""));
let ocB = ocScrollNow ? rule("bottom", result[result.length - 1]) : ocBottomExact();
if (visibleWidth(ocB) !== width) {
if (Date.now() - (globalThis.__ocBorderLogAt || 0) > 1000) {
globalThis.__ocBorderLogAt = Date.now();
try { process.getBuiltinModule("fs").appendFileSync((process.env.TMPDIR || "/tmp") + "/oc-border.log", JSON.stringify({ width, cols: process.stdout.columns, got: visibleWidth(ocB) }) + "\n"); } catch {}
}
ocB = edge("\u2514" + "\u2500".repeat(Math.max(0, width - 2)) + "\u2518");
}
result[result.length - 1] = ocB;
}
if (!ocTopScroll) result[0] = edge("\u250c") + " ".repeat(Math.max(0, width - 2)) + edge("\u2510");
// oc: the "/"-command prefix goes in front of the first text line
if (typeof globalThis.__ocBarPrefix === "function") {
for (let i = 1; i < result.length - 1; i++) {
if (!(result[i] || "").trim()) continue;
result[i] = globalThis.__ocBarPrefix(result[i], () => (typeof this.getText === "function" ? this.getText() : ""));
if (visibleWidth(result[i]) > width - 2) result[i] = clipVis(result[i], width - 2);
break;
}
}
// breathing room inside the box (profile-driven: large 1/1, small 0/0)
const ocP = globalThis.__ocPad ? globalThis.__ocPad() : { top: 1, bottom: 1 };
const ocBlank = () => "";
for (let k = 0; k < ocP.top; k++) result.splice(1, 0, ocBlank());
for (let k = 0; k < ocP.bottom; k++) result.splice(result.length - 1, 0, ocBlank());
}
// Add autocomplete list if active`);
return a && b && c && e;
});
rep("slash menu above chat bar",
/\/\/ Add autocomplete list if active\s*this\.renderedAutocompleteHeight = 0;\s*if \(this\.autocompleteState && this\.autocompleteList\) \{[\s\S]*?\n\s*\}\s*return result;/,
String.raw`// Autocomplete menu: square-cornered box ABOVE the chat bar (oc patch)
this.renderedAutocompleteHeight = 0;
if (this.autocompleteState && this.autocompleteList) {
const innerWidth = Math.max(10, contentWidth - 4);
const autocompleteResult = this.autocompleteList.render(innerWidth);
this.renderedAutocompleteHeight = autocompleteResult.length;
const ansiRe = /\x1b\[[0-9;]*m/g;
const firstText = (autocompleteResult[0] || "").replace(ansiRe, "");
const title = /^\s*(?:\u2192|\u258c)?\s*\//.test(firstText) ? " commands " : " suggestions ";
const edge = (t) => this.borderColor(t);
const menu = [];
menu.push(leftPadding + edge("\u250c\u2500" + title + "\u2500".repeat(Math.max(0, contentWidth - 3 - title.length)) + "\u2510") + rightPadding);
for (const raw of autocompleteResult) {
const line = raw.replace(/^((?:\x1b\[[0-9;]*m)*)\u2192 /, "$1\u258c ");
const pad = " ".repeat(Math.max(0, innerWidth - visibleWidth(line)));
menu.push(leftPadding + edge("\u2502") + " " + line + pad + " " + edge("\u2502") + rightPadding);
}
menu.push(leftPadding + edge("\u2514" + "\u2500".repeat(Math.max(0, contentWidth - 2)) + "\u2518") + rightPadding);
return [...menu, ...result];
}
return result;`);
// editor keys: focus events, log-search input mode, density (ctrl+\ + alt+d fallback),
// ctrl+f search, image list/clear, OSC 52 copy, ctrl+x fold. no fake vim modes.
group("editor keys", () => {
const re = /handleInput\(data\)\s*\{/g;
const m = s.match(re);
if (!m || m.length !== 1) { log.push("MISS   editor keys (" + (m ? m.length : 0) + " handleInput matches), run --probe"); return false; }
s = s.replace(re, () => String.raw`handleInput(data) {
// focus reporting events: swallow + track (never reach the text input)
if (data === "\x1b[I" || data === "\x1b[O") { if (globalThis.__ocFocusEvent) globalThis.__ocFocusEvent(data === "\x1b[I"); return; }
// expose the buffer so the status bar can show a real CMD mode
globalThis.__ocEditorText = () => (typeof this.getText === "function" ? this.getText() : "");
// Read the pi-tui editor's own history buffer; addToHistory() is maintained by pi-tui.
globalThis.__ocPromptHistory = Array.isArray(this.history) ? this.history.slice() : [];
// Searchable history picker (Alt+H). Keep it separate from Ctrl+R context inspection.
{
const hp = globalThis.__ocPromptHistoryUI;
if (hp && hp.active) {
const items = Array.isArray(this.history) ? this.history.filter((x) => !hp.q || String(x).toLowerCase().includes(String(hp.q).toLowerCase())) : [];
if (data === "\x1bh" || data === "\x1b[104;3u") { hp.active = false; hp.q = ""; hp.selected = 0; if (globalThis.__ocRender) globalThis.__ocRender(); return; }
// Do not let Escape reach OpenClaw's run-cancel handler while the picker is open.
if (data === "\x1b") return;
if (data === "\x1b[A" || data === "\x1bOA" || data === "\x10") { hp.selected = Math.max(0, (hp.selected || 0) - 1); if (globalThis.__ocRender) globalThis.__ocRender(); return; }
if (data === "\x1b[B" || data === "\x1bOB" || data === "\x0e") { hp.selected = Math.min(Math.max(0, items.length - 1), (hp.selected || 0) + 1); if (globalThis.__ocRender) globalThis.__ocRender(); return; }
if (data === "\r" || data === "\n") { if (items.length) this.setText(items[Math.max(0, Math.min(items.length - 1, hp.selected || 0))]); hp.active = false; hp.q = ""; if (globalThis.__ocRender) globalThis.__ocRender(); return; }
if (data === "\x7f" || data === "\b") { hp.q = String(hp.q || "").slice(0, -1); hp.selected = 0; if (globalThis.__ocRender) globalThis.__ocRender(); return; }
if (data === "\x15") { hp.q = ""; hp.selected = 0; if (globalThis.__ocRender) globalThis.__ocRender(); return; }
if (typeof data === "string" && data.length && !data.startsWith("\x1b") && !data.startsWith("\x00")) { hp.q = String(hp.q || "") + data; hp.selected = 0; if (globalThis.__ocRender) globalThis.__ocRender(); return; }
return;
}
if (data === "\x1bh" || data === "\x1b[104;3u") {
if (globalThis.__ocPromptHistoryOpen) globalThis.__ocPromptHistoryOpen(typeof this.getText === "function" ? this.getText() : "");
return;
}
}
// log search input mode (ctrl+f starts it; typing filters, esc/enter close)
{
const ocS = globalThis.__ocSearch;
if (ocS && ocS.active) {
if (data === "\x06") { if (globalThis.__ocSearchStop) globalThis.__ocSearchStop(); return; }
if (data === "\x1b" || data === "\r" || data === "\n") { if (globalThis.__ocSearchStop) globalThis.__ocSearchStop(); return; }
if (data === "\x7f" || data === "\b") { ocS.q = ocS.q.slice(0, -1); if (globalThis.__ocRender) globalThis.__ocRender(); return; }
if (data === "\x15") { ocS.q = ""; if (globalThis.__ocRender) globalThis.__ocRender(); return; }
if (typeof data === "string" && data.length >= 1 && !data.startsWith("\x1b")) { ocS.q += data; if (globalThis.__ocRender) globalThis.__ocRender(); return; }
return;
}
}
// ctrl+\ or alt+d : cycle layout density (alt+d = termux/tmux fallback)
if (data === "\x1c" || data === "\x1b[92;5u" || data === "\x1bd" || data === "\x1b[100;3u") {
const ocD = globalThis.__ocDensityNext ? globalThis.__ocDensityNext() : "full";
if (globalThis.__ocToast) globalThis.__ocToast("layout: " + ocD, 1500, true);
if (globalThis.__ocRender) globalThis.__ocRender();
return;
}
// ctrl+f: start log search (a bare "/" stays a slash command)
{
const ocCfg = globalThis.__ocCfg;
if (ocCfg && ocCfg.searchEnabled && (data === "\x06" || data === "\x1b[102;5u")) {
if (globalThis.__ocSearchStart) globalThis.__ocSearchStart();
return;
}
}
// alt+x: list queued images, alt+c: clear them
if (data === "\x1bx" || data === "\x1b[120;3u") { if (globalThis.__ocImagesList) globalThis.__ocImagesList(); return; }
if (data === "\x1bc" || data === "\x1b[99;3u") { if (globalThis.__ocImagesClear) globalThis.__ocImagesClear(); return; }
// ctrl+y: copy last reply via OSC 52, alt+y: copy last code block
if (data === "\x19" || data === "\x1b[121;5u") { if (globalThis.__ocCopyLast) globalThis.__ocCopyLast("reply"); return; }
if (data === "\x1by" || data === "\x1b[121;3u") { if (globalThis.__ocCopyLast) globalThis.__ocCopyLast("code"); return; }
// pi-tui's own matcher also understands the kitty-protocol forms (num/caps lock bits, event types), which raw string compares miss
if ((typeof matchesKey === "function" && matchesKey(data, "ctrl+x")) || data === "\x18" || data === "\x1b[120;5u") {
if (/:[23][A-Za-z~]$/.test(data)) return;
const ocV = globalThis.__ocViewNext ? globalThis.__ocViewNext() : ((globalThis.__ocFold = !globalThis.__ocFold) ? "folded" : "expanded");
if (globalThis.__ocToast) globalThis.__ocToast(ocV === "grouped" ? "tool runs grouped" : ocV === "folded" ? "tool output folded" : "tool output expanded", 1500, true);
if (globalThis.__ocRender) globalThis.__ocRender();
return;
}`);
log.push("ok     editor keys (search, density+alt+d, copy, images, fold " + FOLD_KEY + ")");
return true;
});
if (!log.some((l) => l.startsWith("ok "))) {
if (!AUTO) {
console.log(log.join("\n"));
console.log("editor.js left untouched (pattern missed)");
}
} else {
s += OC_MARK;
const chk2 = syntaxCheck(s, "__oc_editor_check.mjs");
if (!chk2.ok) {
console.log(log.join("\n"));
console.log("editor.js patch fails syntax check, left untouched\n" + chk2.err);
G_FAIL++;
} else {
fs.writeFileSync(EDITOR, s);
if (!AUTO) {
if (chk2.skipped) console.log("note: editor.js written without a syntax check (could not launch node --check)");
console.log(log.join("\n"));
console.log("editor.js written. slash menu, searchable prompt history (alt+h), and changes panel (alt+g) wired (--restore undoes it)");
} else {
for (const l of log) if (!l.startsWith("ok")) console.log(l);
}
}
}
}
// ---- summary: a partial patch must not look like success ----
{
const total = G_OK + G_FAIL;
if (AUTO) {
console.log("vimpel theme: " + G_OK + "/" + total + " groups applied" + (G_FAIL ? " (" + G_FAIL + " missed - run without --auto for details)" : ""));
} else {
console.log("\ngroups applied: " + G_OK + "/" + total + (G_FAIL ? "  <-- " + G_FAIL + " missed, check the MISS/AMBIG lines above (run --probe)" : ""));
}
if (G_FAIL) process.exitCode = 2;
}
}
