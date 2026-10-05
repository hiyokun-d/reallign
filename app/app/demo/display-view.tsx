"use client";

// Laptop side of /demo: pairs with a phone, then shows either the
// Tilt Racer game or the posture sphere. The ESP32 tab talks to the real
// sensor over Bluetooth instead.

import { motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import { leanAngles, scoreFromAngles, TONE_COLORS, toneFromScore } from "./math";
import { OrientationScene } from "./orientation-scene";
import { RaceGame, type Controls } from "./race-game";
import { Esp32View } from "./esp32-view";
import { DemoButton, Panel, Pill, cx } from "./ui";
import { useEsp32 } from "./use-esp32";
import { usePhoneLink } from "./use-phone-link";

type Mode = "race" | "posture" | "esp32";
const MODE_LABELS: Record<Mode, string> = { race: "Race", posture: "Posture", esp32: "ESP32" };

const FULL_TILT_DEG = 25;
// The ESP32 only measures forward/back pitch, so the neck steers and the back
// sets speed. Smaller range than the phone: heads don't tilt that far.
const SENSOR_STEER_DEG = 20;
const SENSOR_THROTTLE_DEG = 20;
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
const deadzone = (v: number) => (Math.abs(v) < 0.06 ? 0 : v);

export function DisplayView() {
  const link = usePhoneLink();
  // Lives here (not in Esp32View) so the BLE link survives tab switches.
  const ble = useEsp32();
  const { relative, hasData, calibrate } = link;
  const { latestRef: sensorRef } = ble;
  const [mode, setMode] = useState<Mode>("race");
  const [invert, setInvert] = useState(false);
  const [invertSpeed, setInvertSpeed] = useState(false);
  const connected = link.status === "connected";
  const sensorOn = ble.status === "connected";
  const input = sensorOn ? "ESP32" : connected ? "Phone" : "Keyboard";

  // Sensor pose at the start of a run counts as "neutral", so no CAL is needed.
  const sensorZero = useRef({ back: 0, neck: 0 });
  // The sensor only sends 5 samples/s; ease toward each one so the car doesn't step.
  const sensorSmooth = useRef({ steer: 0, throttle: 0, t: 0 });
  const zeroSensor = useCallback(() => {
    const s = sensorRef.current;
    if (s) sensorZero.current = { back: s.back, neck: s.neck };
  }, [sensorRef]);
  const zeroAll = useCallback(() => {
    calibrate();
    zeroSensor();
  }, [calibrate, zeroSensor]);

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
    const sample = sensorOn ? sensorRef.current : null;
    if (sample) {
      const neck = sample.neck - sensorZero.current.neck;
      const back = sample.back - sensorZero.current.back;
      const steer = deadzone(clamp1(neck / SENSOR_STEER_DEG)) * (invert ? -1 : 1);
      const throttle = deadzone(clamp1(back / SENSOR_THROTTLE_DEG)) * (invertSpeed ? -1 : 1);
      const sm = sensorSmooth.current;
      const now = performance.now();
      const k = 1 - Math.exp(-Math.min(now - sm.t, 100) / 120);
      sm.t = now;
      sm.steer += (steer - sm.steer) * k;
      sm.throttle += (throttle - sm.throttle) * k;
      return { steer: sm.steer, throttle: sm.throttle };
    }
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
  }, [sensorOn, sensorRef, hasData, relative, invert, invertSpeed]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Lab</h1>
        <div className="flex rounded-lg border p-0.5">
          {(["race", "posture", "esp32"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cx(
                "relative rounded-md px-3 py-1 text-sm",
                mode === m ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {mode === m && (
                <motion.span layoutId="demo-mode" className="absolute inset-0 -z-10 rounded-md bg-muted" />
              )}
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        {mode === "esp32" ? (
          <Pill on={ble.status === "connected"}>
            {ble.status === "connected" ? "sensor connected" : ble.status}
          </Pill>
        ) : (
          <Pill on={connected}>{connected ? "phone connected" : link.status}</Pill>
        )}
      </div>

      {mode === "esp32" ? (
        <Esp32View ble={ble} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
          <div className="h-[520px]">
            {mode === "race" ? (
              <RaceGame getControls={getControls} inputLabel={input} onStart={zeroAll} />
            ) : (
              <div className="h-full rounded-xl border bg-card">
                <OrientationSphere link={link} />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {connected || (sensorOn && mode === "race") ? (
              <Panel className="flex flex-col gap-2">
                {mode === "race" && (
                  <p className="text-xs text-muted-foreground">
                    Controller: <span className="font-medium text-foreground">{input}</span>
                  </p>
                )}
                <DemoButton variant="outline" onClick={zeroAll}>
                  Calibrate (hold still, tap)
                </DemoButton>
                {mode === "race" && (
                  <DemoButton variant="outline" onClick={() => setInvert((v) => !v)}>
                    Steering: {invert ? "inverted" : "normal"}
                  </DemoButton>
                )}
                {mode === "race" && sensorOn && (
                  <DemoButton variant="outline" onClick={() => setInvertSpeed((v) => !v)}>
                    Speed: {invertSpeed ? "inverted" : "normal"}
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
                {mode === "race" && (
                  <p className="text-xs text-muted-foreground">
                    Or connect the posture sensor in the{" "}
                    <button className="underline hover:text-foreground" onClick={() => setMode("esp32")}>
                      ESP32 tab
                    </button>{" "}
                    and drive with your body.
                  </p>
                )}
                {link.status === "error" && (
                  <p className="text-sm text-destructive">Couldn&apos;t reach the pairing server. Reload to retry.</p>
                )}
              </Panel>
            )}
          </div>
        </div>
      )}
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
