// Message format between the phone (sensor) and the laptop (display).
// Same idea as what the ESP32 will send over BLE later: small and frequent.

/** Raw DeviceOrientationEvent angles in degrees. */
export type OrientationPacket = {
  /** alpha: rotation around the screen's z axis (compass-ish), 0–360 */
  a: number
  /** beta: front/back tilt, -180–180 */
  b: number
  /** gamma: left/right tilt, -90–90 */
  g: number
}

// PeerJS uses a free public server to introduce the two devices, then they
// talk directly (WebRTC). The prefix keeps our ids from colliding with others.
export const PEER_PREFIX = "reallign-demo-"

export function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
}

// ── ESP32 over BLE ─────────────────────────────────────────────────────────
// Firmware: esp32/test/src/main.cpp. It exposes a Nordic UART Service and
// streams newline-terminated text, split into 20-byte notifications:
//   "-3.2,12.5,0,1.4,-0.8" → back pitch, neck pitch, motor 0/1, back roll, neck roll
//                    (degrees from calibration; + = forward / right). Older
//                    firmware sends only the first three fields.
//   anything else  → a log line (calibration results, command replies, …)
//   "CAL:..."      → calibration progress (see CalEvent)
//   "DIR:..."      → result of FWD (which sign means "leaning forward")
//   "RDIR:..."     → result of RGT (which sign means "leaning right")
// Commands go the other way as plain text: CAL, CAL=3, FWD, RGT, T=25, D=5000, ON, OFF, BUZZ, STATUS.

export const ESP32_NAME = "PostureMonitor"
// Web Bluetooth only accepts lowercase UUIDs.
export const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
export const NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e" // phone → ESP32
export const NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e" // ESP32 → phone

export type Esp32Settings = {
  /** Degrees away from calibration before it counts as slouching. */
  threshold: number
  /** How long slouching must last before the motor buzzes (ms). */
  durationMs: number
  alertEnabled: boolean
  /** Raw sensor angles saved as "sitting straight" (null until known). */
  zero: { back: number; neck: number } | null
  /** +1/-1 per sensor so leaning forward reads positive (null until known). */
  dir: { back: number; neck: number } | null
  /** Same for roll, so leaning right reads positive. */
  rdir: { back: number; neck: number } | null
}

/** Firmware defaults, used until the ESP32 answers STATUS. */
export const ESP32_DEFAULTS: Esp32Settings = { threshold: 20, durationMs: 3000, alertEnabled: true, zero: null, dir: null, rdir: null }

/** Progress of the firmware's calibrateSensors(). */
export type CalEvent =
  | { phase: "wait"; seconds: number } // countdown before sampling
  | { phase: "hold" } // sampling for 2.5 s, user must keep still
  | { phase: "ok"; back: number; neck: number } // new zero saved to flash
  | { phase: "fail"; wobble: number } // moved too much, old zero kept

export type Esp32Line =
  | { kind: "sample"; back: number; neck: number; motor: boolean; backRoll: number; neckRoll: number }
  | {
      kind: "text"
      text: string
      settings?: Partial<Esp32Settings>
      cal?: CalEvent
      fwd?: FwdEvent
      rgt?: FwdEvent
    }

/** Result of the FWD / RGT commands. */
export type FwdEvent = { ok: true; back: number; neck: number } | { ok: false; angle: number }

const NUM = "(-?\\d+(?:\\.\\d+)?)"
const SAMPLE_RE = new RegExp(`^${NUM},${NUM},([01])(?:,${NUM},${NUM})?$`)

export function parseEsp32Line(line: string): Esp32Line {
  const m = SAMPLE_RE.exec(line)
  if (m) {
    // wrap180 also fixes older firmware that sent 270° instead of -90°.
    return {
      kind: "sample",
      back: wrap180(Number(m[1])),
      neck: wrap180(Number(m[2])),
      motor: m[3] === "1",
      backRoll: Number(m[4] ?? 0),
      neckRoll: Number(m[5] ?? 0),
    }
  }
  const cal = calFromLine(line)
  const fwd = dirFromLine(line, "DIR")
  const rgt = dirFromLine(line, "RDIR")
  const settings =
    cal?.phase === "ok"
      ? { zero: { back: cal.back, neck: cal.neck } }
      : fwd?.ok
        ? { dir: { back: fwd.back, neck: fwd.neck } }
        : rgt?.ok
          ? { rdir: { back: rgt.back, neck: rgt.neck } }
          : settingsFromReply(line)
  return { kind: "text", text: line, settings, cal, fwd, rgt }
}

function wrap180(deg: number) {
  if (deg > 180) return deg - 360
  if (deg < -180) return deg + 360
  return deg
}

function dirFromLine(line: string, prefix: "DIR" | "RDIR"): FwdEvent | undefined {
  let m = new RegExp(`^${prefix}:OK (-?1),(-?1)$`).exec(line)
  if (m) return { ok: true, back: Number(m[1]), neck: Number(m[2]) }
  if ((m = new RegExp(`^${prefix}:FAIL ([\\d.]+)$`).exec(line))) return { ok: false, angle: Number(m[1]) }
  return undefined
}

function calFromLine(line: string): CalEvent | undefined {
  let m = /^CAL:WAIT (\d+)$/.exec(line)
  if (m) return { phase: "wait", seconds: Number(m[1]) }
  if (line === "CAL:HOLD") return { phase: "hold" }
  if ((m = /^CAL:OK (-?[\d.]+),(-?[\d.]+)$/.exec(line))) return { phase: "ok", back: Number(m[1]), neck: Number(m[2]) }
  if ((m = /^CAL:FAIL ([\d.]+)$/.exec(line))) return { phase: "fail", wobble: Number(m[1]) }
  return undefined
}

// Replies are in Indonesian, matching the firmware's handleCommand().
function settingsFromReply(line: string): Partial<Esp32Settings> | undefined {
  let m = /^T=([\d.]+) D=(\d+) Getar=(ON|OFF)(?: Nol=(-?[\d.]+),(-?[\d.]+))?(?: Arah=(-?1),(-?1))?(?: ArahR=(-?1),(-?1))?/.exec(line)
  if (m) {
    return {
      threshold: Number(m[1]),
      durationMs: Number(m[2]),
      alertEnabled: m[3] === "ON",
      ...(m[4] !== undefined && { zero: { back: Number(m[4]), neck: Number(m[5]) } }),
      ...(m[6] !== undefined && { dir: { back: Number(m[6]), neck: Number(m[7]) } }),
      ...(m[8] !== undefined && { rdir: { back: Number(m[8]), neck: Number(m[9]) } }),
    }
  }
  if ((m = /^Ambang: ([\d.]+)/.exec(line))) return { threshold: Number(m[1]) }
  if ((m = /^Durasi: (\d+)/.exec(line))) return { durationMs: Number(m[1]) }
  if ((m = /^Getaran: (ON|OFF)/.exec(line))) return { alertEnabled: m[1] === "ON" }
  return undefined
}
