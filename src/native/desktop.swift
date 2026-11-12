// Desktop helper for the computer-use MCP server: screen capture, display
// geometry, mouse input and Accessibility hit testing, in one long-lived
// process.
//
// Why a helper: each of these used to be a process spawn (screencapture,
// cliclick) plus, for screenshots, a full-resolution PNG round trip
// through the disk and sharp - about a second per click. In-process the same
// work takes well under 100ms.
//
// Protocol: one request per stdin line, one reply per stdout line, either
// "ok[ payload]" or "err message". Requests are handled strictly in order.
// All coordinates are global logical points with the origin at the top-left
// of the main display (the CGEvent convention), except `zoom`, whose region
// is in pixels of the last `shot`.

import AppKit
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

// ── Replies ──────────────────────────────────────────────────────────────────

let stdoutHandle = FileHandle.standardOutput

func reply(_ line: String) {
    stdoutHandle.write((line + "\n").data(using: .utf8)!)
}

func jsonString(_ value: Any) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: value),
          let s = String(data: data, encoding: .utf8) else { return "null" }
    return s
}

// ── Displays ─────────────────────────────────────────────────────────────────

func activeDisplayIDs() -> [CGDirectDisplayID] {
    var count: UInt32 = 0
    CGGetActiveDisplayList(0, nil, &count)
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
    CGGetActiveDisplayList(count, &ids, &count)
    return Array(ids.prefix(Int(count)))
}

/// Physical pixels per logical point, measured from the current display mode.
func scaleFactor(_ id: CGDirectDisplayID) -> Double {
    guard let mode = CGDisplayCopyDisplayMode(id), mode.width > 0 else { return 1 }
    return Double(mode.pixelWidth) / Double(mode.width)
}

func displayName(_ id: CGDirectDisplayID) -> String {
    let key = NSDeviceDescriptionKey("NSScreenNumber")
    for screen in NSScreen.screens {
        if let n = screen.deviceDescription[key] as? NSNumber, n.uint32Value == id {
            return screen.localizedName
        }
    }
    return "Display \(id)"
}

func displaysJSON() -> String {
    let main = CGMainDisplayID()
    // Main display first, so index 1 is always the main display.
    let ids = activeDisplayIDs().sorted { a, b in (a == main ? 0 : 1, a) < (b == main ? 0 : 1, b) }
    let list: [[String: Any]] = ids.map { id in
        let b = CGDisplayBounds(id)
        return [
            "id": Int(id),
            "name": displayName(id),
            "isMain": id == main,
            "originX": Double(b.origin.x),
            "originY": Double(b.origin.y),
            "logicalWidth": Double(b.width),
            "logicalHeight": Double(b.height),
            "scaleFactor": scaleFactor(id),
        ]
    }
    return jsonString(list)
}

// ── Capture ──────────────────────────────────────────────────────────────────

var filters: [CGDirectDisplayID: SCContentFilter] = [:]

/// The capture filter for a display, refreshing the shareable-content list
/// once if the display is not in the cached set (a monitor was plugged in).
func filter(for id: CGDirectDisplayID) -> SCContentFilter? {
    if let f = filters[id] { return f }
    let done = DispatchSemaphore(value: 0)
    var found: SCDisplay?
    SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, _ in
        found = content?.displays.first { $0.displayID == id }
        done.signal()
    }
    if done.wait(timeout: .now() + 5) == .timedOut { return nil }
    guard let display = found else { return nil }
    let f = SCContentFilter(display: display, excludingWindows: [])
    filters[id] = f
    return f
}

/// Start a capture; the returned closure blocks until it finishes.
func startCapture(_ f: SCContentFilter, width: Int, height: Int) -> () -> CGImage? {
    let cfg = SCStreamConfiguration()
    cfg.width = width
    cfg.height = height
    cfg.showsCursor = false
    let done = DispatchSemaphore(value: 0)
    var out: CGImage?
    SCScreenshotManager.captureImage(contentFilter: f, configuration: cfg) { image, _ in
        out = image
        done.signal()
    }
    return {
        if done.wait(timeout: .now() + 5) == .timedOut { return nil }
        return out
    }
}

/// Draw `image` into a new bitmap of the given size, with high-quality
/// interpolation. Used for zoom crops.
func resample(_ image: CGImage, width: Int, height: Int) -> CGImage? {
    guard let ctx = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
    ) else { return nil }
    ctx.interpolationQuality = .high
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return ctx.makeImage()
}

func pngBase64(_ image: CGImage) -> String? {
    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
        return nil
    }
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { return nil }
    return (data as Data).base64EncodedString()
}

// Screen stability: consecutive frames are compared on a sparse pixel grid.
/// Compare every Nth pixel in each direction.
let SAMPLE_STRIDE = 8
let SAMPLE_INTERVAL_MS = 30.0
/// A channel must move by more than this to count as a changed pixel.
let CHANNEL_TOLERANCE = 8
/// Below this share of changed samples the screen counts as settled. High
/// enough to ignore a blinking text cursor, low enough to catch a menu.
let STABLE_RATIO = 0.005

/// Share of sampled pixels that differ between two same-sized frames; 1 when
/// they cannot be compared.
func changedRatio(_ a: CGImage, _ b: CGImage) -> Double {
    guard a.width == b.width, a.height == b.height, a.bytesPerRow == b.bytesPerRow,
          a.bitsPerPixel == 32, b.bitsPerPixel == 32,
          let da = a.dataProvider?.data, let db = b.dataProvider?.data,
          let pa = CFDataGetBytePtr(da), let pb = CFDataGetBytePtr(db) else { return 1 }
    var changed = 0
    var total = 0
    var y = 0
    while y < a.height {
        let row = y * a.bytesPerRow
        var x = 0
        while x < a.width {
            let i = row + x * 4
            if abs(Int(pa[i]) - Int(pb[i])) > CHANNEL_TOLERANCE
                || abs(Int(pa[i + 1]) - Int(pb[i + 1])) > CHANNEL_TOLERANCE
                || abs(Int(pa[i + 2]) - Int(pb[i + 2])) > CHANNEL_TOLERANCE {
                changed += 1
            }
            total += 1
            x += SAMPLE_STRIDE
        }
        y += SAMPLE_STRIDE
    }
    return total == 0 ? 1 : Double(changed) / Double(total)
}

func nowMs() -> Double { CFAbsoluteTimeGetCurrent() * 1000 }

/// The last full-resolution frame, kept so `zoom` shows real detail from the
/// moment of the screenshot rather than an upscaled crop of the small image.
var retained: (image: CGImage, targetWidth: Int, targetHeight: Int)?

/// Capture the display at tw x th. With a settle window (maxMs > 0), frames
/// are taken until two in a row match and minMs has passed, or until maxMs;
/// the last frame taken is the one returned, so no extra capture is spent on
/// the wait. Each frame is captured together with a full-resolution twin,
/// which is what `zoom` crops.
func shot(displayID: CGDirectDisplayID, tw: Int, th: Int, minMs: Double, maxMs: Double) -> String {
    guard activeDisplayIDs().contains(displayID), let f = filter(for: displayID) else {
        filters[displayID] = nil
        return "err no such display \(displayID)"
    }
    let bounds = CGDisplayBounds(displayID)
    let scale = scaleFactor(displayID)
    let fullW = Int((Double(bounds.width) * scale).rounded())
    let fullH = Int((Double(bounds.height) * scale).rounded())

    func pair() -> (small: CGImage, full: CGImage)? {
        let small = startCapture(f, width: tw, height: th)
        let full = startCapture(f, width: fullW, height: fullH)
        guard let s = small(), let l = full() else { return nil }
        return (s, l)
    }

    let start = nowMs()
    var previous: CGImage?
    var frame: (small: CGImage, full: CGImage)?
    while true {
        if maxMs > 0 && previous == nil {
            // First frame of a settle window: only a comparison baseline.
            previous = startCapture(f, width: tw, height: th)()
        } else {
            frame = pair()
            guard let cur = frame else { break }
            let elapsed = nowMs() - start
            if maxMs <= 0 || elapsed >= maxMs { break }
            if let p = previous, elapsed >= minMs, changedRatio(p, cur.small) < STABLE_RATIO { break }
            previous = cur.small
        }
        if previous == nil { break }
        let remaining = maxMs - (nowMs() - start)
        if remaining > 0 { usleep(UInt32(min(SAMPLE_INTERVAL_MS, remaining) * 1000)) }
    }

    guard let result = frame ?? pair() else {
        filters[displayID] = nil
        return "err capture failed for display \(displayID) - Screen Recording permission may be missing"
    }
    retained = (result.full, tw, th)
    guard let b64 = pngBase64(result.small) else { return "err could not encode the screenshot" }
    return "ok \(b64)"
}

func zoom(x0: Int, y0: Int, x1: Int, y1: Int, ow: Int, oh: Int) -> String {
    guard let r = retained else { return "err no frame" }
    let sx = Double(r.image.width) / Double(r.targetWidth)
    let sy = Double(r.image.height) / Double(r.targetHeight)
    let rect = CGRect(
        x: (Double(x0) * sx).rounded(), y: (Double(y0) * sy).rounded(),
        width: (Double(x1 - x0) * sx).rounded(), height: (Double(y1 - y0) * sy).rounded()
    ).intersection(CGRect(x: 0, y: 0, width: r.image.width, height: r.image.height))
    guard rect.width >= 1, rect.height >= 1, let crop = r.image.cropping(to: rect),
          let out = resample(crop, width: ow, height: oh), let b64 = pngBase64(out) else {
        return "err could not crop the zoom region"
    }
    return "ok \(b64)"
}

// ── Mouse ────────────────────────────────────────────────────────────────────

let eventSource = CGEventSource(stateID: .hidSystemState)

/// Time for the target app to process the move before the button goes down.
let MOVE_SETTLE_US: UInt32 = 50_000

func cursorLocation() -> CGPoint { CGEvent(source: nil)?.location ?? .zero }

@discardableResult
func postMouse(
    _ type: CGEventType, _ p: CGPoint, button: CGMouseButton = .left,
    clickState: Int64 = 1, flags: UInt64 = 0
) -> Bool {
    guard let e = CGEvent(mouseEventSource: eventSource, mouseType: type, mouseCursorPosition: p, mouseButton: button)
    else { return false }
    e.setIntegerValueField(.mouseEventClickState, value: clickState)
    if flags != 0 { e.flags = CGEventFlags(rawValue: flags) }
    e.post(tap: .cghidEventTap)
    return true
}

func buttonEvents(_ button: Int) -> (down: CGEventType, up: CGEventType, button: CGMouseButton)? {
    switch button {
    case 0: return (.leftMouseDown, .leftMouseUp, .left)
    case 1: return (.rightMouseDown, .rightMouseUp, .right)
    case 2: return (.otherMouseDown, .otherMouseUp, .center)
    default: return nil
    }
}

/// Move, settle, then press and release `count` times as one multi-click.
func click(button: Int, at p: CGPoint, count: Int, flags: UInt64) -> Bool {
    guard let b = buttonEvents(button) else { return false }
    var ok = postMouse(.mouseMoved, p)
    usleep(MOVE_SETTLE_US)
    for i in 1...count {
        ok = postMouse(b.down, p, button: b.button, clickState: Int64(i), flags: flags) && ok
        usleep(8_000)
        ok = postMouse(b.up, p, button: b.button, clickState: Int64(i), flags: flags) && ok
        if i < count { usleep(8_000) }
    }
    return ok
}

/// Press at `from`, move to `to` in steps, release. The intermediate drag
/// events are what most drop targets need to recognise the gesture.
func drag(from: CGPoint, to: CGPoint) -> Bool {
    var ok = postMouse(.mouseMoved, from)
    usleep(MOVE_SETTLE_US)
    ok = postMouse(.leftMouseDown, from) && ok
    let steps = 10
    for i in 1...steps {
        usleep(10_000)
        let t = Double(i) / Double(steps)
        let p = CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t)
        ok = postMouse(.leftMouseDragged, p) && ok
    }
    usleep(10_000)
    return postMouse(.leftMouseUp, to) && ok
}

// ── Accessibility hit testing ────────────────────────────────────────────────

let systemWide: AXUIElement = {
    let el = AXUIElementCreateSystemWide()
    // An unresponsive app must not stall a click: give up quickly and click
    // without the element information.
    AXUIElementSetMessagingTimeout(el, 0.15)
    return el
}()

/// Controls that act when clicked. Keep in sync with ACTIONABLE_ROLES in
/// snap.ts. Used here only to report the control rather than the label or
/// icon inside it (a hit test returns the deepest element).
let ACTIONABLE_ROLES: Set<String> = [
    "AXButton", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuButton",
    "AXMenuItem", "AXMenuBarItem", "AXLink", "AXTextField", "AXTextArea",
    "AXComboBox", "AXSlider", "AXIncrementor", "AXDisclosureTriangle", "AXTab",
    "AXSegment",
]

func axString(_ el: AXUIElement, _ attr: String) -> String? {
    var v: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr as CFString, &v) == .success else { return nil }
    return v as? String
}

func axParent(_ el: AXUIElement) -> AXUIElement? {
    var v: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, kAXParentAttribute as CFString, &v) == .success,
          let p = v, CFGetTypeID(p) == AXUIElementGetTypeID() else { return nil }
    return (p as! AXUIElement)
}

func axFrame(_ el: AXUIElement) -> CGRect? {
    var pv: CFTypeRef?
    var sv: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, kAXPositionAttribute as CFString, &pv) == .success,
          AXUIElementCopyAttributeValue(el, kAXSizeAttribute as CFString, &sv) == .success,
          let p = pv, let s = sv,
          CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var origin = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &origin), AXValueGetValue(s as! AXValue, .cgSize, &size) else {
        return nil
    }
    return CGRect(origin: origin, size: size)
}

var bundleIDs: [pid_t: String] = [:]

func bundleID(of el: AXUIElement) -> String? {
    var pid: pid_t = 0
    guard AXUIElementGetPid(el, &pid) == .success else { return nil }
    if let known = bundleIDs[pid] { return known }
    let id = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier
    if let id { bundleIDs[pid] = id }
    return id
}

/// The element at a point, promoted to the nearest actionable ancestor (up to
/// 4 levels) when the deepest element is only its label or icon.
func element(at p: CGPoint) -> AXUIElement? {
    var hit: AXUIElement?
    guard AXUIElementCopyElementAtPosition(systemWide, Float(p.x), Float(p.y), &hit) == .success,
          let leaf = hit else { return nil }
    if let role = axString(leaf, kAXRoleAttribute), ACTIONABLE_ROLES.contains(role) { return leaf }
    var cur = leaf
    for _ in 0..<4 {
        guard let parent = axParent(cur) else { break }
        if let role = axString(parent, kAXRoleAttribute), ACTIONABLE_ROLES.contains(role) { return parent }
        cur = parent
    }
    return leaf
}

func describe(_ el: AXUIElement) -> [String: Any]? {
    guard let role = axString(el, kAXRoleAttribute), let frame = axFrame(el) else { return nil }
    let title = axString(el, kAXTitleAttribute) ?? ""
    let label = title.isEmpty ? (axString(el, kAXDescriptionAttribute) ?? "") : title
    return [
        "role": role,
        "label": label,
        "frame": ["x": Double(frame.origin.x), "y": Double(frame.origin.y),
                  "w": Double(frame.width), "h": Double(frame.height)],
        "bundleId": bundleID(of: el) as Any? ?? NSNull(),
    ]
}

/// The element under `p`, plus the distinct other elements found at 16 probe
/// points around it (8 directions at half and full radius).
func hitJSON(at p: CGPoint, radius: Double) -> String {
    guard let centre = element(at: p), let at = describe(centre) else {
        return jsonString(["at": NSNull(), "nearby": []] as [String: Any])
    }
    var seen: [AXUIElement] = [centre]
    var nearby: [[String: Any]] = []
    if radius > 0 {
        for r in [radius / 2, radius] {
            for k in 0..<8 {
                let a = Double(k) * Double.pi / 4
                let q = CGPoint(x: p.x + CGFloat(r * cos(a)), y: p.y + CGFloat(r * sin(a)))
                guard let el = element(at: q), !seen.contains(where: { CFEqual($0, el) }) else { continue }
                seen.append(el)
                if let d = describe(el) { nearby.append(d) }
            }
        }
    }
    return jsonString(["at": at, "nearby": nearby] as [String: Any])
}

// ── Requests ─────────────────────────────────────────────────────────────────

func handle(_ line: String) {
    let f = line.split(separator: " ").map(String.init)
    guard let verb = f.first else { reply("err empty request"); return }

    switch verb {
    case "displays":
        reply("ok \(displaysJSON())")

    case "pos":
        let p = cursorLocation()
        reply("ok \(Int(p.x.rounded())) \(Int(p.y.rounded()))")

    case "shot":
        guard f.count == 6, let id = UInt32(f[1]), let tw = Int(f[2]), let th = Int(f[3]),
              let minMs = Double(f[4]), let maxMs = Double(f[5]), tw >= 1, th >= 1 else {
            reply("err bad shot request: \(line)"); return
        }
        reply(shot(displayID: id, tw: tw, th: th, minMs: minMs, maxMs: maxMs))

    case "zoom":
        guard f.count == 7, let x0 = Int(f[1]), let y0 = Int(f[2]), let x1 = Int(f[3]), let y1 = Int(f[4]),
              let ow = Int(f[5]), let oh = Int(f[6]), x1 > x0, y1 > y0, ow >= 1, oh >= 1 else {
            reply("err bad zoom request: \(line)"); return
        }
        reply(zoom(x0: x0, y0: y0, x1: x1, y1: y1, ow: ow, oh: oh))

    case "hit":
        guard f.count == 4, let x = Double(f[1]), let y = Double(f[2]), let r = Double(f[3]),
              x.isFinite, y.isFinite, r.isFinite, r >= 0 else {
            reply("err bad hit request: \(line)"); return
        }
        reply("ok \(hitJSON(at: CGPoint(x: x, y: y), radius: r))")

    case "click":
        guard f.count == 6, let button = Int(f[1]), let x = Double(f[2]), let y = Double(f[3]),
              let count = Int(f[4]), let flags = UInt64(f[5]),
              x.isFinite, y.isFinite, (1...3).contains(count), buttonEvents(button) != nil else {
            reply("err bad click request: \(line)"); return
        }
        reply(click(button: button, at: CGPoint(x: x, y: y), count: count, flags: flags)
            ? "ok" : "err could not create mouse event")

    case "move":
        guard f.count == 3, let x = Double(f[1]), let y = Double(f[2]), x.isFinite, y.isFinite else {
            reply("err bad move request: \(line)"); return
        }
        let ok = postMouse(.mouseMoved, CGPoint(x: x, y: y))
        usleep(MOVE_SETTLE_US)
        reply(ok ? "ok" : "err could not create mouse event")

    case "down":
        reply(postMouse(.leftMouseDown, cursorLocation()) ? "ok" : "err could not create mouse event")

    case "up":
        reply(postMouse(.leftMouseUp, cursorLocation()) ? "ok" : "err could not create mouse event")

    case "drag":
        guard f.count == 5, let x0 = Double(f[1]), let y0 = Double(f[2]), let x1 = Double(f[3]),
              let y1 = Double(f[4]), [x0, y0, x1, y1].allSatisfy({ $0.isFinite }) else {
            reply("err bad drag request: \(line)"); return
        }
        reply(drag(from: CGPoint(x: x0, y: y0), to: CGPoint(x: x1, y: y1))
            ? "ok" : "err could not create mouse event")

    default:
        reply("err unknown request: \(verb)")
    }
}

// Requests are read on a background thread; the main thread services the run
// loop.
//
// There is deliberately no "frontmost app" request. NSWorkspace's
// frontmostApplication lags or goes stale in a helper process (measured: still
// the previous app 400ms after a switch), and that value gates every input
// action, so the server keeps asking LaunchServices through lsappinfo instead.
Thread.detachNewThread {
    while let line = readLine(strippingNewline: true) {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { continue }
        handle(trimmed)
    }
    exit(0)
}
RunLoop.main.run()
