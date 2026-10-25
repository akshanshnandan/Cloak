# Cloak

**A real website, organized around you.**

Cloak uses a local, open-weight language model to reorganize the real Apple Store. It moves Apple’s existing sections, product cards and category navigation into a personalized hierarchy. Products, images, prices, typography and links remain Apple’s own.

Start with **Original**. Click **Cloaked**. Switch back instantly.

| Original | Engineering student | Creative professional |
| --- | --- | --- |
| ![Original Apple Store](docs/images/apple-original.png) | ![The native store organized for study](docs/images/apple-cloaked.png) | ![The native store organized for creative work](docs/images/apple-creative.png) |

Screenshots from the live-browser integration test. The test checks physical DOM order as well as appearance.

## Run

Requires Node.js 22+.

```sh
npm install
npm run setup
npm start
```

Windows: double-click **Start Cloak.cmd**. Apple opens directly in a separate Chromium window. The small control at the bottom switches versions and opens preferences.

The first start downloads a pinned llama.cpp runtime and **Qwen3-1.7B Q4_K_M** weights (about 1.3 GB), plus a smaller MiniLM embedding model. Downloads are cached and verified. To prepare before a demo:

```sh
npm run warmup
```

New needs require local inference. Matching plans are cached, making repeat profile switches fast. Keep the terminal open while using Cloak.

## Try two different people

1. Open Apple in Original mode.
2. Select **Engineering student**, then **Cloaked**. The curated product shelf favors an affordable study setup. Verified education and refurbished content moves closer to the top. The default maximum is $1,400 per product.
3. Select **Creative professional**. Product order and the section hierarchy change around editing, illustration and professional performance. The default maximum is $4,000.
4. Open preferences and describe different needs in your own words. Change the budget and click **Apply**.
5. Use **+ / −** under Fine-tune to influence future ordering.
6. Click **Original**. Native section order, card order, category order, headings and saved scroll positions are restored.

There are no fixed layouts for individual profiles. Both use the same inventory, local model, plan compiler and DOM engine.

## How it works

```text
Real apple.com/store in Playwright
  → inventory of sections, categories, product cards, prices and links
  → local Qwen3: interpret needs and generate schema-constrained decisions
  → MiniLM: semantic ranking and feedback weighting
  → validated plan: section order, card orders, navigation order, collection
  → transactional DOM engine: move existing native nodes
  → Original: restore the recorded layout
```

**The model decides; the engine constrains.** Qwen produces a short collection title, an intended use, a budget and ordered IDs from the actual page. It cannot output executable code or arbitrary CSS. The compiler validates IDs, applies verified price limits, combines semantic relevance with explicit feedback, and retains all existing content.

The primary native product shelf becomes the personalized collection. Other native sections move higher or lower. Cards within each shelf and the product category navigation are reordered. Less relevant content remains available further down the page or carousel.

The DOM engine records positions using nonvisual anchors and moves whole native carousel items. It preserves node identity, event handlers, product copy and imagery. While Cloaked, native carousel buttons page through the new DOM order on the original scroll surface. Original mode restores the previous behavior and recorded layout.

Education pricing is promoted only when the page contains a verified Apple education link. Cloak does not invent discounts, specifications, product availability or prices. The budget compares against the displayed upfront price, not a monthly installment.

## Development and verification

```sh
npm run dev
npm run typecheck
npm test
npm run test:integration
```

Unit tests cover plan validation, budget enforcement, atomic DOM changes, exact restoration, persistence and host restrictions. Integration tests use the real Apple Store and local model to verify that native section, category and card orders actually change between profiles; they also exercise native pagination, product links, feedback, natural-language refinement, undo, responsive controls and accessibility.

`npm run dashboard` opens the optional development control surface at `http://127.0.0.1:4317`. It is not the Apple experience. `/api/state` exposes the current plan and its model provenance for debugging.

### Local runtime

Windows installs a SHA-256-verified, pinned llama.cpp Vulkan build inside `.cache/runtime/`. Use `CLOAK_CPU=1` to disable GPU offloading. On another platform, set `CLOAK_LLAMA_SERVER` to an installed llama-server executable; optionally set `CLOAK_GGUF_MODEL` to a local Qwen3 GGUF file.

The inference process binds to a random loopback port with a per-process API key. Preferences and plans stay on this computer. Browsing still connects to Apple, and first-run downloads connect to GitHub and Hugging Face.

- `data/preferences.json`: profiles, budgets and feedback.
- `data/browser/`: a dedicated Chromium profile.
- `.cache/models/`: local model weights.
- `.cache/plans/`: validated model decisions.

These paths are git-ignored. Integration tests use a temporary profile and a separate port.

## Design

The controls use a compact Original/Cloaked switch and a preferences popover. Their design follows [Apple’s hierarchy and progressive disclosure guidance](https://developer.apple.com/design/human-interface-guidelines/layout), [Apple’s typography guidance](https://developer.apple.com/design/human-interface-guidelines/typography), and [Stripe’s guidance on clear structure and focused actions](https://stripe.com/resources/more/checkout-ui-strategies-for-faster-and-more-intuitive-transactions). The website keeps its native design system.

## Scope and license

The demonstration supports the tested Apple Store structure. Following a product link opens the unmodified Apple product page. Changes to Apple’s markup may require an adapter update. The previous Hacker News adapter remains as a development fallback.

Cloak and llama.cpp are MIT licensed. [Qwen3](https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF) and [MiniLM](https://huggingface.co/Xenova/all-MiniLM-L6-v2) are Apache-2.0 licensed. Apple’s content and marks belong to Apple. This is an independent project.
