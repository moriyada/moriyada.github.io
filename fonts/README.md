# Fonts

Served from this site (no Google Fonts or other outside requests). Latin subset, woff2,
from the Fontsource npm packages (`@fontsource/inter` 5.3.0, `@fontsource/fraunces` 5.3.0).

| File | Font | Used for |
| --- | --- | --- |
| `inter-400.woff2`, `inter-500.woff2`, `inter-600.woff2` | Inter | body text, menus, buttons, small text |
| `fraunces-400.woff2`, `fraunces-400-italic.woff2`, `fraunces-600.woff2` | Fraunces | headings, quotes, big entry text |

Both are free under the SIL Open Font License 1.1 (Inter: The Inter Project Authors;
Fraunces: The Fraunces Project Authors). The `@font-face` rules are at the top of
`css/style.css`; `inter-400` and `fraunces-600` are preloaded on every page.
