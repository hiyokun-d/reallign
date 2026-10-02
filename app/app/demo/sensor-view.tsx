"use client";

// Phone side: reads DeviceOrientation and streams it to the laptop.

import type { DataConnection, Peer } from "peerjs";
import { useEffect, useRef, useState } from "react";
import { PEER_PREFIX, type OrientationPacket } from "@/app/demo/protocol";
import { FadeIn } from "@/components/motion/fade-in";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

type Status = "idle" | "connecting" | "streaming" | "error";

// iOS needs an explicit permission prompt, triggered by a tap.
type IOSOrientationEvent = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

const SEND_INTERVAL_MS = 33; // ~30 packets per second

export function SensorView({ code }: { code: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [angles, setAngles] = useState<OrientationPacket | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  async function start() {
    setError(null);

    // Must be the first await in the tap handler or iOS rejects it.
    const Orientation = DeviceOrientationEvent as IOSOrientationEvent;
    if (typeof Orientation.requestPermission === "function") {
      const result = await Orientation.requestPermission().catch(() => "denied" as const);
      if (result !== "granted") {
        setStatus("error");
        setError("Motion access was denied. Reload the page and tap Allow.");
        return;
      }
    }

    setStatus("connecting");
    const { default: PeerCtor } = await import("peerjs");
    const peer = new PeerCtor();
    peerRef.current = peer;

    let conn: DataConnection | null = null;
    let lastSent = 0;
    let lastUi = 0;
    let wakeLock: WakeLockSentinel | null = null;

    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      const packet: OrientationPacket = { a: e.alpha ?? 0, b: e.beta, g: e.gamma };
      const now = performance.now();
      if (conn?.open && now - lastSent >= SEND_INTERVAL_MS) {
        conn.send(packet);
        lastSent = now;
      }
      if (now - lastUi >= 100) {
        setAngles(packet);
        lastUi = now;
      }
    };

    stopRef.current = () => {
      window.removeEventListener("deviceorientation", onOrientation);
      wakeLock?.release().catch(() => {});
      peer.destroy();
      peerRef.current = null;
    };

    peer.on("open", () => {
      conn = peer.connect(PEER_PREFIX + code, { serialization: "json", reliable: false });
      conn.on("open", async () => {
        setStatus("streaming");
        window.addEventListener("deviceorientation", onOrientation);
        // Keep the screen on so iOS doesn't pause the page.
        wakeLock = await navigator.wakeLock?.request("screen").catch(() => null);
      });
      conn.on("close", () => {
        setStatus("error");
        setError("The laptop disconnected.");
      });
    });
    peer.on("error", (err) => {
      setStatus("error");
      setError(
        err.type === "peer-unavailable"
          ? `No display found for code ${code}. Check the code on the laptop.`
          : `Connection failed (${err.type}). Are both devices online?`
      );
    });
  }

  function stop() {
    stopRef.current?.();
    stopRef.current = null;
    setStatus("idle");
    setAngles(null);
  }

  return (
    <FadeIn className="mx-auto flex max-w-sm flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Phone sensor
            <Badge variant={status === "streaming" ? "default" : "outline"}>{status}</Badge>
          </CardTitle>
          <CardDescription>
            Sending to display <span className="font-mono">{code}</span>. Hold the phone upright against
            your chest, screen facing out, like the real sensor.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {angles ? (
            <div className="grid grid-cols-3 gap-2 text-center tabular-nums">
              <Angle label="alpha" value={angles.a} />
              <Angle label="beta" value={angles.b} />
              <Angle label="gamma" value={angles.g} />
            </div>
          ) : (
            <p className="text-muted-foreground">Tap start, then allow motion access.</p>
          )}
          {error && <p className="text-destructive">{error}</p>}
        </CardContent>
        <CardFooter>
          {status === "idle" || status === "error" ? (
            <Button className="w-full" size="lg" onClick={start}>
              Start sensor
            </Button>
          ) : (
            <Button className="w-full" size="lg" variant="outline" onClick={stop}>
              Stop
            </Button>
          )}
        </CardFooter>
      </Card>
    </FadeIn>
  );
}

function Angle({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{Math.round(value)}°</div>
    </div>
  );
}
