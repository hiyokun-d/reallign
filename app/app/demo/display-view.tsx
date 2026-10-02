"use client";

// Laptop side of /demo: pairs with a phone, then shows either the
// Tilt Racer game or the posture sphere.

import { motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import { leanAngles, scoreFromAngles, TONE_COLORS, toneFromScore } from "./math";
import { OrientationScene } from "./orientation-scene";
import { RaceGame, type Controls } from "./race-game";
import { DemoButton, Panel, Pill, cx } from "./ui";
import { usePhoneLink } from "./use-phone-link";

type Mode = "race" | "posture";

const FULL_TILT_DEG = 25;
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
const deadzone = (v: number) => (Math.abs(v) < 0.06 ? 0 : v);

export function DisplayView() {
  const link = usePhoneLink();
  const { relative, hasData, calibrate } = link;
  const [mode, setMode] = useState<Mode>("race");
  const [invert, setInvert] = useState(false);
  const connected = link.status === "connected";

  // Keyboard fallback (arrow keys / WASD).
  const keys = useRef(new Set<string>());
  useEffect(() => {
    const down = (e: KeyboardEvent) => keys.current.add(e.code);
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const getControls = useCallback((): Controls => {
    if (hasData()) {
      const { pitch, roll } = leanAngles(relative.current);
      // roll + = top of phone tilted left; pitch + = top tilted toward you.
      const steer = deadzone(clamp1(-roll / FULL_TILT_DEG)) * (invert ? -1 : 1);
      const throttle = deadzone(clamp1(-pitch / FULL_TILT_DEG));
      return { steer, throttle };
    }
    const k = keys.current;
    const pressed = (...codes: string[]) => codes.some((c) => k.has(c));
    return {
      steer: (pressed("ArrowRight", "KeyD") ? 1 : 0) - (pressed("ArrowLeft", "KeyA") ? 1 : 0),
      throttle: (pressed("ArrowUp", "KeyW") ? 1 : 0) - (pressed("ArrowDown", "KeyS") ? 1 : 0),
    };
  }, [hasData, relative, invert]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Lab</h1>
        <div className="flex rounded-lg border p-0.5">
          {(["race", "posture"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cx(
                "relative rounded-md px-3 py-1 text-sm capitalize",
                mode === m ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {mode === m && (
                <motion.span layoutId="demo-mode" className="absolute inset-0 -z-10 rounded-md bg-muted" />
              )}
              {m}
            </button>
          ))}
        </div>
        <Pill on={connected}>{connected ? "phone connected" : link.status}</Pill>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div className="h-[520px]">
          {mode === "race" ? (
            <RaceGame
              getControls={getControls}
              inputLabel={connected ? "Phone" : "Keyboard"}
              onStart={calibrate}
            />
          ) : (
            <div className="h-full rounded-xl border bg-card">
              <OrientationSphere link={link} />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {connected ? (
            <Panel className="flex flex-col gap-2">
              <DemoButton variant="outline" onClick={calibrate}>
                Calibrate (hold still, tap)
              </DemoButton>
              {mode === "race" && (
                <DemoButton variant="outline" onClick={() => setInvert((v) => !v)}>
                  Steering: {invert ? "inverted" : "normal"}
                </DemoButton>
              )}
            </Panel>
          ) : (
            <Panel className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm font-medium">Use your phone as the controller</p>
              {link.joinUrl ? (
                <div className="rounded-lg bg-white p-3">
                  <QRCodeSVG value={link.joinUrl} size={168} />
                </div>
              ) : (
                <div className="size-[192px] animate-pulse rounded-lg bg-muted" />
              )}
              <p className="font-mono text-2xl tracking-widest">{link.code ?? "······"}</p>
              <p className="text-xs text-muted-foreground">Scan, or open /demo?join=CODE on the phone.</p>
              {link.status === "error" && (
                <p className="text-sm text-destructive">Couldn&apos;t reach the pairing server. Reload to retry.</p>
              )}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function OrientationSphere({ link }: { link: ReturnType<typeof usePhoneLink> }) {
  const { relative, hasData } = link;
  const [reading, setReading] = useState({ pitch: 0, roll: 0, score: 100 });

  useEffect(() => {
    const id = setInterval(() => {
      if (!hasData()) return;
      const { pitch, roll } = leanAngles(relative.current);
      setReading({ pitch: Math.round(pitch), roll: Math.round(roll), score: scoreFromAngles(pitch, roll) });
    }, 100);
    return () => clearInterval(id);
  }, [hasData, relative]);

  const tone = toneFromScore(reading.score);

  return (
    <div className="relative h-full">
      <OrientationScene target={relative} tone={tone} />
      <div className="pointer-events-none absolute left-4 top-4 font-mono">
        <div className="text-4xl font-bold tabular-nums" style={{ color: TONE_COLORS[tone] }}>
          {reading.score}
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          pitch {reading.pitch}° · roll {reading.roll}°
        </div>
      </div>
    </div>
  );
}
