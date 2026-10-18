// Real-time synth helper for Mini Piano.
//
// Reads one command per line on stdin and plays through the default output device:
//   on <midi> <piano|sine|organ> <lengthFactor>   start a note (held until "off")
//   off <midi>                                      release a note
//   alloff                                          release every note
//   quit                                            exit
// Prints "ready" once the audio engine is running.
//
// Offline check: `helper --render out.wav` reads the same commands plus `wait <ms>` and writes a WAV instead of playing.

import AVFoundation
import Foundation

let sampleRate = 44100.0
let maxPartials = 8
let maxVoices = 24
let attackTime = 0.0025

enum Tone: String {
  case piano, sine, organ
}

struct Voice {
  var active = false
  var midi = -1
  var held = false
  var sequence = 0
  var partialCount = 0
  var amps = [Double](repeating: 0, count: maxPartials)
  var decayScales = [Double](repeating: 1, count: maxPartials)
  var omegaA = [Double](repeating: 0, count: maxPartials)
  var omegaB = [Double](repeating: 0, count: maxPartials)
  var phaseA = [Double](repeating: 0, count: maxPartials)
  var phaseB = [Double](repeating: 0, count: maxPartials)
  var time = 0.0
  var releaseAt = 0.0
  /// Decay constant once the key is released; matches the plucked-note sound of the offline renderer.
  var ringTime = 1.0
  /// Decay constant while the key is held. 0 means flat (organ).
  var holdTau = 0.0
  var gain = 0.35

  mutating func start(midi: Int, tone: Tone, lengthFactor: Double, sequence: Int) {
    let frequency = 440 * pow(2, Double(midi - 69) / 12)
    let clampedFactor = min(3, max(0.2, lengthFactor))
    let baseRing = min(2, max(0.2, 1.3 * clampedFactor * pow(261.63 / frequency, 0.35)))
    self.midi = midi
    self.sequence = sequence
    active = true
    held = true
    time = 0
    releaseAt = 0
    var detuneCents = 0.5
    switch tone {
    case .sine:
      partialCount = 1
      amps[0] = 1
      decayScales[0] = 1
      omegaA[0] = 2 * .pi * frequency
      ringTime = baseRing
      holdTau = baseRing * 5
      gain = 0.6
      detuneCents = 0
    case .organ:
      let drawbars: [(Double, Double)] = [(1, 1), (2, 0.7), (3, 0.5), (4, 0.4), (6, 0.25), (8, 0.15)]
      partialCount = drawbars.count
      for (i, (ratio, amp)) in drawbars.enumerated() {
        amps[i] = amp
        decayScales[i] = 1
        omegaA[i] = 2 * .pi * frequency * ratio
      }
      ringTime = 0.09
      holdTau = 0
      gain = 0.3
      detuneCents = 1.2
    case .piano:
      partialCount = maxPartials
      let inharmonicity = 0.0003
      for n in 1...maxPartials {
        let i = n - 1
        let ratio = Double(n) * (1 + inharmonicity * Double(n * n)).squareRoot()
        amps[i] = pow(Double(n), -1.35) * (n % 2 == 0 ? 0.85 : 1)
        decayScales[i] = 1 / (1 + 0.45 * Double(n - 1))
        omegaA[i] = 2 * .pi * frequency * ratio
      }
      ringTime = baseRing
      holdTau = baseRing * 4
      gain = 0.35
    }
    let detune = pow(2, detuneCents / 1200)
    for i in 0..<partialCount {
      omegaB[i] = omegaA[i] / detune
      omegaA[i] *= detune
      phaseA[i] = Double(i) * 1.37
      phaseB[i] = 0
    }
    for i in 0..<partialCount where omegaA[i] >= 2 * .pi * sampleRate * 0.45 {
      amps[i] = 0
    }
  }

  func envelope(at t: Double, decayScale: Double) -> Double {
    let attack = 1 - exp(-t / attackTime)
    let heldEnvelope = { (time: Double) -> Double in
      holdTau > 0 ? exp(-time / (holdTau * decayScale)) : 1
    }
    if held || t < releaseAt {
      return attack * heldEnvelope(t)
    }
    return attack * heldEnvelope(releaseAt) * exp(-(t - releaseAt) / (ringTime * decayScale))
  }

  mutating func release() {
    guard active, held else { return }
    held = false
    releaseAt = time
  }

  /// Adds this voice's output for `frameCount` samples into `out`.
  mutating func render(into out: UnsafeMutablePointer<Float>, frameCount: Int) {
    let blockSeconds = Double(frameCount) / sampleRate
    let endTime = time + blockSeconds
    for i in 0..<partialCount where amps[i] > 0 {
      let startEnv = envelope(at: time, decayScale: decayScales[i]) * amps[i] * gain
      let endEnv = envelope(at: endTime, decayScale: decayScales[i]) * amps[i] * gain
      let envStep = (endEnv - startEnv) / Double(frameCount)
      var env = startEnv
      var pa = phaseA[i]
      var pb = phaseB[i]
      let da = omegaA[i] / sampleRate
      let db = omegaB[i] / sampleRate
      for frame in 0..<frameCount {
        out[frame] += Float(env * (sin(pa) + sin(pb)) * 0.5)
        env += envStep
        pa += da
        pb += db
      }
      phaseA[i] = pa.truncatingRemainder(dividingBy: 2 * .pi)
      phaseB[i] = pb.truncatingRemainder(dividingBy: 2 * .pi)
    }
    time = endTime
    if !held && time - releaseAt > ringTime * 9 {
      active = false
    }
  }
}

final class Synth {
  private var voices = [Voice](repeating: Voice(), count: maxVoices)
  private var lock = os_unfair_lock()
  private var sequence = 0

  func noteOn(midi: Int, tone: Tone, lengthFactor: Double) {
    os_unfair_lock_lock(&lock)
    defer { os_unfair_lock_unlock(&lock) }
    sequence += 1
    // Re-triggering a held key releases the old voice so the two decays overlap naturally.
    for i in voices.indices where voices[i].active && voices[i].midi == midi && voices[i].held {
      voices[i].release()
    }
    var slot = voices.firstIndex { !$0.active }
    if slot == nil {
      // Steal the oldest released voice, else the oldest voice.
      let released = voices.indices.filter { !voices[$0].held }
      let pool = released.isEmpty ? Array(voices.indices) : released
      slot = pool.min { voices[$0].sequence < voices[$1].sequence }
    }
    voices[slot!].start(midi: midi, tone: tone, lengthFactor: lengthFactor, sequence: sequence)
  }

  func noteOff(midi: Int) {
    os_unfair_lock_lock(&lock)
    defer { os_unfair_lock_unlock(&lock) }
    for i in voices.indices where voices[i].active && voices[i].midi == midi {
      voices[i].release()
    }
  }

  func allOff() {
    os_unfair_lock_lock(&lock)
    defer { os_unfair_lock_unlock(&lock) }
    for i in voices.indices { voices[i].release() }
  }

  var isSilent: Bool {
    os_unfair_lock_lock(&lock)
    defer { os_unfair_lock_unlock(&lock) }
    return !voices.contains { $0.active }
  }

  func render(into out: UnsafeMutablePointer<Float>, frameCount: Int) {
    for frame in 0..<frameCount { out[frame] = 0 }
    os_unfair_lock_lock(&lock)
    for i in voices.indices where voices[i].active {
      voices[i].render(into: out, frameCount: frameCount)
    }
    os_unfair_lock_unlock(&lock)
    for frame in 0..<frameCount {
      out[frame] = tanh(out[frame] * 1.2) * 0.9
    }
  }

  /// Returns false for commands that end the session.
  @discardableResult
  func handle(_ line: String) -> Bool {
    let parts = line.split(separator: " ")
    guard let command = parts.first else { return true }
    switch command {
    case "on":
      guard parts.count >= 2, let midi = Int(parts[1]) else { return true }
      let tone = parts.count >= 3 ? Tone(rawValue: String(parts[2])) ?? .piano : .piano
      let factor = parts.count >= 4 ? Double(parts[3]) ?? 0.5 : 0.5
      noteOn(midi: midi, tone: tone, lengthFactor: factor)
    case "off":
      if parts.count >= 2, let midi = Int(parts[1]) { noteOff(midi: midi) }
    case "alloff":
      allOff()
    case "quit":
      return false
    default:
      break
    }
    return true
  }
}

func writeWav(_ samples: [Float], to path: String) throws {
  var data = Data()
  func append<T: FixedWidthInteger>(_ value: T) {
    var little = value.littleEndian
    withUnsafeBytes(of: &little) { data.append(contentsOf: $0) }
  }
  let byteCount = UInt32(samples.count * 2)
  data.append(contentsOf: Array("RIFF".utf8)); append(UInt32(36) + byteCount)
  data.append(contentsOf: Array("WAVE".utf8))
  data.append(contentsOf: Array("fmt ".utf8)); append(UInt32(16)); append(UInt16(1)); append(UInt16(1))
  append(UInt32(sampleRate)); append(UInt32(sampleRate) * 2); append(UInt16(2)); append(UInt16(16))
  data.append(contentsOf: Array("data".utf8)); append(byteCount)
  for sample in samples { append(Int16(max(-1, min(1, sample)) * 32767)) }
  try data.write(to: URL(fileURLWithPath: path))
}

func renderOffline(to path: String) throws {
  let synth = Synth()
  var samples = [Float]()
  let block = 256
  var buffer = [Float](repeating: 0, count: block)
  func renderBlocks(_ count: Int) {
    for _ in 0..<count {
      buffer.withUnsafeMutableBufferPointer { synth.render(into: $0.baseAddress!, frameCount: block) }
      samples.append(contentsOf: buffer)
    }
  }
  while let line = readLine() {
    let parts = line.split(separator: " ")
    if parts.first == "wait", parts.count >= 2, let ms = Double(parts[1]) {
      renderBlocks(Int(ms / 1000 * sampleRate / Double(block)))
    } else if !synth.handle(line) {
      break
    }
  }
  var guardBlocks = Int(10 * sampleRate / Double(block))
  while !synth.isSilent && guardBlocks > 0 {
    renderBlocks(1)
    guardBlocks -= 1
  }
  try writeWav(samples, to: path)
}

func runLive() throws {
  let synth = Synth()
  let engine = AVAudioEngine()
  guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1) else {
    throw NSError(domain: "helper", code: 1)
  }
  let source = AVAudioSourceNode(format: format) { _, _, frameCount, audioBufferList -> OSStatus in
    let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
    guard let data = buffers[0].mData else { return noErr }
    synth.render(into: data.assumingMemoryBound(to: Float.self), frameCount: Int(frameCount))
    return noErr
  }
  engine.attach(source)
  engine.connect(source, to: engine.mainMixerNode, format: format)
  if let unit = engine.outputNode.audioUnit {
    // Smaller IO buffer = lower latency; best effort, the default works too.
    var frames: UInt32 = 128
    AudioUnitSetProperty(unit, kAudioDevicePropertyBufferFrameSize, kAudioUnitScope_Global, 0, &frames, UInt32(MemoryLayout<UInt32>.size))
  }
  try engine.start()
  print("ready")
  fflush(stdout)
  while let line = readLine() {
    if !synth.handle(line) { break }
  }
  engine.stop()
}

let arguments = CommandLine.arguments
if arguments.count >= 3, arguments[1] == "--render" {
  try renderOffline(to: arguments[2])
} else {
  try runLive()
}
