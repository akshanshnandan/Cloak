# Installed extension verification

## Manual Personalize with `activeTab`

This smoke procedure checks the toolbar popup and its real buttons. It does not grant persistent access to the fixture host.

1. Build the extension with `npm run build`.
2. Start `npm run fixture` and `npm run companion` in separate terminals. Copy the companion's one-time pairing code.
3. In a dedicated Chrome or Edge profile, open `chrome://extensions` or `edge://extensions`, enable Developer mode, and load the unpacked `extension/dist` folder.
4. Open `http://127.0.0.1:4318/shopping`. Click Cloak's toolbar icon to open the actual extension popup.
5. Enter the pairing code and select **Connect AI**. Enter a preference such as “Show affordable laptops with strong technical specifications first”, then select **Personalize**.
6. Confirm the product-card order changes and the popup reports local AI. Select **Original** and confirm the source order returns without a reload.
7. In the extension's details, check that site access did not acquire a persistent grant from the manual action. Auto-Personalize should still be off.

Opening `popup.html` as a normal tab or sending a runtime message programmatically does not count as a toolbar invocation and cannot prove the `activeTab` flow.

## Auto-Personalize and cancellation

Use a dedicated test profile. The extension requests permission for the current origin only when its **Auto-Personalize this site** switch is turned on. Grant that prompt for the test origin. Keep the preference set and verify:

- Initial enable personalizes the current fixture.
- Reloading the fixture and navigating to another fixture route automatically personalizes the new document/route.
- Leaving and returning to an enabled fixture personalizes it again.
- Turning Auto-Personalize off restores the current page and prevents transformations on later reloads and routes.
- Starting a slow first Qwen inference and switching Cloak Off cancels the request and leaves the page in Original mode.

The automated real-model fixture runner uses `http://127.0.0.1:4318` and checks that permission explicitly. It never accepts a permission prompt or turns Auto-Personalize on by itself. To authorize its host for the isolated runner profile, use the browser's extension details and allow only `http://127.0.0.1`; keep Auto-Personalize off. Then run `npm run test:extension-e2e`.
