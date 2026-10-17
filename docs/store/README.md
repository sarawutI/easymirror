# Release prep

- [privacy-policy.md](privacy-policy.md): privacy policy draft. It needs a public URL.
- [listing.md](listing.md): store text, permission justifications, data disclosures, reviewer notes and a Catbox email draft.

## Decisions only you can make

| Decision | Where it's used | Notes |
|---|---|---|
| **Publisher name** shown in the stores | Store accounts, privacy policy | Your name or a project name. |
| **Contact email** | Stores, privacy policy | It's public, so a separate address keeps your personal one private. |
| **Where to host the privacy policy** | All stores need a public URL | Easiest: a free GitHub Pages site. A public GitHub repository also gives you a support URL. |
| **Open source or not** | Firefox review, trust | Firefox needs the source either way, but only reviewers see it. A public repo builds trust and doubles as a homepage. |
| **Which stores first** | Accounts, fees | Edge Add-ons is free and you already use Edge. Chrome Web Store has a one-time fee. Firefox needs more build work first (M5). |
| **Feedback form provider** | Report page, privacy policy | Tally (free, supports hidden fields filled from the link) or Google Forms (prefilled field). |
| **Donation site** | Popup and Settings footer, privacy policy | For example Ko-fi, Buy Me a Coffee or GitHub Sponsors. Optional: the link stays hidden until you set it. |

## Launch checklist

- [ ] Decide the items above and replace the `[BRACKETED]` placeholders in both drafts.
- [ ] Publish the privacy policy at a public URL.
- [ ] Create the feedback form: a long-answer question for the user's message, plus a field named `details` that is filled from the link (in Tally: a hidden field `details`; in Google Forms: a paragraph question, then "Get pre-filled link"). Put its link in `FEEDBACK_FORM` in `src/links.ts`, with `{details}` where the details go, e.g. `https://tally.so/r/abc123?details={details}`. A link without `{details}` also works: the details get copied to the clipboard for the user to paste.
- [ ] Optional: set up a donation page and put its link in `DONATE` in `src/links.ts`. Leave it empty to hide the link, and remove the "Donations" section from the privacy policy.
- [ ] Send the Catbox courtesy email (draft in listing.md) and wait for a reply.
- [ ] Test Pixeldrain with a real API key (still untested against the real service).
- [x] Make screenshots (1280×800) and a small promo tile (440×280): in [store-assets/](../../store-assets/). Regenerate them with `npm run store-images` after UI changes.
- [ ] Bump the version in `package.json` to `1.0.0`, then run `npm run build` and `npx wxt zip`.
- [ ] Create the developer account(s) and submit.
- [ ] Firefox only: finish the Firefox build (M5), add `browser_specific_settings` (see listing.md), submit with source.
