// /demo — phone-as-sensor demo.
// Open /demo on a laptop → it shows a QR code. Scan it with a phone → the
// phone opens /demo?join=CODE and streams its orientation to the laptop,
// which renders it in 3D and scores the "posture". Stands in for the ESP32
// until the hardware is ready.

import { DisplayView } from "@/app/demo/display-view";
import { SensorView } from "@/app/demo/sensor-view";

export default async function DemoPage({ searchParams }: PageProps<"/demo">) {
  const { join } = await searchParams;
  const code = typeof join === "string" ? join.toUpperCase() : null;

  return code ? <SensorView code={code} /> : <DisplayView />;
}
