# SuperTing Logo

`超级听记 / SuperTing` — single brand mark, 256×256 viewBox SVG, no external
dependencies. **This is the only logo.** Variants are produced by re-exporting
to PNG / WebP at the size you need; do not introduce parallel SVG variants.

## The mark  (`superting-logo-smark.svg`)

A blue rounded-square chip holds a white **S** with a soft cyan halo, flanked
by three short audio waves on each side that taper outward in amplitude.

### Palette

| Role                 | Hex          | Notes                                 |
| -------------------- | ------------ | ------------------------------------- |
| Chip top             | `#0B3D91`    | Deep navy                             |
| Chip bottom          | `#0A2E6E`    | Slightly darker for vertical depth    |
| Letterform fill      | `#FFFFFF`    | Solid white                           |
| Letterform halo      | `#67B8E8`    | Soft cyan, 35% opacity, 9px stroke    |
| Audio waves          | `#FFFFFF`    | White, three opacity tiers per side   |

The cyan halo is **not** a separate decoration — it's the same S glyph
re-rendered with a wider, semi-transparent stroke behind the white fill.
That single trick is what gives the letter its hand-painted, brushstroke
feel.

### Audio waves

Six waves total — three on each side of the S, sitting strictly in the
empty space at the chip's left and right edges. They never touch the
letter, never cross it. They read as sound radiating outward.

| Position (left side) | Stroke width | Opacity |
| -------------------- | ------------ | ------- |
| inner (closer to S)  | 3.5          | 0.9     |
| middle               | 2.5          | 0.55    |
| outer (chip edge)    | 2.0          | 0.3     |

Right side mirrors the left. All waves are single quadratic béziers
with `stroke-linecap="round"`.

### Typography

The S is rendered with `<text>`, not a hand-drawn `<path>`, so the
letterform is guaranteed correct across every renderer. Font stack is
system-only:

```
'Futura', 'Avenir Next', 'Avenir', 'Trebuchet MS', sans-serif
```

No web font, no embed, no missing-glyph risk on any platform.

### Canvas

- **256 × 256** viewBox.
- Chip: full canvas with `rx="40"` rounded corners.
- The S is centred horizontally at `x=128`; the letter's optical centre
  sits at roughly `y=130` (the `y="200"` attribute on the `<text>`
  element is the baseline, which places the cap height around the
  chip's vertical centre for `font-size="200"`).

## Where to use it

| Surface               | Notes                                              |
| --------------------- | -------------------------------------------------- |
| macOS `.icns` icon    | Primary app icon — export to PNG at 1024, downscale |
| Control panel header  | Drop in as-is                                       |
| Marketing & docs      | Hero on light backgrounds                            |
| Business card / press | Drop in as-is                                       |
| Dark UI placeholders  | The cyan halo carries well on dark; the chip itself provides contrast |

**Avoid** on a busy photographic background — the chip's clean rounded
square is meant to read as a confident brand mark, not float on a
collage. On a photo, place the chip on a flat coloured panel first.

## Implementation notes

- **Adjust the audio waves**: each wave is a single `<path>` with
  `Q controlX controlY endX endY`. The control point's Y value
  sets the amplitude — pull it toward 128 for a flatter wave, push
  it away (to 100 or 156) for a taller one.
- **Adjust the halo**: the halo is the same `<text>` element rendered
  with `fill="none"`, `stroke="#67B8E8"`, `stroke-width="9"`,
  `opacity="0.35"`. Bumping the opacity to 0.5 makes the S feel more
  painterly; dropping it to 0.2 makes the S feel more like a logo
  lockup.
- **Need a flat-mark variant** (no chip background)? Delete the
  `<rect width="256" height="256" rx="40" ry="40" fill="url(#bgA)"/>`
  element. The white S and white waves will sit on whatever the chip
  was sitting on.
- **Need a light-on-light variant**? Swap `#0B3D91 → #0A2E6E` for a
  pale wash, change the S to `#0B3D91` (deep navy ink), and the
  waves to the same navy. The cyan halo still works.
