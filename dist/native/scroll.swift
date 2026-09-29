// Minimal scroll-wheel synthesizer.
//
// cliclick (5.1) has NO scroll command - verified against its own help output,
// which lists c/rc/dc/tc/m/dd/dm/du/kd/ku/kp/t/w/p/cp and nothing else. So the
// scroll tool needs a CGEvent source of its own.
//
// Reads one request per line from stdin. Two forms:
//   "scroll <x> <y> <dx> <dy> <ticks>"
//       x, y   destination in LOGICAL points (already mapped by the caller)
//       dx, dy pixel deltas passed straight to CGEvent (positive dy scrolls down)
//       ticks  number of wheel events to emit
//   "middle <x> <y> <ticks>"
//       clicks the scroll-wheel button (CGEvent .otherMouseDown/Up, button 2)
// Emits "ok" or "err <message>" per line so the caller can surface failures -
// a silently swallowed failure here would report success for an action that
// never happened.

import Foundation
import CoreGraphics

func scrollOne(x: Double, y: Double, dx: Int32, dy: Int32) {
    let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                       mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)
    move?.post(tap: .cghidEventTap)

    guard let ev = CGEvent(scrollWheelEvent2Source: nil, units: .pixel,
                           wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0) else { return }
    ev.location = CGPoint(x: x, y: y)
    ev.post(tap: .cghidEventTap)
}

func moveTo(x: Double, y: Double) {
    let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                       mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)
    move?.post(tap: .cghidEventTap)
}

func middleClick(x: Double, y: Double) {
    let pt = CGPoint(x: x, y: y)
    // button 2 = the scroll wheel / middle button.
    let down = CGEvent(mouseEventSource: nil, mouseType: .otherMouseDown,
                       mouseCursorPosition: pt, mouseButton: .center)
    let up = CGEvent(mouseEventSource: nil, mouseType: .otherMouseUp,
                     mouseCursorPosition: pt, mouseButton: .center)
    down?.post(tap: .cghidEventTap)
    usleep(20_000)
    up?.post(tap: .cghidEventTap)
}

while let line = readLine(strippingNewline: true) {
    let f = line.split(separator: " ")
    guard let verb = f.first else { continue }

    if verb == "scroll" {
        guard f.count == 6,
              let x = Double(f[1]), let y = Double(f[2]),
              let dx = Int32(f[3]), let dy = Int32(f[4]),
              let ticks = Int32(f[5]) else {
            print("err bad scroll request: \(line)"); fflush(stdout); continue
        }
        // Settle before scrolling: the HID round trip must finish or the event
        // is interpreted against the previous cursor position.
        usleep(50_000)
        for _ in 0..<max(1, ticks) {
            scrollOne(x: x, y: y, dx: dx, dy: dy)
            usleep(10_000)
        }
        print("ok"); fflush(stdout)
        continue
    }

    if verb == "middle" {
        guard f.count == 4,
              let x = Double(f[1]), let y = Double(f[2]),
              let ticks = Int32(f[3]) else {
            print("err bad middle request: \(line)"); fflush(stdout); continue
        }
        moveTo(x: x, y: y)
        usleep(50_000)
        for _ in 0..<max(1, ticks) { middleClick(x: x, y: y); usleep(20_000) }
        print("ok"); fflush(stdout)
        continue
    }

    print("err unknown verb: \(verb)"); fflush(stdout)
}
