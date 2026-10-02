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
