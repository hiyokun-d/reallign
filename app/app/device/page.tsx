// Device — PLACEHOLDER. Owner: frontend team (UI) + backend/IoT (connection logic).
// How the app talks to the ESP32 (Bluetooth vs. cloud) is NOT decided yet.
// The Connect button only shows a toast for now.

import { ConnectButton } from "@/app/device/connect-button";
import { FadeIn } from "@/components/motion/fade-in";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { getDevice } from "@/lib/data";

export default async function DevicePage() {
  const device = await getDevice();

  return (
    <FadeIn className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Device</h1>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {device.name}
            <Badge variant={device.connected ? "default" : "outline"}>
              {device.connected ? "Connected" : "Disconnected"}
            </Badge>
          </CardTitle>
          <CardDescription>ID {device.id} · firmware {device.firmwareVersion}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex justify-between text-sm">
            <span>Battery</span>
            <span className="tabular-nums">{device.battery}%</span>
          </div>
          <Progress value={device.battery} />
          <Separator />
          <p className="text-xs text-muted-foreground">
            Last seen {new Date(device.lastSeenAt).toLocaleString()}
          </p>
        </CardContent>
        <CardFooter>
          <ConnectButton />
        </CardFooter>
      </Card>
    </FadeIn>
  );
}
