import { describe, expect, it } from "vitest";
import { buildAmbientSoundscapeRecipe } from "@/lib/ambientSoundscape";
import type { SceneConfig } from "@/lib/types";
import { createAmbientSoundscapeGraph } from "./ambientSoundscapeGraph";

// A soundscape that fails silently is the default failure mode of Web Audio:
// connecting an LFO to a node instead of to that node's AudioParam, or
// forgetting to start a source, throws nothing and simply makes no sound. These
// tests run the real graph builder against a fake context and assert the
// topology, because a node environment cannot assert on what it hears.

const FAKE_SAMPLE_RATE = 48000;
const FADE_IN_SECONDS = 2.5;
const FADE_OUT_SECONDS = 1.2;

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
  buffer: { channels: Float32Array[] } | null = null;
  loop = false;
}

class FakeAudioContext {
  currentTime = 0;
  readonly sampleRate = FAKE_SAMPLE_RATE;
  readonly destination = new FakeAudioNode();
  readonly gainNodes: FakeGainNode[] = [];
  readonly filterNodes: FakeBiquadFilterNode[] = [];
  readonly oscillatorNodes: FakeOscillatorNode[] = [];
  readonly bufferSourceNodes: FakeAudioBufferSourceNode[] = [];

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

  createBuffer(channelCount: number, frameCount: number) {
    const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
    return {
      channels,
      getChannelData: (channelIndex: number) => channels[channelIndex]
    };
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
  const graph = createAmbientSoundscapeGraph(
    audioContext as unknown as AudioContext,
    recipe,
    FADE_IN_SECONDS
  );
  return { audioContext, recipe, graph };
}

describe("createAmbientSoundscapeGraph topology", () => {
  it("starts every source it creates", () => {
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const allSources = [...audioContext.oscillatorNodes, ...audioContext.bufferSourceNodes];

    expect(allSources.length).toBeGreaterThan(0);
    for (const source of allSources) {
      expect(source.startTimes).toHaveLength(1);
    }
  });

  it("creates one drone oscillator and one breath LFO per voice, plus the bed sweep", () => {
    const { audioContext, recipe } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const expectedOscillatorCount = recipe.droneVoices.length * 2 + 1;

    expect(audioContext.oscillatorNodes).toHaveLength(expectedOscillatorCount);
    expect(audioContext.bufferSourceNodes).toHaveLength(1);
  });

  it("routes each modulator into an AudioParam rather than into a node", () => {
    const { audioContext, recipe } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    // Depth gains are the last hop before a param. Every one of them must land
    // on an AudioParam — this is the mistake that produces silence.
    const depthGainTargets = audioContext.gainNodes
      .flatMap((gainNode) => gainNode.connectedTo)
      .filter((target) => target instanceof FakeAudioParam);

    expect(depthGainTargets).toHaveLength(recipe.droneVoices.length + 1);
  });

  it("reaches the destination through exactly one master gain", () => {
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const nodesConnectedToDestination = audioContext.gainNodes.filter((gainNode) =>
      gainNode.connectedTo.includes(audioContext.destination)
    );

    expect(nodesConnectedToDestination).toHaveLength(1);
  });

  it("fades in from silence to the recipe level", () => {
    const { audioContext, recipe } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const masterGain = audioContext.gainNodes.find((gainNode) =>
      gainNode.connectedTo.includes(audioContext.destination)
    );

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
    const firstBuffer = first.audioContext.bufferSourceNodes[0];
    const secondBuffer = second.audioContext.bufferSourceNodes[0];

    expect(firstBuffer.loop).toBe(true);
    expect(firstBuffer.buffer?.channels[0]).toHaveLength(FAKE_SAMPLE_RATE * 4);
    expect(Array.from(firstBuffer.buffer?.channels[0].slice(0, 32) ?? [])).toEqual(
      Array.from(secondBuffer.buffer?.channels[0].slice(0, 32) ?? [])
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

describe("createAmbientSoundscapeGraph teardown", () => {
  it("fades out and stops every source at the end of the fade", () => {
    const { audioContext, graph } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    audioContext.currentTime = 10;
    graph.stop(FADE_OUT_SECONDS);
    const allSources = [...audioContext.oscillatorNodes, ...audioContext.bufferSourceNodes];
    const masterGain = audioContext.gainNodes.find((gainNode) =>
      gainNode.connectedTo.includes(audioContext.destination)
    );

    for (const source of allSources) {
      expect(source.stopTimes).toEqual([10 + FADE_OUT_SECONDS]);
    }
    expect(masterGain?.gain.calls.at(-1)).toEqual({
      method: "linearRampToValueAtTime",
      value: 0,
      time: 10 + FADE_OUT_SECONDS
    });
  });

  it("anchors the fade at the level that is actually audible", () => {
    const { audioContext, graph } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    audioContext.currentTime = 10;
    graph.stop(FADE_OUT_SECONDS);
    const masterGain = audioContext.gainNodes.find((gainNode) =>
      gainNode.connectedTo.includes(audioContext.destination)
    );
    const methodOrder = masterGain?.gain.calls.slice(-3).map((call) => call.method);

    expect(methodOrder).toEqual(["cancelScheduledValues", "setValueAtTime", "linearRampToValueAtTime"]);
  });

  it("releases the graph from the destination once the last source ends", () => {
    const { audioContext, graph } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    graph.stop(FADE_OUT_SECONDS);
    const masterGain = audioContext.gainNodes.find((gainNode) =>
      gainNode.connectedTo.includes(audioContext.destination)
    );
    const endedSources = [...audioContext.oscillatorNodes, ...audioContext.bufferSourceNodes].filter(
      (source) => source.onended !== null
    );

    expect(endedSources).toHaveLength(1);
    endedSources[0].onended?.();
    expect(masterGain?.disconnectCount).toBe(1);
  });

  it("ignores a second stop", () => {
    const { audioContext, graph } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    graph.stop(FADE_OUT_SECONDS);
    graph.stop(FADE_OUT_SECONDS);

    for (const source of audioContext.oscillatorNodes) {
      expect(source.stopTimes).toHaveLength(1);
    }
  });
});
