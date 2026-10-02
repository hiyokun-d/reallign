"use client"

// Placeholder chart: plain divs + Motion, no chart library yet.
// If the team picks a chart library later (shadcn `chart` = Recharts),
// replace this component and keep the same props.

import { motion } from "motion/react"
import type { PostureReading } from "@/lib/types"
import { cn } from "@/lib/utils"

const COLORS = {
  good: "bg-primary",
  warning: "bg-primary/50",
  bad: "bg-destructive",
}

export function ReadingsBarChart({ readings }: { readings: PostureReading[] }) {
  return (
    <div className="flex h-32 items-end gap-0.5">
      {readings.map((r, i) => (
        <motion.div
          key={r.id}
          title={`${new Date(r.timestamp).toLocaleTimeString()} · score ${r.score}`}
          className={cn("flex-1 rounded-sm", COLORS[r.status])}
          initial={{ height: 0 }}
          animate={{ height: `${r.score}%` }}
          transition={{ duration: 0.4, delay: i * 0.01, ease: "easeOut" }}
        />
      ))}
    </div>
  )
}
