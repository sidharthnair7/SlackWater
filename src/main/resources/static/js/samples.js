/*
 * Sample readings for the v1 preview. Every measured number below is the engine's real output (0.2.0) on
 * its synthetic test clips (see FlowAnalyzerTest), shaped exactly like GET /api/readings returns them, so
 * wiring the page to the API later means replacing this list with a fetch. The fingerprints and video hashes
 * are placeholders: SHA-256 of a sample label, not of a real clip.
 *
 * `scene` is only for drawing the preview clip; the API never returns it.
 */
window.SLACKWATER_SAMPLES = (function () {
  var NO_SCALE = "No scale was given, so there is no speed in metres per second.";
  var WITH_SCALE = "Surface speed only, assuming the camera looks straight down. It is not the river's average speed.";
  var BAND = "region=0.0000,0.3333,1.0000,0.3333";

  function reading(id, minute, fields) {
    var base = {
      id: id,
      createdAt: "2026-10-04T14:" + minute + ":00Z",
      siteName: "Synthetic test strip",
      latitude: null,
      longitude: null,
      engineVersion: "0.2.0",
      surfaceSpeedPxPerSec: null,
      surfaceSpeedMetresPerSec: null,
      directionDegrees: null,
      refusal: null,
      note: null,
      pairsTotal: 49,
      pairsUsed: 49,
      secondsAnalysed: 4.9,
      frameRate: 30,
      width: 640,
      height: 360,
      cameraUnstableShare: 0,
      noiseFloorPxPerSec: null,
      movingThresholdPxPerSec: null,
      movingShare: null,
      directionCoherence: null,
      medianWaterSpeedPxPerSec: null
    };
    for (var key in fields) base[key] = fields[key];
    return base;
  }

  return [
    {
      key: "steady",
      label: "Steady current",
      scene: { dx: 2, dy: 0 },
      reading: reading(9, "21", {
        fileName: "synthetic-steady.mkv",
        fingerprint: "c96db8f462fa722a56aaeb4bea334c71eac8a8bec3f3cd8254d088cd77308d37",
        videoSha256: "5b7f5de683109925ade8481f3610f07bdf805f849714ee3f2ebbbd9c0a57f1db",
        settings: BAND + ";mpp=0.010000;max=15.0",
        verdict: "MOVING",
        reason: "100% of the points we followed moved together, at about 60 pixels per second.",
        note: WITH_SCALE,
        surfaceSpeedPxPerSec: 60.0, surfaceSpeedMetresPerSec: 0.6, directionDegrees: 359.99,
        waterTracksMedian: 299, backgroundTracksMedian: 200,
        noiseFloorPxPerSec: 0.0025, movingThresholdPxPerSec: 3.0, movingShare: 1.0,
        directionCoherence: 0.99998, medianWaterSpeedPxPerSec: 60.0
      })
    },
    {
      key: "slow",
      label: "Slow trickle",
      scene: { dx: 0.5, dy: 0 },
      reading: reading(8, "20", {
        fileName: "synthetic-slow.mkv",
        fingerprint: "e220391fcdd0b2e8e79e7b6953cd606f4e14e9f50bd89ec684bbd2c46da44155",
        videoSha256: "976f5e78f26776393749f79c1234f03df762eb2f245f48a80b44e154e1522b11",
        settings: BAND + ";mpp=none;max=15.0",
        verdict: "MOVING",
        reason: "100% of the points we followed moved together, at about 15 pixels per second.",
        note: NO_SCALE,
        surfaceSpeedPxPerSec: 15.003, directionDegrees: 359.99,
        waterTracksMedian: 300, backgroundTracksMedian: 200,
        noiseFloorPxPerSec: 0.0025, movingThresholdPxPerSec: 3.0, movingShare: 1.0,
        directionCoherence: 0.99997, medianWaterSpeedPxPerSec: 15.003
      })
    },
    {
      key: "still",
      label: "Still water",
      scene: { dx: 0, dy: 0 },
      reading: reading(7, "19", {
        fileName: "synthetic-still.mkv",
        fingerprint: "c47a020da8b8b9b370cb29c3bf48fe3a73d0cc951a5d7c58c70fa679e1da6756",
        videoSha256: "bc75ac7a8bb365984d3c7548bdb969869a2890ed4f533a57133b1d5aceef9b70",
        settings: BAND + ";mpp=none;max=15.0",
        verdict: "STILL",
        reason: "We followed about 300 points on the surface and 100% of them stayed put.",
        waterTracksMedian: 300, backgroundTracksMedian: 200,
        noiseFloorPxPerSec: 0, movingThresholdPxPerSec: 3.0, movingShare: 0,
        medianWaterSpeedPxPerSec: 0
      })
    },
    {
      key: "shaky",
      label: "Shaky camera",
      scene: { dx: 2, dy: 0, shake: 3 },
      reading: reading(6, "18", {
        fileName: "synthetic-shaky.mkv",
        fingerprint: "6dec83c99d00c88f76f5327a97a3a5db9ee2b3a0c82df8f54639101f210902c5",
        videoSha256: "37d3e26ad452778a80b9cbbde9b53a29e5d362cb92a3f9b30ed16a45f27450a0",
        settings: BAND + ";mpp=none;max=15.0",
        verdict: "REFUSED", refusal: "CAMERA_MOVED",
        reason: "The camera moved during the clip, so the motion we saw could be the camera and not the water. Rest the phone on something and film again.",
        pairsUsed: 5, cameraUnstableShare: 0.898,
        waterTracksMedian: 298, backgroundTracksMedian: 200
      })
    },
    {
      key: "mixed",
      label: "Mixed directions",
      scene: { mixed: true },
      reading: reading(5, "17", {
        fileName: "synthetic-mixed.mkv",
        fingerprint: "9cbb9710ffc1b8c879ba9e81f1612dd851b7a675bfecd59ef236e7ede926fa1d",
        videoSha256: "ab8fc565bf0d1c9d896a9635d8446c4d91e7b3f17315673c4804c9c0772b7c90",
        settings: BAND + ";mpp=none;max=15.0",
        verdict: "REFUSED", refusal: "MIXED_DIRECTIONS",
        reason: "The surface is moving in mixed directions. That's usually wind or reflections, not the current, so we won't call it.",
        waterTracksMedian: 259, backgroundTracksMedian: 200,
        noiseFloorPxPerSec: 0.0025, movingThresholdPxPerSec: 3.0, movingShare: 1.0,
        directionCoherence: 0.265, medianWaterSpeedPxPerSec: 59.97
      })
    },
    {
      key: "flat",
      label: "Nothing to follow",
      scene: { flat: true },
      reading: reading(4, "16", {
        fileName: "synthetic-flat.mkv",
        fingerprint: "253397d71e992e680cd7ef227c187d3a05ba3fb3f8d774a2a2c9de3bb6d72258",
        videoSha256: "1d957ab09c26dc832c0f7d53d3e7cece8608a46278d7f056a8435226b744e9ba",
        settings: BAND + ";mpp=none;max=15.0",
        verdict: "REFUSED", refusal: "NOTHING_TO_TRACK",
        reason: "There's nothing on the surface we can follow: no leaves, foam or ripples. Clean, calm water can't be measured from video, so we won't guess. Toss a leaf or small stick in upstream and film it floating past, from the bank.",
        waterTracksMedian: 0, backgroundTracksMedian: 200,
        noiseFloorPxPerSec: 0, movingThresholdPxPerSec: 3.0
      })
    },
    {
      key: "halfbox",
      label: "Water outside the box",
      scene: { dx: 2, dy: 0 },
      region: { x: 0, y: 1 / 3, w: 0.5, h: 1 / 3 },
      reading: reading(3, "15", {
        fileName: "synthetic-steady.mkv",
        fingerprint: "f50095c48ee3bf05c803daff697eb8301b17a1ade568aa5db4e4d4261dd8bed6",
        videoSha256: "5b7f5de683109925ade8481f3610f07bdf805f849714ee3f2ebbbd9c0a57f1db",
        settings: "region=0.0000,0.3333,0.5000,0.3333;mpp=none;max=15.0",
        verdict: "REFUSED", refusal: "BACKGROUND_MOVING",
        reason: "Things outside the water box are moving, like more water or plants in the wind, so we can't tell real motion from noise. Draw the box over all of the water.",
        waterTracksMedian: 300, backgroundTracksMedian: 195,
        noiseFloorPxPerSec: 60.0, movingThresholdPxPerSec: 180.0
      })
    }
  ];
})();
