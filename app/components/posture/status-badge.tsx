import { Badge } from "@/components/ui/badge"
import type { PostureStatus } from "@/lib/types"

const LABELS: Record<PostureStatus, string> = {
  good: "Good posture",
  warning: "Adjust a little",
  bad: "Slouching",
}

const VARIANTS = {
  good: "default",
  warning: "secondary",
  bad: "destructive",
} as const

export function StatusBadge({ status }: { status: PostureStatus }) {
  return <Badge variant={VARIANTS[status]}>{LABELS[status]}</Badge>
}
