"use client"

// Example of a Motion animation driven by data: the ring fills up to `score`
// and the number counts up. Swap the dummy score for live data later — the
// animation re-runs whenever `score` changes.

import { animate, motion, useMotionValue, useTransform } from "motion/react"
import { useEffect } from "react"

const SIZE = 160
const STROKE = 12
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function ScoreRing({ score }: { score: number }) {
  const value = useMotionValue(0)
  const rounded = useTransform(value, (v) => Math.round(v))
  const offset = useTransform(value, (v) => CIRCUMFERENCE * (1 - v / 100))

  useEffect(() => {
    const controls = animate(value, score, { duration: 1, ease: "easeOut" })
    return () => controls.stop()
  }, [score, value])

  return (
    <div className="relative grid place-items-center" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} className="-rotate-90">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-muted"
        />
        <motion.circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          style={{ strokeDashoffset: offset }}
          className="stroke-primary"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <motion.span className="text-4xl font-semibold tabular-nums">{rounded}</motion.span>
        <span className="text-xs text-muted-foreground">posture score</span>
      </div>
    </div>
  )
}
