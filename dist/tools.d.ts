/**
 * Tool schemas, matching the official @ant/computer-use-mcp server's tool set
 * and naming so the model's existing computer-use knowledge transfers.
 *
 * Coordinate text is written once (COORD_DESC) and reused everywhere a
 * coordinate appears, because a coordinate convention described two different
 * ways in two tools is how the model ends up clicking in the wrong space.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
/** Actions valid inside computer_batch.actions. Kept in sync with dispatchAction. */
export declare const BATCH_ACTION_ITEM_SCHEMA: {
    readonly type: "object";
    readonly properties: {
        readonly action: {
            readonly type: "string";
            readonly enum: readonly ["key", "type", "mouse_move", "left_click", "left_click_drag", "right_click", "middle_click", "double_click", "triple_click", "scroll", "hold_key", "screenshot", "cursor_position", "left_mouse_down", "left_mouse_up", "wait"];
            readonly description: "The action to perform.";
        };
        readonly coordinate: {
            readonly description: "(x, y) for click/mouse_move/scroll/left_click_drag end point.";
            readonly type: "array";
            readonly items: {
                type: string;
            };
            readonly minItems: number;
            readonly maxItems: number;
        };
        readonly start_coordinate: {
            readonly description: "(x, y) drag start - left_click_drag only. Omit to drag from the current cursor.";
            readonly type: "array";
            readonly items: {
                type: string;
            };
            readonly minItems: number;
            readonly maxItems: number;
        };
        readonly text: {
            readonly type: "string";
            readonly description: "For type: the text. For key/hold_key: the chord string. For click/scroll: modifier keys to hold.";
        };
        readonly scroll_direction: {
            readonly type: "string";
            readonly enum: readonly ["up", "down", "left", "right"];
        };
        readonly scroll_amount: {
            readonly type: "integer";
            readonly minimum: 0;
            readonly maximum: 100;
        };
        readonly duration: {
            readonly type: "number";
            readonly description: "Seconds (0-100). For hold_key/wait.";
        };
        readonly repeat: {
            readonly type: "integer";
            readonly minimum: 1;
            readonly maximum: 100;
            readonly description: "For key: repeat count.";
        };
    };
    readonly required: readonly ["action"];
};
export declare function buildComputerUseTools(installedAppNames: readonly string[]): Tool[];
//# sourceMappingURL=tools.d.ts.map