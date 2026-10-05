"use client";

// ESP32 tab of /demo: live back + neck angles from the two MPU6050s over BLE,
// plus the firmware's commands (calibrate, threshold, duration, vibration).

import { useEffect, useRef, useState } from "react";
import { TONE_COLORS, type Tone } from "./math";
import { DemoButton, Panel, cx } from "./ui";
import type { Esp32Link, Esp32Sample } from "./use-esp32";

const BACK_COLOR = "#3b82f6";
const NECK_COLOR = "#a855f7";

function toneFor(angle: number, threshold: number): Tone {
  const a = Math.abs(angle);
  if (a > threshold) return "bad";
  if (a > threshold * 0.6) return "warning";
  return "good";
}

/** How long (ms) the latest run of over-threshold samples has lasted. */
function slouchMs(history: Esp32Sample[], threshold: number) {
  const over = (s: Esp32Sample) => Math.abs(s.back) > threshold || Math.abs(s.neck) > threshold;
  let i = history.length - 1;
  if (i < 0 || !over(history[i])) return 0;
  while (i > 0 && over(history[i - 1])) i--;
  return history.at(-1)!.t - history[i].t;
}

export function Esp32View({ ble }: { ble: Esp32Link }) {
  const connected = ble.status === "connected";

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
      <div className="flex min-h-[520px] flex-col gap-4">
        {connected ? <LivePanel ble={ble} /> : <ConnectPanel ble={ble} />}
      </div>
      <div className="flex flex-col gap-4">
        {connected && <Controls ble={ble} />}
        <LogPanel ble={ble} />
      </div>
    </div>
  );
}

function ConnectPanel({ ble }: { ble: Esp32Link }) {
  return (
    <Panel className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <p className="text-lg font-medium">Connect the posture sensor</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Power on the ESP32, then pick <span className="font-mono">PostureMonitor</span> from the browser&apos;s
        Bluetooth list. Sit upright: it calibrates for 5 seconds after boot.
      </p>
      {ble.supported ? (
        <DemoButton className="h-11 px-6" onClick={ble.connect} disabled={ble.status === "connecting"}>
          {ble.status === "connecting" ? "Connecting…" : "Connect via Bluetooth"}
        </DemoButton>
      ) : (
        <p className="max-w-sm text-sm text-destructive">
          This browser has no Web Bluetooth. Use Chrome or Edge on desktop or Android, over https or localhost.
        </p>
      )}
      {ble.error && <p className="text-sm text-destructive">{ble.error}</p>}
    </Panel>
  );
}

function LivePanel({ ble }: { ble: Esp32Link }) {
  const { latest, history, settings, calibrating } = ble;
  const threshold = settings.threshold;
  const slouch = slouchMs(history, threshold);

  let headline = "Upright";
  let headlineTone: Tone = "good";
  if (calibrating) {
    headline = "Calibrating… sit upright";
    headlineTone = "warning";
  } else if (!latest) {
    headline = "Waiting for data…";
    headlineTone = "warning";
  } else if (latest.motor) {
    headline = "Slouching, buzzing";
    headlineTone = "bad";
  } else if (slouch > 0) {
    headline = `Slouching ${(slouch / 1000).toFixed(1)}s`;
    headlineTone = "warning";
  }

  return (
    <>
      <Panel className="grid gap-4 sm:grid-cols-[200px_1fr]">
        <Figure back={latest?.back ?? 0} neck={latest?.neck ?? 0} threshold={threshold} />
        <div className="flex flex-col justify-center gap-4">
          <div className="text-2xl font-semibold" style={{ color: TONE_COLORS[headlineTone] }}>
            {headline}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Reading label="Back" color={BACK_COLOR} value={latest?.back} threshold={threshold} />
            <Reading label="Neck" color={NECK_COLOR} value={latest?.neck} threshold={threshold} />
          </div>
          <p className="text-xs text-muted-foreground">
            Buzzes after {(settings.durationMs / 1000).toFixed(1)}s past ±{threshold}°
            {settings.alertEnabled ? "" : " (vibration off)"}
          </p>
        </div>
      </Panel>
      <Panel className="flex flex-1 flex-col gap-2">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>Last 30 s</span>
          <Legend color={BACK_COLOR} label="back" />
          <Legend color={NECK_COLOR} label="neck" />
          <span className="ml-auto">dashed = ±{threshold}°</span>
        </div>
        <Chart history={history} threshold={threshold} />
      </Panel>
    </>
  );
}

function Reading({
  label,
  color,
  value,
  threshold,
}: {
  label: string;
  color: string;
  value: number | undefined;
  threshold: number;
}) {
  const tone = value === undefined ? null : toneFor(value, threshold);
  return (
    <div className="rounded-lg bg-muted p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-2 rounded-full" style={{ background: color }} />
        {label}
      </div>
      <div
        className="font-mono text-3xl font-bold tabular-nums"
        style={{ color: tone ? TONE_COLORS[tone] : undefined }}
      >
        {value === undefined ? "–" : `${value.toFixed(1)}°`}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-0.5 w-3 rounded" style={{ background: color }} />
      {label}
    </span>
  );
}

/**
 * Side view: hips at the bottom, back and neck segments tilted by their angles.
 * Which way is "forward" depends on how the sensors are mounted.
 */
function Figure({ back, neck, threshold }: { back: number; neck: number; threshold: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const hip = { x: 100, y: 190 };
  const shoulder = { x: hip.x + 95 * Math.sin(rad(back)), y: hip.y - 95 * Math.cos(rad(back)) };
  const head = { x: shoulder.x + 40 * Math.sin(rad(neck)), y: shoulder.y - 40 * Math.cos(rad(neck)) };
  const backTone = TONE_COLORS[toneFor(back, threshold)];
  const neckTone = TONE_COLORS[toneFor(neck, threshold)];

  return (
    <svg viewBox="0 0 200 210" className="mx-auto h-52 w-full max-w-[200px]" aria-label="Posture figure">
      <line x1={hip.x} y1={hip.y} x2={hip.x} y2={20} stroke="currentColor" strokeOpacity={0.15} strokeDasharray="4 4" />
      <line x1={40} y1={hip.y} x2={160} y2={hip.y} stroke="currentColor" strokeOpacity={0.25} strokeWidth={2} />
      <line
        x1={hip.x}
        y1={hip.y}
        x2={shoulder.x}
        y2={shoulder.y}
        stroke={backTone}
        strokeWidth={10}
        strokeLinecap="round"
        className="transition-all duration-200"
      />
      <line
        x1={shoulder.x}
        y1={shoulder.y}
        x2={head.x}
        y2={head.y}
        stroke={neckTone}
        strokeWidth={7}
        strokeLinecap="round"
        className="transition-all duration-200"
      />
      <circle
        cx={head.x + 16 * Math.sin(rad(neck))}
        cy={head.y - 16 * Math.cos(rad(neck))}
        r={16}
        fill={neckTone}
        className="transition-all duration-200"
      />
    </svg>
  );
}

function Chart({ history, threshold }: { history: Esp32Sample[]; threshold: number }) {
  const W = 600;
  const H = 180;
  const range = Math.max(45, threshold * 1.5);
  const y = (deg: number) => H / 2 - (Math.max(-range, Math.min(range, deg)) / range) * (H / 2 - 4);
  const x = (i: number) => (i / 149) * W;
  const offset = 150 - history.length; // fill from the right
  const points = (key: "back" | "neck") => history.map((s, i) => `${x(i + offset)},${y(s[key])}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full min-h-40 w-full">
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity={0.15} />
      {[threshold, -threshold].map((t) => (
        <line
          key={t}
          x1={0}
          x2={W}
          y1={y(t)}
          y2={y(t)}
          stroke={TONE_COLORS.bad}
          strokeOpacity={0.5}
          strokeDasharray="6 6"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <polyline points={points("back")} fill="none" stroke={BACK_COLOR} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <polyline points={points("neck")} fill="none" stroke={NECK_COLOR} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Controls({ ble }: { ble: Esp32Link }) {
  const { settings, send, calibrating } = ble;

  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{ble.deviceName}</span>
        <button className="text-xs text-muted-foreground hover:text-foreground" onClick={ble.disconnect}>
          Disconnect
        </button>
      </div>
      <DemoButton variant="outline" onClick={() => send("CAL")} disabled={calibrating}>
        {calibrating ? "Calibrating (5 s)…" : "Calibrate (sit upright)"}
      </DemoButton>
      <NumberSetting
        label="Threshold (°)"
        value={settings.threshold}
        min={1}
        max={89}
        onSet={(v) => send(`T=${v}`)}
      />
      <NumberSetting
        label="Delay (ms)"
        value={settings.durationMs}
        min={0}
        max={60000}
        step={500}
        onSet={(v) => send(`D=${v}`)}
      />
      <div className="grid grid-cols-2 gap-2">
        <DemoButton variant="outline" onClick={() => send(settings.alertEnabled ? "OFF" : "ON")}>
          Vibration {settings.alertEnabled ? "on" : "off"}
        </DemoButton>
        <DemoButton variant="outline" onClick={() => send("BUZZ")}>
          Test buzz
        </DemoButton>
      </div>
    </Panel>
  );
}

function NumberSetting({
  label,
  value,
  min,
  max,
  step = 1,
  onSet,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onSet: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  // Follow the device's value when it changes (e.g. after a STATUS reply).
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(String(value));
  }
  const parsed = Number(draft);
  const valid = draft !== "" && parsed >= min && parsed <= max;

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSet(parsed);
      }}
    >
      <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
        {label}
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-9 rounded-lg border bg-background px-2 font-mono text-sm text-foreground"
        />
      </label>
      <DemoButton type="submit" variant="outline" disabled={!valid || parsed === value}>
        Set
      </DemoButton>
    </form>
  );
}

function LogPanel({ ble }: { ble: Esp32Link }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [ble.log]);

  return (
    <Panel className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">Device log</span>
      <div ref={scroller} className="h-56 overflow-y-auto rounded-md bg-muted p-2 font-mono text-xs">
        {ble.log.length === 0 ? (
          <span className="text-muted-foreground">Nothing yet.</span>
        ) : (
          ble.log.map((l) => (
            <div
              key={l.id}
              className={cx(
                "break-words",
                l.text.startsWith(">") && "text-muted-foreground",
                (l.text.startsWith("!") || l.text.startsWith("ERR") || l.text.startsWith("PERINGATAN")) &&
                  "text-destructive"
              )}
            >
              {l.text}
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
