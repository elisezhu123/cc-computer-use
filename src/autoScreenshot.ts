/**
 * Screenshot after every action. Without it the model calls `screenshot`
 * after nearly every click to see what happened, which doubles the number of
 * model round trips - the slow part of each step. With it, the action's own
 * result carries the new screen state.
 *
 * On by default in every mode; CU_AUTO_SCREENSHOT=0 turns it off.
 */

/** Actions whose result changes what is on screen. */
export const AUTO_SCREENSHOT_ACTIONS: ReadonlySet<string> = new Set([
  'left_click', 'double_click', 'triple_click', 'right_click', 'middle_click',
  'left_click_drag', 'left_mouse_up', 'type', 'key', 'hold_key', 'scroll',
  'open_application', 'computer_batch',
]);

/** Time for the UI to react (menus opening, pages scrolling) before capture. */
export const AUTO_SCREENSHOT_SETTLE_MS = 250;

export function autoScreenshotEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CU_AUTO_SCREENSHOT !== '0';
}

type Block = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
interface Result { content: Block[]; isError?: boolean }

/**
 * Append a fresh screenshot to a successful action result. A batch whose last
 * action already was a screenshot is left alone, and so is any result when
 * the capture itself fails - the action did happen, and that is what the
 * result reports.
 */
export async function withAutoScreenshot<R extends Result>(
  name: string,
  args: Record<string, unknown>,
  result: R,
  take: () => Promise<Result>,
  settleMs = AUTO_SCREENSHOT_SETTLE_MS,
): Promise<R> {
  if (result.isError || !AUTO_SCREENSHOT_ACTIONS.has(name)) return result;
  if (name === 'computer_batch') {
    const actions = args.actions as { action?: unknown }[] | undefined;
    if (actions?.at(-1)?.action === 'screenshot') return result;
  }
  if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs));
  let shot: Result;
  try {
    shot = await take();
  } catch {
    return result;
  }
  const note = shot.content.find((c) => c.type === 'text');
  const image = shot.content.find((c) => c.type === 'image');
  if (shot.isError || !image) return result;
  // A batch may carry an image from a mid-batch screenshot; the new one supersedes it.
  const content: Block[] = result.content.filter((c) => c.type !== 'image');
  content.push({ type: 'text', text: `Screenshot after the action: ${note?.type === 'text' ? note.text : ''}`.trim() });
  content.push(image);
  return { ...result, content };
}
