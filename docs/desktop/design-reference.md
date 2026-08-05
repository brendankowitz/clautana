# Clautana Desktop — Visual Design Reference

Derived from the **Workbench workflow automation platform** design project
(`Workbench v4.dc.html`), imported via the Claude Design MCP on 2026-08-04.

That mockup is a workflow automation tool with steps, triggers, cron schedules,
MCP server configuration, model/role assignment, token budgets, and a live run
log. It maps onto slices 3–5 of this plan almost directly, so it is adopted as
the visual target for the whole desktop app rather than just slice 1's window.

`support.js` in that project is the generated `dc-runtime` React renderer for
`.dc.html` files. It is build infrastructure for the design canvas and carries no
design language — nothing from it is adopted here.

## Character

Windows 11 Fluent, dark, and **information-dense**. Small type, tight radii, flat
surfaces separated by value rather than by shadow. It reads as a professional
tool, not a consumer app: closer to Visual Studio or Azure Portal than to a
marketing page. This suits a Windows-first desktop app that will show long
streams of agent output and dense run tables.

The density is deliberate and worth preserving — body text runs 11–13.5px, far
smaller than web defaults. Do not "fix" this to 16px.

## Tokens

```css
:root {
  /* Surfaces — separated by value, no shadows */
  --bg-app: #101010;        /* window background */
  --bg-panel: #1c1c1c;      /* primary panel */
  --bg-panel-alt: #202020;  /* secondary panel */
  --bg-raised: #272727;     /* cards, list rows */
  --bg-control: #2d2d2d;    /* buttons, inputs, chips — the workhorse fill */
  --bg-control-hover: #383838;

  /* Borders */
  --border: #303030;
  --border-strong: #454545;

  /* Text */
  --fg: #c5c5c5;            /* body */
  --fg-bright: #e6e6e6;     /* emphasis */
  --fg-max: #ffffff;        /* headings, active state */
  --fg-muted: #8b8b8b;      /* secondary, placeholders, labels */

  /* Accent */
  --accent: #60cdff;
  --accent-hover: #7fd8ff;
  --accent-press: #4cc2ff;
  --accent-fg: #001a26;     /* text ON a filled accent surface */
  --accent-wash: rgba(96, 205, 255, 0.14);
  --accent-wash-strong: rgba(96, 205, 255, 0.3);

  /* Status */
  --success: #6ccb5f;
  --warning: #fce100;
  --danger: #ff99a4;
  --danger-solid: #c42b1c;

  /* Type */
  --font: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
  --font-mono: Consolas, 'Cascadia Mono', monospace;

  /* Radii — 4px is the default; 8px for panels and cards */
  --r-sm: 4px;
  --r-md: 8px;
}
```

Accent is used three ways and the foreground pairing matters: as a **fill**
(with `--accent-fg` text on top — never white), as a **foreground** for links and
active icons, and as a **border** for focus and selection.

## Type scale

| Use | Size |
|---|---|
| Section labels, badges (uppercase, tracked) | 11 / 11.5px |
| Dense table cells, secondary text | 12 / 12.5px |
| Body, controls, most UI | 13 / 13.5px |
| Sub-headings | 14–19px |
| Page display | 28px |

Monospace (`--font-mono`) for agent output, log lines, tool arguments, IDs, and
anything the user might copy.

## Layout

Two-pane splits dominate: a fluid main area with a fixed inspector rail at
**320–326px**. Tables use explicit fixed columns rather than auto layout, which
keeps numeric columns aligned across rows.

For slice 1's window this means: agent output stream fluid, run/agent detail in a
~320px right rail.

## Iconography

24×24 stroke icons, `stroke-width: 1.6`, round caps and joins — Lucide-compatible.
The source set is: activity, alert, branch, cal, check, chev, clock, cpu, drag,
file, msg, open, play, plug, plus, refresh, search, sliders, term, up, wand, x.

Prefer `lucide-react` over hand-rolled SVG, set to `strokeWidth={1.6}`.

## Chrome details worth copying

```css
::-webkit-scrollbar { width: 12px; height: 12px; }
::-webkit-scrollbar-thumb {
  background: #4a4a4a; border-radius: 6px;
  border: 4px solid transparent; background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover { background: #5e5e5e; background-clip: content-box; }
::-webkit-scrollbar-track { background: transparent; }
::selection { background: rgba(96, 205, 255, 0.3); }
```

The inset scrollbar (transparent border + `background-clip: content-box`) is what
makes it read as native Windows rather than as a web page.

## Applying this in slice 1

Slice 1's UI is deliberately minimal — project picker, spawn button, prompt
input, output stream. Adopting the tokens and type scale now costs nothing and
means slice 2 extends a coherent surface instead of restyling one.

Status events map to the status colours: `processing` → accent, `idle` → muted,
`interrupted` → warning, `error` → danger, `complete` → success.
