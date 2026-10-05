"use client";

// Browser side of the ESP32 link: Web Bluetooth → Nordic UART Service.
// Works in Chrome/Edge on desktop and Android, and in the Bluefy app on iOS
// (Safari has no Web Bluetooth). Only on https or localhost.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ESP32_DEFAULTS,
  ESP32_NAME,
  NUS_RX,
  NUS_SERVICE,
  NUS_TX,
  parseEsp32Line,
  type CalEvent,
  type Esp32Settings,
  type FwdEvent,
} from "./protocol";

// TypeScript's DOM lib has no Web Bluetooth types yet; this is the slice we use.
type BleCharacteristic = EventTarget & {
  value?: DataView;
  startNotifications(): Promise<BleCharacteristic>;
  writeValue(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
};
type BleDevice = EventTarget & {
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<{
      getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<BleCharacteristic> }>;
    }>;
    disconnect(): void;
  };
};
type BluetoothNavigator = Navigator & {
  bluetooth?: {
    requestDevice(options: {
      filters: ({ services: string[] } | { name: string })[];
      optionalServices?: string[];
    }): Promise<BleDevice>;
  };
};

export type BleStatus = "idle" | "connecting" | "connected" | "error";

export const NO_BLUETOOTH =
  "This browser can't use Bluetooth. On a computer or Android, use Chrome or Edge. On iPhone, Safari doesn't support it: open this page in the free Bluefy browser app.";

export type Esp32Sample = {
  /** performance.now() when it arrived */
  t: number;
  /** Back pitch, degrees from calibration */
  back: number;
  /** Neck pitch, degrees from calibration */
  neck: number;
  /** Side lean, + = right (0 with older firmware) */
  backRoll: number;
  neckRoll: number;
  motor: boolean;
};

export type LogLine = { id: number; text: string };

export const HISTORY_SIZE = 600; // ~30 s at the firmware's 20 Hz
const LOG_SIZE = 60;

const noopSubscribe = () => () => {};
const isSupported = () => "bluetooth" in navigator;

export function useEsp32() {
  const supported = useSyncExternalStore(noopSubscribe, isSupported, () => true);
  const [status, setStatus] = useState<BleStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [history, setHistory] = useState<Esp32Sample[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [settings, setSettings] = useState<Esp32Settings>(ESP32_DEFAULTS);
  /** Latest calibration progress; null when none has run this session. */
  const [cal, setCal] = useState<CalEvent | null>(null);
  /** Latest FWD result; null until FWD is sent, "pending" while waiting. */
  const [fwd, setFwd] = useState<FwdEvent | "pending" | null>(null);
  /** Same for RGT. */
  const [rgt, setRgt] = useState<FwdEvent | "pending" | null>(null);

  const deviceRef = useRef<BleDevice | null>(null);
  const rxRef = useRef<BleCharacteristic | null>(null);
  // GATT allows one operation at a time, so writes are chained.
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const logId = useRef(0);
  // Same as history.at(-1), but readable every frame (the race game) without re-renders.
  const latestRef = useRef<Esp32Sample | null>(null);

  const addLog = useCallback((text: string) => {
    const id = ++logId.current;
    setLog((prev) => [...prev.slice(-(LOG_SIZE - 1)), { id, text }]);
  }, []);

  const handleLine = useCallback(
    (line: string) => {
      const parsed = parseEsp32Line(line);
      if (parsed.kind === "sample") {
        const { back, neck, backRoll, neckRoll, motor } = parsed;
        const sample = { t: performance.now(), back, neck, backRoll, neckRoll, motor };
        latestRef.current = sample;
        setHistory((prev) => [...prev.slice(-(HISTORY_SIZE - 1)), sample]);
        return;
      }
      // Older firmware printed this debug line every loop; keep it out of the log.
      if (parsed.text === "Test 1234") return;
      if (parsed.settings) setSettings((prev) => ({ ...prev, ...parsed.settings }));
      if (parsed.cal) {
        setCal(parsed.cal);
        // The firmware stops streaming while it calibrates; don't steer on stale data.
        if (parsed.cal.phase === "wait" || parsed.cal.phase === "hold") latestRef.current = null;
        if (parsed.cal.phase === "ok") setHistory([]);
        // Countdown ticks would flood the log; the UI shows them instead.
        if (parsed.cal.phase === "wait") return;
      }
      if (parsed.fwd) {
        setFwd(parsed.fwd);
        if (parsed.fwd.ok) setHistory([]);
      }
      if (parsed.rgt) {
        setRgt(parsed.rgt);
        if (parsed.rgt.ok) setHistory([]);
      }
      addLog(parsed.text);
    },
    [addLog]
  );

  const send = useCallback(
    (command: string) => {
      const rx = rxRef.current;
      if (!rx) return;
      const bytes = new TextEncoder().encode(command);
      writeQueue.current = writeQueue.current
        .then(() => (rx.writeValueWithoutResponse ? rx.writeValueWithoutResponse(bytes) : rx.writeValue(bytes)))
        .then(() => addLog(`> ${command}`))
        .catch((err: Error) => addLog(`! ${command} failed: ${err.message}`));
      if (command.startsWith("CAL")) setCal({ phase: "wait", seconds: Number(command.split("=")[1] ?? 5) });
      if (command === "FWD") setFwd("pending");
      if (command === "RGT") setRgt("pending");
    },
    [addLog]
  );

  const connect = useCallback(async () => {
    const bluetooth = (navigator as BluetoothNavigator).bluetooth;
    if (!bluetooth) return;
    setError(null);

    let device: BleDevice;
    try {
      device = await bluetooth.requestDevice({
        filters: [{ services: [NUS_SERVICE] }, { name: ESP32_NAME }],
        optionalServices: [NUS_SERVICE],
      });
    } catch {
      return; // user closed the picker
    }

    setStatus("connecting");
    try {
      deviceRef.current = device;
      device.addEventListener("gattserverdisconnected", () => {
        rxRef.current = null;
        latestRef.current = null;
        setCal(null);
        setFwd(null);
        setRgt(null);
        setStatus((s) => (s === "connected" ? "idle" : s));
        addLog("Disconnected");
      });

      const server = await device.gatt!.connect();
      const service = await server.getPrimaryService(NUS_SERVICE);
      const tx = await service.getCharacteristic(NUS_TX);
      rxRef.current = await service.getCharacteristic(NUS_RX);

      // Notifications arrive in 20-byte chunks; rebuild whole lines.
      const decoder = new TextDecoder();
      let buffer = "";
      tx.addEventListener("characteristicvaluechanged", () => {
        if (!tx.value) return;
        buffer += decoder.decode(tx.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) handleLine(trimmed);
        }
      });
      await tx.startNotifications();

      setDeviceName(device.name ?? ESP32_NAME);
      setHistory([]);
      setStatus("connected");
      addLog(`Connected to ${device.name ?? ESP32_NAME}`);
      send("STATUS");
    } catch (err) {
      device.gatt?.disconnect();
      setStatus("error");
      setError(`Couldn't connect: ${(err as Error).message}`);
    }
  }, [addLog, handleLine, send]);

  const disconnect = useCallback(() => {
    deviceRef.current?.gatt?.disconnect();
  }, []);

  useEffect(() => () => deviceRef.current?.gatt?.disconnect(), []);

  // Keep the screen awake while the sensor is connected (phones would
  // otherwise sleep mid-game, and a sleeping page drops the BLE link).
  useEffect(() => {
    if (status !== "connected" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== "visible") return;
      const next = await navigator.wakeLock.request("screen").catch(() => null);
      if (cancelled) next?.release().catch(() => {});
      else lock = next;
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      lock?.release().catch(() => {});
    };
  }, [status]);

  return {
    supported,
    status,
    error,
    deviceName,
    history,
    latest: history.at(-1) ?? null,
    latestRef,
    log,
    settings,
    cal,
    calibrating: cal?.phase === "wait" || cal?.phase === "hold",
    fwd,
    rgt,
    connect,
    disconnect,
    send,
  };
}

export type Esp32Link = ReturnType<typeof useEsp32>;
