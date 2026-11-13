---
name: Avant-Garde High Jewelry
colors:
  surface: '#fff8f5'
  surface-dim: '#e1d8d3'
  surface-bright: '#fff8f5'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#fbf2ed'
  surface-container: '#f5ece7'
  surface-container-high: '#efe6e1'
  surface-container-highest: '#eae1dc'
  on-surface: '#1f1b18'
  on-surface-variant: '#514345'
  inverse-surface: '#34302c'
  inverse-on-surface: '#f8efea'
  outline: '#837375'
  outline-variant: '#d5c2c4'
  surface-tint: '#81515a'
  primary: '#7e4f57'
  on-primary: '#ffffff'
  primary-container: '#9a676f'
  on-primary-container: '#fffbff'
  inverse-primary: '#f4b7c0'
  secondary: '#5f5e5e'
  on-secondary: '#ffffff'
  secondary-container: '#e2dfde'
  on-secondary-container: '#636262'
  tertiary: '#755717'
  on-tertiary: '#ffffff'
  tertiary-container: '#90702e'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffd9de'
  primary-fixed-dim: '#f4b7c0'
  on-primary-fixed: '#331018'
  on-primary-fixed-variant: '#663a42'
  secondary-fixed: '#e5e2e1'
  secondary-fixed-dim: '#c8c6c5'
  on-secondary-fixed: '#1c1b1b'
  on-secondary-fixed-variant: '#474746'
  tertiary-fixed: '#ffdea5'
  tertiary-fixed-dim: '#e9c176'
  on-tertiary-fixed: '#261900'
  on-tertiary-fixed-variant: '#5d4201'
  background: '#fff8f5'
  on-background: '#1f1b18'
  surface-variant: '#eae1dc'
typography:
  display-lg:
    fontFamily: Syne
    fontSize: 64px
    fontWeight: '700'
    lineHeight: 68px
    letterSpacing: -0.03em
  display-lg-mobile:
    fontFamily: Syne
    fontSize: 38px
    fontWeight: '700'
    lineHeight: 42px
    letterSpacing: -0.02em
  headline-xl:
    fontFamily: Syne
    fontSize: 44px
    fontWeight: '600'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Syne
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Syne
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: 0em
  body-xl:
    fontFamily: Newsreader
    fontSize: 22px
    fontWeight: '400'
    lineHeight: 32px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Newsreader
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
    letterSpacing: 0em
  body-md:
    fontFamily: Newsreader
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0.01em
  spec-num:
    fontFamily: Syne
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: 0.04em
  label-caps:
    fontFamily: Syne
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.14em
  caption-italic:
    fontFamily: Newsreader
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.02em
spacing:
  space-3xs: 0.125rem
  space-2xs: 0.25rem
  space-xs: 0.5rem
  space-sm: 0.75rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
  space-2xl: 4rem
  space-3xl: 6rem
  space-4xl: 10rem
  gutter: 1.5rem
  margin-mobile: 1.25rem
  margin-desktop: 3rem
  max-width: 1440px
---

## Brand & Style

This design system establishes an architectural, avant-garde perspective on fine luxury jewelry. Departing from standard ornamental clichés, it balances stark sculptural forms with tactile warmth. The visual direction fuses sharp geometric discipline with editorial grace, evoking the tactile sensation of unpolished precious metals set against stone and silk.

The aesthetic leans into a precise blend of **Minimalism** and **Architectural Brutalism**:
- Razor-sharp perimeters (zero corner radiuses across every element).
- Asymmetrical breathing room and deliberate whitespace, treating screen viewports like gallery exhibition plinths.
- Sculptural typographic tension: unconventional wide display geometry paired with intimate literary editorial serifs.
- Grounded luxury, driven by crisp luminous surfaces, subtle champagne tiers, deep obsidian typography, and muted dusty rose metallics.

## Colors

The color system anchors on a pristine white gallery canvas contrasted against architectural obsidian and dusty rose accents. Rather than cold clinical monochrome, warmth is introduced through champagne-sand surfaces and muted metallic tones.

### Functional Roles
- **Surface (`#FFFFFF`)**: Pure museum white serving as the primary field for product display grids, high-detail macro gemstone imagery, and primary nav headers.
- **Surface Variant & Container (`#F6F2EB`, `#EFE8DE`)**: Soft warm sand and raw champagne used for editorial sections, product detail background panels, and structural drawer trays.
- **Secondary / Deep Off-Black (`#1A1A1A`)**: Used for authoritative titles, high-contrast actions, and structural bounding borders.
- **Primary / Dusty Rose (`#A26E77`)**: An unconventional, muted mineral tone that acts as the signature brand marker for active states, concierge tags, selection indicators, and intimate editorial accents.
- **Accent Heirloom Gold (`#C5A059`)**: Reserved strictly for metal stampings, hallmark certifications, material specs (e.g., 18k Yellow Gold, Platinum), and bespoke atelier badging.
- **Outline & Divider (`#E2DAD0`)**: Low-contrast linear partitions that segment viewport space without creating visual heaviness.

## Typography

The typographic system creates deliberate tension between two extremes:
1. **Syne (Headlines, Labels, Technical Metadata)**: A striking geometric grotesque that shifts between structural austerity and bold avant-garde proportions. Used in all caps for metadata, navigation, pricing, and sizing to convey modern architectural precision.
2. **Newsreader (Narrative, Editorial Body, Provenance)**: A classic literary serif with distinct, warm proportions. Used for gemstone descriptions, collection narratives, historical essays, and conversational interactions.

### Hierarchy & Style Rules
- All category titles, navigation markers, price displays, and carat specs must render in `Syne` with wide tracking on smaller labels (`0.14em`).
- Poetic storytelling, designer statements, and product essays transition immediately into `Newsreader`, rendering body copy with natural rhythm and optical punctuation.
- Numbers within pricing tables and technical specifications are set in tabular-style Syne to preserve clean alignment down grid axes.

## Layout & Spacing

Layouts follow a modular 12-column architectural grid defined by crisp structural divisions and museum-grade proportions.

### Grid & Margins
- **Desktop (1024px and up)**: 12-column grid, `max-width: 1440px`, with `margin-desktop: 3rem` (48px) and `gutter: 1.5rem` (24px). Editorial sections may break into asymmetrical spans (e.g., 5 columns copy, 7 columns imagery).
- **Tablet (768px – 1023px)**: 8-column grid with `2rem` margins and `1.25rem` gutters.
- **Mobile (Below 768px)**: 4-column grid with `margin-mobile: 1.25rem` (20px) and `0.75rem` gutters. Elements snap into edge-to-edge frames separated by 1px hairline rules.

### Spacing Philosophy
- Vertical pacing uses generous empty fields (`space-3xl`, `space-4xl`) between collection showcases to preserve high visual tension.
- Product cards employ asymmetric internal padding: tighter top/sides (`space-md`) and expanded bottom space (`space-xl`) to give typographic credentials room to breathe.

## Elevation & Depth

This system intentionally rejects skeuomorphic drop shadows and ambient blurs. Depth is conveyed strictly through architectural surface layering and high-contrast structural borders:

- **Flat Graphic Stratification**: Elevation is achieved via planar shifting. A layered modal or slide-over drawer does not float on a shadow; it sits flush on the z-axis using a full 1px solid `#1A1A1A` outline and a warm champagne backdrop (`#F6F2EB`).
- **Hairline Structural Outlines**: Surfaces are framed with crisp `1px` lines. In inactive states, rules are muted warm stone (`#E2DAD0`). In active or focused states, rules snap to stark carbon (`#1A1A1A`).
- **Dimmer Overlays**: Modal backdrops reject dark blurry overlays in favor of a semi-sheer warm mineral veil: `rgba(26, 26, 26, 0.45)`.
- **Image Hover States**: Jewelry pieces are photographed on neutral plinths. Hovering an image tile does not lift the card; it triggers an instant cut to an alternate macro craft detail or on-model silhouette view.

## Shapes

The geometric signature is strictly **Sharp (`roundedness: 0`)**.

- Every button, input field, modal tray, badge, thumbnail frame, and drop-down box features exact 90-degree right angles (0px border radius).
- This sharp geometry reinforces the cold cut of stones, architectural jewelry mounts, and modern art gallery plinths.
- No rounded pills or softened corners are permitted anywhere in the interface.

## Components

### Buttons
- **Primary Action**: Sharp rectangular block with `#1A1A1A` background and `#FFFFFF` text. Typography is `label-caps` (`Syne`, bold, tracked). On hover, background shifts to `#A26E77` with zero ease (instant switch).
- **Secondary Outline**: Flat `#FFFFFF` background, `1px solid #1A1A1A`, text in `#1A1A1A`. On hover, inverts to `#1A1A1A` fill and `#FFFFFF` text.
- **Text Link / Editorial CTA**: Set in `Newsreader`, italicized, underlined with a 1px solid `#A26E77` rule offset by 4px.

### Badges & Chips
- Sharp rectangular tiles with `1px solid #E2DAD0`, background in `#F6F2EB`, and typography set to `label-caps`.
- **Material Hallmark Tag**: Thin `#C5A059` border with matching gold text for precious alloy indicators (e.g., "PT950", "18K OCHRE").
- **Concierge / Atelier Badge**: Muted Dusty Rose `#A26E77` background with `#FFFFFF` text.

### Form Inputs & Fields
- Boxed inputs with 0px corner radiuses. Border is `1px solid #E2DAD0`, resting background is pure `#FFFFFF`.
- Label rests above the field in `label-caps` (`#6E6864`).
- Focused state transforms the border to an unapologetic `1px solid #1A1A1A` with zero outer glow.
- Input text appears in `Syne` for numerical/code entries and `Newsreader` for personalized message cards.

### Product Grid Cards
- Pure `#FFFFFF` framing surrounded by an hairline border (`#E2DAD0`).
- Imagery ratio is locked to an architectural 4:5 vertical proportion.
- Technical specs (carat, purity, dimensions) run along the bottom boundary in 11px uppercase `Syne`, separated by subtle centered dots.
- Price is emphasized with tabular numeric spacing in `headline-sm`.

### Checkboxes & Radios
- Square 16px by 16px boxes with zero corner rounding.
- Inactive: `1px solid #E2DAD0`.
- Active: `#1A1A1A` fill containing an inner 6px square of pure `#FFFFFF` (no check curves).

### Specimen Tables & Accordions
- Horizontal single-pixel separator rules (`#E2DAD0`).
- Accordion triggers set in `headline-sm` with a custom sharp `+` and `−` geometric glyph that rotates instantly on toggle.