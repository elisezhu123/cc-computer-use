// Background input for one application, without touching the system cursor.
//
// Events are delivered with CGEvent.postToPid, straight into the target
// process's event queue, instead of the global HID tap that cliclick and
// scroll.swift use. The user's mouse and keyboard stay free.
//
// Reads one request per line from stdin and replies "ok [payload]" or
// "err <message>" on stdout:
//   pid <bundleId>                        -> ok <pid>        (running instance)
//   window <pid>                          -> ok <id> <x> <y> <w> <h>
//                                            frontmost normal window, global points
//   mouse <pid> <kind> <button> <x> <y> <clicks> <flags>
//         kind: down | up | move | drag;  button: 0 left, 1 right, 2 middle
//   key <pid> <keycode> <down 1|0> <flags>
//   text <pid> <base64 utf-8>             Unicode typing, no key codes needed
//   scroll <pid> <x> <y> <dx> <dy>        pixel deltas, same sign as scroll.swift

import Foundation
import CoreGraphics
import AppKit

setvbuf(stdout, nil, _IOLBF, 0)

func reply(_ s: String) {
    print(s)
    fflush(stdout)
}

let source = CGEventSource(stateID: .privateState)

func post(_ event: CGEvent?, _ pid: pid_t, flags: UInt64 = 0) -> Bool {
    guard let e = event else { return false }
    e.flags = CGEventFlags(rawValue: flags)
    e.postToPid(pid)
    return true
}

func frontWindow(pid: pid_t) -> (UInt32, CGRect)? {
    // On-screen windows first (front to back), then any window of the app.
    for option in [CGWindowListOption.optionOnScreenOnly, CGWindowListOption.optionAll] {
        let info = CGWindowListCopyWindowInfo([option, .excludeDesktopElements], kCGNullWindowID)
        guard let list = info as? [[String: Any]] else { continue }
        for w in list {
            guard (w[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
                  (w[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
                  let number = (w[kCGWindowNumber as String] as? NSNumber)?.uint32Value,
                  let boundsDict = w[kCGWindowBounds as String] as? NSDictionary,
                  let bounds = CGRect(dictionaryRepresentation: boundsDict as CFDictionary),
                  bounds.width >= 50, bounds.height >= 50 else { continue }
            return (number, bounds)
        }
    }
    return nil
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

while let line = readLine(strippingNewline: true) {
    let f = line.split(separator: " ").map(String.init)
    guard let verb = f.first else { continue }

    switch verb {
    case "pid":
        guard f.count == 2 else { reply("err usage: pid <bundleId>"); continue }
        if let app = NSRunningApplication.runningApplications(withBundleIdentifier: f[1]).first {
            reply("ok \(app.processIdentifier)")
        } else {
            reply("err \(f[1]) is not running")
        }

    case "window":
        guard f.count == 2, let pid = Int32(f[1]) else { reply("err usage: window <pid>"); continue }
        if let w = frontWindow(pid: pid) {
            let r = w.1
            reply("ok \(w.0) \(r.origin.x) \(r.origin.y) \(r.width) \(r.height)")
        } else {
            reply("err no window found for pid \(pid)")
        }

    case "mouse":
        guard f.count == 8, let pid = Int32(f[1]), let button = Int(f[3]),
              let x = Double(f[4]), let y = Double(f[5]),
              let clicks = Int64(f[6]), let flags = UInt64(f[7]),
              let kind = mouseEvent(f[2], button) else {
            reply("err bad mouse request: \(line)"); continue
        }
        let e = CGEvent(mouseEventSource: source, mouseType: kind.0,
                        mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: kind.1)
        e?.setIntegerValueField(.mouseEventClickState, value: clicks)
        reply(post(e, pid, flags: flags) ? "ok" : "err could not create mouse event")

    case "key":
        guard f.count == 5, let pid = Int32(f[1]), let code = UInt16(f[2]),
              let flags = UInt64(f[4]) else {
            reply("err bad key request: \(line)"); continue
        }
        let e = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: f[3] == "1")
        reply(post(e, pid, flags: flags) ? "ok" : "err could not create key event")

    case "text":
        guard f.count == 3, let pid = Int32(f[1]),
              let data = Data(base64Encoded: f[2]),
              let s = String(data: data, encoding: .utf8) else {
            reply("err bad text request"); continue
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
            reply("err bad scroll request: \(line)"); continue
        }
        let e = CGEvent(scrollWheelEvent2Source: source, units: .pixel,
                        wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0)
        e?.location = CGPoint(x: x, y: y)
        reply(post(e, pid) ? "ok" : "err could not create scroll event")

    default:
        reply("err unknown verb: \(verb)")
    }
}
