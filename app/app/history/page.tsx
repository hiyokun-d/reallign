// History — PLACEHOLDER. Owner: frontend team.
// TODO: weekly trend chart, session detail view, date picker.

import { FadeIn, Stagger, StaggerItem } from "@/components/motion/fade-in";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDailySummaries, getSessions } from "@/lib/data";

export default async function HistoryPage() {
  const [sessions, summaries] = await Promise.all([getSessions(), getDailySummaries()]);

  return (
    <div className="flex flex-col gap-6">
      <FadeIn>
        <h1 className="text-2xl font-semibold tracking-tight">History</h1>
      </FadeIn>

      <Tabs defaultValue="sessions">
        <TabsList>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="week">Last 7 days</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions">
          <Stagger className="flex flex-col gap-3">
            {sessions.map((s) => (
              <StaggerItem key={s.id}>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      {new Date(s.startedAt).toLocaleString()}
                      {s.endedAt === null && <Badge>Live</Badge>}
                    </CardTitle>
                    <CardDescription>
                      {s.slouchCount} slouches · {s.goodMinutes} min good posture
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Progress value={s.averageScore} />
                  </CardContent>
                </Card>
              </StaggerItem>
            ))}
          </Stagger>
        </TabsContent>

        <TabsContent value="week">
          <Card>
            <CardContent className="flex flex-col gap-3">
              {summaries.map((d) => (
                <div key={d.date} className="grid grid-cols-[6rem_1fr_2rem] items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{d.date}</span>
                  <Progress value={d.averageScore} />
                  <span className="text-right tabular-nums">{d.averageScore}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
