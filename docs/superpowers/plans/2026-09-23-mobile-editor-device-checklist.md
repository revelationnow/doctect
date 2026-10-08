# Mobile editor — manual device checklist

Run on a real iPhone (Safari) and Android phone (Chrome), plus an iPad (Safari). Automated coverage
(`tests/e2e/mobile_editor.spec.js`) runs on emulated Chromium only on the dev host, so everything
below is what emulation cannot prove.

- [ ] Editor opens in phone/tablet layout; a desktop browser on a laptop is unchanged at any window width
- [ ] Phone: the tool strip wraps to two rows on narrow screens and every tool, Fit included, is tappable
- [ ] Double-tap text: keyboard opens and the text stays visible above it
- [ ] Tapping a property input doesn't zoom the page
- [ ] Address bar showing/hiding doesn't cut off the bottom sheet or full-screen dialogs
- [ ] Rotate while the drawer is open: drawer closes, page re-fits
- [ ] Long-press on the canvas opens the stack menu, not the system text-selection callout
- [ ] Pinch-zoom feels anchored under the fingers
- [ ] Quick format bar buttons don't end text editing
- [ ] Colour picker opens from the quick format bar's swatch, and one pick is a single undo step
      (iOS Safari fires `change` only when the picker closes — one Undo must revert the whole pick)
- [ ] Generator: toggle between Template and Hierarchy keeps both scripts; Preview and Apply work
- [ ] Layers (in the properties sheet on phone): ▲/▼ reorder layers
- [ ] Phone ⋯ → Home / Gallery / Docs navigate, and the unsaved-work prompt still appears when due
- [ ] iPad with trackpad/mouse: mouse drags still move and marquee-select as on desktop
- [ ] CI: the `mobile-phone-webkit` and `mobile-tablet-webkit` Playwright projects need a run on a host
      where WebKit launches (it cannot on the dev host); watch PDF download detection and the
      synthetic-pointer pinch fallback there
