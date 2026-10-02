// Dummy data so the UI can be built before the backend / IoT is ready.
// Only lib/data.ts should import this file. Components get data from lib/data.ts.

import type {
  DailySummary,
  Device,
  PostureReading,
  PostureSession,
  PostureStatus,
} from "@/lib/types"

export function statusFromScore(score: number): PostureStatus {
  if (score >= 75) return "good"
  if (score >= 50) return "warning"
  return "bad"
}

// Deterministic pseudo-random so server and client render the same numbers
// (avoids hydration mismatches you'd get with Math.random()).
function seeded(seed: number) {
  const x = Math.sin(seed) * 10000
  return x - Math.floor(x)
}

const NOW = new Date("2026-10-02T10:00:00Z").getTime()
const MINUTE = 60_000

export const mockDevice: Device = {
  id: "esp32-001",
  name: "Reallign Sensor",
  connected: true,
  battery: 78,
  firmwareVersion: "0.1.0",
  lastSeenAt: new Date(NOW).toISOString(),
}

/** Last 60 minutes, one reading per minute. */
export const mockReadings: PostureReading[] = Array.from(
  { length: 60 },
  (_, i) => {
    const pitch = Math.round((seeded(i + 1) * 40 - 5) * 10) / 10
    const roll = Math.round((seeded(i + 100) * 16 - 8) * 10) / 10
    const score = Math.max(
      0,
      Math.min(100, Math.round(100 - Math.abs(pitch) * 1.8 - Math.abs(roll) * 2))
    )
    return {
      id: `r-${i}`,
      timestamp: new Date(NOW - (59 - i) * MINUTE).toISOString(),
      pitch,
      roll,
      score,
      status: statusFromScore(score),
    }
  }
)

export const mockSessions: PostureSession[] = [
  {
    id: "s-3",
    startedAt: "2026-10-02T09:00:00Z",
    endedAt: null,
    averageScore: 72,
    slouchCount: 4,
    goodMinutes: 38,
  },
  {
    id: "s-2",
    startedAt: "2026-10-01T13:00:00Z",
    endedAt: "2026-10-01T16:30:00Z",
    averageScore: 81,
    slouchCount: 6,
    goodMinutes: 170,
  },
  {
    id: "s-1",
    startedAt: "2026-09-30T08:30:00Z",
    endedAt: "2026-09-30T11:00:00Z",
    averageScore: 64,
    slouchCount: 11,
    goodMinutes: 88,
  },
]

/** Last 7 days. */
export const mockDailySummaries: DailySummary[] = Array.from(
  { length: 7 },
  (_, i) => {
    const date = new Date(NOW - (6 - i) * 24 * 60 * MINUTE)
    return {
      date: date.toISOString().slice(0, 10),
      averageScore: Math.round(55 + seeded(i + 200) * 40),
      slouchCount: Math.round(seeded(i + 300) * 15),
      trackedMinutes: Math.round(60 + seeded(i + 400) * 240),
    }
  }
)
