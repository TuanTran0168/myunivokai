import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAmbientSoundscapeRecipe } from "@/lib/ambientSoundscape";
import type { SceneConfig } from "@/lib/types";
import { createAmbientSoundscapeGraph, type AmbientInstrumentSet } from "./ambientSoundscapeGraph";
import {
  noteNameToMidiNumber,
  SAMPLED_INSTRUMENT_NOTE_NAMES,
  type LoadedInstrument
} from "./instrumentSamples";

// A soundscape that fails silently is the default failure mode of Web Audio:
// connecting an LFO to a node instead of to that node's AudioParam, or
// forgetting to start a source, throws nothing and simply makes no sound. These
// tests run the real graph builder against a fake context and assert topology.
//
// What it sounds like is a separate question these cannot answer. That one is
// settled by rendering the real graph offline to WAV and measuring — see
// notes/fe/ambient-audio-mechanism.md.

const FAKE_SAMPLE_RATE = 48000;
const FADE_IN_SECONDS = 3;
const FADE_OUT_SECONDS = 1.2;
const SCHEDULER_INTERVAL_MILLISECONDS = 250;
const SAMPLE_FRAME_COUNT = 1024;

type ScheduledCall = { method: string; value: number; time: number };

class FakeAudioParam {
  value: number;
  readonly calls: ScheduledCall[] = [];
  constructor(initialValue: number) {
    this.value = initialValue;
  }
  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.calls.push({ method: "setValueAtTime", value, time });
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.calls.push({ method: "linearRampToValueAtTime", value, time });
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.calls.push({ method: "exponentialRampToValueAtTime", value, time });
  }
  cancelScheduledValues(time: number) {
    this.calls.push({ method: "cancelScheduledValues", value: Number.NaN, time });
  }
}

class FakeAudioNode {
  readonly connectedTo: unknown[] = [];
  disconnectCount = 0;
  connect(target: unknown) {
    this.connectedTo.push(target);
    return target;
  }
  disconnect() {
    this.disconnectCount += 1;
  }
}

class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam(1);
}
class FakeBiquadFilterNode extends FakeAudioNode {
  type = "lowpass";
  readonly frequency = new FakeAudioParam(350);
  readonly Q = new FakeAudioParam(1);
}
class FakeDelayNode extends FakeAudioNode {
  readonly delayTime = new FakeAudioParam(0);
}
class FakeStereoPannerNode extends FakeAudioNode {
  readonly pan = new FakeAudioParam(0);
}
class FakeConvolverNode extends FakeAudioNode {
  buffer: FakeAudioBuffer | null = null;
}
class FakeSourceNode extends FakeAudioNode {
  startTimes: number[] = [];
  stopTimes: number[] = [];
  onended: (() => void) | null = null;
  start(time: number) {
    this.startTimes.push(time);
  }
  stop(time: number) {
    this.stopTimes.push(time);
  }
}
class FakeOscillatorNode extends FakeSourceNode {
  type = "sine";
  readonly frequency = new FakeAudioParam(440);
  readonly detune = new FakeAudioParam(0);
}
class FakeAudioBufferSourceNode extends FakeSourceNode {
  buffer: FakeAudioBuffer | null = null;
  loop = false;
  readonly playbackRate = new FakeAudioParam(1);
}

type FakeAudioBuffer = {
  channels: Float32Array[];
  getChannelData: (channelIndex: number) => Float32Array;
};

function fakeAudioBuffer(channelCount: number, frameCount: number): FakeAudioBuffer {
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
  return { channels, getChannelData: (channelIndex: number) => channels[channelIndex] };
}

class FakeAudioContext {
  currentTime = 0;
  readonly sampleRate = FAKE_SAMPLE_RATE;
  readonly destination = new FakeAudioNode();
  readonly gainNodes: FakeGainNode[] = [];
  readonly filterNodes: FakeBiquadFilterNode[] = [];
  readonly oscillatorNodes: FakeOscillatorNode[] = [];
  readonly bufferSourceNodes: FakeAudioBufferSourceNode[] = [];
  readonly convolverNodes: FakeConvolverNode[] = [];
  readonly delayNodes: FakeDelayNode[] = [];
  readonly pannerNodes: FakeStereoPannerNode[] = [];

  createGain() {
    const node = new FakeGainNode();
    this.gainNodes.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = new FakeBiquadFilterNode();
    this.filterNodes.push(node);
    return node;
  }
  createOscillator() {
    const node = new FakeOscillatorNode();
    this.oscillatorNodes.push(node);
    return node;
  }
  createBufferSource() {
    const node = new FakeAudioBufferSourceNode();
    this.bufferSourceNodes.push(node);
    return node;
  }
  createConvolver() {
    const node = new FakeConvolverNode();
    this.convolverNodes.push(node);
    return node;
  }
  createDelay() {
    const node = new FakeDelayNode();
    this.delayNodes.push(node);
    return node;
  }
  createStereoPanner() {
    const node = new FakeStereoPannerNode();
    this.pannerNodes.push(node);
    return node;
  }
  createBuffer(channelCount: number, frameCount: number) {
    return fakeAudioBuffer(channelCount, frameCount);
  }
}

function fakeInstrument(key: keyof typeof SAMPLED_INSTRUMENT_NOTE_NAMES): LoadedInstrument {
  const buffers = new Map<number, AudioBuffer>();
  for (const noteName of SAMPLED_INSTRUMENT_NOTE_NAMES[key]) {
    buffers.set(noteNameToMidiNumber(noteName), fakeAudioBuffer(1, SAMPLE_FRAME_COUNT) as unknown as AudioBuffer);
  }
  return { key, midiNumbers: [...buffers.keys()].sort((first, second) => first - second), buffers };
}

const UNIVERSE_SCENE: SceneConfig = { seed: "graph-seed-001", theme: "aurora" };
const FOREST_SCENE: SceneConfig = {
  seed: "graph-seed-002",
  sceneType: "forest",
  weather: { kind: "rain", intensity: 0.8 },
  lighting: { timeOfDay: "dusk" }
};

function buildGraphAgainstFakeContext(scene: SceneConfig) {
  const audioContext = new FakeAudioContext();
  const recipe = buildAmbientSoundscapeRecipe(scene);
  const instruments: AmbientInstrumentSet = {
    melody: fakeInstrument(recipe.melody.instrument),
    harmony: fakeInstrument(recipe.harmony.instrument)
  };
  const graph = createAmbientSoundscapeGraph(
    audioContext as unknown as AudioContext,
    recipe,
    FADE_IN_SECONDS,
    instruments
  );
  return { audioContext, recipe, graph, instruments };
}

function advanceScheduler(audioContext: FakeAudioContext, untilSeconds: number) {
  for (let elapsedSeconds = 0; elapsedSeconds < untilSeconds; elapsedSeconds += 0.25) {
    audioContext.currentTime = elapsedSeconds;
    vi.advanceTimersByTime(SCHEDULER_INTERVAL_MILLISECONDS);
  }
}

function findMasterGain(audioContext: FakeAudioContext) {
  return audioContext.gainNodes.find((gainNode) => gainNode.connectedTo.includes(audioContext.destination));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("no oscillator plays music", () => {
  it("uses exactly one oscillator, and only to sweep the noise bed", () => {
    vi.useFakeTimers();
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    advanceScheduler(audioContext, 40);

    // Two earlier versions synthesised the pad and the notes from oscillators
    // and both were rejected as harsh. Every musical voice is now a recording;
    // the only oscillator left is the sub-audio LFO that moves the wind filter.
    expect(audioContext.oscillatorNodes).toHaveLength(1);
    const bedSweep = audioContext.oscillatorNodes[0];
    expect(bedSweep.frequency.value).toBeLessThan(1);
    const sweepDepth = audioContext.gainNodes.find((gainNode) => bedSweep.connectedTo.includes(gainNode));
    expect(sweepDepth?.connectedTo.some((target) => target instanceof FakeAudioParam)).toBe(true);
  });
});

describe("routing", () => {
  it("reaches the destination through exactly one master gain", () => {
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const masters = audioContext.gainNodes.filter((gainNode) =>
      gainNode.connectedTo.includes(audioContext.destination)
    );
    expect(masters).toHaveLength(1);
  });

  it("fades in from silence to the recipe level", () => {
    const { audioContext, recipe } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const masterGain = findMasterGain(audioContext);
    expect(masterGain?.gain.calls[0]).toEqual({ method: "setValueAtTime", value: 0, time: 0 });
    expect(masterGain?.gain.calls[1]).toEqual({
      method: "linearRampToValueAtTime",
      value: recipe.masterGain,
      time: FADE_IN_SECONDS
    });
  });

  it("sends the tone filter to the dry, reverb and delay paths", () => {
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const toneFilter = audioContext.filterNodes.find((filterNode) => filterNode.connectedTo.length === 3);
    expect(toneFilter).toBeDefined();
  });

  it("builds a stereo reverb tail that actually decays", () => {
    const { audioContext, recipe } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const tail = audioContext.convolverNodes[0]?.buffer;
    expect(audioContext.convolverNodes).toHaveLength(1);
    expect(tail?.channels).toHaveLength(2);
    expect(tail?.channels[0]).toHaveLength(Math.floor(FAKE_SAMPLE_RATE * recipe.space.reverbDecaySeconds));

    function averageMagnitude(samples: Float32Array): number {
      let total = 0;
      for (const sample of samples) {
        total += Math.abs(sample);
      }
      return total / samples.length;
    }
    const head = averageMagnitude(tail?.channels[0].slice(0, 2000) ?? new Float32Array(1));
    const end = averageMagnitude(tail?.channels[0].slice(-2000) ?? new Float32Array(1));
    expect(head).toBeGreaterThan(end * 10);
  });

  it("closes the delay feedback loop back into the delay", () => {
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const delayNode = audioContext.delayNodes[0];
    // The feedback gain is the one that is BOTH a target of the delay and a
    // source into it; searching only one direction also matches its input gain.
    const feedbackGain = audioContext.gainNodes.find(
      (gainNode) => gainNode.connectedTo.includes(delayNode) && delayNode.connectedTo.includes(gainNode)
    );
    expect(feedbackGain).toBeDefined();
  });

  it("keeps the noise bed out of the reverb and straight to the master", () => {
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const bedSource = audioContext.bufferSourceNodes.find((source) => source.loop);
    const bedFilter = bedSource?.connectedTo[0] as FakeBiquadFilterNode | undefined;
    const bedGain = bedFilter?.connectedTo[0] as FakeGainNode | undefined;
    const masterGain = findMasterGain(audioContext);
    const convolver = audioContext.convolverNodes[0];

    expect(bedGain?.connectedTo).toEqual([masterGain]);
    expect(bedGain?.connectedTo).not.toContain(convolver);
  });

  it("loops a deterministic noise buffer for the bed", () => {
    const first = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const second = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const firstBed = first.audioContext.bufferSourceNodes.find((source) => source.loop);
    const secondBed = second.audioContext.bufferSourceNodes.find((source) => source.loop);
    expect(firstBed?.startTimes).toHaveLength(1);
    expect(Array.from(firstBed?.buffer?.channels[0].slice(0, 32) ?? [])).toEqual(
      Array.from(secondBed?.buffer?.channels[0].slice(0, 32) ?? [])
    );
  });

  it("gives the forest a bandpass bed and the universe a lowpass one", () => {
    const universeTypes = buildGraphAgainstFakeContext(UNIVERSE_SCENE).audioContext.filterNodes.map((f) => f.type);
    const forestTypes = buildGraphAgainstFakeContext(FOREST_SCENE).audioContext.filterNodes.map((f) => f.type);
    expect(universeTypes).not.toContain("bandpass");
    expect(forestTypes).toContain("bandpass");
  });
});

describe("the performance", () => {
  it("opens with harmony and lets the melody answer it", () => {
    vi.useFakeTimers();
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const bedSourceCount = 1;

    advanceScheduler(audioContext, 2.5);
    const afterHarmonyEntry = audioContext.bufferSourceNodes.length - bedSourceCount;
    advanceScheduler(audioContext, 10);
    const afterMelodyEntry = audioContext.bufferSourceNodes.length - bedSourceCount;

    expect(afterHarmonyEntry).toBeGreaterThan(0);
    expect(afterMelodyEntry).toBeGreaterThan(afterHarmonyEntry);
  });

  it("plays every note through a panner and keeps the image inside the field", () => {
    vi.useFakeTimers();
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    advanceScheduler(audioContext, 30);

    expect(audioContext.pannerNodes.length).toBeGreaterThan(0);
    const panValues = audioContext.pannerNodes.map((panner) => panner.pan.value);
    expect(new Set(panValues).size).toBeGreaterThan(1);
    for (const panValue of panValues) {
      expect(Math.abs(panValue)).toBeLessThanOrEqual(1);
    }
  });

  it("never stretches a sample beyond an octave", () => {
    vi.useFakeTimers();
    // Chord changes transpose the melody, and without folding a note can land
    // far outside the sampled range — a stretched recording stops sounding like
    // the instrument at all.
    for (const scene of [UNIVERSE_SCENE, FOREST_SCENE, { seed: "s", theme: "crystal" }]) {
      const { audioContext } = buildGraphAgainstFakeContext(scene);
      advanceScheduler(audioContext, 90);
      const noteSources = audioContext.bufferSourceNodes.filter((source) => !source.loop);
      expect(noteSources.length).toBeGreaterThan(0);
      for (const noteSource of noteSources) {
        expect(noteSource.playbackRate.value).toBeGreaterThan(0.5);
        expect(noteSource.playbackRate.value).toBeLessThan(2);
      }
    }
  });

  it("stops scheduling once stopped", () => {
    vi.useFakeTimers();
    const { audioContext, graph } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    advanceScheduler(audioContext, 15);
    graph.stop(FADE_OUT_SECONDS);
    const countAtStop = audioContext.bufferSourceNodes.length;
    advanceScheduler(audioContext, 40);
    expect(audioContext.bufferSourceNodes).toHaveLength(countAtStop);
  });
});

describe("teardown", () => {
  it("fades out and stops the bed at the end of the fade", () => {
    const { audioContext, graph } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    audioContext.currentTime = 10;
    graph.stop(FADE_OUT_SECONDS);
    const bedSource = audioContext.bufferSourceNodes.find((source) => source.loop);

    expect(bedSource?.stopTimes).toContain(10 + FADE_OUT_SECONDS);
    expect(audioContext.oscillatorNodes[0]?.stopTimes).toContain(10 + FADE_OUT_SECONDS);
    expect(findMasterGain(audioContext)?.gain.calls.at(-1)?.method).toBe("linearRampToValueAtTime");
  });

  it("anchors the fade at the level that is actually audible", () => {
    const { audioContext, graph } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    audioContext.currentTime = 10;
    graph.stop(FADE_OUT_SECONDS);
    const methodOrder = findMasterGain(audioContext)?.gain.calls.slice(-3).map((call) => call.method);
    expect(methodOrder).toEqual(["cancelScheduledValues", "setValueAtTime", "linearRampToValueAtTime"]);
  });

  it("cuts notes still ringing when the world goes away", () => {
    vi.useFakeTimers();
    const { audioContext, graph } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    advanceScheduler(audioContext, 15);
    const noteSources = audioContext.bufferSourceNodes.filter((source) => !source.loop);
    graph.stop(FADE_OUT_SECONDS);

    expect(noteSources.length).toBeGreaterThan(0);
    for (const noteSource of noteSources) {
      expect(noteSource.stopTimes.length).toBeGreaterThan(0);
    }
  });

  it("releases the graph from the destination once the bed ends", () => {
    const { audioContext, graph } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    graph.stop(FADE_OUT_SECONDS);
    const masterGain = findMasterGain(audioContext);
    const bedSource = audioContext.bufferSourceNodes.find((source) => source.onended !== null);

    expect(bedSource).toBeDefined();
    bedSource?.onended?.();
    expect(masterGain?.disconnectCount).toBe(1);
  });

  it("ignores a second stop", () => {
    const { audioContext, graph } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    graph.stop(FADE_OUT_SECONDS);
    graph.stop(FADE_OUT_SECONDS);
    const bedSource = audioContext.bufferSourceNodes.find((source) => source.loop);
    expect(bedSource?.stopTimes).toHaveLength(1);
  });
});
