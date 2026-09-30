# 使用示例

平时直接用自然语言描述任务就可以，模型会自己选择工具。
下面列出的是模型实际发出的工具调用，方便理解每个工具的参数、调试时对照，或者在其他 MCP 客户端里直接调用。

坐标一律是 **最近一次 `screenshot` 返回的图片中的像素坐标**，服务器会负责换算到屏幕。

## 1. 开始一个会话

任何截图或输入操作之前，都必须先申请应用权限：

```json
{ "tool": "request_access", "arguments": {
    "apps": ["TextEdit", "com.apple.Notes"],
    "reason": "在 TextEdit 中整理会议记录，并从备忘录中复制内容",
    "clipboardWrite": true
} }
```

- `apps` 可以写显示名（不区分大小写），也可以写 bundle ID。
- 无法识别的名字会在返回结果中单独列出，不会被悄悄忽略。
- 多次调用时授权会累加。

查看当前授权情况：

```json
{ "tool": "list_granted_applications", "arguments": {} }
```

## 2. 看屏幕

```json
{ "tool": "open_application", "arguments": { "app": "TextEdit" } }
{ "tool": "screenshot", "arguments": {} }
```

返回的说明文字里会写明图片尺寸，例如 `1372x891 pixels on "Built-in Retina Display"`，之后的坐标都基于这个尺寸。

需要看清小字时，放大截图中的某个区域（不影响后续点击的坐标基准）：

```json
{ "tool": "zoom", "arguments": { "region": [900, 0, 1372, 40] } }
```

需要把截图发给用户时：

```json
{ "tool": "screenshot", "arguments": { "save_to_disk": true } }
```

## 3. 鼠标

```json
{ "tool": "left_click",   "arguments": { "coordinate": [640, 420] } }
{ "tool": "left_click",   "arguments": { "coordinate": [640, 420], "text": "cmd" } }
{ "tool": "double_click", "arguments": { "coordinate": [300, 200] } }
{ "tool": "triple_click", "arguments": { "coordinate": [300, 200] } }
{ "tool": "right_click",  "arguments": { "coordinate": [300, 200] } }
{ "tool": "mouse_move",   "arguments": { "coordinate": [500, 60] } }
```

第二行演示了点击时按住修饰键：点击的 `text` 参数表示点击期间按住的键，例如 `"cmd"` 或 `"shift+alt"`。

拖拽（不写 `start_coordinate` 时从当前光标位置开始）：

```json
{ "tool": "left_click_drag", "arguments": { "start_coordinate": [100, 300], "coordinate": [600, 300] } }
```

需要在按下和松开之间做其他操作时，分步执行：

```json
{ "tool": "mouse_move",      "arguments": { "coordinate": [100, 300] } }
{ "tool": "left_mouse_down", "arguments": {} }
{ "tool": "mouse_move",      "arguments": { "coordinate": [600, 300] } }
{ "tool": "left_mouse_up",   "arguments": {} }
```

## 4. 滚动

```json
{ "tool": "scroll", "arguments": { "coordinate": [700, 500], "scroll_direction": "down", "scroll_amount": 5 } }
```

`scroll_amount` 是滚轮的格数（每格约 40 像素）。

## 5. 键盘

输入文本（中文、emoji 都支持）：

```json
{ "tool": "type", "arguments": { "text": "你好，世界 👋" } }
```

多行文本会通过剪贴板粘贴，需要事先获得 `clipboardWrite` 授权，粘贴完成后会恢复原来的剪贴板内容：

```json
{ "tool": "type", "arguments": { "text": "第一行\n第二行\n第三行" } }
```

按键和组合键：

```json
{ "tool": "key", "arguments": { "text": "return" } }
{ "tool": "key", "arguments": { "text": "cmd+s" } }
{ "tool": "key", "arguments": { "text": "ctrl+shift+tab" } }
{ "tool": "key", "arguments": { "text": "down", "repeat": 5 } }
```

常用键名：`return`、`escape`、`tab`、`space`、`backspace`、`delete`、`up` / `down` / `left` / `right`、
`pageup`、`pagedown`、`home`、`end`、`f1`–`f12`。
修饰键：`cmd`（`command`）、`ctrl`（`control`）、`alt`（`option`）、`shift`、`fn`。

按住一段时间（单位为秒）：

```json
{ "tool": "hold_key", "arguments": { "text": "shift+down", "duration": 1.5 } }
```

⌘Q、⌘Tab、⌘Space 等系统快捷键需要 `systemKeyCombos` 授权，否则返回 `needs_flag`。

## 6. 批处理

可以预见结果的连续操作，放进一个 `computer_batch`，只需要一次模型往返：

```json
{ "tool": "computer_batch", "arguments": { "actions": [
    { "action": "left_click", "coordinate": [640, 120] },
    { "action": "key", "text": "cmd+a" },
    { "action": "type", "text": "会议记录 2026-09-29" },
    { "action": "key", "text": "return" },
    { "action": "wait", "duration": 0.5 },
    { "action": "screenshot" }
] } }
```

- 按顺序执行，遇到第一个错误就停止，并返回此前已完成的步骤。
- 所有坐标都基于**批次开始前**的那张截图。
- 每一步都会单独检查前台应用。

## 7. 剪贴板

```json
{ "tool": "read_clipboard",  "arguments": {} }
{ "tool": "write_clipboard", "arguments": { "text": "要复制的内容" } }
```

分别需要 `clipboardRead` / `clipboardWrite` 授权。

## 8. 多显示器

截图的说明文字会列出其他显示器。切换方式：

```json
{ "tool": "switch_display", "arguments": { "display": "2" } }
{ "tool": "switch_display", "arguments": { "display": "DELL U2720Q" } }
{ "tool": "switch_display", "arguments": { "display": "auto" } }
```

切换后需要重新截图，之后的坐标以新显示器的截图为准。

## 9. 完整示例：在备忘录中新建一条笔记

```text
用户：在备忘录里新建一条笔记，标题“购物清单”，内容是牛奶、鸡蛋、面包，每项一行。
```

```json
{ "tool": "request_access", "arguments": { "apps": ["Notes"], "reason": "新建购物清单笔记", "clipboardWrite": true } }
{ "tool": "open_application", "arguments": { "app": "Notes" } }
{ "tool": "screenshot", "arguments": {} }
{ "tool": "computer_batch", "arguments": { "actions": [
    { "action": "key", "text": "cmd+n" },
    { "action": "wait", "duration": 0.5 },
    { "action": "type", "text": "购物清单\n牛奶\n鸡蛋\n面包" },
    { "action": "screenshot" }
] } }
```

## 10. 会被拒绝的操作

| 操作 | 返回 | 原因 |
|------|------|------|
| 未调用 `request_access` 就截图 | `needs_access` | 必须先申请 |
| Finder 在前台时点击，但只授权了 TextEdit | `not_granted` | 前台应用不在白名单中 |
| 在 Terminal 中 `type`（仅 `CU_STRICT_APP_TIERS=1` 时） | `denied_tier` | 严格模式下终端只允许点击 |
| 在 Safari 中点击（仅 `CU_STRICT_APP_TIERS=1` 时） | `denied_tier` | 严格模式下浏览器只允许查看 |
| `key` `cmd+q`（未授予 `systemKeyCombos`） | `needs_flag` | 系统级快捷键 |
| 多行 `type`（未授予 `clipboardWrite`） | `needs_flag` | 多行输入需要剪贴板 |
