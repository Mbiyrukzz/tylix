# Chrome Web Store listing: Tylix DevTools

Upload `devtools/extension/tylix-devtools.zip` (built by `npm run build` in
`devtools/extension`) at https://chrome.google.com/webstore/devconsole.

## Store listing tab

**Name**: Tylix DevTools

**Summary** (132 characters max):
Inspect and edit the live state of Tylix pages, components and capabilities from a DevTools panel.

**Category**: Developer Tools

**Language**: English

**Description**:

Tylix DevTools adds a **Tylix** panel to Chrome's developer tools for apps built with Tylix's native .tyx pages.

- See the live page, layout and components, nested as they are on the page, and the capabilities in use
- Read state, props and computed values, updated as your app changes them
- Edit any state field or prop as JSON. The page re-renders immediately
- Run an action with arguments and see what it returns
- Hover a component in the tree to highlight it on the page

The panel connects to apps served by `tylix dev`, which exposes the app's state to it. It reads nothing from other sites, has no content scripts, and asks for no permissions.

Open source: https://github.com/Mbiyrukzz/tylix

**Graphic assets**:
- Store icon (128×128): `dist/icons/icon-128.png`
- Screenshot (1280×800): `store/screenshot-1.png`
- Small promo tile (440×280): `store/promo-small-440x280.png`

**Homepage URL**: https://github.com/Mbiyrukzz/tylix/tree/main/devtools/extension
**Support URL**: https://github.com/Mbiyrukzz/tylix/issues

## Privacy practices tab

**Single purpose**:
Developer tool that shows and edits the state of Tylix web apps in a Chrome DevTools panel.

**Permission justifications**: none needed. The manifest requests no permissions and no host permissions. It only declares a `devtools_page`.

**Remote code**: No, I am not using remote code. All code is packaged in the extension.

**Data usage**: tick none of the boxes. The extension collects and transmits no user data. It only reads state from the page being inspected, inside DevTools, while the panel is open.

Certify the three disclosures (no selling or transferring data, no unrelated use, no creditworthiness use).

**Privacy policy URL**: not required when no user data is collected. If the form insists, use
https://github.com/Mbiyrukzz/tylix/tree/main/devtools/extension#privacy

## Distribution tab

Visibility: Public. Regions: all.

## Firefox (optional)

The same zip works on https://addons.mozilla.org/developers/ (the manifest carries the Firefox id `devtools@tylix.dev`). Or from the command line: `npx web-ext sign --channel=listed --source-dir dist --api-key … --api-secret …`.
