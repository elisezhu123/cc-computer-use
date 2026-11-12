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

// ── Requests ─────────────────────────────────────────────────────────────────

func handle(_ line: String) {
    let f = line.split(separator: " ").map(String.init)
    guard let verb = f.first else { reply("err empty request"); return }

    switch verb {
    case "displays":
        reply("ok \(displaysJSON())")

    case "pos":
        let p = CGEvent(source: nil)?.location ?? .zero
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
