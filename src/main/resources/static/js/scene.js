/*
 * The viewport. Three kinds of picture:
 *  - real footage: the clip itself, with the engine's tracking overlay (a transparent PNG) laid on top;
 *  - an evidence frame: the engine's picture of one frame with its marks, for clips browsers can't play;
 *  - a synthetic test clip: a textured strip sliding between two banks, drawn the way the engine's test clips are
 *    made, with animated trails. These are test fixtures, not what a river looks like.
 * Real pictures are letterboxed, never cropped, so the water box lines up with the frame the engine saw.
 */
window.SlackWaterScene = (function () {
  var BAND_TOP = 1 / 3;
  var BAND_HEIGHT = 1 / 3;
  var SOURCE_WIDTH = 640; // the engine's analysis width; scene speeds are given in these pixels
  var STRIPES = 8;

  function seeded(seed) {
    return function () {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
  }

  // Smoothed noise in the colours of a real clip: muddy green-grey banks, brown-grey water.
  function texture(size, base, spread, flecks, seed) {
    var c = document.createElement("canvas");
    c.width = c.height = size;
    var g = c.getContext("2d");
    var rnd = seeded(seed);
    g.fillStyle = "rgb(" + base.join(",") + ")";
    g.fillRect(0, 0, size, size);
    for (var i = 0; i < size * size / 9; i++) {
      var shade = (rnd() - 0.5) * spread;
      g.fillStyle = "rgba(" + (base[0] + shade | 0) + "," + (base[1] + shade | 0) + "," + (base[2] + shade | 0) + ",0.55)";
      var r = 0.6 + rnd() * 2.2;
      g.beginPath();
      g.ellipse(rnd() * size, rnd() * size, r * (1 + rnd()), r, rnd() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    for (var j = 0; j < flecks; j++) {
      g.fillStyle = "rgba(236,240,238," + (0.35 + rnd() * 0.5) + ")";
      g.beginPath();
      g.arc(rnd() * size, rnd() * size, 0.6 + rnd() * 1.4, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  }

  function Scene(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.water = texture(256, [92, 86, 76], 46, 90, 7);
    this.banks = texture(256, [64, 78, 52], 58, 0, 11);
    this.config = {};
    this.region = { x: 0, y: BAND_TOP, w: 1, h: BAND_HEIGHT };
    this.reveal = 1;        // 0..1, how much of the tracking overlay to show
    this.overlay = true;
    this.video = null;
    this.image = null;          // an evidence frame
    this.overlayImage = null;   // transparent tracking marks for a playing clip
    this.time = 0;
    this.camera = { x: 0, y: 0 };
    this.stripeDirs = [];
    var rnd = seeded(42);
    for (var s = 0; s < STRIPES; s++) {
      var a = rnd() * Math.PI * 2;
      this.stripeDirs.push({ dx: 2 * Math.cos(a), dy: 2 * Math.sin(a) });
    }
    this.resize();
    this.seedPoints();
  }

  Scene.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * ratio);
    this.canvas.height = Math.round(rect.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.scale = this.width / SOURCE_WIDTH;
  };

  Scene.prototype.setConfig = function (config, region) {
    this.config = config || {};
    if (region) this.region = { x: region.x, y: region.y, w: region.w, h: region.h };
    this.seedPoints();
  };

  Scene.prototype.setRegion = function (region) {
    this.region = region;
    this.seedPoints();
  };

  Scene.prototype.setVideo = function (video) {
    this.video = video;
    this.image = null;
    this.overlayImage = null;
  };

  // Real footage: a playing clip (with optional overlay) or a still evidence frame.
  Scene.prototype.setMedia = function (media) {
    this.video = media.video || null;
    this.image = media.image || null;
    this.overlayImage = media.overlayImage || null;
  };

  Scene.prototype.isReal = function () {
    return !!(this.video || this.image);
  };

  // Where the picture actually sits on the canvas, in CSS pixels: letterboxed to keep its shape.
  Scene.prototype.contentRect = function () {
    var w = 0, h = 0;
    if (this.image && this.image.naturalWidth) { w = this.image.naturalWidth; h = this.image.naturalHeight; }
    else if (this.video && this.video.videoWidth) { w = this.video.videoWidth; h = this.video.videoHeight; }
    if (!w || !h) return { x: 0, y: 0, w: this.width, h: this.height };
    var s = Math.min(this.width / w, this.height / h);
    return { x: (this.width - w * s) / 2, y: (this.height - h * s) / 2, w: w * s, h: h * s };
  };

  // Water velocity, in scene pixels per second, at a point given as frame fractions.
  Scene.prototype.velocityAt = function (fx, fy) {
    var c = this.config;
    if (this.isReal() || c.flat) return null;
    if (fy < BAND_TOP || fy > BAND_TOP + BAND_HEIGHT) return { vx: 0, vy: 0 };
    var perSecond = 30 * this.scale;
    if (c.mixed) {
      var d = this.stripeDirs[Math.min(STRIPES - 1, Math.floor(fx * STRIPES))];
      return { vx: d.dx * perSecond, vy: d.dy * perSecond };
    }
    return { vx: (c.dx || 0) * perSecond, vy: (c.dy || 0) * perSecond };
  };

  Scene.prototype.seedPoints = function () {
    var rnd = seeded(5);
    var r = this.region;
    this.waterPoints = [];
    this.bankPoints = [];
    for (var i = 0; i < 70; i++) {
      this.waterPoints.push(this.spawn(rnd(), rnd()));
    }
    var tries = 0;
    while (this.bankPoints.length < 34 && tries++ < 2000) {
      var fx = 0.03 + rnd() * 0.94;
      var fy = 0.04 + rnd() * 0.92;
      var inside = fx > r.x - 0.02 && fx < r.x + r.w + 0.02 && fy > r.y - 0.03 && fy < r.y + r.h + 0.03;
      if (!inside) this.bankPoints.push({ fx: fx, fy: fy });
    }
  };

  Scene.prototype.spawn = function (u, v) {
    var r = this.region;
    return { fx: r.x + 0.02 + u * (r.w - 0.04), fy: r.y + 0.04 + v * (r.h - 0.08), trail: [] };
  };

  Scene.prototype.step = function (dt) {
    this.time += dt;
    var c = this.config;
    if (c.shake && !this.isReal()) {
      // A new random camera offset every frame of a 30 fps clip, like a hand-held phone.
      if (!this.lastShake || this.time - this.lastShake > 1 / 30) {
        this.lastShake = this.time;
        this.camera.x = (Math.random() * 2 - 1) * c.shake * this.scale;
        this.camera.y = (Math.random() * 2 - 1) * c.shake * this.scale;
      }
    } else {
      this.camera.x = this.camera.y = 0;
    }
    var r = this.region;
    for (var i = 0; i < this.waterPoints.length; i++) {
      var p = this.waterPoints[i];
      var v = this.velocityAt(p.fx, p.fy);
      if (!v) continue;
      p.fx += v.vx * dt / this.width;
      p.fy += v.vy * dt / this.height;
      p.trail.push({ fx: p.fx, fy: p.fy });
      if (p.trail.length > 14) p.trail.shift();
      var out = p.fx < r.x || p.fx > r.x + r.w || p.fy < r.y || p.fy > r.y + r.h;
      if (out) {
        var np = this.spawn(Math.random(), Math.random());
        // Re-enter from the upstream edge so the box stays full.
        if (v.vx > 0) np.fx = r.x + 0.01;
        else if (v.vx < 0) np.fx = r.x + r.w - 0.01;
        if (v.vy > 0 && Math.abs(v.vy) > Math.abs(v.vx)) np.fy = r.y + 0.01;
        else if (v.vy < 0 && Math.abs(v.vy) > Math.abs(v.vx)) np.fy = r.y + r.h - 0.01;
        this.waterPoints[i] = np;
      }
    }
  };

  Scene.prototype.drawPattern = function (pattern, x, y, w, h, offsetX, offsetY) {
    var g = this.ctx;
    // The texture repeats every 256 px, so keep offsets small to avoid float drift over a long session.
    offsetX = ((offsetX % 256) + 256) % 256;
    offsetY = ((offsetY % 256) + 256) % 256;
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.translate(offsetX, offsetY);
    g.fillStyle = pattern;
    g.fillRect(x - offsetX - 256, y - offsetY - 256, w + 512, h + 512);
    g.restore();
  };

  Scene.prototype.draw = function () {
    var g = this.ctx;
    var W = this.width, H = this.height;
    var cam = this.camera;
    g.clearRect(0, 0, W, H);
    var marksInPicture = false;

    if (this.isReal()) {
      var rect = this.contentRect();
      g.fillStyle = "#0d110f";
      g.fillRect(0, 0, W, H);
      if (this.image && this.image.complete && this.image.naturalWidth) {
        g.drawImage(this.image, rect.x, rect.y, rect.w, rect.h);
        marksInPicture = true; // the evidence frame already has the box and the marks
      } else if (this.video && this.video.readyState >= 2) {
        g.drawImage(this.video, rect.x, rect.y, rect.w, rect.h);
        if (this.overlay && this.overlayImage && this.overlayImage.complete && this.overlayImage.naturalWidth) {
          g.globalAlpha = Math.min(1, this.reveal * 1.2);
          g.drawImage(this.overlayImage, rect.x, rect.y, rect.w, rect.h);
          g.globalAlpha = 1;
          marksInPicture = this.reveal >= 1;
        }
      }
    } else {
      if (!this.bankPattern) {
        this.bankPattern = g.createPattern(this.banks, "repeat");
        this.waterPattern = g.createPattern(this.water, "repeat");
      }
      this.drawPattern(this.bankPattern, 0, 0, W, H, cam.x, cam.y);
      var top = BAND_TOP * H, h = BAND_HEIGHT * H;
      var c = this.config;
      var perSecond = 30 * this.scale;
      if (c.flat) {
        g.fillStyle = "rgb(98,92,82)";
        g.fillRect(0, top, W, h);
      } else if (c.mixed) {
        var sw = W / STRIPES;
        for (var s2 = 0; s2 < STRIPES; s2++) {
          var d = this.stripeDirs[s2];
          this.drawPattern(this.waterPattern, s2 * sw, top, sw + 0.5, h,
            cam.x + d.dx * perSecond * this.time, cam.y + d.dy * perSecond * this.time);
        }
      } else {
        this.drawPattern(this.waterPattern, 0, top, W, h,
          cam.x + (c.dx || 0) * perSecond * this.time, cam.y + (c.dy || 0) * perSecond * this.time);
      }
      // The water's edge: a soft wet line where bank meets water.
      g.fillStyle = "rgba(20,24,18,0.35)";
      g.fillRect(0, top - 1.5, W, 3);
      g.fillRect(0, top + h - 1.5, W, 3);
    }

    if (this.overlay && !this.isReal()) this.drawTracking();
    if (!marksInPicture || this.drag) this.drawBox();
  };

  Scene.prototype.drawTracking = function () {
    var g = this.ctx;
    var W = this.width, H = this.height, cam = this.camera;
    var reveal = this.reveal;
    var styles = getComputedStyle(document.documentElement);
    var waterInk = styles.getPropertyValue("--trace-water").trim() || "#7fe3ff";
    var bankInk = styles.getPropertyValue("--trace-bank").trim() || "#f4f1e6";
    var warnInk = styles.getPropertyValue("--trace-warn").trim() || "#ffb347";
    var c = this.config;

    // Bank points: small crosses. When the camera shakes, they move, and turn amber.
    var bankShow = Math.min(1, reveal * 2);
    if (bankShow > 0) {
      g.lineWidth = 1.4;
      g.strokeStyle = c.shake ? warnInk : bankInk;
      g.globalAlpha = 0.9 * bankShow;
      for (var b = 0; b < this.bankPoints.length; b++) {
        var bp = this.bankPoints[b];
        var x = bp.fx * W + cam.x, y = bp.fy * H + cam.y;
        g.beginPath();
        g.moveTo(x - 3.5, y); g.lineTo(x + 3.5, y);
        g.moveTo(x, y - 3.5); g.lineTo(x, y + 3.5);
        g.stroke();
        if (c.shake) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x - cam.x * 3, y - cam.y * 3);
          g.stroke();
        }
      }
    }

    // Water points: a fading trail behind each one, like a long-exposure photo of foam.
    var waterShow = Math.max(0, Math.min(1, reveal * 2 - 0.6));
    if (waterShow <= 0 || c.flat) {
      g.globalAlpha = 1;
      return;
    }
    var ink = c.mixed ? warnInk : waterInk;
    g.strokeStyle = ink;
    g.fillStyle = ink;
    for (var i = 0; i < this.waterPoints.length; i++) {
      var p = this.waterPoints[i];
      var t = p.trail;
      if (t.length > 1) {
        for (var k = 1; k < t.length; k++) {
          g.globalAlpha = waterShow * (k / t.length) * 0.85;
          g.lineWidth = 1 + 1.2 * (k / t.length);
          g.beginPath();
          g.moveTo(t[k - 1].fx * W + cam.x, t[k - 1].fy * H + cam.y);
          g.lineTo(t[k].fx * W + cam.x, t[k].fy * H + cam.y);
          g.stroke();
        }
      }
      g.globalAlpha = waterShow;
      g.beginPath();
      var still = !c.dx && !c.dy && !c.mixed;
      if (still) {
        g.lineWidth = 1.2;
        g.arc(p.fx * W + cam.x, p.fy * H + cam.y, 2.6, 0, Math.PI * 2);
        g.stroke();
      } else {
        g.arc(p.fx * W + cam.x, p.fy * H + cam.y, 1.8, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  };

  Scene.prototype.drawBox = function () {
    var g = this.ctx;
    var r = this.drag || this.region;
    var c = this.contentRect();
    var x = c.x + r.x * c.w, y = c.y + r.y * c.h, w = r.w * c.w, h = r.h * c.h;
    var styles = getComputedStyle(document.documentElement);
    var gauge = styles.getPropertyValue("--gauge").trim() || "#f2c641";
    g.save();
    g.lineWidth = 1.5;
    g.strokeStyle = "rgba(0,0,0,0.55)";
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.strokeStyle = gauge;
    g.setLineDash([7, 5]);
    g.lineDashOffset = -this.time * 18;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.setLineDash([]);
    // Corner ticks, like the marks on a staff gauge.
    g.lineWidth = 2.5;
    var t = 10;
    [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(function (c) {
      g.beginPath();
      g.moveTo(c[0] + c[2] * t, c[1]); g.lineTo(c[0], c[1]); g.lineTo(c[0], c[1] + c[3] * t);
      g.stroke();
    });
    g.restore();
  };

  return Scene;
})();
