# Cloak

**The same website. A little more you.**

Cloak is an open-source, local AI layer that adapts the **real Apple Store** to a person’s interests. Start with the original page. Click **Cloak this page**. Relevant products come into focus. Click **Show original** to restore the page.

There is no recreated storefront, extension, hosted proxy, API key or cloud LLM. Playwright opens `https://www.apple.com/store` in a visible Chromium window. Cloak adds a small, monochrome control to that document.

## Run it

Requires **Node.js 22 or newer** and an internet connection for the store and the initial model download.

```sh
npm install
npm run setup
npm start
```

On Windows, you can also double-click **Start Cloak.cmd**. It installs dependencies on first use and opens Apple directly. Keep the terminal open while using Cloak. Running it again reuses the existing Cloak process and returns to the original Apple Store.

The first run downloads quantized MiniLM weights. Subsequent runs use the model cache. Use `npm run warmup` before a presentation to download and verify the model ahead of time.

## The demo

1. Start Cloak. The real Apple Store opens in **Original** mode.
2. Keep **Engineering student** selected. Scroll through Apple’s original product cards.
3. Click **Cloak this page**. Relevant native cards get a subtle outline and a **For you** badge. The native carousels bring the best matches into view. Macs should rank highly for this profile.
4. Switch the floating control to **Active lifestyle**. Watches and audio products should rise in the ranking.
5. Use **+** or **−** on a highlighted card to teach the local model. Feedback is saved separately for each profile.
6. Click **Show original**. The outlines and badges disappear, and the pre-Cloak page and carousel scroll positions return.

The control’s settings button edits the profile directly on Apple. **Find your top match** brings the highest-ranked existing card into view. Minimize the control when you want more room.

Results depend on Apple’s current content. Cloak extracts live descriptions; it doesn’t fabricate product recommendations or alter prices.

## Architecture

```text
Local Node process
  ├─ Playwright → real apple.com/store in Chromium
  │    ├─ Tested extractor → native product names, descriptions, URLs
  │    ├─ Shadow DOM control → profiles, Cloak/Original, feedback
  │    └─ Reversible adapter → outlines, badges, native carousel focus
  ├─ Transformers.js → quantized MiniLM on the CPU
  │    └─ Semantic ranking → profile + interests − exclusions + feedback
  └─ Local JSON preferences + cached model weights
```

The page calls a Playwright binding for explicit control actions. The Node process embeds the page content and preferences locally, ranks items by cosine similarity, and sends the result back to the live document. Article/product opens provide a smaller positive signal than explicit feedback. Recent feedback carries more weight.

Apple’s nodes stay in their native order. Cloak does not move framework-managed cards, replace links, change product copy, submit forms, or automate purchases. Carousel focus uses the existing scroll containers. Undo removes Cloak’s badges and restores the original styles and captured scroll positions.

Adaptation is restricted to tested store URLs. Following a product link opens Apple’s original product page. The previous Hacker News adapter remains available as a development fallback, but the primary demo is Apple.

## Optional development workspace

`npm run dashboard` starts the optional local dashboard at **http://127.0.0.1:4317**. It provides profile editing, live ranking explanations and learning history. It is a control surface, not a replacement for Apple, and isn’t required for the direct demo.

```sh
npm run dev               # Restart on source changes; opens Apple directly
npm run typecheck
npm test                  # Persistence, ranking and host restrictions
npm run test:integration  # Live Apple + real model + browser verification
```

Integration tests use a separate profile directory and port 4318. They verify the original-first flow, distinct semantic rankings, feedback from the live page, settings on Apple, native node identity, undo and scroll restoration, persisted feedback, keyboard dismissal, responsive layouts and accessibility audits of Cloak’s UI. They require access to Apple and Hugging Face on the first run.

## Data and design

- `data/preferences.json`: profiles, exclusions and feedback. Git-ignored.
- `data/browser/`: Cloak’s separate Chromium profile. Git-ignored; not your personal Chrome profile.
- `.cache/models/`: downloaded model weights. Git-ignored.
- Personal preferences and inference stay on this device. Browsing connects directly to Apple; initial model download connects to Hugging Face. The local server binds only to the loopback interface and checks mutation origins.

Cloak’s monochrome controls follow Apple’s guidance on [layout and progressive disclosure](https://developer.apple.com/design/human-interface-guidelines/layout), [legible typography](https://developer.apple.com/design/human-interface-guidelines/typography), [accessible controls](https://developer.apple.com/design/human-interface-guidelines/accessibility), and [purposeful motion](https://developer.apple.com/design/human-interface-guidelines/motion). System fonts, quiet surfaces, clear focus states and reduced-motion support keep the controls familiar and unobtrusive.

This prototype supports the tested Apple Store structure, not arbitrary websites. If Apple changes its markup, the adapter may need updating. It uses an independent managed browser; working in an already-open personal Chrome tab would require an extension or a separate connection mechanism.

## License

Cloak is [MIT licensed](LICENSE). The [`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2) model is Apache-2.0 licensed. Apple’s website, content and marks belong to Apple. Cloak is an independent project.
