/**
 * Tool schemas, matching the official @ant/computer-use-mcp server's tool set
 * and naming so the model's existing computer-use knowledge transfers.
 *
 * Coordinate text is written once (COORD_DESC) and reused everywhere a
 * coordinate appears, because a coordinate convention described two different
 * ways in two tools is how the model ends up clicking in the wrong space.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const COORD_DESC = {
  x: 'Horizontal pixel position read directly from the most recent screenshot image, measured from the left edge.',
  y: 'Vertical pixel position read directly from the most recent screenshot image, measured from the top edge.',
};

const coordinateTuple = {
  type: 'array' as const,
  items: { type: 'number' },
  minItems: 2,
  maxItems: 2,
  description: `(x, y): ${COORD_DESC.x} ${COORD_DESC.y}`,
};

const FRONTMOST_GATE_DESC =
  'The frontmost application must be in the session allowlist at the time of this call, or this tool returns an error and does nothing.';

const clickModifierText = {
  type: 'string',
  description:
    'Modifier keys to hold during the click (e.g. "shift", "ctrl+shift"). Same syntax as the key tool.',
};

/** Actions valid inside computer_batch.actions. Kept in sync with dispatchAction. */
export const BATCH_ACTION_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [
        'key', 'type', 'mouse_move', 'left_click', 'left_click_drag',
        'right_click', 'middle_click', 'double_click', 'triple_click',
        'scroll', 'hold_key', 'screenshot', 'cursor_position',
        'left_mouse_down', 'left_mouse_up', 'wait',
      ],
      description: 'The action to perform.',
    },
    coordinate: { ...coordinateTuple, description: '(x, y) for click/mouse_move/scroll/left_click_drag end point.' },
    start_coordinate: { ...coordinateTuple, description: '(x, y) drag start - left_click_drag only. Omit to drag from the current cursor.' },
    text: {
      type: 'string',
      description: 'For type: the text. For key/hold_key: the chord string. For click/scroll: modifier keys to hold.',
    },
    scroll_direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
    scroll_amount: { type: 'integer', minimum: 0, maximum: 100 },
    duration: { type: 'number', description: 'Seconds (0-100). For hold_key/wait.' },
    repeat: { type: 'integer', minimum: 1, maximum: 100, description: 'For key: repeat count.' },
  },
  required: ['action'],
} as const;

export function buildComputerUseTools(installedAppNames: readonly string[]): Tool[] {
  const installedAppsHint =
    installedAppNames.length > 0
      ? ` Available applications on this machine: ${installedAppNames.join(', ')}.`
      : '';

  return [
    {
      name: 'request_access',
      description:
        'Request permission to control a set of applications for this session. Must be called before any other tool in this server. ' +
        'Returns the granted apps, the apps that could not be resolved, and the active grant flags.',
      inputSchema: {
        type: 'object',
        properties: {
          apps: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Application display names (e.g. "Safari") or bundle identifiers (e.g. "com.apple.Safari"). Display names resolve case-insensitively against installed apps.' +
              installedAppsHint,
          },
          reason: {
            type: 'string',
            description: 'One-sentence explanation of the task. Shown to the user.',
          },
          clipboardRead: { type: 'boolean', description: 'Also grant reading the clipboard.' },
          clipboardWrite: { type: 'boolean', description: 'Also grant writing the clipboard. When granted, multi-line and long (over 200 characters) `type` calls use the faster clipboard paste path.' },
          systemKeyCombos: { type: 'boolean', description: 'Also grant system-level key combos (quit app, switch app, lock screen). Without this those specific combos are refused.' },
        },
        required: ['apps', 'reason'],
      },
    },
    {
      name: 'list_granted_applications',
      description: 'List the applications in the session allowlist, the active grant flags, and the current screenshot dimensions that coordinates are relative to. No side effects.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'screenshot',
      description:
        'Take a screenshot of the current display. Returns an error if the allowlist is empty. ' +
        'The returned image is what all subsequent click coordinates are relative to; the tool result states its pixel dimensions.',
      inputSchema: {
        type: 'object',
        properties: {
          save_to_disk: {
            type: 'boolean',
            description: 'Save the image to disk so it can be attached to a message for the user. Returns the path. Only set this when you intend to share the image.',
          },
        },
        required: [],
      },
    },
    {
      name: 'zoom',
      description:
        'Take a higher-resolution screenshot of a region of the last full-screen screenshot. Use this liberally to read small text or fine UI details. ' +
        'IMPORTANT: coordinates in subsequent click calls always refer to the full-screen screenshot, never the zoomed image. Read-only.',
      inputSchema: {
        type: 'object',
        properties: {
          region: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 4,
            maxItems: 4,
            description: '(x0, y0, x1, y1): rectangle to zoom into, in the coordinate space of the most recent full-screen screenshot. x0,y0 = top-left, x1,y1 = bottom-right.',
          },
          save_to_disk: { type: 'boolean', description: 'Save the cropped image to disk and return its path.' },
        },
        required: ['region'],
      },
    },
    {
      name: 'switch_display',
      description:
        'Switch which monitor subsequent screenshots capture. Use this when the application you need is on a different monitor. ' +
        'Pass a monitor name or index from the screenshot note, or "auto" to return to the main display.',
      inputSchema: {
        type: 'object',
        properties: { display: { type: 'string', description: 'Monitor name or 1-based index from the screenshot note, or "auto".' } },
        required: ['display'],
      },
    },
    {
      name: 'cursor_position',
      description: 'Get the current mouse cursor position, in the pixel space of the most recent screenshot.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'left_click',
      description: `Left-click at the given coordinates. ${FRONTMOST_GATE_DESC}`,
      inputSchema: { type: 'object', properties: { coordinate: coordinateTuple, text: clickModifierText }, required: ['coordinate'] },
    },
    {
      name: 'double_click',
      description: `Double-click at the given coordinates. Selects a word in most text editors. ${FRONTMOST_GATE_DESC}`,
      inputSchema: { type: 'object', properties: { coordinate: coordinateTuple, text: clickModifierText }, required: ['coordinate'] },
    },
    {
      name: 'triple_click',
      description: `Triple-click at the given coordinates. Selects a line in most text editors. ${FRONTMOST_GATE_DESC}`,
      inputSchema: { type: 'object', properties: { coordinate: coordinateTuple, text: clickModifierText }, required: ['coordinate'] },
    },
    {
      name: 'right_click',
      description: `Right-click at the given coordinates. Opens a context menu in most applications. ${FRONTMOST_GATE_DESC}`,
      inputSchema: { type: 'object', properties: { coordinate: coordinateTuple, text: clickModifierText }, required: ['coordinate'] },
    },
    {
      name: 'mouse_move',
      description: `Move the mouse cursor without clicking. Useful for triggering hover states. ${FRONTMOST_GATE_DESC}`,
      inputSchema: { type: 'object', properties: { coordinate: coordinateTuple }, required: ['coordinate'] },
    },
    {
      name: 'left_click_drag',
      description: `Press at the start point, move to the end point, and release. ${FRONTMOST_GATE_DESC}`,
      inputSchema: {
        type: 'object',
        properties: {
          coordinate: { ...coordinateTuple, description: `(x, y) end point: ${COORD_DESC.x} ${COORD_DESC.y}` },
          start_coordinate: { ...coordinateTuple, description: `(x, y) start point. If omitted, drags from the current cursor position.` },
        },
        required: ['coordinate'],
      },
    },
    {
      name: 'left_mouse_down',
      description: `Press the left mouse button at the current cursor position and leave it held. Use mouse_move first to position the cursor. Call left_mouse_up to release. ${FRONTMOST_GATE_DESC}`,
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'left_mouse_up',
      description: `Release the left mouse button at the current cursor position. Pairs with left_mouse_down. ${FRONTMOST_GATE_DESC}`,
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'type',
      description: `Type text into whatever currently has keyboard focus. ${FRONTMOST_GATE_DESC} Newlines are supported. For keyboard shortcuts use \`key\` instead.`,
      inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Text to type.' } }, required: ['text'] },
    },
    {
      name: 'key',
      description:
        `Press a key or key combination (e.g. "return", "escape", "cmd+a", "ctrl+shift+tab"). ${FRONTMOST_GATE_DESC} ` +
        'System-level combos (quit app, switch app, lock screen) require the systemKeyCombos grant.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Modifiers joined with "+", e.g. "cmd+shift+a".' },
          repeat: { type: 'integer', minimum: 1, maximum: 100, description: 'Number of times to repeat. Default 1.' },
        },
        required: ['text'],
      },
    },
    {
      name: 'hold_key',
      description:
        `Press and hold a key or combination for the given duration, then release. ${FRONTMOST_GATE_DESC} ` +
        'Useful for holding a modifier or an arrow key to accelerate scrolling in a list.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Key or chord to hold, e.g. "space", "shift+down".' },
          duration: { type: 'number', description: 'Duration in seconds (0-100).' },
        },
        required: ['text', 'duration'],
      },
    },
    {
      name: 'scroll',
      description: `Scroll at the given coordinates. ${FRONTMOST_GATE_DESC}`,
      inputSchema: {
        type: 'object',
        properties: {
          coordinate: coordinateTuple,
          scroll_direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Direction to scroll.' },
          scroll_amount: { type: 'integer', minimum: 0, maximum: 100, description: 'Number of scroll ticks.' },
        },
        required: ['coordinate', 'scroll_direction', 'scroll_amount'],
      },
    },
    {
      name: 'open_application',
      description: 'Bring an application to the front, launching it if necessary. The target must already be in the session allowlist - call request_access first.',
      inputSchema: {
        type: 'object',
        properties: { app: { type: 'string', description: 'Display name (e.g. "Safari") or bundle identifier.' } },
        required: ['app'],
      },
    },
    {
      name: 'read_clipboard',
      description: 'Read the current clipboard contents as text. Requires the clipboardRead grant.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'write_clipboard',
      description: 'Write text to the clipboard. Requires the clipboardWrite grant.',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
    {
      name: 'wait',
      description: 'Wait for a specified duration before the next action, when the interface needs time to settle.',
      inputSchema: {
        type: 'object',
        properties: { duration: { type: 'number', description: 'Duration in seconds (0-100).' } },
        required: ['duration'],
      },
    },
    {
      name: 'computer_batch',
      description:
        'Execute a sequence of actions in ONE tool call. Each individual tool call costs a model-to-API round trip (seconds); batching a predictable sequence eliminates all but one. ' +
        'Use this whenever you can predict the outcome of several actions ahead - e.g. click a field, type into it, press Return. Actions execute sequentially and stop on the first error. ' +
        `${FRONTMOST_GATE_DESC} The gate runs before EACH action inside the batch. ` +
        'Coordinates in the batch (and in any screenshots taken mid-batch) always refer to the screenshot taken BEFORE the batch started.',
      inputSchema: {
        type: 'object',
        properties: {
          actions: {
            type: 'array',
            minItems: 1,
            items: BATCH_ACTION_ITEM_SCHEMA,
            description: 'List of actions. Example: [{"action":"left_click","coordinate":[100,200]},{"action":"type","text":"hello"},{"action":"key","text":"Return"}]',
          },
        },
        required: ['actions'],
      },
    },
    {
      name: 'middle_click',
      description:
        `Middle-click (scroll-wheel click) at the given coordinates. ${FRONTMOST_GATE_DESC} ` +
        'Implemented via a synthesized scroll-wheel button event, so it requires the scroll helper to have compiled.',
      inputSchema: { type: 'object', properties: { coordinate: coordinateTuple }, required: ['coordinate'] },
    },
  ] as Tool[];
}
