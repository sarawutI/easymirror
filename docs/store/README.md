# Release prep

- [privacy-policy.md](privacy-policy.md): privacy policy draft. It needs a public URL.
- [listing.md](listing.md): store text, permission justifications, data disclosures, reviewer notes and a Catbox email draft.

## Decisions only you can make

| Decision | Where it's used | Notes |
|---|---|---|
| ~~Publisher name~~ | Store accounts, privacy policy | Decided: Sarawut Detyotdee. |
| ~~Contact email~~ | Stores, privacy policy | Decided: sarawut.det11@gmail.com (public). |
| ~~Where to host the privacy policy~~ | All stores need a public URL | Decided: GitHub Pages, from `docs/` in the public repo. |
| ~~Open source or not~~ | Firefox review, trust | Decided: public repo at https://github.com/sarawutI/easymirror. |
| **Which stores first** | Accounts, fees | Edge Add-ons is free and you already use Edge. Chrome Web Store has a one-time fee. Firefox needs more build work first (M5). |
| ~~Feedback form provider~~ | Report page, privacy policy | Decided: Tally. |
| ~~Donation site~~ | Popup and Settings footer, privacy policy | Decided: Ko-fi. |

## Launch checklist

- [x] Replace the `[BRACKETED]` placeholders in both drafts. (Still open above: which stores first.)
- [x] Publish the privacy policy at a public URL: https://sarawuti.github.io/easymirror/store/privacy-policy.html (GitHub Pages, from `docs/` on `main`).
- [x] Create the feedback form (done: Tally, linked in `src/links.ts`): a long-answer question for the user's message, plus a field named `details` that is filled from the link (in Tally: a hidden field `details`; in Google Forms: a paragraph question, then "Get pre-filled link"). Put its link in `FEEDBACK_FORM` in `src/links.ts`, with `{details}` where the details go, e.g. `https://tally.so/r/abc123?details={details}`. A link without `{details}` also works: the details get copied to the clipboard for the user to paste.
- [x] Set up a donation page (done: Ko-fi, linked as `DONATE` in `src/links.ts`). If you ever remove it, empty `DONATE` and delete the "Donations" section from the privacy policy.
- [ ] Send the Catbox courtesy email (draft in listing.md) and wait for a reply.
- [ ] Test Pixeldrain with a real API key (still untested against the real service).
- [x] Make screenshots (1280×800) and a small promo tile (440×280): in [store-assets/](../../store-assets/). Regenerate them with `npm run store-images` after UI changes.
- [ ] Bump the version in `package.json` to `1.0.0`, then run `npm run build` and `npx wxt zip`.
- [ ] Create the developer account(s) and submit.
- [ ] Firefox only: finish the Firefox build (M5), add `browser_specific_settings` (see listing.md), submit with source.
