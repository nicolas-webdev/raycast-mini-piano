import { ChildProcess, execFile, spawn } from "child_process";
import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { environment, showToast, Toast } from "@raycast/api";
import { playNote, Sound } from "./synth";

const execFileAsync = promisify(execFile);

// Bump when assets/helper.swift changes so the binary is rebuilt.
const HELPER_VERSION = 1;
const HELPER_SOURCE = join(environment.assetsPath, "helper.swift");
const HELPER_BINARY = join(environment.supportPath, `helper-v${HELPER_VERSION}`);

const LOG_PATH = join(environment.supportPath, "engine.log");

const LENGTH_FACTOR: Record<Sound["length"], number> = { short: 0.5, medium: 0.85, long: 1.4 };

export type EngineMode = "starting" | "live" | "afplay";

/**
 * Plays notes through the real-time Swift helper when it can be built and started, otherwise through
 * pre-rendered WAVs and afplay. Only the live engine can hold and release notes.
 */
export class Engine {
  mode: EngineMode = "starting";
  onModeChange?: (mode: EngineMode) => void;
  private child?: ChildProcess;
  /** Incremented by every start() and stop() so a stale start cannot adopt a child after a later stop. */
  private generation = 0;

  /** Appends to engine.log in the support directory; the log restarts with every launch. */
  log(message: string): void {
    try {
      appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}\n`);
    } catch {
      /* logging must never break playing */
    }
  }

  private setMode(mode: EngineMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.log(`mode ${mode}`);
    this.onModeChange?.(mode);
  }

  async start(): Promise<void> {
    const generation = ++this.generation;
    this.setMode("starting");
    try {
      mkdirSync(environment.supportPath, { recursive: true });
      if (existsSync(LOG_PATH) && statSync(LOG_PATH).size > 256_000) writeFileSync(LOG_PATH, "");
      this.log(`start #${generation} pid=${process.pid} node=${process.version} binary=${HELPER_BINARY}`);
      if (!existsSync(HELPER_BINARY)) await this.compile();
      // React (in development) and Raycast can stop and restart the command quickly; only the latest start may spawn.
      if (generation !== this.generation) return;
      await this.spawnHelper(generation);
    } catch (error) {
      if (generation !== this.generation) return;
      this.log(`start failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      this.setMode("afplay");
      await showToast({
        style: Toast.Style.Failure,
        title: "Sustain unavailable, using the basic player",
        message: error instanceof Error ? error.message.split("\n")[0] : String(error),
      });
    }
  }

  stop(): void {
    this.generation++;
    this.log(`stop (helper pid=${this.child?.pid ?? "none"})`);
    const child = this.child;
    this.child = undefined;
    child?.stdin?.end("quit\n");
    child?.kill();
  }

  noteOn(midi: number, sound: Sound): void {
    this.log(`on ${midi} (${this.mode})`);
    if (this.mode === "live" && this.child?.stdin?.writable) {
      this.child.stdin.write(`on ${midi} ${sound.tone} ${LENGTH_FACTOR[sound.length]}\n`);
    } else {
      void playNote(midi, sound);
    }
  }

  noteOff(midi: number): void {
    this.log(`off ${midi}`);
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
      const started = Date.now();
      await execFileAsync("/usr/bin/xcrun", ["swiftc", "-O", "-o", HELPER_BINARY, HELPER_SOURCE], {
        timeout: 180_000,
      });
      this.log(`compiled in ${Date.now() - started} ms`);
      await toast.hide();
    } catch (error) {
      await toast.hide();
      throw error;
    }
  }

  private spawnHelper(generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(HELPER_BINARY, [], { stdio: ["pipe", "pipe", "pipe"] });
      this.child = child;
      this.log(`spawned pid=${child.pid}`);
      child.stderr?.on("data", (chunk: Buffer) => this.log(`helper stderr: ${chunk.toString().trim()}`));
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      child.stdout?.on("data", (chunk: Buffer) => {
        this.log(`helper stdout: ${chunk.toString().trim()}`);
        if (chunk.toString().includes("ready") && generation === this.generation) {
          this.setMode("live");
          settle(resolve);
        }
      });
      child.on("error", (error) => {
        this.log(`spawn error: ${error.message}`);
        settle(() => reject(error));
      });
      child.on("exit", (code, signal) => {
        this.log(`helper pid=${child.pid} exited code=${code} signal=${signal}`);
        if (generation !== this.generation) return;
        this.child = undefined;
        this.setMode("afplay");
        settle(() => reject(new Error(`synth helper exited with code ${code}`)));
      });
      setTimeout(() => settle(() => reject(new Error("synth helper did not start"))), 5000);
    });
  }
}
