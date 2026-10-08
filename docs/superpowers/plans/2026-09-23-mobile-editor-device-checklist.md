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
- [ ] Back gesture — iOS Safari edge swipe-back and Android back (gesture and button): with the ⋯ sheet,
      the pages drawer, the project list, a Cloud dialog or a full-screen dialog (JSON, Generator,
      preview, New project) open, back closes just that and stays in the editor on `/app`, with the
      canvas and Undo intact; Generator → Preview unwinds one per back; with nothing open, back
      leaves the editor (unsaved-work prompt when due). iOS: the swipe shows a snapshot of the same
      page before the overlay closes — note how it looks
- [ ] Back with unapplied JSON edits shows "Discard JSON changes?": Cancel keeps the dialog (a second
      back asks again), OK closes it; the same prompt on Escape from a hardware keyboard
- [ ] Select multiple: taps add/remove, dragging one selected element moves all of them in a single
      gesture (none left behind, one Undo reverts the move), ⋯ → Arrange aligns/distributes the group
- [ ] Steppers (−/+ beside X/Y/W/H, Z-Index, padding): a tap nudges once and does not raise the keyboard;
      holding repeats after a short delay and stops the instant the finger lifts; a finger that lands on
      a button and slides off scrolls the sheet/panel with exactly one nudge and no runaway repeat;
      switching apps mid-hold stops the repeat
- [ ] Landscape phone (incl. 844×390 class): the phone layout stays (top bar, one-row tool strip,
      bottom sheet) and a usable canvas band remains between the bar and the strip; rotating back refits
- [ ] Android tablet: tapping a property field raises the keyboard without flipping the layout to phone;
      the layout is re-checked only once the field loses focus
- [ ] iPad with trackpad/mouse: mouse drags still move and marquee-select as on desktop
- [ ] CI: the `mobile-phone-webkit` and `mobile-tablet-webkit` Playwright projects need a run on a host
      where WebKit launches (it cannot on the dev host); watch PDF download detection and the
      synthetic-pointer pinch fallback there
