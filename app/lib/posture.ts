// Posture scoring shared by mock data, the /demo page and (later) real sensor data.

import type { PostureStatus } from "@/lib/types"

export function statusFromScore(score: number): PostureStatus {
  if (score >= 75) return "good"
  if (score >= 50) return "warning"
  return "bad"
}

/** pitch/roll are degrees away from upright (0 = perfect). */
export function scoreFromAngles(pitch: number, roll: number): number {
  const score = 100 - Math.abs(pitch) * 1.8 - Math.abs(roll) * 2
  return Math.max(0, Math.min(100, Math.round(score)))
}
