# Artwork and brand: all rights reserved

The source code in this repository is under the [MIT License](LICENSE). The ShadowCrypt artwork and brand are not. They're the owner's personal mark, and no license is granted to use, copy, modify or redistribute them.

That covers:

- **The ShadowCrypt artwork**: the hooded figure with glowing eyes, drawn in text characters, with the ShadowCrypt name. That includes `assets/shadowcrypt-backdrop-source.webp`, `assets/shadowcrypt-signature-source.webp`, `public/signature-360.webp`, `public/signature-720.webp` and every `public/backdrop-*.webp` made from it.
- **The logo**: everything in `brand/`, the hooded mark drawn by `brandMarkSvg` in `lib/brand.ts` (its shapes and colors, not the code around them), and the icons and preview images generated from it.
- **The names** "ShadowCrypt", "ShadowCrypts" and "ShadowCrypts Predictions".

© 2026 ShadowCrypt. All rights reserved.

## Forking it

Use the code freely under its license, but give your copy its own name and images:

1. Replace the files in `assets/`, `brand/` and the `public/signature-*` and `public/backdrop-*` images with your own.
2. Run `node scripts/make-backdrop.mjs 0.06` on your own backdrop image, or delete the `.site-backdrop` rules in `app/styles/globals.css` and the backdrop test.
3. Draw your own mark in `brandMarkSvg` and change the names in `BRAND` in `lib/brand.ts`.

Team names, logos, player photos and statistics belong to their owners, and none of them are in this repository: the site loads them from ESPN while it runs.
