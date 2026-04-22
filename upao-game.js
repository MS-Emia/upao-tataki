const CONFIG = {
  gameLimit: 60,
  minSpawnInterval: 800,
  maxSpawnInterval: 1500,
  upaoShowTime: 1200,
  normalSpawn: 70,
  rareSpawn: 10,
  angrySpawn: 20,
  normalPoints: 1,
  rarePoints: 5,
  angryPoints: -3,
  feverCombo: 7,
  feverTimeMs: 5000,
  feverRareRate: 30,
  feverBonus: 2,
  timeBonus: 5,
  timeBonusCombo: 16,
  
  gaugeUp: 7,
  gaugeUpRare: 15,
  gaugeDownAngry: 15,
  gaugeDownMiss: 3,
  gaugeLv2: 40,
  gaugeLv3: 70,
  gaugeLvMax: 95,
  gaugeDecayLv1: 0.07,
  gaugeDecayLv2: 0.14,
  gaugeDecayLv3: 0.20,
  gaugeMaxDecay: 1.2,
  scoreBonusLv1: 1.0,
  scoreBonusLv2: 1.5,
  scoreBonusLv3: 2.0,
  scoreBonusMax: 3.0,

  inkSpawn: 5,
  inkAnimeMs: 600,
  inkFadeMs: 3000,
};

const UPAO_IMAGES = {
  normal: [
    "img/normal_upao_1.PNG",
    "img/normal_upao_2.PNG",
    "img/normal_upao_3.PNG"
  ],
  rare: "img/rare_upao.PNG",
  angry: "img/angry_upao.PNG",
  damage: "img/damage_upao.PNG",
  ink: "img/ink_upao.PNG",
};

let gameState = {
  isPlaying: false,
  isTransitioning: false,
  score: 0,
  timeLeft: CONFIG.gameLimit,
  activeUpao: [],
  spawnTimer: null,
  countdownTimer: null,
  combo: 0,
  feverCombo: 0,
  timeBonusCombo: 0,
  isFever: false,
  feverTimer: null,
  gauge: 0,
  gaugeLevel: 1,
  gaugeMax: 0,
};


let _spawnCounter = 0;

let _countdownStartTs = 0;
let _countdownBase = CONFIG.gameLimit; 

let _gaugeDecayLastTime = null; 

const elements = {}; 


let audioContext = null;
const loadedSounds = {};

function _ensureAudioCtx() {
  if (audioContext) {
    return audioContext;
  }
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  } catch(e) {}
  return audioContext;
}

async function loadSound(name, url) {
  try {
    let ctx = _ensureAudioCtx();
    if (!ctx) {
      return;
    }

    const res = await fetch(url);
    const ab = await res.arrayBuffer();
    loadedSounds[name] = await ctx.decodeAudioData(ab);
  } catch(e) {}
}

function playSound(name) {
  let ctx = _ensureAudioCtx();
  if (!ctx) {
    return;
  }

  const buffer = loadedSounds[name];
  if (!buffer) {
    return;
  }
  if (ctx.state === "suspended") {
    ctx.resume();
  }

  const src = ctx.createBufferSource();
  const gain = ctx.createGain();

  gain.gain.value = 0.5;
  src.buffer = buffer;
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start(0);
}

async function loadAllSounds() {
  await Promise.all([
    loadSound("splash", "audio/splash.mp3"),
    loadSound("hit", "audio/hit.mp3"),
    loadSound("fever", "audio/fever.mp3"),
    loadSound("fake", "audio/miss.mp3"),
  ]);
}

function unlockAudio() {
  let ctx = _ensureAudioCtx();
  if (!ctx) {
    return;
  }
  if (ctx.state === "suspended") {
    ctx.resume();
  }

  Object.keys(loadedSounds).forEach(function(name) {
    let buf = loadedSounds[name];
    if (!buf) {
      return;
    }
    let src = ctx.createBufferSource();
    let gain = ctx.createGain();

    gain.gain.value = 0;
    src.buffer = buf;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start(0);
    src.stop(ctx.currentTime + 0.001);
  });
}

document.addEventListener("pointerdown", unlockAudio, { once: true });
document.addEventListener("touchstart", unlockAudio, { once: true });
document.addEventListener("click", unlockAudio, { once: true });

let _lastSplashTime = 0;
// 水音の重なりが不快なので無視
function playGameSound(name) {
  if (name === "splash") {
    let now = Date.now();

    if (now - _lastSplashTime < 150) {
      return;
    }
    _lastSplashTime = now;
  }
  playSound(name);
}


let _seaCanvas = null;
let _seaCtx = null;
let _seaTime = 0;
let _seaLoopId = null;

function initSeaCanvas() {
  _seaCanvas = document.getElementById("sea-canvas");
  if (!_seaCanvas) {
    return;
  }
  _seaCtx = _seaCanvas.getContext("2d");

  resizeSeaCanvas();

  if (_seaLoopId) {
    cancelAnimationFrame(_seaLoopId);
  }
  _seaTime = 0;
  requestAnimationFrame(updateSea);
}

function stopSeaCanvas() {
  if (_seaLoopId) {
    cancelAnimationFrame(_seaLoopId);
    _seaLoopId = null;
  }
}


function resizeSeaCanvas() {
  if (!_seaCanvas) {
    return;
  }
  const seaTopStr = getComputedStyle(document.documentElement)
    .getPropertyValue("--sea-top")
    .trim();

  const seaTopPct = parseFloat(seaTopStr) / 100 || 0.18;

  const logicalW = 430;
  const logicalH = Math.ceil(870 * (1 - seaTopPct));

  _seaH = logicalH;
  _skyGradient = null;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  _seaCanvas.width  = logicalW * dpr;
  _seaCanvas.height = logicalH * dpr;

  if (_seaCtx) {
    _seaCtx.scale(dpr, dpr);
  }
}

let _seaLastTimeSt = null;
let _seaH = Math.ceil(870 * (1 - 0.18));
let _skyGradient = null;


let _SIN_TABLE_SIZE = 4096;
let _SIN_TABLE = new Float32Array(_SIN_TABLE_SIZE);
let _SIN_SCALE = _SIN_TABLE_SIZE / (2 * Math.PI);


(function () {
  for (let i = 0; i < _SIN_TABLE_SIZE; i++) {
    _SIN_TABLE[i] = Math.sin((i / _SIN_TABLE_SIZE) * 2 * Math.PI);
  }
})();

function _sin(x) {
  let idx = ((x * _SIN_SCALE) | 0) & (_SIN_TABLE_SIZE - 1);
  return _SIN_TABLE[idx >= 0 ? idx : idx + _SIN_TABLE_SIZE];
}


let _waveLayerStyles = (function () {
  let styles = [];

  for (let i = 0; i < 6; i++) {
    let ratio = i / 5;

    let r = Math.round(15  - 12  * ratio);
    let g = Math.round(155 - 95  * ratio);
    let b = Math.round(210 - 70  * ratio);

    let alpha = (0.08 + ratio * 0.17).toFixed(3);

    styles.push({
      fillStyle: "rgba(" + r + "," + g + "," + b + "," + alpha + ")",
      amp: (1.5 + ratio * 22) * 2
    });
  }

  return styles;
})();


let _whitewaveStyles = (function() {

  let defs = [
    [0.00, 0.55, 0.7,  0.30],
    [0.05, 0.48, 0.8,  0.45],
    [0.10, 0.38, 0.9,  0.60],
    [0.18, 0.28, 1.0,  0.80],
    [0.26, 0.18, 1.1,  1.00],
    [0.42, 0.14, 1.4,  1.30],
    [0.65, 0.11, 2.0,  1.60],
    [0.85, 0.08, 2.8,  1.90],
  ];

  return defs.map(function(d) {
    let ratio = d[0],
        ampScale = d[3];

    return {
      ratio: ratio,
      strokeStyle: "rgba(230,250,255," + d[1].toFixed(3) + ")",
      lineWidth: d[2],
      amp2: (2.0 + ratio * 18) * 2 * ampScale,
      step: ratio < 0.3 ? 6 : 9,
    };
  });
})();


function _getSkyGradient() {
  if (_skyGradient) {
    return _skyGradient;
  }

  _skyGradient = _seaCtx.createLinearGradient(
    0, 0,
    0, -50
  );

  _skyGradient.addColorStop(0, "#ffffff");
  _skyGradient.addColorStop(0.5, "#ffffff");
  _skyGradient.addColorStop(0.8, "#f0ffff");
  _skyGradient.addColorStop(1, "#e0ffff");

  return _skyGradient;
}

function updateSea(ts) {
  if (!_seaCtx || !_seaCanvas) {
    return;
  }

  let dt = Math.min((ts - (_seaLastTimeSt || ts)) / 1000, 0.05);
  _seaLastTimeSt = ts;
  _seaTime += dt;

  let W = 430;
  let H = _seaH;

  let t = _seaTime;

  _seaCtx.clearRect(0, 0, W, H);

  let skyGrad = _getSkyGradient();

  _seaCtx.beginPath();
  _seaCtx.moveTo(-20, -50);

  for (let sx = -20; sx <= W + 20; sx += 10) {
    _seaCtx.lineTo(
      sx,
      _sin(sx * 0.010 + t * 0.6) * 2.0 + _sin(sx * 0.020 - t * 0.50) * 0.9
    );
  }

  _seaCtx.lineTo(W + 20, -50);
  _seaCtx.closePath();

  _seaCtx.fillStyle = skyGrad;
  _seaCtx.fill();


  _seaCtx.beginPath();

  for (let wx = -20; wx <= W + 20; wx += 10) {
    let wy = _sin(wx * 0.010 + t * 0.7) * 1.5 + _sin(wx * 0.022 - t * 0.55) * 1.0;

    if (wx === -20) {
      _seaCtx.moveTo(wx, wy);
    } else {
       _seaCtx.lineTo(wx, wy);
    }
  }

  _seaCtx.strokeStyle = "rgba(255,255,255,0.95)";
  _seaCtx.lineWidth = 2.5;
  _seaCtx.stroke();

  for (let i = 0; i < 6; i++) {
    let ls = _waveLayerStyles[i];
    let ratio = i / 5;
    let baseY = ratio * H;
    let amp = ls.amp;

    let ph1 = i * 2.0;
    let ph2 = i * 0.9;

    let tph1 = t * 0.38 + ph1;
    let tph2 = t * 0.26 + ph2;

    _seaCtx.beginPath();
    _seaCtx.moveTo(-20, H);

    for (let x = -20; x <= W + 20; x += 8) {
      _seaCtx.lineTo(x, baseY + (_sin(x * 0.003 + tph1) * 0.65 + _sin(x * 0.007 + tph2) * 0.35) * amp);
    }

    _seaCtx.lineTo(W + 20, H);
    _seaCtx.closePath();

    _seaCtx.fillStyle = ls.fillStyle;
    _seaCtx.fill();
  }

  let t07 = t * 0.65;

  for (let j = 0; j < 8; j++) {
    let hs = _whitewaveStyles[j];
    let baseY2 = hs.ratio * H;
    let amp2 = hs.amp2;
    let step2 = hs.step;

    let tph3 = t07 + j * 1.9;
    let tph4 = -t07 * 0.75 + j * 0.8;

    _seaCtx.lineWidth = hs.lineWidth;
    _seaCtx.strokeStyle = hs.strokeStyle;

    _seaCtx.beginPath();

    for (let x2 = -20; x2 <= W + 20; x2 += step2) {
      let y2 = baseY2 + (_sin(x2 * 0.004 + tph3) * 0.6 + _sin(x2 * 0.009 + tph4) * 0.4) * amp2;
       if (x2 === -20) {
        _seaCtx.moveTo(x2, y2);
       } else {
        _seaCtx.lineTo(x2, y2);
       }
    }

    _seaCtx.stroke();
  }

  tickAmbientEffects(ts);

  if (gameState.isFever) {
    spawnFeverParticle(ts);
  }

  if (gameState.isPlaying) {
    let pdDelta = (_gaugeDecayLastTime !== null) ? Math.min((ts - _gaugeDecayLastTime) / 1000, 0.05) : 0;

    _gaugeDecayLastTime = ts;

    if (pdDelta > 0) {
      if (gameState.gaugeLevel === 4) {

        gameState.gaugeMax -=
          CONFIG.gaugeMaxDecay * 10 * pdDelta;

        if (gameState.gaugeMax <= 0) {

          gameState.gaugeMax = 0;
          gameState.gauge = 0;
          gameState.gaugeLevel = 1;

          _gaugeDisplayCache.level = -1;

          renderGauge(0, 1);
          showLevelDownPop();

        } else {
          renderGauge(gameState.gauge, 4);
        }

      } else {

        let pdDecay = [
          0,
          CONFIG.gaugeDecayLv1 * 10,
          CONFIG.gaugeDecayLv2 * 10,
          CONFIG.gaugeDecayLv3 * 10
        ][gameState.gaugeLevel];

        gaugeDecay(pdDecay * pdDelta);
      }
    }

  } else {
    _gaugeDecayLastTime = null;
  }

  _seaLoopId = requestAnimationFrame(updateSea);
}

document.addEventListener("DOMContentLoaded", function() {


// 初期化
  cacheElements();
  setEventListeners();
  setHammer();
  setMuteButton();

  loadImages();
  loadAllSounds();

  initSeaCanvas();
  startAmbientEffects();

  initWaveClips();
  initBirds();

  switchStartImage();
  setAppHeight();


  
  window.addEventListener("resize", function() {

    setAppHeight();
    resizeGameContainer();
    resizeSeaCanvas();

    switchStartImage();

    _containerRect = null;
  });


  window.addEventListener("orientationchange", function() {

    setTimeout(function() {

      setAppHeight();
      resizeGameContainer();
      resizeSeaCanvas();

      switchStartImage();

      _containerRect = null;

    }, 200);
  });


  if (window.visualViewport) {
    let _vpResizeTimer = null;

    window.visualViewport.addEventListener("resize", function() {

      if (_vpResizeTimer) {
        clearTimeout(_vpResizeTimer);
      }

      _vpResizeTimer = setTimeout(function() {

        _vpResizeTimer = null;

        setAppHeight();
        resizeGameContainer();

        _containerRect = null;

      }, 100);

    });
  }


  document.addEventListener("visibilitychange", function() {

    if (document.visibilityState === "visible") {

      if (audioContext && audioContext.state === "suspended") {
        audioContext.resume();
      }

    }
  });



  window.addEventListener("blur", function() {
    if (elements.hammer) {
      elements.hammer.classList.remove("show");
    }
  });


  resizeGameContainer();

});



function initBirds() {
  let birds = document.querySelectorAll(".bird");

  birds.forEach(function(bird) {
    let goRight = Math.random() < 0.5;

    // 調整
    let duration = (30 + Math.random() * 35).toFixed(1) + "s";

    let delay = -(Math.random() * 60).toFixed(1) + "s";

    let animName = goRight ? "birdFlyLR" : "birdFlyRL";

    bird.style.animation =
      animName + " " +
      duration + " " +
      "linear infinite " +
      delay;
  });

}

function setAppHeight() {
  document.documentElement.style.setProperty(
    "--app-height",
    window.innerHeight + "px"
  );
}

function switchStartImage() {
  let img = document.getElementById("start-image");
  if (!img) {
    return;
  }


  let isSmartphone = window.innerWidth <= 600;

  let isPortrait = window.innerHeight > window.innerWidth;


  if (isSmartphone && isPortrait) {
    img.src = "img/start_game_portrait.png";
  } else {
    img.src = "img/start_game.png";
  }
}


function cacheElements() {
  elements.startScreen = document.getElementById("start-screen");
  elements.gameContainer  = document.getElementById("game-container");
  elements.startBtn = document.getElementById("start-btn");
  elements.startBtnWrapper = document.getElementById("start-btn-wrapper");

  elements.scoreDisplay = document.getElementById("score");
  elements.timeDisplay = document.getElementById("time");
  elements.holes = document.querySelectorAll(".hole");
  elements.hammer = document.getElementById("hammer");

  elements.resultScreen  = document.getElementById("result-screen");
  elements.finalScore = document.getElementById("final-score");
  elements.retryBtn = document.getElementById("retry-btn");
  elements.shareBtn = document.getElementById("share-btn");

  elements.seaLayer = document.getElementById("sea-layer");
  elements.feverIndicator = document.getElementById("fever-indicator");
  elements.feverText = document.getElementById("fever-text");

  elements.comboDisplay = document.getElementById("combo-display");
  elements.comboNum = document.getElementById("combo");

  elements.muteBtn = document.getElementById("mute-btn");
  elements.btnUpao = document.getElementById("btn-upao");

  elements.levelBar = document.getElementById("level-bar");
  elements.levelLabel = document.getElementById("level-label");
  elements.levelBarFill = document.getElementById("level-bar-fill");

  elements.resultTitle = document.getElementById("result-title");
  elements.resultStarDiv = document.querySelector(".star-divider");
  elements.resultContent = document.getElementById("result-content");
  elements.resultRows = document.querySelectorAll(".result-row");
  elements.resultBtns = document.getElementById("result-btns");
  elements.finalBest1 = document.getElementById("final-best1");
  elements.finalBest2 = document.getElementById("final-best2");
  elements.finalBest3 = document.getElementById("final-best3");
  elements.finalCombo = document.getElementById("final-combo");


  elements.holeContainers = [];
  elements.holeImgs = [];

  elements.holes.forEach(function(hole) {
    let container = hole.querySelector(".upao-container");

    let img = document.createElement("img");

    img.alt       = "うぱお";
    img.draggable = false;
    container.appendChild(img);

    elements.holeContainers.push(container);
    elements.holeImgs.push(img);
  });

  renderGauge(0, 1);
}


function setEventListeners() {
  elements.gameContainer.addEventListener("pointerdown", function(e) {
      if (e.pointerType === "mouse" && e.button !== 0) {
        return;
      }

      if (gameState.isPlaying) {
        return;
      }
      if (elements.resultScreen.classList.contains("show")) {
        return;
      }

      e.preventDefault();

      startClick(e.clientX, e.clientY);
    },
    { passive: false }
  );

  elements.retryBtn.addEventListener("pointerdown", function(e) {
      if (e.pointerType === "mouse" && e.button !== 0) {
        return;
      }

      e.stopPropagation();

      retryGame();
    }
  );

   
   elements.shareBtn.addEventListener("click", function(e) {
     e.stopPropagation();

     shareScore();
});


  elements.holes.forEach(function(hole) {
    hole.addEventListener("pointerdown", function(e) {
        if (e.pointerType === "mouse" && e.button !== 0) {
          return;
        }

        e.preventDefault();

        upaoHit(e, hole);
      },
      { passive: false }
    );
  });
}



function startClick(clientX, clientY) {
  if (gameState.isPlaying) {
    return;
  }
  if (gameState.isTransitioning) {
    return;
  }
  if (elements.resultScreen.classList.contains("show")) {
    return;
  }

  gameState.isTransitioning = true;

  if (!_containerRect) {
    _updateContainerBounds();
  }

  let x = (clientX - _containerRect.left) / _containerScale;
  let y = (clientY - _containerRect.top) / _containerScale;

  [0, 250].forEach(function(delay) {
    let ripple = document.createElement("div");
    ripple.className = "tap-ripple";

    let size = 120;

    ripple.style.cssText = `
      width: ${size}px;
      height: ${size}px;
      left: ${x - size / 2}px;
      top: ${y - size / 2}px;
      animation-delay: ${delay}ms;
      `;

    elements.gameContainer.appendChild(ripple);

    setTimeout(function() {
      ripple.remove();
    }, delay + 800);
  });


  let banner = document.getElementById("start-banner");

  if (banner) {
    banner.style.display = "none";
  }

  setTimeout(function() {
    playGameSound("whistle");

    if (elements.btnUpao) {
      elements.btnUpao.classList.remove("hide");
      elements.btnUpao.classList.add("show");
    }
  }, 200);


  setTimeout(function() {
    if (elements.btnUpao) {
      elements.btnUpao.classList.remove("show");
      elements.btnUpao.classList.add("hide");
    }
  }, 1800);


  setTimeout(function() {
    if (elements.btnUpao) {
      elements.btnUpao.classList.remove("hide");
    }

    gameState.isTransitioning = false;

    startGame();
  }, 2500);
}


let _containerRect  = null;
let _containerScale = 1;

function _updateContainerBounds() {
  _containerRect =
    elements.gameContainer.getBoundingClientRect();

  _containerScale = _containerRect.width / 430;
}


function toGameCoords(clientX, clientY) {
  if (!_containerRect) {
    _updateContainerBounds();
  }

  return {
    x:
      (clientX - _containerRect.left) /  _containerScale,

    y:
      (clientY - _containerRect.top) /  _containerScale
  };
}


let hammerUpdateQueued = false;

let _hammerX = 0
let _hammerY = 0;


function _applyHammerPosition() {
  elements.hammer.style.left = _hammerX + "px";
  elements.hammer.style.top = _hammerY + "px";

  hammerUpdateQueued = false;
}

function requestHammerUpdate(x, y) {
  _hammerX = x;
  _hammerY = y;

  if (!hammerUpdateQueued) {
    hammerUpdateQueued = true;

    requestAnimationFrame(_applyHammerPosition);
  }
}


function setHammer() {
  document.addEventListener("mousemove", function(e) {
      if (!gameState.isPlaying) {
        return;
      }

      let pos = toGameCoords(e.clientX, e.clientY);

      requestHammerUpdate(pos.x, pos.y);
      elements.hammer.classList.add("show");
    }
  );

  elements.gameContainer.addEventListener("mouseleave", function() {
      elements.hammer.classList.remove("show");
    }
  );

  document.addEventListener("pointerdown", function(e) {
      if (!gameState.isPlaying) {
        return;
      }

      if (elements.resultScreen.classList.contains("show")) {
        return;
      }

      _lastPointerType = e.pointerType;

      let pos = toGameCoords(e.clientX, e.clientY);

      requestHammerUpdate(pos.x, pos.y);

      if (e.pointerType !== "mouse") {
        elements.hammer.classList.add("show");
      }

      swingHammer();
    },
    { passive: true }
  );


  document.addEventListener("pointermove", function(e) {
      if (!gameState.isPlaying)
        return;
      if (e.pointerType === "mouse") {
        return;
      }

      let pos = toGameCoords(e.clientX, e.clientY);

      requestHammerUpdate(pos.x, pos.y);
    },
    { passive: true }
  );

  document.addEventListener("pointerup", function(e) {
      if (e.pointerType !== "mouse") {
        elements.hammer.classList.remove("show");
      }
    },
    { passive: true }
  );

  document.addEventListener("pointercancel", function(e) {
      if (e.pointerType !== "mouse") {
        elements.hammer.classList.remove("show");
      }
    },
    { passive: true }
  );

}


let _lastPointerType = "mouse";

function swingHammer() {
  let el = elements.hammer;

  el.classList.remove("swing");

  requestAnimationFrame(function() {
    el.classList.add("swing");
  });

  if (_lastPointerType !== "mouse") {
    setTimeout(function() {
      el.classList.remove("show");
    }, 200);
  }

  gameState._swingHit = false;

  setTimeout(function() {
    if (gameState.isPlaying && !gameState._swingHit && gameState.gaugeLevel !== 4) {
      changeGauge(-CONFIG.gaugeDownMiss);
    }
  }, 80);
}

function loadImages() {
  [].concat(
    UPAO_IMAGES.normal,
    [
      UPAO_IMAGES.rare,
      UPAO_IMAGES.angry,
      UPAO_IMAGES.damage,
      UPAO_IMAGES.ink
    ]
  ).forEach(function(src) {
    new Image().src = src;
  });

  new Image().src = "img/ink.png";
}

function getSpawnInterval() {
  let elapsed = CONFIG.gameLimit - gameState.timeLeft;

  let progress = Math.min(elapsed / CONFIG.gameLimit, 1);

  let avg = 800 - (400 * progress * progress);

  let jitter = 120;

  return Math.max(400, avg + (Math.random() - 0.5) * jitter * 2 );
}



function startGame() {
  clearInterval(gameState.countdownTimer);
  clearTimeout(gameState.spawnTimer);

  _gaugeDecayLastTime = null;
  _gaugeDisplayCache.fillPct = -1;
  _gaugeDisplayCache.level = -1;

  _lastScore = -1;
  _lastTime  = -1;

  _countdownStartTs = performance.now();
  _countdownBase = CONFIG.gameLimit;

  gameState = {
    isPlaying: true,
    isTransitioning: false,

    score: 0,
    timeLeft: CONFIG.gameLimit,

    activeUpao: [],
    spawnTimer: null,
    countdownTimer: null,

    combo: 0,
    feverCombo: 0,
    timeBonusCombo: 0,
    isFever: false,
    feverTimer: null,

    gauge: 0,
    gaugeLevel: 1,
    gaugeMax:  0,

    maxCombo: 0,
  };

  elements.seaLayer.classList.remove("fever");
  elements.feverIndicator.classList.remove("show");
  elements.resultScreen.classList.remove("show");

  elements.startBtnWrapper.style.display = "none";

  if (elements.btnUpao) {
    elements.btnUpao.classList.remove("show");
  }

  updateScore(0);
  updateTime(CONFIG.gameLimit);
  renderGauge(0, 1);

  elements.comboDisplay.classList.remove("pop");
  elements.comboDisplay.style.opacity = "";

  gameState.countdownTimer = setInterval(function() {
    let elapsed = (performance.now() - _countdownStartTs) / 1000;

    let newTime = Math.max(0, Math.round(_countdownBase - elapsed));

    if (newTime !== gameState.timeLeft) {
      gameState.timeLeft = newTime;
      updateTime(gameState.timeLeft);
    }

    if (gameState.timeLeft <= 0) {
      endGame();
    }
  }, 250);

  _gaugeDecayLastTime = null;

  queueNextSpawn();
}


function queueNextSpawn() {
  if (!gameState.isPlaying) {
    return;
  }

  let interval = getSpawnInterval();

  gameState.spawnTimer = setTimeout(function() {
    spawnUpao();

    let elapsed  = CONFIG.gameLimit - gameState.timeLeft;
    let progress = elapsed / CONFIG.gameLimit;
    let extraRate = 0.40 + progress * 0.40;

    if (Math.random() < extraRate) {
      spawnUpao(true);
    }
    if (progress > 0.35 && Math.random() < 0.35 + progress * 0.30) {
      spawnUpao(true);
    }
    if (progress > 0.6 && Math.random() < 0.25) {
      spawnUpao(true);
    }

    queueNextSpawn();
  }, interval);
}


function spawnUpao(forceSpawn) {
  if (!gameState.isPlaying) {
    return;
  }
  let available = [];

  for (let hi = 0; hi < 8; hi++) {
    let cl = elements.holeContainers[hi].classList;

    if (!cl.contains("show") && !cl.contains("hit") && !cl.contains("hiding")) {
      available.push(hi);
    }
  }

  if (available.length === 0) {
    return;
  }
  let holeIndex = available[Math.floor(Math.random() * available.length)];

  let randomHole = elements.holes[holeIndex];
  let container  = elements.holeContainers[holeIndex];
  let img = elements.holeImgs[holeIndex];

  let rand = Math.random() * 100;
  let rareRate = gameState.isFever ? CONFIG.feverRareRate : CONFIG.rareSpawn;
  let inkRate = CONFIG.inkSpawn;

  let elapsed = CONFIG.gameLimit - gameState.timeLeft;
  let progress = elapsed / CONFIG.gameLimit;

  let earlyBonus = (1 - progress) * 10;

  let lateBonus = progress > 0.67 ? Math.round((progress - 0.67) * 3 * 20): 0;

  let angryRate = CONFIG.angrySpawn + earlyBonus + lateBonus;

  let type;

  if (rand < rareRate) {
    type = "rare";
  } else if (rand < rareRate + inkRate) {
    type = "ink";
  } else if (rand < rareRate + inkRate + angryRate) {
    type = "angry";
  } else {
    type = "normal";
  }

  if (type === "normal") {
    img.src = UPAO_IMAGES.normal[Math.floor(Math.random() * UPAO_IMAGES.normal.length)];
  } else {
    img.src = UPAO_IMAGES[type];
  }

  img.dataset.type = type;

  let spawnId = holeIndex + "_" + (++_spawnCounter);

  container.dataset.spawnId = spawnId;
  container.classList.add("show");

  if (type === "rare" || type === "ink") {
    let glow = document.createElement("div");

    glow.className = "hole-glow " + (type === "rare" ? "rare" : "ink");

    glow.dataset.glowType = type;

    randomHole.appendChild(glow);
  }

  gameState.activeUpao.push(holeIndex);

  createSplash(randomHole);
  createUpSplash(randomHole);

  if (!forceSpawn) {
    playGameSound("splash");
  }

  let baseTime = 2400 - (400 * Math.min(progress, 1) * Math.min(progress, 1));

  let displayTime = type === "rare" ? baseTime * 0.7 : type === "ink" ? baseTime * 0.4 : baseTime;

  setTimeout(function() {
    if (container.dataset.spawnId === spawnId && container.classList.contains("show") && !container.classList.contains("hit")) {
      if (type === "ink") {
        inkSplash(randomHole);
      }

      sinkUpao(holeIndex);

      if (type !== "angry" && type !== "ink") {
        resetCombo();
      }
    }
  }, displayTime);
}

/* 不要かも　検討
function randomizeWavePosition(hole) {
  let offsetX = (Math.random() - 0.5) * 16;
  let offsetY = (Math.random() - 0.5) * 6;
  let rotation = (Math.random() - 0.5) * 8;
  let scale = 0.92 + Math.random() * 0.16;

  hole.style.setProperty("--wave-offset-x", `calc(-50% + ${offsetX}px)`);
  hole.style.setProperty("--wave-offset-y", `${offsetY}px`);
  hole.style.setProperty("--wave-rotation", `${rotation}deg`);
  hole.style.setProperty("--wave-scale", `${scale}`);
}
  */


function sinkUpao(holeIndex) {
  let hole = elements.holes[holeIndex];
  let container = elements.holeContainers[holeIndex];
  let currentSpawnId = container.dataset.spawnId;

  container.classList.remove("show", "hit");
  container.classList.add("hiding");

  let glow = hole.querySelector(".hole-glow");
  if (glow) {
    glow.remove();
  }

  let idx = gameState.activeUpao.indexOf(holeIndex);
  if (idx > -1) {
    gameState.activeUpao.splice(idx, 1);
  }

  setTimeout(function() {
    if (container.dataset.spawnId === currentSpawnId) {
      elements.holeImgs[holeIndex].src = "";
    }
    container.classList.remove("hiding");
  }, 400);  // 沈むアニメーション後に
}

function upaoHit(e, hole) {
  if (!gameState.isPlaying) {
    return;
  }

  let holeIndex = parseInt(hole.dataset.index);
  let container = elements.holeContainers[holeIndex];

  if (!container.classList.contains("show") || container.classList.contains("hit")) {
    return;
  }

  let img = elements.holeImgs[holeIndex];

  if (!img || !img.dataset.type) {
    return;
  }

  gameState._swingHit = true;

  let type = img.dataset.type;

  img.src = UPAO_IMAGES.damage;
  container.classList.add("hit");

  createHitEffect(hole);

  if (type === "angry") {
    playGameSound("fake");
  } else {
    playGameSound("hit");
  }

  createSplash(hole);

  let points, popClass;

  if (type === "rare") {
    points = CONFIG.rarePoints;
    popClass = "bonus";
  } else if (type === "angry") {
    points = -Math.max(3, Math.round(gameState.score * 0.05));
    popClass = "minus";
  } else if (type === "ink") {
    points   = CONFIG.normalPoints;
    popClass = "plus";
  } else {
    points   = CONFIG.normalPoints;
    popClass = "plus";
  }

  if (type === "angry") {
    if (gameState.gaugeLevel !== 4) {
      changeGauge(-CONFIG.gaugeDownAngry);
    }

    gameState.combo = gameState.feverCombo = gameState.timeBonusCombo = 0;

  } else {
    let powGain = type === "rare" ? CONFIG.gaugeUpRare : CONFIG.gaugeUp;

    changeGauge(powGain);

    gameState.combo++;
    gameState.feverCombo++;
    gameState.timeBonusCombo++;

    if (gameState.combo > gameState.maxCombo) {
      gameState.maxCombo = gameState.combo;
    }

    checkFever();
    checkTimeBonus();
  }

  if (points > 0) {
    points = Math.round(points * getScoreBonus());

    if (gameState.isFever) {
      points = Math.round(points * CONFIG.feverBonus);
    }
  }

  gameState.score += points;

  if (gameState.score < 0) {
    gameState.score = 0;
  }

  updateScore(gameState.score);


  createScorePop(
    hole,
    points,
    popClass,
    gameState.combo
  );

  setTimeout(function() {
    sinkUpao(holeIndex);
  }, 150);
}

function changeGauge(delta) {
  gameState.gauge = Math.max(0, Math.min(100, gameState.gauge + delta));
  let newLevel = calcGaugeLevel(gameState.gauge);

  if (newLevel === 4 && gameState.gaugeLevel !== 4) {
    gameState.gaugeMax = 100;
  }
  if (newLevel > gameState.gaugeLevel) {
    showLevelUpPop(newLevel);
  }
  gameState.gaugeLevel = newLevel;
  renderGauge(gameState.gauge, gameState.gaugeLevel);
}

function gaugeDecay(amount) {
  gameState.gauge = Math.max(0, gameState.gauge - amount);

  let newLevel = calcGaugeLevel(gameState.gauge);
  
  gameState.gaugeLevel = newLevel;
  renderGauge(gameState.gauge, gameState.gaugeLevel);
}

function calcGaugeLevel(gpoint) {
  if (gpoint >= CONFIG.gaugeLvMax) {
    return 4;
  } else if (gpoint >= CONFIG.gaugeLv3) {
    return 3;
  } else if (gpoint >= CONFIG.gaugeLv2) {
    return 2;
  } else {
    return 1;
  }
}

function getScoreBonus() {
  if (gameState.gaugeLevel === 4) {
    return CONFIG.scoreBonusMax;
  } else if (gameState.gaugeLevel === 3) {
    return CONFIG.scoreBonusLv3;
  } else if (gameState.gaugeLevel === 2) {
    return CONFIG.scoreBonusLv2;
  } else {
    return CONFIG.scoreBonusLv1;
  }
}


let _gaugeDisplayCache = { fillPct: -1, level: -1 };

function renderGauge(pow, level) {
  if (!elements.levelLabel || !elements.levelBarFill || !elements.levelBar) {
    return;
  }

  let pct;
  if (level === 4) {
    pct = Math.max(0, gameState.gaugeMax);
  } else {
    let bases = [0, 0, CONFIG.gaugeLv2, CONFIG.gaugeLv3, CONFIG.gaugeLvMax];
    let tops = [CONFIG.gaugeLv2, CONFIG.gaugeLv2, CONFIG.gaugeLv3, CONFIG.gaugeLvMax, 100];
    
    pct = Math.min(100, Math.max(0, ((pow - bases[level]) / (tops[level] - bases[level])) * 100));
  }

  let fillPct = Math.round(pct * 0.75 * 100) / 100;

  if (fillPct === _gaugeDisplayCache.fillPct && level === _gaugeDisplayCache.level) {
    return;
  }
  _gaugeDisplayCache.fillPct = fillPct;

  if (level !== _gaugeDisplayCache.level) {
    _gaugeDisplayCache.level = level;
    let labels = ["", "Lv 1", "Lv 2", "Lv 3", "MAX"];
    elements.levelLabel.textContent = labels[level];

    if (level === 4) {
      elements.levelBar.classList.add("pow-max");
    } else {
      elements.levelBar.classList.remove("pow-max");
    }
  }

  elements.levelBarFill.style.width = fillPct + "%";
}

function showLevelUpPop(level) {
  if (elements.levelBar) {
    let lb = elements.levelBar;
    lb.classList.remove("level-up-pop");
    requestAnimationFrame(function() {
      lb.classList.add("level-up-pop");
    });
  }

  let labels = ["", "Lv 1", "Lv 2", "Lv 3", "MAX!"];

  let pop = document.createElement("div");

  pop.style.cssText = `
    position: absolute;
    top: 18%;
    left: 50%;
    transform: translateX(-50%);
    font-size: 48px;
    font-weight: bold;
    color: #FFD700;
    text-shadow: 0 0 12px #FF8C00,
                 0 0 28px #FF8C00,
                 2px 2px 4px rgba(0,0,0,0.7);
    white-space: nowrap;
    pointer-events: none;
    z-index: 700;
    animation: timeBonusPop 1.2s ease-out forwards;
  `;

  pop.textContent = level === 4 ? "MAX!" : labels[level] + " UP!";

  elements.gameContainer.appendChild(pop);
  setTimeout(function() {
    pop.remove();
  }, 1200);
}

function showLevelDownPop() {
}  // 演出を考える


function resetCombo() {
  gameState.combo = gameState.feverCombo = gameState.timeBonusCombo = 0;
}

function checkFever() {
  if (gameState.isFever) {
    return;
  }
  if (gameState.feverCombo === CONFIG.feverCombo) {
    gameState.feverCombo = 0;
    startFever();
  }
}

function checkTimeBonus() {
  if (gameState.timeBonusCombo >= CONFIG.timeBonusCombo) {
    gameState.timeBonusCombo = 0;
    gameState.timeLeft += CONFIG.timeBonus;

    _countdownBase = gameState.timeLeft;
    _countdownStartTs = performance.now();

    updateTime(gameState.timeLeft);
    showTimeBonusPop();
  }
}


function showTimeBonusPop() {
  let flash = document.createElement("div");
  flash.style.cssText = `
    position: absolute;
    inset: 0;
    background: rgba(255,220,0,0.25);
    z-index: 699;
    pointer-events: none;
    animation: timeBonusFade 0.6s ease-out forwards;
  `;
  elements.gameContainer.appendChild(flash);

  setTimeout(function() {
    flash.remove();
  }, 600);

  let pop = document.createElement("div");
  pop.style.cssText = `
    position: absolute;
    top: 38%;
    left: 50%;
    transform: translateX(-50%);
    font-size: 42px;
    font-weight: bold;
    color: #FFD700;
    text-shadow: 0 0 10px #FF8C00,
                 0 0 24px #FF8C00,
                 2px 2px 4px rgba(0,0,0,0.6);
    white-space: nowrap;
    pointer-events: none;
    z-index: 700;
    animation: timeBonusPop 1.2s ease-out forwards;
  `;
  pop.textContent = "⏱️ +" + CONFIG.timeBonus + "秒！";
  elements.gameContainer.appendChild(pop);
  setTimeout(function() {
    pop.remove(); 
  }, 1200);
}

let _feverParticles = [];
let _feverParticleLastTs = 0;
let _FEVER_PARTICLE_INTERVAL = 120;

function startFever() {
  playGameSound("fever");
  gameState.isFever = true;

  elements.seaLayer.classList.add("fever");
  elements.feverIndicator.classList.add("show");

  let ft = elements.feverText;

  ft.classList.remove("show");

  requestAnimationFrame(function() {
    ft.classList.add("show");
  });

  setTimeout(function() {
    ft.classList.remove("show");
  }, 2200);

  _feverParticleLastTs = 0;
  gameState.feverTimer = setTimeout(endFever, CONFIG.feverTimeMs);
}

function endFever() {
  gameState.isFever = false;
  gameState.feverCombo = 0;
  elements.seaLayer.classList.remove("fever");
  elements.feverIndicator.classList.remove("show");

  for (let pi = 0; pi < _feverParticles.length; pi++) {
    let p = _feverParticles[pi];
    p.style.transition = "opacity 0.8s ease-out";
    p.style.opacity = "0";
    setTimeout((function(el) {
      return function() {
        el.remove(); 
      };
    }) (p), 800);
  }
  _feverParticles = [];

  if (gameState.feverTimer) {
    clearTimeout(gameState.feverTimer);
      gameState.feverTimer = null;
  }
}


let FEVER_COLORS = ["#7FDFFF", "#40C0FF", "#FFFFFF", "#B0F0FF", "#5BC8F5"];

function spawnFeverParticle(ts) {
  if (!gameState.isFever) {
    return;
  }
  if (ts - _feverParticleLastTs < _FEVER_PARTICLE_INTERVAL) {
    return;
  }
  _feverParticleLastTs = ts;

  let count = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < count; i++) {
    let p = document.createElement("div");
    p.className = "fever-particle";

    let dur = 2.0 + Math.random() * 2.0;
    let size = 2 + Math.random() * 5;
    let color = FEVER_COLORS[Math.floor(Math.random() * FEVER_COLORS.length)];

    p.style.cssText = `
      left: ${Math.random() * 100}%;
      bottom: ${Math.random() * 30}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      --rise-height: ${-(70 + Math.random() * 100)}px;
      --drift-x: ${(Math.random() - 0.5) * 30}px;
      --rise-duration: ${dur}s;
      border-radius: 50%;
      position: absolute;
      pointer-events: none;
      animation:particleRise ${dur}s ease-out forwards;`;

    elements.seaLayer.appendChild(p);
    _feverParticles.push(p);

    (function(el, d) {
      setTimeout(function() {
        el.remove();
        let idx = _feverParticles.indexOf(el);

        if (idx > -1) {
          _feverParticles.splice(idx, 1);
        }
      }, d * 1000);
    })(p, dur);
  }
}



function createHitEffect(hole) {
  let el = document.createElement("div");

  el.className = "hit-effect";
  hole.appendChild(el);

  setTimeout(function() {
    el.remove();
  }, 300);
}

function createSplash(hole) {
  let el = document.createElement("div");

  el.className = "splash";
  hole.appendChild(el);

  setTimeout(function() {
    el.remove();
  }, 400);
}

function createUpSplash(hole) {
  let el = document.createElement("div");

  el.className = "up-splash";
  hole.appendChild(el);

  setTimeout(function() {
    el.remove();
  }, 500);
}

function createScorePop(hole, points, popClass, combo) {
  let POP_DURATION = 1100;

  let pop = document.createElement("div");
  pop.className   = "score-pop " + popClass;
  pop.textContent = points > 0 ? "+" + points : points;
  hole.appendChild(pop);

  setTimeout(function() {
    pop.remove();
  }, POP_DURATION);

  if (combo >= 2) {
    let comboPop = document.createElement("div");

    comboPop.className   = "score-pop combo-pop";
    comboPop.textContent = combo + "combo!";
    hole.appendChild(comboPop);

    setTimeout(function() {
      comboPop.remove();
    }, POP_DURATION);
  }
}



let _lastScore = -1;
let _lastTime = -1;

function updateScore(score) {
  if (score === _lastScore) {
    return;
  }

  _lastScore = score;
  elements.scoreDisplay.textContent = score;
}

function updateTime(time) {
  let display = Math.max(0, time);

  if (display === _lastTime) {
    return;
  }

  _lastTime = display;
  elements.timeDisplay.textContent = display;

  if (time <= 5 && time > 0) {
    elements.timeDisplay.classList.add("urgent");
  } else {
    elements.timeDisplay.classList.remove("urgent");
  }
}



function endGame() {
  if (!gameState.isPlaying) {
    return;
  }

  gameState.isPlaying = false;
  gameState.isTransitioning = true;

  clearInterval(gameState.countdownTimer);
  clearTimeout(gameState.spawnTimer);

  _gaugeDecayLastTime = null;

  endFever();
  stopAllWaves();
  stopSeaCanvas();


  elements.hammer.classList.remove("show");
  elements.timeDisplay.classList.remove("urgent");

  for (let ei = 0; ei < 8; ei++) {
    elements.holeContainers[ei].classList.remove("show", "hit", "hiding");
    elements.holeImgs[ei].src = "";
    elements.holes[ei].classList.remove("rare-active");
    elements.holes[ei].classList.remove("ink-active");
    elements.holes[ei].querySelectorAll(".hole-glow").forEach(function(g) {
      g.remove();
    });
  }
  gameState.activeUpao = [];

  animateTimeUp(function() {
    showResultScreen();
  });
}


// 終了時ホワイトアウト
function animateTimeUp(callback) {
  let timeUpEl = document.createElement("div");
  timeUpEl.id = "timeup-text";
  timeUpEl.textContent = "TIME UP";
  timeUpEl.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 72px;
    font-weight: bold;
    color: #FF3333;
    font-family: "M PLUS Rounded 1c",sans-serif;
    -webkit-text-stroke: 4px #fff;
    paint-order: stroke fill;
    text-shadow: 0 0 20px rgba(255,50,50,0.8),
                 0 0 40px rgba(255,50,50,0.4),
                 3px 3px 6px rgba(0,0,0,0.5);
    z-index: 9999;
    pointer-events: none;
    opacity: 0;
    transform: scale(0.3);
    transition: opacity 0.4s ease, transform 0.5s cubic-bezier(0.34,1.56,0.64,1);
  `;

  elements.gameContainer.appendChild(timeUpEl);

  let whiteOut = document.createElement("div");
  whiteOut.id = "whiteout-overlay";
  whiteOut.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: #fff;
    opacity: 0;
    z-index: 9998;
    pointer-events: none;
    transition: opacity 0.6s ease;
  `;
  elements.gameContainer.appendChild(whiteOut);

  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      timeUpEl.style.opacity = "1";
      timeUpEl.style.transform = "scale(1)";
    });
  });

  setTimeout(function() {
    whiteOut.style.opacity = "1";
    timeUpEl.style.transition = "opacity 0.4s ease";
    timeUpEl.style.opacity = "0";
  }, 1800);

  setTimeout(function() {
    timeUpEl.remove();
    whiteOut.style.transition = "opacity 0.5s ease";
    whiteOut.style.opacity = "0";
    setTimeout(function() {
      whiteOut.remove();
    }, 500);

    if (callback)
      callback();

  }, 2700);
}

function shareScore() {
  let text = "#うぱお叩きゲーム で " + gameState.score + " 点を獲得しました！💫\n" + window.location.href;
  
  // Web Share API（iOS Safari対応）を優先
  if (navigator.share) {
    navigator.share({
      text: text,
    }).catch(function() {});
    return;
  }
  
  // フォールバック：twitter.comを使用
  let shareUrl = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text);
  window.open(shareUrl, "_blank");
}

function showResultScreen() {
  saveHighScore(gameState.score);
  let best = getHighScores();
  
  if (elements.finalScore) {
    elements.finalScore.textContent = gameState.score;
    elements.finalScore.title = String(gameState.score);
  }
  if (elements.finalCombo) {
    elements.finalCombo.textContent = gameState.maxCombo;
  }
  if (elements.finalBest1) {
    elements.finalBest1.textContent = best[0] !== undefined ? best[0] : "---";
  }
  if (elements.finalBest2) {
    elements.finalBest2.textContent = best[1] !== undefined ? best[1] : "---";
  }
  if (elements.finalBest3) {
    elements.finalBest3.textContent = best[2] !== undefined ? best[2] : "---";
  }

  let title = elements.resultTitle;
  let starDiv = elements.resultStarDiv;
  let content = elements.resultContent;
  let rows = elements.resultRows;
  let btns = elements.resultBtns;

  content.style.cssText = "opacity:0;transition:none;";

  title.style.cssText = `
    position: absolute;
    top: 24px;
    left: 0;
    width: 100%;
    transform: translateY(calc(50vh - 24px - 60px)) scale(0.5);
    opacity: 0;
    font-size: 52px;
    transition: none;
    z-index: 2;
  `;

  if (starDiv) {
    starDiv.style.cssText = `
      opacity: 0;
      transform: translateY(10px);
      transition: none;
    `;
  }

  rows.forEach(function(r) {
    r.style.cssText = `
      opacity: 0;
      transform: translateY(30px);
      transition: none;
    `;
  });

  if (btns) {
    btns.style.cssText = `
      opacity: 0;
      transform: translateY(30px);
      transition: none;
    `;
  }

  elements.resultScreen.classList.add("show");
  gameState.isTransitioning = false;

  let timers = [];
  gameState._resultTimers = timers;

  requestAnimationFrame(function() {
    requestAnimationFrame(function() {

      content.style.transition = "opacity 0.4s ease";
      content.style.opacity    = "1";

      startResultShine(content, timers);

      timers.push(setTimeout(function() {
        if (gameState._resultTimers !== timers) {
          return;
        }
        title.style.transition = "opacity 0.4s ease,transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1)";
        title.style.opacity    = "1";
        title.style.transform  = "translateY(calc(50vh - 24px - 60px)) scale(1)";
      }, 300));

      timers.push(setTimeout(function() {
        if (gameState._resultTimers !== timers) {
          return;
        }
        title.style.transition = "font-size 0.5s ease,transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)";
        title.style.fontSize   = "38px";
        title.style.transform  = "translateY(0) scale(1)";
      }, 900));

      timers.push(setTimeout(function() {
        if (gameState._resultTimers !== timers) {
          return;
        }
        if (starDiv) {
          starDiv.style.transition = "opacity 0.3s ease, transform 0.3s ease";
          starDiv.style.opacity    = "0.5";
          starDiv.style.transform  = "translateY(0)";
        }
      }, 1100));

      let delay = 1300;
      rows.forEach(function(row) {
        timers.push(setTimeout(function() {
          if (gameState._resultTimers !== timers) {
            return;
          }
          row.style.transition = "opacity 0.38s ease,transform 0.38s cubic-bezier(0.34, 1.3, 0.64, 1)";
          row.style.opacity    = "1";
          row.style.transform  = "translateY(0)";
        }, delay));
        delay += 160;
      });

      timers.push(setTimeout(function() {
        if (gameState._resultTimers !== timers) {
          return;
        }
        if (btns) {
          btns.style.transition = "opacity 0.38s ease,transform 0.38s cubic-bezier(0.34, 1.3, 0.64, 1)";
          btns.style.opacity    = "1";
          btns.style.transform  = "translateY(0)";
        }
      }, delay));

    });
  });
}


function startResultShine(content, timers) {
  content.querySelectorAll(".result-shine").forEach(function(el) {
    el.remove();
  });

  timers.push(setTimeout(function() {
    let s1 = document.createElement("div");
    s1.className = "result-shine shine-once";
    content.appendChild(s1);

    setTimeout(function() {
      s1.remove();
    }, 800);
  }, 400));

  timers.push(setTimeout(function() {
    let s2 = document.createElement("div");
    s2.className = "result-shine shine-once-2";
    content.appendChild(s2);

    setTimeout(function() {
      s2.remove();
    }, 700);
  }, 650));

  let loop1 = document.createElement("div");
  loop1.className = "result-shine shine-loop";
  loop1.style.setProperty("--shine-delay", "2.5s");
  loop1.style.setProperty("--shine-dur", "6.0s");
  content.appendChild(loop1);

  let loop2 = document.createElement("div");
  loop2.className = "result-shine shine-loop";
  loop2.style.width = "16%";
  loop2.style.opacity = "0.5";
  loop2.style.setProperty("--shine-delay", "3.4s");
  loop2.style.setProperty("--shine-dur", "6.0s");
  content.appendChild(loop2);
}

function retryGame() {
  elements.hammer.classList.remove("show", "swing");
  elements.hammer.style.left = "-100px";
  elements.hammer.style.top = "-100px";

  if (gameState._resultTimers) {
    gameState._resultTimers.forEach(function(id) {
      clearTimeout(id);
    });

    gameState._resultTimers = [];
  }

  if (elements.resultContent) {
    elements.resultContent.querySelectorAll(".result-shine").forEach(function(el) {
      el.remove();
    });
  }

  let banner = document.getElementById("start-banner");
  if (banner)
    banner.style.display = "";

  elements.startBtnWrapper.style.display = "";

  if (elements.resultTitle) {
    elements.resultTitle.removeAttribute("style");
    elements.resultTitle.className = "";
  }

  restartAllWaves();
  restartSeaCanvas();

  setTimeout(function() { 
    startGame();
  }, 0);
}


let _scoresFallback = [];

function getHighScores() {
  try {
    let stored = localStorage.getItem("upaoHighScores");
    return stored ? JSON.parse(stored) : [];
  } catch(e) {
    return _scoresFallback.slice();
  }
}

function saveHighScore(score) {
  let scores = getHighScores();
  scores.push(score);
  scores.sort(function(a, b) {
    return b - a; 
  });

  scores = scores.slice(0, 3);
  _scoresFallback = scores.slice();

  try {
    localStorage.setItem("upaoHighScores", JSON.stringify(scores));
  } catch(e) {}
}


let bgm = null;
let _bgmLoading = false;

function playBGM() {
  if (_bgmLoading || bgm) {
    return;
  }

  _bgmLoading = true;

  try {
    let audio = new Audio("audio/theme.mp3");

    audio.loop = true;
    audio.volume = 0.3;  // 調整
    audio.play().then(function() {
      bgm = audio;
      bgm.muted = isMuted;
      _bgmLoading = false;

    }).catch(function() {
      _bgmLoading = false;
    });

  } catch(e) {
    _bgmLoading = false;
  }
}


let isMuted = true;

function setMuteButton() {
  elements.muteBtn.textContent = "🔇";
  elements.muteBtn.classList.add("muted");
  elements.muteBtn.addEventListener("click", function() {
    isMuted = !isMuted;

    if (!bgm && !_bgmLoading) {
      playBGM();
    } else if (bgm) {
      bgm.muted = isMuted;
    }

    elements.muteBtn.textContent = isMuted ? "🔇" : "🔊";
    elements.muteBtn.classList.toggle("muted", isMuted);
  });
}


let _fishCount = 0;
let _shipCount = 0;
let _ambientLastTs = 0;
let _AMBIENT_INTERVAL = 600;

function tickAmbientEffects(ts) {
  if (ts - _ambientLastTs < _AMBIENT_INTERVAL) {
    return;
  }
  _ambientLastTs = ts;
  if (Math.random() < 0.6) {
    spawnBubble();
  }
  if (Math.random() < 0.15) {
        spawnFish();
  }
  if (Math.random() < 0.04) {
    spawnShip();
  }
}


function startAmbientEffects() {
  _ambientLastTs = 0;
}

function spawnBubble() {
  let el = document.createElement("div");
  el.className = "bubble";

  let size = 4 + Math.random() * 10;
  let dur  = 4 + Math.random() * 4;

  el.style.cssText = `
    width: ${size}px;
    height: ${size}px;
    position:absolute;
    left: ${Math.random() * 100}%;
    bottom: ${Math.random() * 70}%;
    --bubble-duration: ${dur}s;
    --bubble-rise: ${-(80 + Math.random() * 120)}px;
    --bubble-drift: ${(Math.random() - 0.5) * 30}px;
    `;

  elements.seaLayer.appendChild(el);
  setTimeout(function() {
    el.remove();
  }, dur * 1000);
}

function spawnFish() {
  if (_fishCount >= 3) {
    return;
  }
  _fishCount++;

  let goRight = Math.random() < 0.5;
  let dur = 5 + Math.random() * 4;
  let list = ["🐟","🐠","🐡"];
  let el = document.createElement("div");
  el.className = "fish " + (goRight ? "left-to-right" : "right-to-left");

  let depth = Math.random();
  let bottomPct = 15 + depth * 45;
  let fishSize = 24 - depth * 10;
  let opacity = (0.35 - depth * 0.15).toFixed(2);
  let speed = dur + depth * 3;

  el.style.cssText = `
    position: absolute;
    bottom: ${bottomPct}%;
    --fish-size: ${fishSize}px;
    --fish-duration: ${speed}s;
    --fish-drift: ${(Math.random() - 0.5) * 40}px;
    z-index: ${10 - Math.round(depth * 5)};
    opacity: ${opacity};`;

  let inner = document.createElement("span");
  inner.textContent = list[Math.floor(Math.random()*list.length)];
  inner.style.cssText = `
    display:inline-block;
    transform:scaleX(${goRight ? -1 : 1});
    `;

  el.appendChild(inner);
  elements.gameContainer.appendChild(el);
  setTimeout(function() {
    el.remove();
    _fishCount = Math.max(0, _fishCount - 1);
  }, speed * 1000);
}


function spawnShip() {
  if (_shipCount >= 1) {
    return;
  }
  _shipCount++;

  let goRight = Math.random() < 0.5;
  let dur = 20 + Math.random() * 10;
  let size = 80 + Math.random() * 40;
  let el = document.createElement("div");
  el.className = "ship " + (goRight ? "left-to-right" : "right-to-left");
  el.style.cssText = `
    position: absolute;
    --ship-size: ${size}px;
    --ship-duration: ${dur}s;
    animation-name: ${goRight ? "shipSwimLR" : "shipSwimRL"};
    animation-duration: ${dur}s;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
    z-index: 11;`;

  let flip = document.createElement("div");
  flip.style.cssText = goRight ? "display:inline-block;transform:scaleX(-1);" : "display:inline-block;";

  let img = document.createElement("img");
  img.src = "img/ship.png";
  img.draggable = false;

  flip.appendChild(img);
  el.appendChild(flip);
  elements.gameContainer.appendChild(el);
  setTimeout(function() {
    el.remove();
    _shipCount = Math.max(0, _shipCount - 1);
  }, dur * 1000);
}

function initWaveClips() {
}
function stopAllWaves() {
}
function restartAllWaves() {
}


function resizeGameContainer() {
  let container = elements.gameContainer;
  let scaleX = window.innerWidth  / 430;
  let scaleY = window.innerHeight / 870;
  let scale = Math.min(scaleX, scaleY);
  let scaledW = 430 * scale;
  let scaledH = 870 * scale;
  let leftOffset = (window.innerWidth - scaledW) / 2;

  container.style.transform = "scale(" + scale + ")";
  container.style.transformOrigin = "top left";
  container.style.position = "absolute";
  container.style.top = "0";
  container.style.left = leftOffset + "px";
  container.style.marginTop = "0";

  document.body.style.height = scaledH + "px";   

}

function restartSeaCanvas() {
  if (_seaLoopId) {
    return;
  }
  _seaLastTimeSt = null;
  _seaLoopId = requestAnimationFrame(updateSea);
}



function inkSplash(originHole) {
  let holeRect = originHole.getBoundingClientRect();
  let contRect = elements.gameContainer.getBoundingClientRect();
  let scale = contRect.width / 430;

  let originX = (holeRect.left + holeRect.width / 2 - contRect.left) / scale;
  let originY = (holeRect.top + holeRect.height / 2 - contRect.top) / scale;

  let gameArea = document.getElementById("game-area");
  let areaRect = gameArea.getBoundingClientRect();
  let areaLeft = (areaRect.left - contRect.left) / scale;
  let areaTop = (areaRect.top  - contRect.top)  / scale;
  let areaW = areaRect.width  / scale;
  let areaH = areaRect.height / scale;

  let targetX = areaLeft + 40 + Math.random() * (areaW - 80);
  let targetY = areaTop  + 40 + Math.random() * (areaH - 80);

  let inkSize = 80 + Math.random() * 1160;
  let ink = document.createElement("img");
  ink.src       = "img/ink.png";
  ink.className = "ink-splash";
  ink.draggable = false;

  ink.style.cssText = `
    position :absolute;
    pointer-events: none;
    z-index: 150;
    width: ${inkSize}px;
    height: ${inkSize}px;
    left: ${originX}px;
    top: ${originY}px;
    transform: translate(-50%,-50%) scale(0.1);
    opacity: 0.9;
    transition: transform ${CONFIG.inkAnimeMs}ms cubic-bezier(0.22,0.61,0.36,1),
    left ${CONFIG.inkAnimeMs}ms cubic-bezier(0.22,0.61,0.36,1),
    top ${CONFIG.inkAnimeMs}ms cubic-bezier(0.22,0.61,0.36,1),
    opacity ${CONFIG.inkAnimeMs}ms ease;`;

  let rotation = Math.floor(Math.random() * 360);

  elements.gameContainer.appendChild(ink);

  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      ink.style.left = targetX + "px";
      ink.style.top = targetY + "px";
      ink.style.transform = "translate(-50%,-50%) scale(1) rotate(" + rotation + "deg)";
      ink.style.opacity = "1";
    });
  });

  let splashMs = CONFIG.inkAnimeMs;
  let fadeMs   = CONFIG.inkFadeMs;

  setTimeout(function() {
    ink.style.transition = `opacity ${fadeMs}ms ease-out`;
    ink.style.opacity = "0";

    setTimeout(function() {
      ink.remove();
    }, fadeMs);
  }, splashMs);
}
