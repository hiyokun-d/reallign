// Dashboard — PLACEHOLDER. Owner: frontend team.
// Shows the current posture score, the last hour of readings and today's stats.
// All data comes from lib/data.ts (dummy data for now).

import { FadeIn, Stagger, StaggerItem } from "@/components/motion/fade-in";
import { ReadingsBarChart } from "@/components/posture/readings-bar-chart";
import { ScoreRing } from "@/components/posture/score-ring";
import { StatusBadge } from "@/components/posture/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDailySummaries, getLatestReading, getRecentReadings } from "@/lib/data";

export default async function DashboardPage() {
  const [latest, readings, summaries] = await Promise.all([
    getLatestReading(),
    getRecentReadings(60),
    getDailySummaries(),
  ]);
  const today = summaries[summaries.length - 1];

  return (
    <div className="flex flex-col gap-6">
      <FadeIn>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Dummy data — real sensor data coming soon.</p>
      </FadeIn>

      <Stagger className="grid gap-4 md:grid-cols-3">
        <StaggerItem>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Right now</CardTitle>
              <CardDescription>Latest reading from the sensor</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-3">
              <ScoreRing score={latest.score} />
              <StatusBadge status={latest.status} />
              <p className="text-xs text-muted-foreground tabular-nums">
                pitch {latest.pitch}° · roll {latest.roll}°
              </p>
            </CardContent>
          </Card>
        </StaggerItem>

        <StaggerItem className="md:col-span-2">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Last 60 minutes</CardTitle>
              <CardDescription>One bar per minute, height = score</CardDescription>
            </CardHeader>
            <CardContent>
              <ReadingsBarChart readings={readings} />
            </CardContent>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Stat label="Average today" value={today.averageScore} />
        </StaggerItem>
        <StaggerItem>
          <Stat label="Slouches today" value={today.slouchCount} />
        </StaggerItem>
        <StaggerItem>
          <Stat label="Minutes tracked" value={today.trackedMinutes} />
        </StaggerItem>
      </Stagger>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
