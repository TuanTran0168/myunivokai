import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAmbientSoundscapeRecipe } from "@/lib/ambientSoundscape";
import type { SceneConfig } from "@/lib/types";
import { createAmbientSoundscapeGraph } from "./ambientSoundscapeGraph";

// A soundscape that fails silently is the default failure mode of Web Audio:
// connecting an LFO to a node instead of to that node's AudioParam, or
// forgetting to start a source, throws nothing and simply makes no sound. These
// tests run the real graph builder against a fake context and assert the
// topology, because a node environment cannot assert on what it hears.
//
// What it sounds like is a separate question these cannot answer. That one is
// settled by rendering the real graph offline to WAV — see
// notes/fe/ambient-audio-mechanism.md.

const FAKE_SAMPLE_RATE = 48000;
const FADE_IN_SECONDS = 2.5;
const FADE_OUT_SECONDS = 1.2;
const SCHEDULER_INTERVAL_MILLISECONDS = 250;

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
}

type FakeAudioBuffer = {
  channels: Float32Array[];
  getChannelData: (channelIndex: number) => Float32Array;
};

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

  createBuffer(channelCount: number, frameCount: number): FakeAudioBuffer {
    const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
    return { channels, getChannelData: (channelIndex: number) => channels[channelIndex] };
  }
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
  const graph = createAmbientSoundscapeGraph(audioContext as unknown as AudioContext, recipe, FADE_IN_SECONDS);
  const padOscillatorCount = recipe.droneVoices.length * 2 + 1;
  return { audioContext, recipe, graph, padOscillatorCount };
}

function findMasterGain(audioContext: FakeAudioContext) {
  return audioContext.gainNodes.find((gainNode) => gainNode.connectedTo.includes(audioContext.destination));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("sustained layers", () => {
  it("starts every sustained source it creates", () => {
    const { audioContext, padOscillatorCount } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const sustainedSources = [...audioContext.oscillatorNodes.slice(0, padOscillatorCount), ...audioContext.bufferSourceNodes];

    for (const source of sustainedSources) {
      expect(source.startTimes).toHaveLength(1);
    }
  });

  it("creates one pad oscillator and one breath LFO per voice, plus the bed sweep", () => {
    const { audioContext, padOscillatorCount } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);

    // No notes are due yet, so the pad is all there is at construction.
    expect(audioContext.oscillatorNodes).toHaveLength(padOscillatorCount);
    expect(audioContext.bufferSourceNodes).toHaveLength(1);
  });

  it("routes each modulator into an AudioParam rather than into a node", () => {
    const { audioContext, recipe } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const depthGainTargets = audioContext.gainNodes
      .flatMap((gainNode) => gainNode.connectedTo)
      .filter((target) => target instanceof FakeAudioParam);

    expect(depthGainTargets).toHaveLength(recipe.droneVoices.length + 1);
  });

  it("reaches the destination through exactly one master gain", () => {
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const mastersConnectedToDestination = audioContext.gainNodes.filter((gainNode) =>
      gainNode.connectedTo.includes(audioContext.destination)
    );

    expect(mastersConnectedToDestination).toHaveLength(1);
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

  it("loops a deterministic noise buffer for the bed", () => {
    const first = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const second = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const firstBed = first.audioContext.bufferSourceNodes[0];
    const secondBed = second.audioContext.bufferSourceNodes[0];

    expect(firstBed.loop).toBe(true);
    expect(Array.from(firstBed.buffer?.channels[0].slice(0, 32) ?? [])).toEqual(
      Array.from(secondBed.buffer?.channels[0].slice(0, 32) ?? [])
    );
  });

  it("gives the forest a bandpass bed and the universe a lowpass one", () => {
    const universeFilterTypes = buildGraphAgainstFakeContext(UNIVERSE_SCENE).audioContext.filterNodes.map(
      (filterNode) => filterNode.type
    );
    const forestFilterTypes = buildGraphAgainstFakeContext(FOREST_SCENE).audioContext.filterNodes.map(
      (filterNode) => filterNode.type
    );

    expect(universeFilterTypes).toContain("lowpass");
    expect(universeFilterTypes).not.toContain("bandpass");
    expect(forestFilterTypes).toContain("bandpass");
  });
});

describe("space", () => {
  it("builds a stereo reverb tail as long as the recipe asks for", () => {
    const { audioContext, recipe } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const impulseResponse = audioContext.convolverNodes[0]?.buffer;

    expect(audioContext.convolverNodes).toHaveLength(1);
    expect(impulseResponse?.channels).toHaveLength(2);
    expect(impulseResponse?.channels[0]).toHaveLength(
      Math.floor(FAKE_SAMPLE_RATE * recipe.space.reverbDecaySeconds)
    );
  });

  it("decays the impulse response instead of leaving flat noise", () => {
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const tail = audioContext.convolverNodes[0]?.buffer?.channels[0];
    function averageMagnitude(samples: Float32Array): number {
      let total = 0;
      for (const sample of samples) {
        total += Math.abs(sample);
      }
      return total / samples.length;
    }

    const headLevel = averageMagnitude(tail?.slice(0, 2000) ?? new Float32Array(1));
    const tailLevel = averageMagnitude(tail?.slice(-2000) ?? new Float32Array(1));
    expect(headLevel).toBeGreaterThan(tailLevel * 10);
  });

  it("closes the delay feedback loop back into the delay", () => {
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const delayNode = audioContext.delayNodes[0];
    // The feedback gain is the one that is BOTH a target of the delay and a
    // source into it. Searching only for "connects into the delay" also matches
    // the delay's input gain, which is not a loop.
    const feedbackGain = audioContext.gainNodes.find(
      (gainNode) => gainNode.connectedTo.includes(delayNode) && delayNode.connectedTo.includes(gainNode)
    );

    expect(delayNode).toBeDefined();
    expect(feedbackGain).toBeDefined();
  });

  it("keeps the noise bed out of the reverb", () => {
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const convolver = audioContext.convolverNodes[0];
    const reverbInput = audioContext.gainNodes.find((gainNode) => gainNode.connectedTo.includes(convolver));
    // The bed gain is the one fed by the bed filter.
    const bedFilter = audioContext.filterNodes.find((filterNode) => filterNode.type !== "lowpass" || filterNode !== audioContext.filterNodes[0]);
    const bedGain = audioContext.gainNodes.find((gainNode) => bedFilter?.connectedTo.includes(gainNode));

    expect(bedGain).toBeDefined();
    expect(bedGain?.connectedTo).not.toContain(reverbInput);
    expect(bedGain?.connectedTo).not.toContain(convolver);
  });
});

describe("the melodic performance", () => {
  it("plays no notes at the very start, then plays them once they are due", () => {
    vi.useFakeTimers();
    const { audioContext, padOscillatorCount } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);

    expect(audioContext.oscillatorNodes).toHaveLength(padOscillatorCount);

    for (let elapsedSeconds = 0; elapsedSeconds < 20; elapsedSeconds += 0.25) {
      audioContext.currentTime = elapsedSeconds;
      vi.advanceTimersByTime(SCHEDULER_INTERVAL_MILLISECONDS);
    }

    expect(audioContext.oscillatorNodes.length).toBeGreaterThan(padOscillatorCount);
    expect(audioContext.pannerNodes.length).toBeGreaterThan(0);
  });

  it("pans notes across the stereo field", () => {
    vi.useFakeTimers();
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    for (let elapsedSeconds = 0; elapsedSeconds < 30; elapsedSeconds += 0.25) {
      audioContext.currentTime = elapsedSeconds;
      vi.advanceTimersByTime(SCHEDULER_INTERVAL_MILLISECONDS);
    }
    const panValues = audioContext.pannerNodes.map((panner) => panner.pan.value);

    expect(new Set(panValues).size).toBeGreaterThan(1);
    for (const panValue of panValues) {
      expect(Math.abs(panValue)).toBeLessThanOrEqual(1);
    }
  });

  it("glides the pad to a new chord instead of jumping", () => {
    vi.useFakeTimers();
    const { audioContext, recipe, padOscillatorCount } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const untilSeconds = recipe.chordProgression.changeIntervalSeconds + 2;
    for (let elapsedSeconds = 0; elapsedSeconds < untilSeconds; elapsedSeconds += 0.25) {
      audioContext.currentTime = elapsedSeconds;
      vi.advanceTimersByTime(SCHEDULER_INTERVAL_MILLISECONDS);
    }
    const padOscillators = audioContext.oscillatorNodes.slice(0, padOscillatorCount);
    const glideCalls = padOscillators.flatMap((oscillator) =>
      oscillator.frequency.calls.filter((call) => call.method === "linearRampToValueAtTime")
    );

    expect(glideCalls.length).toBeGreaterThan(0);
  });

  it("stops scheduling new notes once stopped", () => {
    vi.useFakeTimers();
    const { audioContext, graph } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    for (let elapsedSeconds = 0; elapsedSeconds < 12; elapsedSeconds += 0.25) {
      audioContext.currentTime = elapsedSeconds;
      vi.advanceTimersByTime(SCHEDULER_INTERVAL_MILLISECONDS);
    }
    graph.stop(FADE_OUT_SECONDS);
    const oscillatorCountAtStop = audioContext.oscillatorNodes.length;

    for (let elapsedSeconds = 12; elapsedSeconds < 30; elapsedSeconds += 0.25) {
      audioContext.currentTime = elapsedSeconds;
      vi.advanceTimersByTime(SCHEDULER_INTERVAL_MILLISECONDS);
    }

    expect(audioContext.oscillatorNodes).toHaveLength(oscillatorCountAtStop);
  });
});

describe("teardown", () => {
  it("fades out and stops every sustained source at the end of the fade", () => {
    const { audioContext, graph, padOscillatorCount } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    audioContext.currentTime = 10;
    graph.stop(FADE_OUT_SECONDS);
    const sustainedSources = [
      ...audioContext.oscillatorNodes.slice(0, padOscillatorCount),
      ...audioContext.bufferSourceNodes
    ];

    for (const source of sustainedSources) {
      expect(source.stopTimes).toContain(10 + FADE_OUT_SECONDS);
    }
    expect(findMasterGain(audioContext)?.gain.calls.at(-1)).toEqual({
      method: "linearRampToValueAtTime",
      value: 0,
      time: 10 + FADE_OUT_SECONDS
    });
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
    const { audioContext, graph, padOscillatorCount } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    for (let elapsedSeconds = 0; elapsedSeconds < 12; elapsedSeconds += 0.25) {
      audioContext.currentTime = elapsedSeconds;
      vi.advanceTimersByTime(SCHEDULER_INTERVAL_MILLISECONDS);
    }
    const noteSources = audioContext.oscillatorNodes.slice(padOscillatorCount);
    graph.stop(FADE_OUT_SECONDS);

    expect(noteSources.length).toBeGreaterThan(0);
    for (const noteSource of noteSources) {
      expect(noteSource.stopTimes).toContain(audioContext.currentTime + FADE_OUT_SECONDS);
    }
  });

  it("releases the graph from the destination once the last sustained source ends", () => {
    const { audioContext, graph } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    graph.stop(FADE_OUT_SECONDS);
    const masterGain = findMasterGain(audioContext);
    const releaseSource = [...audioContext.oscillatorNodes, ...audioContext.bufferSourceNodes].find(
      (source) => source.onended !== null
    );

    expect(releaseSource).toBeDefined();
    releaseSource?.onended?.();
    expect(masterGain?.disconnectCount).toBe(1);
  });

  it("ignores a second stop", () => {
    const { audioContext, graph, padOscillatorCount } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    graph.stop(FADE_OUT_SECONDS);
    graph.stop(FADE_OUT_SECONDS);

    for (const source of audioContext.oscillatorNodes.slice(0, padOscillatorCount)) {
      expect(source.stopTimes).toHaveLength(1);
    }
  });
});
