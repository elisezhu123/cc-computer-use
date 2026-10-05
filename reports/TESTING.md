# 测试说明

## 运行

```bash
npm test          # tsc 编译后运行 node --test dist/*.test.js
npm run typecheck # 只做类型检查
```

单元测试不需要屏幕录制或辅助功能权限，也不会移动鼠标或按键。
其中 5 个测试会调用真实的 `cliclick` 做参数校验，未安装 cliclick（例如在 Linux CI 上）时会自动跳过：

```
# tests 85
# pass 80
# skipped 5    ← cliclick is not installed (brew install cliclick)
```

在装有 cliclick 的 Mac 上，85 个测试应全部通过。

## 测试文件

| 文件 | 数量 | 覆盖内容 |
|------|------|----------|
| `coords.test.ts` | 13 | `targetImageSize` 的长边和 token 双约束（包括 14" MBP 的 1568×1014 陷阱、竖屏）、模型像素 ↔ 逻辑点互逆映射、未截图时坐标直通、`clampRegion` |
| `coords.fullspace.test.ts` | 18 | 内置 Retina、外接 4K HiDPI、非 Retina、截图大于显示器四种显示器，各测 4 项：四个角精确映射、全屏往返误差 ≤ 1pt、单调且不越界、`1/scaleFactor` 公式会明显出错；另有 `clampRegion` 退化/反向矩形和越界坐标行为 |
| `input.test.ts` | 9 | 键名映射、组合键拆分；**用真实 cliclick 的 `-m test` 模式**校验我们生成的每个参数（含单进程点击 `moveAndClick`）都能被接受，并确认 `kp:cmd`、`kp:a` 会被拒绝 |
| `policy.test.ts` | 16 | 快捷键黑名单（各种别名写法、`cmd+q+a` 后缀绕过）、默认所有应用可完全交互、严格模式下的应用分级、授权标志 |
| `policy.truth.test.ts` | 6 | 白名单 × 分级（严格模式）× 动作类型的完整真值表；每种拒绝都返回可区分的错误码；白名单累加而不是覆盖 |
| `browser.test.ts` | 4 | 浏览器模式：键名映射、组合键拆分、工具列表（去掉桌面专属工具和前台检查说明）、环境变量解析 |
| `background.test.ts` | 8 | 原生后台模式：虚拟键码映射；用模拟的 Swift 小工具验证授权 / 选定目标 / 后台启动流程，动作后自动截图，以及点击、双击、输入（含换行）、组合键、滚动、拖拽发出的每条底层指令，和快捷键黑名单拦截 |
| `apps.test.ts` | 11 | 描述中的应用列表过滤：去掉后台组件和守护进程、强制保留 Finder/TextEdit、保留非 ASCII 名称、应用名字符白名单（防提示注入）；`resolveApp` 按名称/bundle ID 精确匹配，不做模糊猜测 |

## 真机冒烟测试（macOS）

单元测试不覆盖真实的截图和输入。改动 `server.ts`、`input.ts`、`screen.ts`、`scroll.ts` 之后，
建议在 Mac 上用 Claude Code 按以下步骤验证一遍：

1. **启动**：`node dist/index.js` 不报 preflight 错误（stdin 关闭后会自动退出）。
2. **授权**：`request_access` 请求 `TextEdit`，返回 `Granted (1): com.apple.TextEdit`。
3. **截图**：`screenshot` 返回的尺寸说明与图片一致，例如 `1372x891 pixels`。
4. **点击精度**：打开 TextEdit，点击菜单栏上的一个小目标（例如“格式”菜单），确认点中。
   偏差通常出现在屏幕右下角，务必测那一侧。
5. **文本**：`type` 输入单行中英文；授予 `clipboardWrite` 后输入多行文本，确认换行正确、原剪贴板内容已恢复。
6. **组合键**：`key` `cmd+a`、`cmd+shift+left`；`cmd+q` 在未授予 `systemKeyCombos` 时应被拒绝。
7. **前台检查**：把未授权的应用切到前台后执行 `left_click`，应返回 `not_granted`。
8. **浏览器交互**：授权 Chrome 后，`left_click`、`type`、`key` 都能正常执行。
   （设置 `CU_STRICT_APP_TIERS=1` 重启后，Chrome 点击应返回 `denied_tier`，Terminal 允许点击但 `type` 返回 `denied_tier`。）
9. **滚动 / 中键**：首次 `scroll` 会编译 Swift helper（需要 Xcode Command Line Tools），之后滚动应立即响应。
10. **批处理**：`computer_batch` 执行“点击 → 输入 → 回车”，中途失败时返回已完成的步骤。
11. **多显示器**（如有）：`switch_display` 切到副屏后截图并点击。

## 浏览器模式端到端测试

浏览器模式可以在任何有 Chrome / Chromium 的机器上（包括 Linux）做真实测试。开发过程中已用 Chromium 验证：普通点击、Shift+点击、右键、双击、中英文输入、长文本、`ctrl+a` + 退格、canvas 游戏的方向键（`repeat` 和 `hold_key`）、拖拽落点、滚动距离、批处理、`zoom`、光标位置、相对网址被拒绝，以及视口大于截图时（1600×1000 → 1389×868）的坐标换算。

## 原生后台模式

`background.swift` 需要在 Mac 上编译运行，验证步骤见 [BACKGROUND.md](../BACKGROUND.md#在-mac-上验证)。

HTTP Gateway 的验证方法见 [`computer-use-mcp-server/GATEWAY.md`](../computer-use-mcp-server/GATEWAY.md)。
