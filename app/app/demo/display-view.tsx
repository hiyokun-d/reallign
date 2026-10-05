"use client";

// Laptop side of /demo. Every game reads the same "body" input: how far the
// player leans forward and right, from the ESP32 posture sensor, a paired
// phone, or the keyboard (in that order). The ESP32 tab manages the sensor.

import { motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Quaternion } from "three";
import { leanAngles, scoreFromAngles, tilt, tiltQuaternion, TONE_COLORS, toneFromScore } from "./math";
import { OrientationScene } from "./orientation-scene";
import { RaceGame } from "./race-game";
import { SteadyGame } from "./steady-game";
import { Esp32View } from "./esp32-view";
import { DemoButton, Panel, Pill, cx } from "./ui";
import { useEsp32, type Esp32Sample } from "./use-esp32";
import { usePhoneLink } from "./use-phone-link";

type Mode = "race" | "steady" | "posture" | "esp32";
const MODES: Mode[] = ["race", "steady", "posture", "esp32"];
const MODE_LABELS: Record<Mode, string> = { race: "Race", steady: "Steady", posture: "Posture", esp32: "ESP32" };

export type InputSource = "ESP32" | "Phone" | "Keyboard";

/**
 * What every game reads each frame. fwd/right are the player's lean,
 * normalised so 1 = the posture threshold (sensor) or 25° (phone).
 * Values past ±1 mean the player is leaning further than is healthy.
 */
export type Body = {
  fwd: number;
  right: number;
  /** Tilted past the threshold for longer than the device's delay. */
  slouching: boolean;
};

const PHONE_FULL_TILT_DEG = 25;
const KEYBOARD_LEAN = 0.8;
const clamp = (v: number, max = 1.5) => Math.max(-max, Math.min(max, v));
const deadzone = (v: number) => (Math.abs(v) < 0.06 ? 0 : v);

export function DisplayView() {
  const link = usePhoneLink();
  // Lives here (not in Esp32View) so the BLE link survives tab switches.
  const ble = useEsp32();
  const { relative, hasData, calibrate } = link;
  const { latestRef: sensorRef, send } = ble;
  const { threshold, durationMs, alertEnabled } = ble.settings;
  const [mode, setMode] = useState<Mode>("race");
  const [invert, setInvert] = useState(false);
  const connected = link.status === "connected";
  const sensorOn = ble.status === "connected";
  const input: InputSource = sensorOn ? "ESP32" : connected ? "Phone" : "Keyboard";

  // Sensor pose at the start of a run counts as "neutral" for steering.
  const sensorZero = useRef({ back: 0, backRoll: 0 });
  // Ease between sensor samples (20/s) so motion is smooth at 60fps.
  const smooth = useRef({ fwd: 0, right: 0, t: 0 });
  // When the current over-threshold run began (firmware rule, raw angles).
  const overSince = useRef<number | null>(null);

  const zeroAll = useCallback(() => {
    calibrate();
    const s = sensorRef.current;
    if (s) sensorZero.current = { back: s.back, backRoll: s.backRoll };
    smooth.current = { fwd: 0, right: 0, t: 0 };
  }, [calibrate, sensorRef]);

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

  const slouchingNow = useCallback(
    (s: Esp32Sample) => {
      const over = tilt(s.back, s.backRoll) > threshold || tilt(s.neck, s.neckRoll) > threshold;
      if (!over) overSince.current = null;
      else overSince.current ??= s.t;
      return s.motor || (overSince.current !== null && s.t - overSince.current > durationMs);
    },
    [threshold, durationMs]
  );

  const getBody = useCallback((): Body => {
    const sample = sensorOn ? sensorRef.current : null;
    if (sample) {
      const fwd = clamp((sample.back - sensorZero.current.back) / threshold);
      const right = clamp((sample.backRoll - sensorZero.current.backRoll) / threshold);
      const sm = smooth.current;
      const now = performance.now();
      const k = 1 - Math.exp(-Math.min(now - sm.t, 100) / 60);
      sm.t = now;
      sm.fwd += (fwd - sm.fwd) * k;
      sm.right += (right - sm.right) * k;
      return { fwd: sm.fwd, right: sm.right, slouching: slouchingNow(sample) };
    }
    if (hasData()) {
      // Phone held upright: roll + = top tilted left; pitch + = top tilted toward you.
      const { pitch, roll } = leanAngles(relative.current);
      return { fwd: clamp(-pitch / PHONE_FULL_TILT_DEG), right: clamp(-roll / PHONE_FULL_TILT_DEG), slouching: false };
    }
    const k = keys.current;
    const pressed = (...codes: string[]) => (codes.some((c) => k.has(c)) ? KEYBOARD_LEAN : 0);
    return {
      fwd: pressed("ArrowUp", "KeyW") - pressed("ArrowDown", "KeyS"),
      right: pressed("ArrowRight", "KeyD") - pressed("ArrowLeft", "KeyA"),
      slouching: false,
    };
  }, [sensorOn, sensorRef, threshold, slouchingNow, hasData, relative]);

  const getRaceControls = useCallback(() => {
    const b = getBody();
    return {
      steer: deadzone(Math.max(-1, Math.min(1, b.right))) * (invert ? -1 : 1),
      throttle: deadzone(Math.max(-1, Math.min(1, b.fwd))),
      slouching: b.slouching,
    };
  }, [getBody, invert]);

  /** Haptic feedback on crash/fall, if the player allows vibration. */
  const buzz = useCallback(() => {
    if (sensorOn && alertEnabled) send("BUZZ");
  }, [sensorOn, alertEnabled, send]);

  const isGame = mode === "race" || mode === "steady";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Lab</h1>
        <div className="flex rounded-lg border p-0.5">
          {MODES.map((m) => (
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
        {mode === "esp32" || sensorOn ? (
          <Pill on={sensorOn}>{sensorOn ? "sensor connected" : ble.status}</Pill>
        ) : (
          <Pill on={connected}>{connected ? "phone connected" : link.status}</Pill>
        )}
      </div>

      {mode === "esp32" ? (
        <Esp32View ble={ble} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
          <div className="h-[520px]">
            {mode === "race" && (
              <RaceGame getControls={getRaceControls} input={input} onStart={zeroAll} onCrash={buzz} />
            )}
            {mode === "steady" && (
              <SteadyGame getBody={getBody} input={input} onStart={zeroAll} onFall={buzz} />
            )}
            {mode === "posture" && (
              <div className="h-full rounded-xl border bg-card">
                <OrientationSphere link={link} sensorRef={sensorOn ? sensorRef : null} threshold={threshold} />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {connected || sensorOn ? (
              <Panel className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">
                  Controller: <span className="font-medium text-foreground">{input}</span>
                </p>
                {isGame && sensorOn && (
                  <p className="text-xs text-muted-foreground">
                    Full lean = your {threshold}° threshold. Past it for {(durationMs / 1000).toFixed(1)}s counts as
                    slouching and costs you in-game.
                  </p>
                )}
                <DemoButton variant="outline" onClick={zeroAll}>
                  Re-center (hold still, tap)
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
                <p className="text-xs text-muted-foreground">
                  Or connect the posture sensor in the{" "}
                  <button className="underline hover:text-foreground" onClick={() => setMode("esp32")}>
                    ESP32 tab
                  </button>{" "}
                  and play with your body.
                </p>
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

/** 3D posture view: follows the ESP32 back sensor when connected, else the phone. */
function OrientationSphere({
  link,
  sensorRef,
  threshold,
}: {
  link: ReturnType<typeof usePhoneLink>;
  sensorRef: React.RefObject<Esp32Sample | null> | null;
  threshold: number;
}) {
  const { relative, hasData } = link;
  const target = useRef(new Quaternion());
  const [reading, setReading] = useState({ pitch: 0, roll: 0, score: 100 });

  useEffect(() => {
    let lastUi = 0;
    const id = setInterval(() => {
      const s = sensorRef?.current;
      let pitch: number;
      let roll: number;
      let score: number;
      if (s) {
        pitch = s.back;
        roll = s.backRoll;
        tiltQuaternion(pitch, roll, target.current);
        // Same feel as the phone score, but scaled to the user's own threshold.
        score = Math.max(0, Math.min(100, Math.round(100 - (tilt(pitch, roll) / threshold) * 50)));
      } else if (hasData()) {
        target.current.copy(relative.current);
        ({ pitch, roll } = leanAngles(relative.current));
        score = scoreFromAngles(pitch, roll);
      } else {
        return;
      }
      const now = performance.now();
      if (now - lastUi > 100) {
        lastUi = now;
        setReading({ pitch: Math.round(pitch), roll: Math.round(roll), score });
      }
    }, 33);
    return () => clearInterval(id);
  }, [sensorRef, threshold, hasData, relative]);

  const tone = toneFromScore(reading.score);

  return (
    <div className="relative h-full">
      <OrientationScene target={target} tone={tone} />
      <div className="pointer-events-none absolute left-4 top-4 font-mono">
        <div className="text-4xl font-bold tabular-nums" style={{ color: TONE_COLORS[tone] }}>
          {reading.score}
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {sensorRef ? "fwd" : "pitch"} {reading.pitch}° · {sensorRef ? "right" : "roll"} {reading.roll}°
        </div>
      </div>
    </div>
  );
}
