/* The wordmark, in one place. The developer has not confirmed it yet
 * (design/QUESTIONS.md, question 1), so swapping it is a one-line change here.
 * index.html repeats it in its static <title> for crawlers and the first paint;
 * the page sets document.title from PAGE_TITLE at runtime. */

export const WORDMARK = "VOLTA";

/** The dock mark's accessible name. */
export const MARK_LABEL = `${WORDMARK}, home`;

export const PAGE_TITLE = `${WORDMARK} · Smart Energy Microgrid`;
