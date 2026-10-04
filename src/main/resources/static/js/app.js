/*
 * SlackWater v1 preview. Renders readings shaped like the API's: real-readings.js (a snapshot of the engine's
 * answers on real flood footage) and samples.js (synthetic test clips).
 * To connect it later: replace REAL with GET /api/readings, and the Measure button's replay with
 * POST /api/readings (the water box is already kept as fractions of the frame, which is what the API takes).
 */
(function () {
  "use strict";

  var REAL = window.SLACKWATER_REAL || [];
  var TESTS = window.SLACKWATER_SAMPLES || [];
  var SAMPLES = REAL.concat(TESTS);
  var DEFAULT_REGION = { x: 0, y: 1 / 3, w: 1, h: 1 / 3 };
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var GATES = [
    { key: "TOO_SHORT", name: "Enough video" },
    { key: "NO_FIXED_BACKGROUND", name: "Banks in view" },
    { key: "CAMERA_MOVED", name: "Camera held still" },
    { key: "BACKGROUND_MOVING", name: "Background still" },
    { key: "NOTHING_TO_TRACK", name: "Something to follow" },
    { key: "MIXED_DIRECTIONS", name: "One direction" }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    canvas: $("scene"), video: $("own-video"), viewport: $("viewport"),
    hudSource: $("hud-source"), hudTime: $("hud-time"), hudRate: $("hud-rate"), hudBox: $("hud-box"),
    sampleList: $("sample-list"), ownFile: $("own-file"), showTracking: $("show-tracking"),
    readout: $("readout"), verdict: $("verdict"), meta: $("readout-meta"),
    figure: $("figure"), figureValue: $("figure-value"), figureUnit: $("figure-unit"),
    compass: $("compass"), needle: $("compass-needle"), figureSub: $("figure-sub"),
    reason: $("reason"), note: $("note"), log: $("log"), gates: $("gates"), record: $("record"),
    measureBtn: $("measure-btn"), measureHint: $("measure-hint"), credit: $("credit"),
    filters: $("filters"), readingsBody: $("readings-body")
  };

  var scene = new window.SlackWaterScene(el.canvas);
  var state = { sample: null, region: DEFAULT_REGION, boxChanged: false, own: false, filter: "ALL", run: 0 };

  /* ---------- formatting ---------- */

  function num(value, digits) {
    if (value === null || value === undefined) return "—";
    return Number(value).toFixed(digits);
  }
  function pct(value) {
    return value === null || value === undefined ? "—" : Math.round(value * 100) + "%";
  }
  function shortHash(hash) {
    return hash ? hash.slice(0, 10) + "…" + hash.slice(-6) : "—";
  }
  function heading(deg) {
    var names = ["right", "up and right", "up", "up and left", "left", "down and left", "down", "down and right"];
    return names[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  }
  function clock(iso) {
    var d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function verdictClass(r) {
    return r.verdict === "MOVING" ? "is-moving" : r.verdict === "STILL" ? "is-still" : "is-refused";
  }
  function verdictWord(r) {
    return r.verdict === "MOVING" ? "Moving" : r.verdict === "STILL" ? "Still" : "Refused";
  }
  function speedText(r) {
    if (r.surfaceSpeedMetresPerSec != null) return num(r.surfaceSpeedMetresPerSec, 2) + " m/s";
    if (r.surfaceSpeedPxPerSec != null) return num(r.surfaceSpeedPxPerSec, 1) + " px/s";
    return "—";
  }

  /* The water box a reading was measured with, read back from its settings ("region=x,y,w,h;..."). */
  function regionOf(reading) {
    var m = /region=([\d.]+),([\d.]+),([\d.]+),([\d.]+)/.exec(reading.settings || "");
    return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : DEFAULT_REGION;
  }

  function loadImage(src) {
    if (!src) return null;
    var img = new Image();
    img.src = src;
    img.addEventListener("load", function () { if (reduceMotion) scene.draw(); });
    return img;
  }
  REAL.forEach(function (s) {
    s.evidenceImage = loadImage(s.evidence);
    s.overlayImage = loadImage(s.overlay);
  });

  /* ---------- gates, derived from a reading exactly as the engine orders them ---------- */

  function gateRows(r) {
    var failed = r.refusal ? GATES.findIndex(function (g) { return g.key === r.refusal; }) : -1;
    var noiseLimit = 15 * (r.width || 640) / 640;
    var values = {
      TOO_SHORT: [num(r.secondsAnalysed, 1) + " s · " + r.pairsTotal + " pairs", "≥ 1 s and ≥ 5 pairs"],
      NO_FIXED_BACKGROUND: [num(r.backgroundTracksMedian, 0) + " points", "≥ 12"],
      CAMERA_MOVED: [pct(r.cameraUnstableShare) + " of pairs moved", "≤ 25%"],
      BACKGROUND_MOVING: [r.noiseFloorPxPerSec == null ? "—" : num(r.noiseFloorPxPerSec, 1) + " px/s jitter", "≤ " + num(noiseLimit, 0) + " px/s"],
      NOTHING_TO_TRACK: [num(r.waterTracksMedian, 0) + " points", "≥ 15"],
      MIXED_DIRECTIONS: [r.directionCoherence == null ? "—" : "coherence " + num(r.directionCoherence, 2), "≥ 0.60"]
    };
    if (r.refusal === "VIDEO_UNREADABLE") {
      return GATES.map(function (g) { return { name: g.name, value: "—", rule: "", status: "skip" }; });
    }
    return GATES.map(function (g, i) {
      var status = failed === -1 ? "pass" : i < failed ? "pass" : i === failed ? "fail" : "skip";
      var value = values[g.key][0];
      if (g.key === "MIXED_DIRECTIONS" && r.verdict === "STILL") {
        status = "skip";
        value = "not needed: nothing moved";
      }
      if (status === "skip" && r.verdict !== "STILL") value = "not reached";
      return { name: g.name, value: value, rule: values[g.key][1], status: status };
    });
  }

  /* ---------- readout ---------- */

  function renderGates(rows, pending) {
    el.gates.innerHTML = "";
    rows.forEach(function (row) {
      var li = document.createElement("li");
      li.className = "gate " + (pending ? "is-pending" : "is-" + row.status);
      li.innerHTML =
        '<span class="gate-mark" aria-hidden="true"></span>' +
        '<span class="gate-name"></span>' +
        '<span class="gate-value"></span>' +
        '<span class="gate-rule"></span>';
      li.querySelector(".gate-name").textContent = row.name;
      li.querySelector(".gate-value").textContent = pending ? "…" : row.value;
      li.querySelector(".gate-rule").textContent = row.rule;
      li.setAttribute("aria-label", row.name + ": " + (pending ? "checking" : row.status === "pass" ? "passed" : row.status === "fail" ? "failed" : "not reached") + ", " + row.value);
      el.gates.appendChild(li);
    });
  }

  function renderRecord(r) {
    var items = [
      ["Fingerprint", shortHash(r.fingerprint), r.fingerprint],
      ["Video SHA-256", shortHash(r.videoSha256), r.videoSha256],
      ["Settings", r.settings, null],
      ["Engine", r.engineVersion + " · saved " + clock(r.createdAt), null]
    ];
    el.record.innerHTML = "";
    items.forEach(function (item) {
      var dt = document.createElement("dt");
      dt.textContent = item[0];
      var dd = document.createElement("dd");
      var code = document.createElement("code");
      code.textContent = item[1];
      dd.appendChild(code);
      if (item[2]) {
        var copy = document.createElement("button");
        copy.type = "button";
        copy.className = "copy";
        copy.textContent = "Copy";
        copy.addEventListener("click", function () {
          var done = function () { copy.textContent = "Copied"; setTimeout(function () { copy.textContent = "Copy"; }, 1400); };
          try {
            navigator.clipboard.writeText(item[2]).then(done, function () { selectText(code, item[2]); });
          } catch (e) { selectText(code, item[2]); }
        });
        dd.appendChild(copy);
      }
      el.record.appendChild(dt);
      el.record.appendChild(dd);
    });
    var note = document.createElement("p");
    note.className = "record-note";
    note.textContent = state.sample && state.sample.real
      ? "Real fingerprint: SHA-256 of the clip's hash, these settings and the engine version. Anyone with the clip can check it."
      : "Placeholder hashes for a synthetic test clip. A real reading's fingerprint is SHA-256 of the clip's hash, these settings and the engine version.";
    el.record.appendChild(note);
  }

  function selectText(node, full) {
    node.textContent = full;
    var range = document.createRange();
    range.selectNodeContents(node);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function renderFigure(r, progress) {
    el.figure.className = "figure " + verdictClass(r);
    el.compass.toggleAttribute("hidden", r.verdict !== "MOVING");
    if (r.verdict === "MOVING") {
      var metres = r.surfaceSpeedMetresPerSec != null;
      var target = metres ? r.surfaceSpeedMetresPerSec : r.surfaceSpeedPxPerSec;
      el.figureValue.textContent = num(target * progress, metres ? 2 : 1);
      el.figureUnit.textContent = metres ? "m/s" : "px/s";
      el.needle.setAttribute("transform", "rotate(" + (-r.directionDegrees) + " 24 24)");
      el.figureSub.textContent = (metres ? num(r.surfaceSpeedPxPerSec, 1) + " px/s · " : "") +
        "heading " + Math.round(r.directionDegrees) % 360 + "°, " + heading(r.directionDegrees) + " in the frame · " +
        pct(r.movingShare) + " of points moving";
    } else if (r.verdict === "STILL") {
      el.figureValue.textContent = "Still";
      el.figureUnit.textContent = "";
      el.figureSub.textContent = pct(r.movingShare) + " of " + num(r.waterTracksMedian, 0) +
        " points moved faster than " + num(r.movingThresholdPxPerSec, 1) + " px/s";
    } else {
      el.figureValue.textContent = "Refused";
      el.figureUnit.textContent = "";
      var gate = GATES.find(function (g) { return g.key === r.refusal; });
      el.figureSub.textContent = gate ? "Stopped at the gate: " + gate.name.toLowerCase() : "The video couldn't be read";
    }
  }

  function renderReading(r) {
    el.verdict.textContent = verdictWord(r);
    el.verdict.className = "verdict " + verdictClass(r);
    el.meta.textContent = num(r.secondsAnalysed, 1) + " s analysed · " + r.pairsUsed + " of " + r.pairsTotal +
      " pairs used · " + r.width + "×" + r.height + " at " + num(r.frameRate, 0) + " fps";
    renderFigure(r, 1);
    el.reason.textContent = r.reason;
    el.note.textContent = r.note || "";
    el.note.hidden = !r.note;
    renderGates(gateRows(r), false);
    renderRecord(r);
  }

  /* ---------- the measuring sequence ---------- */

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function animateNumber(r, ms) {
    return new Promise(function (resolve) {
      var start = performance.now();
      function frame(now) {
        var t = Math.min(1, (now - start) / ms);
        renderFigure(r, 1 - Math.pow(1 - t, 3));
        if (t < 1) requestAnimationFrame(frame); else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  function animateReveal(ms) {
    var start = performance.now();
    function frame(now) {
      scene.reveal = Math.min(1, (now - start) / ms);
      if (scene.reveal < 1) requestAnimationFrame(frame);
    }
    scene.reveal = 0;
    requestAnimationFrame(frame);
  }

  async function measure(r) {
    var run = ++state.run;
    if (reduceMotion) {
      scene.reveal = 1;
      renderReading(r);
      return;
    }
    el.readout.classList.add("is-measuring");
    el.verdict.textContent = "Measuring";
    el.verdict.className = "verdict is-working";
    el.figure.className = "figure is-working";
    el.figureValue.textContent = "…";
    el.figureUnit.textContent = "";
    el.compass.toggleAttribute("hidden", true);
    el.figureSub.textContent = "";
    el.reason.textContent = "";
    el.note.hidden = true;
    el.record.innerHTML = "";
    renderGates(gateRows(r), true);
    animateReveal(1800);

    var lines = [
      ["Reading frames", num(r.secondsAnalysed, 1) + " s at " + num(r.frameRate, 0) + " fps"],
      ["Finding points", num(r.waterTracksMedian, 0) + " on the water · " + num(r.backgroundTracksMedian, 0) + " on the banks"],
      ["Checking the camera", "steady in " + r.pairsUsed + " of " + r.pairsTotal + " pairs"],
      ["Running the gates", ""]
    ];
    el.log.hidden = false;
    el.log.innerHTML = "";
    for (var i = 0; i < lines.length; i++) {
      if (run !== state.run) return;
      var line = document.createElement("div");
      line.className = "log-line";
      line.innerHTML = '<span class="log-step"></span><span class="log-value"></span>';
      line.querySelector(".log-step").textContent = lines[i][0];
      line.querySelector(".log-value").textContent = lines[i][1];
      el.log.appendChild(line);
      await wait(320);
    }

    var rows = gateRows(r);
    var items = el.gates.children;
    for (var g = 0; g < rows.length; g++) {
      if (run !== state.run) return;
      items[g].className = "gate is-" + rows[g].status + " is-arriving";
      items[g].querySelector(".gate-value").textContent = rows[g].value;
      await wait(rows[g].status === "skip" ? 70 : 170);
    }
    if (run !== state.run) return;

    el.log.hidden = true;
    el.readout.classList.remove("is-measuring");
    el.verdict.textContent = verdictWord(r);
    el.verdict.className = "verdict " + verdictClass(r);
    el.meta.textContent = num(r.secondsAnalysed, 1) + " s analysed · " + r.pairsUsed + " of " + r.pairsTotal +
      " pairs used · " + r.width + "×" + r.height + " at " + num(r.frameRate, 0) + " fps";
    el.reason.textContent = r.reason;
    el.note.textContent = r.note || "";
    el.note.hidden = !r.note;
    renderRecord(r);
    await animateNumber(r, 650);
  }

  /* ---------- clips ---------- */

  function chooseSample(key, animate) {
    var sample = SAMPLES.find(function (s) { return s.key === key; }) || SAMPLES[0];
    state.sample = sample;
    state.own = false;
    state.boxChanged = false;
    state.region = sample.real ? regionOf(sample.reading) : (sample.region || DEFAULT_REGION);
    el.video.pause();
    if (sample.real && sample.video) {
      if (el.video.getAttribute("src") !== sample.video) el.video.src = sample.video;
      el.video.play().catch(function () {});
      scene.setMedia({ video: el.video, overlayImage: sample.overlayImage });
    } else if (sample.real) {
      el.video.removeAttribute("src");
      scene.setMedia({ image: sample.evidenceImage });
    } else {
      el.video.removeAttribute("src");
      scene.setVideo(null);
    }
    scene.setConfig(sample.real ? {} : sample.scene, state.region);
    el.hudSource.textContent = sample.real
      ? "Real footage · " + (sample.video ? "camera view" : "evidence frame")
      : "Synthetic test clip · " + sample.label.toLowerCase();
    el.hudRate.textContent = num(sample.reading.frameRate, sample.real ? 2 : 0) + " fps";
    el.credit.hidden = !sample.real;
    el.showTracking.disabled = !!(sample.real && !sample.video);
    el.showTracking.parentElement.title = el.showTracking.disabled ? "This clip's tracking is drawn on its evidence frame" : "";
    el.measureBtn.disabled = false;
    el.measureBtn.textContent = "Measure again";
    el.measureHint.textContent = "";
    updateBoxHud();
    Array.prototype.forEach.call(el.sampleList.querySelectorAll(".sample"), function (b) {
      var on = b.dataset.key === sample.key;
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
    if (animate) measure(sample.reading); else renderReading(sample.reading);
  }

  function renderSampleList() {
    el.sampleList.innerHTML = "";
    [["Real footage", REAL], ["Synthetic test clips", TESTS]].forEach(function (group) {
      if (!group[1].length) return;
      var label = document.createElement("span");
      label.className = "sample-group";
      label.textContent = group[0];
      el.sampleList.appendChild(label);
      group[1].forEach(addSampleButton);
    });
  }

  function addSampleButton(s) {
    {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "sample";
      b.setAttribute("role", "radio");
      b.dataset.key = s.key;
      b.innerHTML = '<span class="sample-dot ' + verdictClass(s.reading) + '" aria-hidden="true"></span><span></span>';
      b.lastChild.textContent = s.label;
      b.addEventListener("click", function () { chooseSample(s.key, true); });
      b.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        var i = SAMPLES.indexOf(s) + (e.key === "ArrowRight" ? 1 : -1);
        var next = SAMPLES[(i + SAMPLES.length) % SAMPLES.length];
        chooseSample(next.key, true);
        el.sampleList.querySelector('[data-key="' + next.key + '"]').focus();
      });
      el.sampleList.appendChild(b);
    }
  }

  el.ownFile.addEventListener("change", function () {
    var file = el.ownFile.files && el.ownFile.files[0];
    if (!file) return;
    state.run++;
    state.own = true;
    state.sample = null;
    el.video.src = URL.createObjectURL(file);
    el.video.play().catch(function () {});
    scene.setVideo(el.video);
    state.region = { x: 0.1, y: 0.3, w: 0.8, h: 0.5 };
    scene.setConfig({}, state.region);
    updateBoxHud();
    el.hudSource.textContent = "Your clip · " + file.name;
    el.hudRate.textContent = "fps read on upload";
    Array.prototype.forEach.call(el.sampleList.querySelectorAll(".sample"), function (b) { b.setAttribute("aria-checked", "false"); });
    el.credit.hidden = true;
    el.showTracking.disabled = false;

    el.readout.classList.remove("is-measuring");
    el.log.hidden = true;
    el.verdict.textContent = "Not measured";
    el.verdict.className = "verdict is-working";
    el.meta.textContent = file.name + " · " + (file.size / 1e6).toFixed(1) + " MB";
    el.figure.className = "figure is-working";
    el.figureValue.textContent = "—";
    el.figureUnit.textContent = "";
    el.compass.toggleAttribute("hidden", true);
    el.figureSub.textContent = "";
    el.reason.textContent = "Drag on the clip to draw the water box around the water only. Leave some bank outside it: the banks are how we check the camera held still.";
    el.note.textContent = "Measuring your own clips arrives when this page is connected to the engine.";
    el.note.hidden = false;
    renderGates(GATES.map(function (g) { return { name: g.name, value: "—", rule: "", status: "skip" }; }), true);
    el.record.innerHTML = "";
    el.measureBtn.disabled = true;
    el.measureBtn.textContent = "Measure";
    el.measureHint.textContent = "Not connected to the engine in this preview.";
  });

  el.measureBtn.addEventListener("click", function () {
    if (state.sample) measure(state.sample.reading);
  });

  el.showTracking.addEventListener("change", function () {
    scene.overlay = el.showTracking.checked;
    if (reduceMotion) scene.draw();
  });

  /* ---------- drawing the water box ---------- */

  function updateBoxHud() {
    var r = scene.drag || state.region;
    el.hudBox.textContent = "box x " + num(r.x, 2) + " · y " + num(r.y, 2) + " · w " + num(r.w, 2) + " · h " + num(r.h, 2);
  }

  // Pointer position as fractions of the picture itself, not the letterbox around it.
  function framePoint(e) {
    var rect = el.canvas.getBoundingClientRect();
    var c = scene.contentRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left - c.x) / c.w)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top - c.y) / c.h))
    };
  }

  var dragStart = null;
  el.canvas.addEventListener("pointerdown", function (e) {
    dragStart = framePoint(e);
    el.canvas.setPointerCapture(e.pointerId);
  });
  el.canvas.addEventListener("pointermove", function (e) {
    if (!dragStart) return;
    var p = framePoint(e);
    scene.drag = {
      x: Math.min(dragStart.x, p.x), y: Math.min(dragStart.y, p.y),
      w: Math.abs(p.x - dragStart.x), h: Math.abs(p.y - dragStart.y)
    };
    updateBoxHud();
    if (reduceMotion) scene.draw();
  });
  function endDrag() {
    if (!dragStart) return;
    var box = scene.drag;
    dragStart = null;
    scene.drag = null;
    // The engine refuses boxes under 5% of the frame, so the page does too.
    if (box && box.w >= 0.05 && box.h >= 0.05) {
      state.region = box;
      scene.setRegion(box);
      if (state.sample) {
        state.boxChanged = true;
        el.measureHint.textContent = "Box redrawn. This sample's result was measured with its original box; your box is used once the engine is connected.";
      }
    }
    updateBoxHud();
    if (reduceMotion) scene.draw();
  }
  el.canvas.addEventListener("pointerup", endDrag);
  el.canvas.addEventListener("pointercancel", endDrag);

  /* ---------- readings ---------- */

  function arrowSvg(deg) {
    return '<svg class="dir" viewBox="0 0 20 20" aria-hidden="true"><g transform="rotate(' + (-deg) + ' 10 10)">' +
      '<path d="M3 10h12"/><path d="M15 10l-4-3v6z"/></g></svg>';
  }

  function renderFilters() {
    var counts = { ALL: SAMPLES.length, MOVING: 0, STILL: 0, REFUSED: 0 };
    SAMPLES.forEach(function (s) { counts[s.reading.verdict]++; });
    var labels = { ALL: "All", MOVING: "Moving", STILL: "Still", REFUSED: "Refused" };
    el.filters.innerHTML = "";
    Object.keys(labels).forEach(function (key) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "filter";
      b.setAttribute("aria-pressed", state.filter === key ? "true" : "false");
      b.innerHTML = "<span></span><b></b>";
      b.firstChild.textContent = labels[key];
      b.lastChild.textContent = counts[key];
      b.addEventListener("click", function () { state.filter = key; renderFilters(); renderReadings(); });
      el.filters.appendChild(b);
    });
  }

  function renderReadings() {
    el.readingsBody.innerHTML = "";
    SAMPLES.slice().sort(function (a, b) { return b.reading.id - a.reading.id; })
      .filter(function (s) { return state.filter === "ALL" || s.reading.verdict === state.filter; })
      .forEach(function (s) {
        var r = s.reading;
        var tr = document.createElement("tr");
        tr.tabIndex = 0;
        tr.innerHTML =
          '<td class="data"></td>' +
          '<td><span class="clip-name"></span><small class="clip-site"></small></td>' +
          '<td><span class="verdict small ' + verdictClass(r) + '"></span></td>' +
          '<td class="num data"></td>' +
          '<td class="data">' + (r.directionDegrees != null ? arrowSvg(r.directionDegrees) + Math.round(r.directionDegrees) % 360 + "°" : "—") + "</td>" +
          '<td class="num data"></td>' +
          '<td class="num data"></td>' +
          '<td class="why"></td>';
        var cells = tr.children;
        cells[0].textContent = clock(r.createdAt);
        cells[1].querySelector(".clip-name").textContent = s.label;
        cells[1].querySelector(".clip-site").textContent = (s.real ? "real · " : "synthetic · ") + r.fileName;
        cells[2].firstChild.textContent = verdictWord(r);
        cells[3].textContent = speedText(r);
        cells[5].textContent = num(r.waterTracksMedian, 0) + " / " + num(r.backgroundTracksMedian, 0);
        cells[6].textContent = r.pairsUsed + " / " + r.pairsTotal;
        cells[7].textContent = r.reason;
        var open = function () { location.hash = "measure"; chooseSample(s.key, true); };
        tr.addEventListener("click", open);
        tr.addEventListener("keydown", function (e) { if (e.key === "Enter") open(); });
        el.readingsBody.appendChild(tr);
      });
  }

  /* ---------- views ---------- */

  function showView() {
    var name = (location.hash || "#measure").slice(1);
    if (["measure", "readings", "method"].indexOf(name) === -1) name = "measure";
    document.querySelectorAll(".view").forEach(function (v) { v.hidden = v.dataset.view !== name; });
    document.querySelectorAll(".tabs a").forEach(function (a) {
      if (a.dataset.view === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    if (name === "measure") requestAnimationFrame(function () { scene.resize(); scene.draw(); });
  }
  window.addEventListener("hashchange", showView);

  /* ---------- loop ---------- */

  var last = performance.now();
  function loop(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!document.getElementById("view-measure").hidden) {
      scene.step(dt);
      scene.draw();
      var playing = state.own || (state.sample && state.sample.real && state.sample.video);
      var seconds = playing ? el.video.currentTime
        : scene.time % (state.sample ? state.sample.reading.secondsAnalysed + 0.1 : 5);
      var mm = Math.floor(seconds / 60), ss = seconds % 60;
      el.hudTime.textContent = String(mm).padStart(2, "0") + ":" + ss.toFixed(2).padStart(5, "0");
    }
    requestAnimationFrame(loop);
  }

  new ResizeObserver(function () { scene.resize(); scene.draw(); }).observe(el.viewport);

  renderSampleList();
  renderFilters();
  renderReadings();
  chooseSample(SAMPLES[0].key, false);
  showView();
  if (reduceMotion) {
    // Advance once so trails exist, then hold a still frame.
    for (var i = 0; i < 20; i++) scene.step(1 / 30);
    scene.draw();
  } else {
    requestAnimationFrame(loop);
  }
})();
