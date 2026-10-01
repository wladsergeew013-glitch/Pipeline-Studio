# Assets and dependencies

The runnable application uses browser APIs and Python's standard library. No third-party JavaScript runtime packages or fonts are distributed.

The included PNG emoji illustrations were rasterized from the system-installed **Noto Color Emoji** font (Google / Noto contributors). Font binaries are not included. Additional emoji entered by a user can be rasterized locally by that user's browser. Glyph appearance depends on the glyphs available on that system.

`build_assets.py` is an optional asset-generation helper. It uses Pillow and the Python `regex` package, as well as an already installed font. Those development dependencies are not needed to run the shipped application. No Twemoji assets are included.

Tests use optional development tools: Playwright, Chromium, FFmpeg (fixture generation) and PyMuPDF (PDF visual inspection). The server can optionally invoke a locally installed LibreOffice for static previews of office documents. These programs are not bundled in the ZIP.


Russian hyphenation patterns: vendored from Pyphen 0.18.1. Original dictionary, upstream licensing notices and license texts are included in licenses/. The JavaScript Liang matcher is implemented in this project.
