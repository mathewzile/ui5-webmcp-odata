let counter = 0;

/**
 * A fresh application group ID for one tool call. Calls that share a group would
 * submit, or reset, each other's changes when they run at the same time.
 * Application group IDs may only consist of word characters.
 */
export function nextGroupId(): string {
  counter += 1;
  return `webmcp${counter}`;
}
