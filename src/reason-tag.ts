export const REASON_TAG_OPEN = "{REASON:";

/** Prefixes the mode tag unless the text already picks a mode, so a tag the user typed keeps priority. */
export function tagWithReason(text: string, reason: string): string {
  if (text.includes(REASON_TAG_OPEN)) return text;
  return `${REASON_TAG_OPEN}${reason}} ${text}`;
}
