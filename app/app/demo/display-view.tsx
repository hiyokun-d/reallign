"use client";

// Laptop side: waits for a phone to connect, renders its orientation in 3D
// and turns it into a posture score.

import type { Peer } from "peerjs";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import { Euler, MathUtils, Quaternion } from "three";
import { OrientationScene } from "@/app/demo/orientation-scene";
import { makeCode, PEER_PREFIX, type OrientationPacket } from "@/app/demo/protocol";
import { FadeIn } from "@/components/motion/fade-in";
import { ScoreRing } from "@/components/posture/score-ring";
import { StatusBadge } from "@/components/posture/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { scoreFromAngles, statusFromScore } from "@/lib/posture";

type Status = "starting" | "waiting" | "connected" | "error";

// DeviceOrientation angles → quaternion in the phone's own frame
// (x = right, y = top of phone, z = out of the screen). W3C order is Z-X'-Y''.
function packetToQuaternion(p: OrientationPacket) {
  const euler = new Euler(
    MathUtils.degToRad(p.b),
    MathUtils.degToRad(p.g),
    MathUtils.degToRad(p.a),
    "ZXY"
  );
  return new Quaternion().setFromEuler(euler);
}

export function DisplayView() {
  const [status, setStatus] = useState<Status>("starting");
  const [code, setCode] = useState<string | null>(null);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [reading, setReading] = useState({ pitch: 0, roll: 0, score: 100 });

  // Hot path lives in refs: updated ~30x/sec without re-rendering.
  const latest = useRef<Quaternion | null>(null);
  const baseline = useRef<Quaternion | null>(null);
  const relative = useRef(new Quaternion());

  useEffect(() => {
    let peer: Peer | null = null;
    let cancelled = false;

    async function connect(attempt = 0) {
      const { default: PeerCtor } = await import("peerjs");
      if (cancelled) return;
      const newCode = makeCode();
      peer = new PeerCtor(PEER_PREFIX + newCode);

      peer.on("open", () => {
        setCode(newCode);
        setJoinUrl(`${window.location.origin}/demo?join=${newCode}`);
        setStatus("waiting");
      });

      peer.on("connection", (conn) => {
        conn.on("open", () => {
          baseline.current = null; // recalibrate on every new phone
          setStatus("connected");
        });
        conn.on("data", (data) => {
          const q = packetToQuaternion(data as OrientationPacket);
          latest.current = q;
          baseline.current ??= q.clone();
          // Rotation relative to the calibrated "upright" pose.
          relative.current.copy(baseline.current).invert().multiply(q);
        });
        conn.on("close", () => setStatus("waiting"));
      });

      peer.on("error", (err) => {
        if (err.type === "unavailable-id" && attempt < 3) {
          peer?.destroy();
          connect(attempt + 1);
          return;
        }
        setStatus("error");
      });
    }

    connect();

    // Update the numbers 10x/sec (the 3D scene reads the ref every frame).
    const interval = setInterval(() => {
      if (!latest.current) return;
      // YXZ: y = twist (ignored), x = lean forward/back, z = lean sideways.
      const e = new Euler().setFromQuaternion(relative.current, "YXZ");
      const pitch = Math.round(MathUtils.radToDeg(e.x));
      const roll = Math.round(MathUtils.radToDeg(e.z));
      setReading({ pitch, roll, score: scoreFromAngles(pitch, roll) });
    }, 100);

    return () => {
      cancelled = true;
      clearInterval(interval);
      peer?.destroy();
    };
  }, []);

  function calibrate() {
    if (latest.current) baseline.current = latest.current.clone();
  }

  const postureStatus = statusFromScore(reading.score);

  return (
    <div className="flex flex-col gap-6">
      <FadeIn>
        <h1 className="text-2xl font-semibold tracking-tight">Live demo</h1>
        <p className="text-sm text-muted-foreground">
          Your phone stands in for the ESP32 sensor. Data goes phone → laptop directly (WebRTC).
        </p>
      </FadeIn>

      <div className="grid gap-4 md:grid-cols-[1fr_280px]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Sensor orientation
              <Badge variant={status === "connected" ? "default" : "outline"}>{status}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[420px]">
            <OrientationScene target={relative} status={postureStatus} />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          {status === "connected" ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3">
                <ScoreRing score={reading.score} />
                <StatusBadge status={postureStatus} />
                <p className="text-xs text-muted-foreground tabular-nums">
                  pitch {reading.pitch}° · roll {reading.roll}°
                </p>
                <Button variant="outline" className="w-full" onClick={calibrate}>
                  Calibrate (sit straight, then tap)
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Connect your phone</CardTitle>
                <CardDescription>Scan with the phone camera, or open /demo?join=CODE on it.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3">
                {joinUrl ? (
                  <div className="rounded-lg bg-white p-3">
                    <QRCodeSVG value={joinUrl} size={180} />
                  </div>
                ) : (
                  <div className="size-[204px] animate-pulse rounded-lg bg-muted" />
                )}
                <p className="font-mono text-2xl tracking-widest">{code ?? "······"}</p>
                {status === "error" && (
                  <p className="text-sm text-destructive">Couldn&apos;t reach the pairing server. Reload to retry.</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
