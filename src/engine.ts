import { ChildProcess, execFile, spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { environment, showToast, Toast } from "@raycast/api";
import { playNote, Sound } from "./synth";

const execFileAsync = promisify(execFile);

// Bump when assets/helper.swift changes so the binary is rebuilt.
const HELPER_VERSION = 1;
const HELPER_SOURCE = join(environment.assetsPath, "helper.swift");
const HELPER_BINARY = join(environment.supportPath, `helper-v${HELPER_VERSION}`);

const LENGTH_FACTOR: Record<Sound["length"], number> = { short: 0.5, medium: 0.85, long: 1.4 };

export type EngineMode = "starting" | "live" | "afplay";

/**
 * Plays notes through the real-time Swift helper when it can be built and started, otherwise through
 * pre-rendered WAVs and afplay. Only the live engine can hold and release notes.
 */
export class Engine {
  mode: EngineMode = "starting";
  private child?: ChildProcess;
  private stopped = false;

  async start(): Promise<void> {
    try {
      if (!existsSync(HELPER_BINARY)) await this.compile();
      if (this.stopped) return;
      await this.spawnHelper();
    } catch (error) {
      this.mode = "afplay";
      await showToast({
        style: Toast.Style.Failure,
        title: "Sustain unavailable, using the basic player",
        message: error instanceof Error ? error.message.split("\n")[0] : String(error),
      });
    }
  }

  stop(): void {
    this.stopped = true;
    this.child?.stdin?.end("quit\n");
    this.child?.kill();
    this.child = undefined;
  }

  noteOn(midi: number, sound: Sound): void {
    if (this.mode === "live" && this.child?.stdin?.writable) {
      this.child.stdin.write(`on ${midi} ${sound.tone} ${LENGTH_FACTOR[sound.length]}\n`);
    } else {
      void playNote(midi, sound);
    }
  }

  noteOff(midi: number): void {
    if (this.mode === "live" && this.child?.stdin?.writable) {
      this.child.stdin.write(`off ${midi}\n`);
    }
  }

  allOff(): void {
    if (this.mode === "live" && this.child?.stdin?.writable) {
      this.child.stdin.write("alloff\n");
    }
  }

  private async compile(): Promise<void> {
    await execFileAsync("/usr/bin/xcode-select", ["-p"]).catch(() => {
      throw new Error("Xcode Command Line Tools are not installed (xcode-select --install)");
    });
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Building the synth (one time, about 10 seconds)",
    });
    mkdirSync(environment.supportPath, { recursive: true });
    try {
      await execFileAsync("/usr/bin/xcrun", ["swiftc", "-O", "-o", HELPER_BINARY, HELPER_SOURCE], {
        timeout: 180_000,
      });
      await toast.hide();
    } catch (error) {
      await toast.hide();
      throw error;
    }
  }

  private spawnHelper(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(HELPER_BINARY, [], { stdio: ["pipe", "pipe", "ignore"] });
      this.child = child;
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      child.stdout?.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("ready")) {
          this.mode = "live";
          settle(resolve);
        }
      });
      child.on("error", (error) => settle(() => reject(error)));
      child.on("exit", (code) => {
        this.child = undefined;
        if (this.mode === "live") this.mode = "afplay";
        settle(() => reject(new Error(`synth helper exited with code ${code}`)));
      });
      setTimeout(() => settle(() => reject(new Error("synth helper did not start"))), 5000);
    });
  }
}
