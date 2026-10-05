// Background input for one application, without touching the system cursor.
//
// Events are delivered with CGEvent.postToPid, straight into the target
// process's event queue, instead of the global HID tap that cliclick and
// scroll.swift use. The user's mouse and keyboard stay free.
//
// Clicks try the Accessibility API first (AXPress on buttons, checkboxes,
// menu items, links...), which works on background windows in nearly every
// native app. Anything else is a mouse event tagged with the target window's
// number, so AppKit routes it to that window instead of the frontmost one.
//
// An "agent cursor" overlay - a click-through window drawn above everything -
// glides to each point the agent acts on and ripples on clicks, so the user
// can see what the agent is doing while their real cursor stays put. It is
// never in screenshots: those capture only the target window.
//   CU_AGENT_CURSOR=0      hide the overlay
//   CU_BACKGROUND_AX=0     never press through Accessibility; always post events
//
// Reads one request per line from stdin and replies "ok [payload]" or
// "err <message>" on stdout:
//   pid <bundleId>                        -> ok <pid>        (running instance)
//   window <pid>                          -> ok <id> <x> <y> <w> <h>
//                                            frontmost normal window, global points
//   click <pid> <button> <x> <y> <count> <flags>
//                                         -> ok ax <role> | ok event
//   mouse <pid> <kind> <button> <x> <y> <clicks> <flags>
//         kind: down | up | move | drag;  button: 0 left, 1 right, 2 middle
//   key <pid> <keycode> <down 1|0> <flags>
//   text <pid> <base64 utf-8>             Unicode typing, no key codes needed
//   scroll <pid> <x> <y> <dx> <dy>        pixel deltas, same sign as scroll.swift

import Foundation
import CoreGraphics
import AppKit
import ApplicationServices
import QuartzCore

setvbuf(stdout, nil, _IOLBF, 0)

func reply(_ s: String) {
    print(s)
    fflush(stdout)
}

let environment = ProcessInfo.processInfo.environment
let showAgentCursor = environment["CU_AGENT_CURSOR"] != "0"
let useAccessibility = environment["CU_BACKGROUND_AX"] != "0"

let source = CGEventSource(stateID: .privateState)

// kCGMouseEventWindowUnderMousePointer / ...ThatCanHandleThisEvent: which
// window a mouse event is for. Without them a posted click is hit-tested
// against whatever window is on top at that point.
let windowUnderPointerField = CGEventField(rawValue: 91)!
let windowThatCanHandleField = CGEventField(rawValue: 92)!

// ── Agent cursor overlay ─────────────────────────────────────────────────────

/// Where the arrow's tip sits inside the overlay window (bottom-left origin).
let hotspot = NSPoint(x: 20, y: 44)
/// Claude's orange (#D97757).
let cursorColor = NSColor(srgbRed: 0xD9 / 255.0, green: 0x77 / 255.0, blue: 0x57 / 255.0, alpha: 1)
let overlaySize = NSSize(width: 64, height: 64)

final class CursorView: NSView {
    let arrow = CAShapeLayer()
    let ring = CAShapeLayer()

    override init(frame: NSRect) {
        super.init(frame: frame)
        // Layer-hosting: the view's content is just these two shape layers.
        layer = CALayer()
        wantsLayer = true

        let r: CGFloat = 14
        ring.bounds = CGRect(x: 0, y: 0, width: 2 * r, height: 2 * r)
        ring.position = hotspot
        ring.path = CGPath(ellipseIn: ring.bounds.insetBy(dx: 1, dy: 1), transform: nil)
        ring.fillColor = cursorColor.withAlphaComponent(0.25).cgColor
        ring.strokeColor = cursorColor.cgColor
        ring.lineWidth = 2
        ring.opacity = 0

        // A classic arrow, offsets measured downward from the tip.
        let points: [(CGFloat, CGFloat)] = [(0, 0), (0, 22), (6, 17), (10, 26), (13.5, 24.5), (9.5, 15.5), (16, 15.5)]
        let path = CGMutablePath()
        for (i, p) in points.enumerated() {
            let pt = CGPoint(x: hotspot.x + p.0, y: hotspot.y - p.1)
            if i == 0 { path.move(to: pt) } else { path.addLine(to: pt) }
        }
        path.closeSubpath()
        arrow.path = path
        arrow.fillColor = cursorColor.cgColor
        arrow.strokeColor = NSColor.white.cgColor
        arrow.lineWidth = 1.5
        arrow.lineJoin = .round
        arrow.shadowOpacity = 0.35
        arrow.shadowRadius = 2
        arrow.shadowOffset = CGSize(width: 0, height: -1)

        layer?.addSublayer(ring)
        layer?.addSublayer(arrow)
    }

    required init?(coder: NSCoder) { fatalError("unused") }

    func pulse() {
        let scale = CABasicAnimation(keyPath: "transform.scale")
        scale.fromValue = 0.3
        scale.toValue = 1.3
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 0.9
        fade.toValue = 0
        let group = CAAnimationGroup()
        group.animations = [scale, fade]
        group.duration = 0.35
        group.timingFunction = CAMediaTimingFunction(name: .easeOut)
        ring.add(group, forKey: "pulse")
    }
}

final class AgentCursor {
    let window: NSWindow
    let view: CursorView

    init() {
        window = NSWindow(contentRect: NSRect(origin: .zero, size: overlaySize),
                          styleMask: .borderless, backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.level = .screenSaver
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        window.isReleasedWhenClosed = false
        view = CursorView(frame: NSRect(origin: .zero, size: overlaySize))
        window.contentView = view
    }

    /// Global point (top-left origin, as CGEvent uses) -> overlay window origin.
    func origin(for p: CGPoint) -> NSPoint {
        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
        return NSPoint(x: p.x - hotspot.x, y: (primaryHeight - p.y) - hotspot.y)
    }

    func move(to p: CGPoint, animated: Bool) {
        let o = origin(for: p)
        if !window.isVisible {
            window.setFrameOrigin(o)
            window.orderFrontRegardless()
            return
        }
        if animated {
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = 0.1
                ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
                window.animator().setFrame(NSRect(origin: o, size: overlaySize), display: true)
            }
        } else {
            window.setFrameOrigin(o)
        }
    }
}

/// Only touched on the main thread.
var agentCursor: AgentCursor?

/// Show the agent cursor at a point. Returns how long to wait for the glide.
@discardableResult
func showCursor(at p: CGPoint, animated: Bool, pulse: Bool = false) -> useconds_t {
    guard showAgentCursor else { return 0 }
    DispatchQueue.main.async {
        let c = agentCursor ?? AgentCursor()
        agentCursor = c
        c.move(to: p, animated: animated)
        if pulse { c.view.pulse() }
    }
    return animated ? 100_000 : 0
}

func pulseCursor() {
    guard showAgentCursor else { return }
    DispatchQueue.main.async { agentCursor?.view.pulse() }
}

// ── Windows ──────────────────────────────────────────────────────────────────

func normalWindows(pid: pid_t, option: CGWindowListOption) -> [(UInt32, CGRect)] {
    let info = CGWindowListCopyWindowInfo([option, .excludeDesktopElements], kCGNullWindowID)
    guard let list = info as? [[String: Any]] else { return [] }
    var out: [(UInt32, CGRect)] = []
    for w in list {
        guard (w[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
              (w[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
              let number = (w[kCGWindowNumber as String] as? NSNumber)?.uint32Value,
              let boundsDict = w[kCGWindowBounds as String] as? NSDictionary,
              let bounds = CGRect(dictionaryRepresentation: boundsDict as CFDictionary),
              bounds.width >= 50, bounds.height >= 50 else { continue }
        out.append((number, bounds))
    }
    return out
}

func frontWindow(pid: pid_t) -> (UInt32, CGRect)? {
    // On-screen windows first (front to back), then any window of the app.
    normalWindows(pid: pid, option: .optionOnScreenOnly).first ?? normalWindows(pid: pid, option: .optionAll).first
}

/// The target's window under a point, falling back to its front window.
func windowNumber(pid: pid_t, at p: CGPoint) -> UInt32? {
    normalWindows(pid: pid, option: .optionOnScreenOnly).first { $0.1.contains(p) }?.0 ?? frontWindow(pid: pid)?.0
}

// ── Events ───────────────────────────────────────────────────────────────────

func post(_ event: CGEvent?, _ pid: pid_t, flags: UInt64 = 0) -> Bool {
    guard let e = event else { return false }
    e.flags = CGEventFlags(rawValue: flags)
    e.postToPid(pid)
    return true
}

func mouseEvent(_ kind: String, _ button: Int) -> (CGEventType, CGMouseButton)? {
    let b: CGMouseButton = button == 1 ? .right : (button == 2 ? .center : .left)
    switch (kind, button) {
    case ("move", _): return (.mouseMoved, b)
    case ("down", 0): return (.leftMouseDown, b)
    case ("up", 0): return (.leftMouseUp, b)
    case ("drag", 0): return (.leftMouseDragged, b)
    case ("down", 1): return (.rightMouseDown, b)
    case ("up", 1): return (.rightMouseUp, b)
    case ("drag", 1): return (.rightMouseDragged, b)
    case ("down", _): return (.otherMouseDown, b)
    case ("up", _): return (.otherMouseUp, b)
    case ("drag", _): return (.otherMouseDragged, b)
    default: return nil
    }
}

func postMouse(_ pid: pid_t, _ kind: String, _ button: Int, _ p: CGPoint, clicks: Int64, flags: UInt64) -> Bool {
    guard let k = mouseEvent(kind, button) else { return false }
    let e = CGEvent(mouseEventSource: source, mouseType: k.0, mouseCursorPosition: p, mouseButton: k.1)
    e?.setIntegerValueField(.mouseEventClickState, value: clicks)
    if let wid = windowNumber(pid: pid, at: p) {
        e?.setIntegerValueField(windowUnderPointerField, value: Int64(wid))
        e?.setIntegerValueField(windowThatCanHandleField, value: Int64(wid))
    }
    return post(e, pid, flags: flags)
}

// ── Accessibility ────────────────────────────────────────────────────────────

let pressableRoles: Set<String> = [
    "AXButton", "AXCheckBox", "AXRadioButton", "AXMenuItem", "AXMenuButton",
    "AXPopUpButton", "AXLink", "AXMenuBarItem", "AXDisclosureTriangle",
]
let textRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"]

func axAttribute(_ e: AXUIElement, _ name: String) -> CFTypeRef? {
    var v: CFTypeRef?
    return AXUIElementCopyAttributeValue(e, name as CFString, &v) == .success ? v : nil
}

func axParent(_ e: AXUIElement) -> AXUIElement? {
    guard let v = axAttribute(e, kAXParentAttribute), CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
    return (v as! AXUIElement)
}

func axActions(_ e: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(e, &names) == .success else { return [] }
    return (names as? [String]) ?? []
}

/// Press the control under a point through Accessibility. Returns its role
/// when pressed; nil means "send a real click instead". A text field under
/// the point is focused here but still gets the click, to place the caret.
func axPress(pid: pid_t, at p: CGPoint) -> String? {
    guard useAccessibility, AXIsProcessTrusted() else { return nil }
    var hit: AXUIElement?
    guard AXUIElementCopyElementAtPosition(AXUIElementCreateApplication(pid), Float(p.x), Float(p.y), &hit) == .success,
          var e = hit else { return nil }
    // The hit is often a label or image inside the control; walk up a little.
    for _ in 0..<4 {
        let role = axAttribute(e, kAXRoleAttribute) as? String ?? ""
        if textRoles.contains(role) {
            _ = AXUIElementSetAttributeValue(e, kAXFocusedAttribute as CFString, kCFBooleanTrue)
            return nil
        }
        if pressableRoles.contains(role) && axActions(e).contains(kAXPressAction) {
            return AXUIElementPerformAction(e, kAXPressAction as CFString) == .success ? role : nil
        }
        guard let parent = axParent(e) else { break }
        e = parent
    }
    return nil
}

// ── Requests ─────────────────────────────────────────────────────────────────

func handle(_ line: String) {
    let f = line.split(separator: " ").map(String.init)
    guard let verb = f.first else { return }

    switch verb {
    case "pid":
        guard f.count == 2 else { reply("err usage: pid <bundleId>"); return }
        if let app = NSRunningApplication.runningApplications(withBundleIdentifier: f[1]).first {
            reply("ok \(app.processIdentifier)")
        } else {
            reply("err \(f[1]) is not running")
        }

    case "window":
        guard f.count == 2, let pid = Int32(f[1]) else { reply("err usage: window <pid>"); return }
        if let w = frontWindow(pid: pid) {
            let r = w.1
            reply("ok \(w.0) \(r.origin.x) \(r.origin.y) \(r.width) \(r.height)")
        } else {
            reply("err no window found for pid \(pid)")
        }

    case "click":
        guard f.count == 7, let pid = Int32(f[1]), let button = Int(f[2]),
              let x = Double(f[3]), let y = Double(f[4]),
              let count = Int64(f[5]), let flags = UInt64(f[6]), count >= 1 else {
            reply("err bad click request: \(line)"); return
        }
        let p = CGPoint(x: x, y: y)
        usleep(showCursor(at: p, animated: true))
        if button == 0 && count == 1 && flags == 0, let role = axPress(pid: pid, at: p) {
            pulseCursor()
            reply("ok ax \(role)")
            return
        }
        var ok = postMouse(pid, "move", button, p, clicks: 1, flags: 0)
        for i in 1...count {
            ok = postMouse(pid, "down", button, p, clicks: i, flags: flags) && ok
            ok = postMouse(pid, "up", button, p, clicks: i, flags: flags) && ok
        }
        pulseCursor()
        reply(ok ? "ok event" : "err could not create mouse event")

    case "mouse":
        guard f.count == 8, let pid = Int32(f[1]), let button = Int(f[3]),
              let x = Double(f[4]), let y = Double(f[5]),
              let clicks = Int64(f[6]), let flags = UInt64(f[7]),
              mouseEvent(f[2], button) != nil else {
            reply("err bad mouse request: \(line)"); return
        }
        let p = CGPoint(x: x, y: y)
        showCursor(at: p, animated: false, pulse: f[2] == "down")
        reply(postMouse(pid, f[2], button, p, clicks: clicks, flags: flags) ? "ok" : "err could not create mouse event")

    case "key":
        guard f.count == 5, let pid = Int32(f[1]), let code = UInt16(f[2]),
              let flags = UInt64(f[4]) else {
            reply("err bad key request: \(line)"); return
        }
        let e = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: f[3] == "1")
        reply(post(e, pid, flags: flags) ? "ok" : "err could not create key event")

    case "text":
        guard f.count == 3, let pid = Int32(f[1]),
              let data = Data(base64Encoded: f[2]),
              let s = String(data: data, encoding: .utf8) else {
            reply("err bad text request"); return
        }
        let units = Array(s.utf16)
        var ok = true
        var i = 0
        while i < units.count {
            // CGEvent carries at most 20 UTF-16 units per event.
            var chunk = Array(units[i..<min(i + 16, units.count)])
            for down in [true, false] {
                let e = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down)
                e?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: &chunk)
                ok = post(e, pid) && ok
            }
            usleep(2_000)
            i += 16
        }
        reply(ok ? "ok" : "err could not create text event")

    case "scroll":
        guard f.count == 6, let pid = Int32(f[1]),
              let x = Double(f[2]), let y = Double(f[3]),
              let dx = Int32(f[4]), let dy = Int32(f[5]) else {
            reply("err bad scroll request: \(line)"); return
        }
        let p = CGPoint(x: x, y: y)
        showCursor(at: p, animated: false)
        let e = CGEvent(scrollWheelEvent2Source: source, units: .pixel,
                        wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0)
        e?.location = p
        reply(post(e, pid) ? "ok" : "err could not create scroll event")

    default:
        reply("err unknown verb: \(verb)")
    }
}

// Requests are read and served off the main thread; the main thread runs the
// AppKit loop that draws the agent cursor. Accessory policy: no Dock icon, and
// the helper never becomes the active app.
let application = NSApplication.shared
application.setActivationPolicy(.accessory)

Thread {
    while let line = readLine(strippingNewline: true) {
        handle(line)
    }
    exit(0)
}.start()

application.run()
