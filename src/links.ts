// Outside links the extension opens. Fill these in before release (docs/store/README.md).
//
// FEEDBACK_FORM: the online form for bug reports and complaints. If it contains
// "{details}", that part is replaced with the technical details the user chose to
// include (URL-encoded), e.g. a Tally form with a hidden field:
//   'https://tally.so/r/abc123?details={details}'
// Without the placeholder the form just opens, and the user pastes the details.
//
// DONATE: a Ko-fi / Buy Me a Coffee / GitHub Sponsors page. The "Support EasyMirror"
// link is hidden while it's empty.
const TEST = import.meta.env.MODE === 'spike';

export const FEEDBACK_FORM = TEST ? 'http://127.0.0.1:8787/mock/form?details={details}' : '';
export const DONATE = TEST ? 'http://127.0.0.1:8787/mock/donate' : '';

/** Form URLs get long; browsers and form sites cope with a few thousand characters. */
const MAX_DETAILS_IN_URL = 1800;

/** The form URL with `details` filled in, or undefined when no form is set. */
export function feedbackUrl(details: string): string | undefined {
  if (!FEEDBACK_FORM) return undefined;
  if (!FEEDBACK_FORM.includes('{details}')) return FEEDBACK_FORM;
  const text = details.length > MAX_DETAILS_IN_URL ? `${details.slice(0, MAX_DETAILS_IN_URL)}\n[cut short]` : details;
  return FEEDBACK_FORM.replace('{details}', encodeURIComponent(text));
}
