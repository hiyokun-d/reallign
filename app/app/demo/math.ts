// Orientation + scoring helpers for /demo only.

import { Euler, MathUtils, Quaternion } from "three";
import type { OrientationPacket } from "./protocol";

export type Tone = "good" | "warning" | "bad";

export const TONE_COLORS: Record<Tone, string> = {
  good: "#22c55e",
  warning: "#f59e0b",
  bad: "#ef4444",
};

// DeviceOrientation angles → quaternion in the phone's own frame
// (x = right, y = top of phone, z = out of the screen). W3C order is Z-X'-Y''.
export function packetToQuaternion(p: OrientationPacket) {
  const euler = new Euler(
    MathUtils.degToRad(p.b),
    MathUtils.degToRad(p.g),
    MathUtils.degToRad(p.a),
    "ZXY"
  );
  return new Quaternion().setFromEuler(euler);
}

const scratch = new Euler();

/**
 * Lean angles (degrees) of a rotation relative to the calibrated pose.
 * pitch = lean forward/back (x), roll = lean sideways (z). Twist is ignored.
 */
export function leanAngles(relative: Quaternion) {
  scratch.setFromQuaternion(relative, "YXZ");
  return {
    pitch: MathUtils.radToDeg(scratch.x),
    roll: MathUtils.radToDeg(scratch.z),
  };
}

export function scoreFromAngles(pitch: number, roll: number) {
  const score = 100 - Math.abs(pitch) * 1.8 - Math.abs(roll) * 2;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function toneFromScore(score: number): Tone {
  if (score >= 75) return "good";
  if (score >= 50) return "warning";
  return "bad";
}

/** Total lean (degrees) from a forward/back and a sideways angle. */
export function tilt(pitch: number, roll: number) {
  return Math.hypot(pitch, roll);
}

/**
 * ESP32 pitch/roll (degrees, + = forward / right) → rotation for a 3D body
 * whose spine is +y and whose front faces the camera (+z).
 */
export function tiltQuaternion(pitch: number, roll: number, out = new Quaternion()) {
  scratch.set(MathUtils.degToRad(pitch), 0, MathUtils.degToRad(-roll), "XYZ");
  return out.setFromEuler(scratch);
}
