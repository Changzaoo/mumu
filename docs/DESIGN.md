# Aurial — Design System

> Identity: **deep black, glass, one exclusive green**. Minimal like Nothing/Linear, warm like Apple Music, fast like Raycast. Original — inspired by, never copied from, Spotify/Apple/Arc.

## 1. Brand

- Name: **Aurial** (aura + aural).
- Logo concept: a rounded waveform arc forming an "A" (SVG, single path, uses `--accent`).
- Voice: quiet confidence. No exclamation marks in UI copy.

## 2. Color tokens (CSS variables, HSL triplets consumed by Tailwind)

Defined in `styles/globals.css` under `:root` (light) and `.dark`. **All components use tokens — never raw hex.**

| Token           | Dark                                   | Light         | Use                                  |
| --------------- | -------------------------------------- | ------------- | ------------------------------------ |
| `--bg`          | `240 6% 4%` (#0A0A0C deep black)       | `0 0% 99%`    | app background                       |
| `--bg-elevated` | `240 5% 7%`                            | `0 0% 100%`   | cards, sidebar                       |
| `--bg-overlay`  | `240 5% 10%`                           | `240 5% 96%`  | popovers, sheets                     |
| `--fg`          | `0 0% 98%`                             | `240 6% 7%`   | primary text                         |
| `--fg-muted`    | `240 4% 64%`                           | `240 4% 42%`  | secondary text                       |
| `--fg-subtle`   | `240 4% 40%`                           | `240 4% 62%`  | tertiary/placeholders                |
| `--accent`      | `158 84% 52%` (#17E68C — Aurial Green) | `160 84% 36%` | primary actions, active states, play |
| `--accent-fg`   | `160 90% 8%`                           | `0 0% 100%`   | text on accent                       |
| `--info`        | `217 92% 65%` (discreet neon blue)     | `221 83% 53%` | links, focus alt, badges             |
| `--danger`      | `0 72% 58%`                            | `0 72% 46%`   | destructive                          |
| `--border`      | `240 5% 14%`                           | `240 5% 90%`  | hairlines (always 1px)               |
| `--ring`        | = accent                               | = accent      | focus rings                          |

Gradients: only ambient — dominant-color glow extracted from artwork (`color-thief` style util), blurred 120px at 25% opacity behind hero sections. No decorative rainbow gradients.

## 3. Glass

`.glass` utility:

```css
background: hsl(var(--bg-elevated) / 0.55);
backdrop-filter: blur(24px) saturate(140%);
border: 1px solid hsl(var(--fg) / 0.06);
```

Used by: PlayerBar, TopBar (on scroll), context menus, modals, MobileNav, Queue panel. Solid fallback via `@supports not (backdrop-filter: blur(1px))`.

## 4. Typography

- Font: **Inter Variable** (self-hosted via `@fontsource-variable/inter`), `font-feature-settings: "cv02","cv03","cv04","cv11"` for the modern look. Mono: `JetBrains Mono` for timestamps/durations (tabular numbers ok via `font-variant-numeric: tabular-nums`).
- Scale: 12 / 13 / 14 (base) / 16 / 18 / 22 / 28 / 36 / 48. Titles `tracking-tight font-semibold`. Page hero titles `text-4xl md:text-5xl font-bold`.
- Line clamp everywhere text can overflow (`line-clamp-1/2`).

## 5. Spacing, radius, elevation

- Radius: `--radius: 12px`; cards 12, buttons/inputs 10, pills/full 9999, artwork 8 (tracks) / 12 (cards). Never mix radii in one component.
- Grid: content max-width 1600px; page padding `px-4 md:px-6 lg:px-8`; section gap `space-y-8`.
- Shadows: dark mode uses **borders + glow**, not drop shadows. Light mode: `shadow-sm` cards, `shadow-lg` popovers.
- Artwork hover: scale 1.03 + play button fade-in (no heavy shadows).

## 6. Motion (Framer Motion)

- Durations: micro 120ms · UI 200ms · page 320ms. Spring default: `{ type: 'spring', stiffness: 380, damping: 32 }`.
- Page transitions: fade + 8px rise (`opacity 0→1, y 8→0`), 60fps — only `transform`/`opacity` animate. Never animate `width/height/top`.
- Player bar: slides up on first track (spring). Queue panel: slide from right. Bottom sheet (mobile): drag-to-dismiss with `drag="y"`.
- List items: staggered fade-in (`staggerChildren: 0.03`, max 12 items stagger).
- Respect `prefers-reduced-motion`: wrap in `MotionConfig reducedMotion="user"`.

## 7. Layout spec

```
Desktop (≥1024px)
┌────────┬──────────────────────────┬─────────┐
│Sidebar │  Main (scroll container) │ Queue*  │  * collapsible
│ 280px  │   TopBar (sticky, glass) │  320px  │
│        │   <page/>                │         │
├────────┴──────────────────────────┴─────────┤
│ PlayerBar (88px, glass, fixed)              │
└──────────────────────────────────────────────┘

Mobile (<768px): no sidebar; MobileNav bottom tabs (Home, Search, Library);
MiniPlayer (64px) docked above tabs → tap = full-screen NowPlaying sheet.
```

- Sidebar sections: Home, Search, Discover · Library (Playlists, Liked, Albums, Artists, Downloads, Uploads, History) · pinned playlists. Collapsible to 72px (icons only).
- TopBar: back/forward, contextual title (appears on scroll), search shortcut `⌘K`, notifications, avatar menu.
- PlayerBar (3 columns): [artwork+title+artist+like] [transport: shuffle,prev,play,next,repeat + seek bar with buffered indicator] [queue, lyrics, devices, volume, fullscreen].
- NowPlaying (theater mode): full-screen, ambient artwork glow, WaveSurfer waveform, synced lyrics pane, spectrum visualizer toggle.

## 8. Components inventory (components/ui — shadcn-style, CVA variants)

`Button` (default/accent/ghost/outline/destructive; sm/md/lg/icon) · `IconButton` · `Input` · `Textarea` · `Slider` (player seek + volume; thin 4px track, thumb on hover) · `Dialog` · `Sheet` · `DropdownMenu` · `ContextMenu` · `Tooltip` (delay 400ms) · `Tabs` · `Avatar` · `Badge` · `Skeleton` (shimmer) · `Switch` · `Select` · `ScrollArea` · `Toast` (sonner) · `Command` (⌘K palette).

Media components: `MediaCard` (square art, title, subtitle, hover play) · `TrackRow` (index/play, art 40px, title+artist, album, duration, like, menu; height 56px) · `ArtistCard` (circular art) · `SectionCarousel` (h-scroll, snap, arrows on hover) · `HeroHeader` (page hero: art 232px + type label + title + meta + actions row) · `WaveformSeeker` · `SpectrumVisualizer` · `LyricsView` (active line highlighted, auto-scroll) · `EqualizerPanel` (10 sliders + presets).

## 9. States

- Loading: Skeletons matching final layout (never spinners for content).
- Empty states: icon + one sentence + one action. Friendly, short.
- Errors: inline retry card; toasts only for background failures.
- Focus: 2px `--ring` outline offset 2px — always visible via keyboard, never on mouse (`:focus-visible`).

## 10. Accessibility

- All interactive elements keyboard-reachable; roving tabindex in track lists.
- `aria-label` on icon buttons; live region announces track changes.
- Contrast ≥ 4.5:1 for text (tokens above comply); high-contrast theme variant; font scale setting (0.875×–1.25×).

## 11. Theme switching

`settingsStore.theme: 'dark' | 'light' | 'system'` → sets `.dark` class on `<html>`, persists to localStorage, respects `prefers-color-scheme`. Default: **dark**. Both themes are first-class — every screen must be checked in both.
