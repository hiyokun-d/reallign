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
//   "-3.2,12.5,0"  → back pitch, neck pitch (degrees from calibration), motor 0/1
//   anything else  → a log line (calibration results, command replies, …)
// Commands go the other way as plain text: CAL, T=25, D=5000, ON, OFF, BUZZ, STATUS.

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
}

/** Firmware defaults, used until the ESP32 answers STATUS. */
export const ESP32_DEFAULTS: Esp32Settings = { threshold: 20, durationMs: 3000, alertEnabled: true }

export type Esp32Line =
  | { kind: "sample"; back: number; neck: number; motor: boolean }
  | { kind: "text"; text: string; settings?: Partial<Esp32Settings> }

const SAMPLE_RE = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),([01])$/

export function parseEsp32Line(line: string): Esp32Line {
  const m = SAMPLE_RE.exec(line)
  if (m) return { kind: "sample", back: Number(m[1]), neck: Number(m[2]), motor: m[3] === "1" }
  return { kind: "text", text: line, settings: settingsFromReply(line) }
}

// Replies are in Indonesian, matching the firmware's handleCommand().
function settingsFromReply(line: string): Partial<Esp32Settings> | undefined {
  let m = /^T=([\d.]+) D=(\d+) Getar=(ON|OFF)/.exec(line)
  if (m) return { threshold: Number(m[1]), durationMs: Number(m[2]), alertEnabled: m[3] === "ON" }
  if ((m = /^Ambang: ([\d.]+)/.exec(line))) return { threshold: Number(m[1]) }
  if ((m = /^Durasi: (\d+)/.exec(line))) return { durationMs: Number(m[1]) }
  if ((m = /^Getaran: (ON|OFF)/.exec(line))) return { alertEnabled: m[1] === "ON" }
  return undefined
}
