# Arizona visual identity

The dashboard and standalone weather explorer load `frontend/arizona-theme.css`
after their component styles. This layer defines the brand palette, typography,
masthead, controls, panels, calendar, alerts, and responsive layout. Screening
results retain separate green / amber / dark red semantic colors and text labels.
Evaluator behavior, source disclosures, and application controls are unchanged.

## References

- [University of Arizona colors](https://marcom.arizona.edu/brand-guidelines/colors):
  Arizona Blue `#0C234B`, Arizona Red `#AB0520`, Azurite `#1E5288`,
  Cloud `#E5EFF7`, Caliche `#F2EFEA`, and Sonoran Red `#850000`.
- [University typography](https://marcom.arizona.edu/brand-guidelines/typography):
  Hepta Slab is a complementary typeface suited to research/editorial headings.
  Body text prefers an installed Proxima Nova or Calibri, with Arial as fallback.
- [Arizona Digital header pattern](https://review.digital.arizona.edu/arizona-bootstrap/issue/2086/docs/5.1/components/arizona-header/):
  the university wordmark occupies its own masthead above the product identity.

## Local assets

- `frontend/assets/brand/ua-wordmark-white.svg` is the unmodified
  [official white wordmark](https://cdn.digital.arizona.edu/logos/v1.0.0/ua_wordmark_line_logo_white_rgb.min.svg).
  Preserve its proportions and clear space; do not recreate it with text or recolor it.
- `frontend/assets/fonts/hepta-slab-latin-variable.woff2` is the Latin variable
  [Google Fonts webfont](https://fonts.gstatic.com/s/heptaslab/v25/ea8cadoyU_jkHdalebHv42llhHCXA3A.woff2),
  with [upstream sources](https://github.com/google/fonts/tree/main/ofl/heptaslab).
  The bundled `OFL-Hepta-Slab.txt` contains its SIL Open Font License.
  No proprietary font files are bundled.

The masthead and typeface are served locally, so rendering does not require a
third-party font or logo request. `font-display: swap` retains readable fallback
text while the font loads. The existing build copies these assets into `dist/`.
