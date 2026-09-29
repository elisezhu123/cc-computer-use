#!/usr/bin/env node
/**
 * Computer Use MCP Server - HTTP/SSE Mode
 * For Gateway integration
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { execAppleScript, execCliClick, getScreenInfo, getMousePosition, takeScreenshot } from "./utils.js";
import sharp from "sharp";
const app = express();
const PORT = process.env.PORT || 3000;
// No need to import schemas - we define them inline
// Create server instance
const server = new Server({
    name: "computer-use-mcp-server",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "computer_get_screen_info",
                description: "Get current screen resolution and display information",
                inputSchema: {
                    type: "object",
                    properties: {
                        response_format: {
                            type: "string",
                            enum: ["markdown", "json"],
                            default: "markdown",
                            description: "Output format"
                        }
                    }
                }
            },
            {
                name: "computer_screenshot",
                description: "Take a screenshot and save to file",
                inputSchema: {
                    type: "object",
                    properties: {
                        output_path: { type: "string", description: "Path to save screenshot" },
                        format: { type: "string", enum: ["png", "jpeg"], default: "png" },
                        quality: { type: "number", minimum: 1, maximum: 100, default: 90 }
                    },
                    required: ["output_path"]
                }
            },
            {
                name: "computer_mouse_move",
                description: "Move mouse to coordinates",
                inputSchema: {
                    type: "object",
                    properties: {
                        x: { type: "number" },
                        y: { type: "number" },
                        duration: { type: "number", default: 0 }
                    },
                    required: ["x", "y"]
                }
            },
            {
                name: "computer_mouse_click",
                description: "Click mouse at coordinates",
                inputSchema: {
                    type: "object",
                    properties: {
                        x: { type: "number" },
                        y: { type: "number" },
                        button: { type: "string", enum: ["left", "right", "middle"], default: "left" },
                        action: { type: "string", enum: ["click", "down", "up"], default: "click" },
                        click_count: { type: "number", minimum: 1, maximum: 3, default: 1 }
                    },
                    required: ["x", "y"]
                }
            },
            {
                name: "computer_type_text",
                description: "Type text at cursor position",
                inputSchema: {
                    type: "object",
                    properties: {
                        text: { type: "string" }
                    },
                    required: ["text"]
                }
            },
            {
                name: "computer_press_key",
                description: "Press keyboard key with optional modifiers",
                inputSchema: {
                    type: "object",
                    properties: {
                        key: { type: "string" },
                        modifiers: { type: "array", items: { type: "string" }, default: [] }
                    },
                    required: ["key"]
                }
            },
            {
                name: "computer_get_mouse_position",
                description: "Get current mouse position",
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "computer_run_applescript",
                description: "Execute AppleScript",
                inputSchema: {
                    type: "object",
                    properties: {
                        script: { type: "string" }
                    },
                    required: ["script"]
                }
            }
        ],
    };
});
// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        const { name, arguments: args } = request.params;
        switch (name) {
            case "computer_get_screen_info": {
                const screenInfo = await getScreenInfo();
                const format = args?.response_format || "markdown";
                if (format === "json") {
                    return {
                        content: [{
                                type: "text",
                                text: JSON.stringify(screenInfo, null, 2)
                            }]
                    };
                }
                return {
                    content: [{
                            type: "text",
                            text: `# Screen Information\n\n- **Resolution:** ${screenInfo.width} x ${screenInfo.height}\n- **Scale Factor:** ${screenInfo.scaleFactor}x`
                        }]
                };
            }
            case "computer_screenshot": {
                const buffer = await takeScreenshot();
                const format = args?.format || "png";
                const quality = args?.quality || 90;
                let processedBuffer = buffer;
                if (format === "jpeg") {
                    processedBuffer = await sharp(buffer).jpeg({ quality }).toBuffer();
                }
                await sharp(processedBuffer).toFile(args.output_path);
                return {
                    content: [{
                            type: "text",
                            text: `Screenshot saved to: ${args.output_path}`
                        }]
                };
            }
            case "computer_mouse_move": {
                const duration = args?.duration || 0;
                const durationMs = Math.round(duration * 1000);
                await execCliClick([`m:${args.x},${args.y}`], durationMs > 0 ? [`w:${durationMs}`] : undefined);
                return {
                    content: [{
                            type: "text",
                            text: `Mouse moved to (${args.x}, ${args.y})`
                        }]
                };
            }
            case "computer_mouse_click": {
                const button = args?.button || "left";
                const action = args?.action || "click";
                const clickCount = args?.click_count || 1;
                const buttonMap = {
                    left: "",
                    right: "r",
                    middle: "m"
                };
                const actionMap = {
                    click: "c",
                    down: "d",
                    up: "u"
                };
                const buttonStr = buttonMap[button];
                const actionStr = actionMap[action];
                const clickStr = clickCount > 1 ? `:${clickCount}` : "";
                await execCliClick([`c:${args.x},${args.y}`], [`${buttonStr}${actionStr}${clickStr}`]);
                return {
                    content: [{
                            type: "text",
                            text: `Mouse ${action} at (${args.x}, ${args.y}) with ${button} button`
                        }]
                };
            }
            case "computer_type_text": {
                await execCliClick([`t:${args.text}`]);
                return {
                    content: [{
                            type: "text",
                            text: `Typed: ${args.text}`
                        }]
                };
            }
            case "computer_press_key": {
                const modifiers = args?.modifiers || [];
                const modStr = modifiers.length > 0
                    ? modifiers.map((m) => m.toLowerCase()).join(",") + ":"
                    : "";
                await execCliClick([`kp:${modStr}${args.key}`]);
                const modText = modifiers.length > 0 ? `${modifiers.join("+")}+` : "";
                return {
                    content: [{
                            type: "text",
                            text: `Pressed: ${modText}${args.key}`
                        }]
                };
            }
            case "computer_get_mouse_position": {
                const position = await getMousePosition();
                return {
                    content: [{
                            type: "text",
                            text: `Mouse position: (${position.x}, ${position.y})`
                        }]
                };
            }
            case "computer_run_applescript": {
                const result = await execAppleScript(args.script);
                return {
                    content: [{
                            type: "text",
                            text: result || "Script executed successfully"
                        }]
                };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        return {
            content: [{
                    type: "text",
                    text: `❌ Tool execution failed: ${errorMsg}`
                }],
            isError: true
        };
    }
});
// Express setup
app.use(express.json());
app.get("/health", (req, res) => {
    res.json({ status: "ok", server: "computer-use-mcp-server" });
});
app.get("/sse", async (req, res) => {
    console.error("Client connected via SSE");
    const transport = new SSEServerTransport("/message", res);
    await server.connect(transport);
    req.on("close", () => {
        console.error("Client disconnected");
    });
});
app.post("/message", async (req, res) => {
    res.status(200).end();
});
app.listen(PORT, () => {
    console.error(`\n╔════════════════════════════════════════════════════════════╗`);
    console.error(`║  Computer Use MCP Server (HTTP/SSE Mode)                  ║`);
    console.error(`╚════════════════════════════════════════════════════════════╝`);
    console.error(`\n🌐 Server listening on port ${PORT}`);
    console.error(`\n📡 Endpoints:`);
    console.error(`   SSE:    http://localhost:${PORT}/sse`);
    console.error(`   Health: http://localhost:${PORT}/health`);
    console.error(`\n🔗 Use this URL in Gateway configuration:\n   http://localhost:${PORT}/sse\n`);
});
//# sourceMappingURL=http-server.js.map