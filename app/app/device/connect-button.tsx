"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// TODO(backend/IoT): replace with real pairing (Web Bluetooth or cloud).
export function ConnectButton() {
  return (
    <Button onClick={() => toast.info("Pairing isn't wired up yet — dummy data only.")}>
      Connect sensor
    </Button>
  );
}
