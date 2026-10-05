"use client";

// Main side of /demo. Every game reads the same "body" input: how far the
// player leans forward and right, from the ESP32 posture sensor, a paired
// phone, or the keyboard (in that order). The ESP32 tab manages the sensor.
//
// On a phone (coarse pointer) the demo is ESP32-only: the phone talks to the
// sensor over Bluetooth itself, so there's no QR pairing or keyboard.

import { motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Quaternion } from "three";
import { leanAngles, scoreFromAngles, tilt, tiltQuaternion, TONE_COLORS, toneFromScore } from "./math";
import { OrientationScene } from "./orientation-scene";
import { RaceGame } from "./race-game";
import { LighthouseGame } from "./lighthouse-game";
import { SteadyGame } from "./steady-game";
import { Esp32View } from "./esp32-view";
import { DemoButton, Panel, Pill, cx } from "./ui";
import { NO_BLUETOOTH, useEsp32, type Esp32Sample } from "./use-esp32";
import { usePhoneLink } from "./use-phone-link";

type Mode = "race" | "steady" | "lighthouse" | "posture" | "esp32";
const MODES: Mode[] = ["race", "steady", "lighthouse", "posture", "esp32"];
const MOBILE_MODES: Mode[] = ["esp32", "race", "steady", "lighthouse", "posture"];
const MODE_LABELS: Record<Mode, string> = {
  race: "Race",
  steady: "Steady",
  lighthouse: "Lighthouse",
  posture: "Posture",
  esp32: "ESP32",
};

export type InputSource = "ESP32" | "Phone" | "Keyboard";

/**
 * What every game reads each frame. fwd/right are the player's lean,
 * normalised so 1 = the posture threshold (sensor) or 25° (phone).
 * Values past ±1 mean the player is leaning further than is healthy.
 */
export type Body = {
  /** Back sensor */
  fwd: number;
  right: number;
  /** Neck sensor (phone / keyboard: same as fwd/right) */
  neckFwd: number;
  neckRight: number;
  /** Tilted past the threshold for longer than the device's delay. */
  slouching: boolean;
};

const PHONE_FULL_TILT_DEG = 25;
const KEYBOARD_LEAN = 0.8;
const clamp = (v: number, max = 1.5) => Math.max(-max, Math.min(max, v));
const deadzone = (v: number) => (Math.abs(v) < 0.06 ? 0 : v);

const COARSE = "(pointer: coarse)";
function subscribeCoarse(onChange: () => void) {
  const mq = window.matchMedia(COARSE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
/** True on touch-first devices (phones, tablets). */
function useIsMobile() {
  return useSyncExternalStore(subscribeCoarse, () => window.matchMedia(COARSE).matches, () => false);
}

export function DisplayView() {
  const isMobile = useIsMobile();
  const link = usePhoneLink(!isMobile);
  // Lives here (not in Esp32View) so the BLE link survives tab switches.
  const ble = useEsp32();
  const { relative, hasData, calibrate } = link;
  const { latestRef: sensorRef, send } = ble;
  const { threshold, durationMs, alertEnabled } = ble.settings;
  const [chosenMode, setMode] = useState<Mode | null>(null);
  // Phones start on the ESP32 tab: nothing works until the sensor is connected.
  const mode = chosenMode ?? (isMobile ? "esp32" : "race");
  const [invert, setInvert] = useState(false);
  const connected = link.status === "connected";
  const sensorOn = ble.status === "connected";
  const input: InputSource = sensorOn ? "ESP32" : connected ? "Phone" : "Keyboard";
  const needsSensor = isMobile && !sensorOn;

  // Sensor pose at the start of a run counts as "neutral" for steering.
  const sensorZero = useRef({ back: 0, backRoll: 0, neck: 0, neckRoll: 0 });
  // Ease between sensor samples (20/s) so motion is smooth at 60fps.
  const smooth = useRef({ fwd: 0, right: 0, neckFwd: 0, neckRight: 0, t: 0 });
  // When the current over-threshold run began (firmware rule, raw angles).
  const overSince = useRef<number | null>(null);

  const zeroAll = useCallback(() => {
    calibrate();
    const s = sensorRef.current;
    if (s) sensorZero.current = { back: s.back, backRoll: s.backRoll, neck: s.neck, neckRoll: s.neckRoll };
    smooth.current = { fwd: 0, right: 0, neckFwd: 0, neckRight: 0, t: 0 };
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
      const z = sensorZero.current;
      const raw = {
        fwd: clamp((sample.back - z.back) / threshold),
        right: clamp((sample.backRoll - z.backRoll) / threshold),
        neckFwd: clamp((sample.neck - z.neck) / threshold),
        neckRight: clamp((sample.neckRoll - z.neckRoll) / threshold),
      };
      const sm = smooth.current;
      const now = performance.now();
      const k = 1 - Math.exp(-Math.min(now - sm.t, 100) / 60);
      sm.t = now;
      for (const key of ["fwd", "right", "neckFwd", "neckRight"] as const) sm[key] += (raw[key] - sm[key]) * k;
      return { fwd: sm.fwd, right: sm.right, neckFwd: sm.neckFwd, neckRight: sm.neckRight, slouching: slouchingNow(sample) };
    }
    if (hasData()) {
      // Phone held upright: roll + = top tilted left; pitch + = top tilted toward you.
      const { pitch, roll } = leanAngles(relative.current);
      const fwd = clamp(-pitch / PHONE_FULL_TILT_DEG);
      const right = clamp(-roll / PHONE_FULL_TILT_DEG);
      return { fwd, right, neckFwd: fwd, neckRight: right, slouching: false };
    }
    const k = keys.current;
    const pressed = (...codes: string[]) => (codes.some((c) => k.has(c)) ? KEYBOARD_LEAN : 0);
    const fwd = pressed("ArrowUp", "KeyW") - pressed("ArrowDown", "KeyS");
    const right = pressed("ArrowRight", "KeyD") - pressed("ArrowLeft", "KeyA");
    return { fwd, right, neckFwd: fwd, neckRight: right, slouching: false };
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

  const isGame = mode === "race" || mode === "steady" || mode === "lighthouse";
  const { zero, dir, rdir } = ble.settings;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Lab</h1>
        <div className="flex max-w-full overflow-x-auto rounded-lg border p-0.5 max-sm:order-last max-sm:w-full">
          {(isMobile ? MOBILE_MODES : MODES).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cx(
                "relative shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm",
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
        {mode === "esp32" || sensorOn || isMobile ? (
          <Pill on={sensorOn}>{sensorOn ? "sensor connected" : ble.status}</Pill>
        ) : (
          <Pill on={connected}>{connected ? "phone connected" : link.status}</Pill>
        )}
      </div>

      {mode === "esp32" ? (
        <Esp32View ble={ble} />
      ) : needsSensor ? (
        <SensorPrompt ble={ble} onOpenSetup={() => setMode("esp32")} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
          {/* Square on phones (portrait), fixed height on bigger screens. */}
          <div className="aspect-square max-h-[80svh] w-full sm:aspect-auto sm:h-[min(520px,85svh)]">
            {mode === "race" && (
              <RaceGame getControls={getRaceControls} input={input} onStart={zeroAll} onCrash={buzz} />
            )}
            {mode === "steady" && (
              <SteadyGame getBody={getBody} input={input} onStart={zeroAll} onFall={buzz} />
            )}
            {mode === "lighthouse" && (
              <LighthouseGame
                getBody={getBody}
                input={input}
                setup={
                  sensorOn
                    ? { calibrated: !!zero, forward: !!dir, right: !!rdir, threshold, durationMs, alertEnabled }
                    : null
                }
                onStart={zeroAll}
                onHit={buzz}
                onOpenSetup={() => setMode("esp32")}
              />
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
                <DemoButton variant="outline" className="h-11 sm:h-9" onClick={zeroAll}>
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

/** Phone without a sensor yet: games need the ESP32. */
function SensorPrompt({ ble, onOpenSetup }: { ble: ReturnType<typeof useEsp32>; onOpenSetup: () => void }) {
  return (
    <Panel className="flex flex-col items-center gap-3 py-10 text-center">
      <p className="text-lg font-medium">Connect the posture sensor to play</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        Wear the ESP32 and connect it over Bluetooth. Your back and neck are the controller.
      </p>
      {ble.supported ? (
        <DemoButton className="h-12 px-6 text-base" onClick={ble.connect} disabled={ble.status === "connecting"}>
          {ble.status === "connecting" ? "Connecting…" : "Connect via Bluetooth"}
        </DemoButton>
      ) : (
        <p className="max-w-xs text-sm text-destructive">{NO_BLUETOOTH}</p>
      )}
      <button className="text-xs text-muted-foreground underline" onClick={onOpenSetup}>
        Open sensor setup
      </button>
    </Panel>
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
