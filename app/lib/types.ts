// Shared data shapes for the app.
// These are a first guess — the final shape depends on what the ESP32 sends.
// When the IoT payload is decided, update these types first; TypeScript will
// then point at every component that needs changing.

export type PostureStatus = "good" | "warning" | "bad"

/** One sample from the sensor. */
export type PostureReading = {
  id: string
  /** ISO 8601 timestamp */
  timestamp: string
  /** Forward/backward tilt in degrees. 0 = upright, positive = leaning forward. */
  pitch: number
  /** Side-to-side tilt in degrees. 0 = level, positive = leaning right. */
  roll: number
  /** 0–100, higher is better. */
  score: number
  status: PostureStatus
}

/** A continuous wearing/tracking period. */
export type PostureSession = {
  id: string
  startedAt: string
  /** null while the session is still running */
  endedAt: string | null
  averageScore: number
  /** Number of times posture went "bad" during the session. */
  slouchCount: number
  /** Minutes spent in "good" posture. */
  goodMinutes: number
}

export type Device = {
  id: string
  name: string
  connected: boolean
  /** 0–100 */
  battery: number
  firmwareVersion: string
  lastSeenAt: string
}

export type DailySummary = {
  /** YYYY-MM-DD */
  date: string
  averageScore: number
  slouchCount: number
  trackedMinutes: number
}
