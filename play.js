"use strict";

const game = new CandyGarden();
const byId = id => document.getElementById(id);
const field = byId("field");
const arena = byId("arena");
const context = field.getContext("2d");
context.imageSmoothingEnabled = false;
const plots = byId("plots");
const pickups = byId("pickups");
const defenders = byId("defenders");
const waveMeter = byId("wave-meter");
const shovel = byId("shovel");
const pause = byId("pause");
const restart = byId("restart");
const sound = byId("sound");
const overlay = byId("game-overlay");
const overlayTitle = byId("overlay-title");
const overlayCopy = byId("overlay-copy");
const overlayAction = byId("overlay-action");
const guide = byId("guide");
const restartDialog = byId("restart-dialog");
const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
const percentX = x => x / BOARD.width * 100 + "%";
const percentY = y => y / BOARD.height * 100 + "%";
const coinButtons = new Map();
const theme = getComputedStyle(document.documentElement);
const palette = {
  laneEdge: theme.getPropertyValue("--color-turf-lane").trim(),
  healthTrack: theme.getPropertyValue("--color-bar-track").trim(),
  defenderHealth: theme.getPropertyValue("--color-bar-defender").trim(),
  enemyHealth: theme.getPropertyValue("--color-bar-enemy").trim(),
};
const sugarIcon = "assets/SugarCube.png";
let art;
let previewDefender;
let focusedTile = 0;
let displayedMode;
let modalReturnMode;
let muted = true;
let audioContext;
let lastTime = 0;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load " + file));
    image.src = "assets/" + file;
  });
}

function makeCards() {
  return DEFENDERS.map((defender, type) => {
    const button = document.createElement("button");
    button.className = "defender";
    button.type = "button";
    button.title = defender.tip;
    button.setAttribute("aria-label", defender.name + ", " + defender.cost + " sugar. " + defender.tip);
    button.innerHTML = '<kbd></kbd><img class="defender-art" alt="" width="64" height="64"><span class="defender-copy"><strong></strong><span class="cost"><img src="' + sugarIcon + '" alt="" width="17" height="17"><span></span></span></span><span class="cooldown" aria-hidden="true" hidden></span>';
    button.querySelector("kbd").textContent = type + 1;
    button.querySelector(".defender-art").src = "assets/Plant" + type + ".png";
    button.querySelector("strong").textContent = defender.label;
    button.querySelector(".cost span").textContent = defender.cost;
    button.addEventListener("click", () => select(type));
    defenders.append(button);
    return { button, cooldown: button.querySelector(".cooldown") };
  });
}

function makePlots() {
  Object.assign(plots.style, {
    gridTemplateRows: "repeat(" + ROWS + ", minmax(0, 1fr))",
    gridTemplateColumns: "repeat(" + COLS + ", minmax(0, 1fr))",
    left: percentX(BOARD.left), top: percentY(BOARD.top),
    width: percentX(BOARD.cellWidth * COLS), height: percentY(BOARD.cellHeight * ROWS),
  });
  return Array.from({ length: ROWS * COLS }, (_, index) => {
    const row = Math.floor(index / COLS);
    const col = index % COLS;
    const button = document.createElement("button");
    button.className = "plot";
    button.type = "button";
    button.tabIndex = index === 0 ? 0 : -1;
    button.addEventListener("focus", () => setFocusedTile(index));
    button.addEventListener("click", () => game.place(row, col));
    plots.append(button);
    return { button, row, col };
  });
}

function setFocusedTile(index) {
  plotButtons[focusedTile].button.tabIndex = -1;
  focusedTile = index;
  plotButtons[index].button.tabIndex = 0;
}

const cards = makeCards();
const plotButtons = makePlots();
const waveSegments = Array.from({ length: LAST_WAVE }, () => {
  const segment = document.createElement("span");
  waveMeter.append(segment);
  return segment;
});

function select(type) {
  if (game.mode !== "playing") return;
  game.selected = type;
  game.say(type === "shovel" ? "Tap a planted tile to remove its defender." : DEFENDERS[type].tip);
  playSound("select");
  renderHud();
}

function start() {
  if (!art) return;
  enableAudio();
  game.reset();
  game.say("Select a defender, then tap a garden tile.");
  setFocusedTile(0);
  playSound("plant");
  syncMode();
  plotButtons[0].button.focus({ preventScroll: true });
}

function togglePause() {
  if (game.mode === "playing") game.mode = "paused";
  else if (game.mode === "paused") game.mode = "playing";
  syncMode();
  if (game.mode === "playing") plotButtons[focusedTile].button.focus({ preventScroll: true });
}

function openDialog(dialog) {
  if (guide.open || restartDialog.open) return;
  modalReturnMode = game.mode;
  if (game.mode === "playing") game.mode = "paused";
  dialog.showModal();
  syncMode(false);
}

function closeDialog() {
  game.mode = modalReturnMode;
  syncMode(false);
}

function syncMode(focus = true) {
  if (displayedMode === game.mode) return;
  displayedMode = game.mode;
  arena.dataset.mode = game.mode;
  const playing = game.mode === "playing";
  overlay.hidden = playing;
  plots.inert = !playing;
  pickups.inert = !playing;
  defenders.inert = !playing;
  shovel.disabled = !playing;
  pause.disabled = !playing;
  restart.disabled = game.mode === "title";
  if (playing) return;
  const content = {
    title: ["Defend the garden", "Plant candy defenders and survive all 10 waves.", "Start game"],
    paused: ["Game paused", "", "Resume game"],
    won: ["Garden defended!", game.defeated + " monsters defeated, " + game.score + " points", "Play again"],
    lost: ["The garden was overrun", "Wave " + game.wave + ", " + game.score + " points", "Try again"],
  }[game.mode];
  overlayTitle.textContent = content[0];
  overlayCopy.textContent = content[1];
  overlayCopy.hidden = !content[1];
  overlayAction.textContent = art ? content[2] : "Loading game…";
  if (focus && game.mode !== "title" && !guide.open && !restartDialog.open) {
    overlayAction.focus({ preventScroll: true });
  }
}

function setText(element, text) {
  if (element.textContent !== String(text)) element.textContent = text;
}

function renderHud() {
  setText(byId("sugar"), game.sugar);
  setText(byId("score"), game.score);
  setText(byId("wave"), "Wave " + game.wave + " of " + LAST_WAVE);
  if (waveMeter.getAttribute("aria-valuenow") !== String(game.wave)) {
    waveMeter.setAttribute("aria-valuenow", game.wave);
    waveSegments.forEach((segment, index) => {
      segment.className = index + 1 < game.wave ? "cleared" : index + 1 === game.wave ? "current" : "";
    });
  }
  let waveStatus = "Ready";
  if (game.mode === "paused") waveStatus = "Paused";
  if (game.mode === "playing") {
    waveStatus = game.queued > 0 ? "Incoming" : game.wave < LAST_WAVE
      ? "Next in " + Math.max(0, Math.ceil(game.nextWave)) + "s" : "Final wave";
  }
  if (game.mode === "won") waveStatus = "Cleared";
  if (game.mode === "lost") waveStatus = "Overrun";
  setText(byId("wave-time"), waveStatus);

  cards.forEach(({ button, cooldown }, index) => {
    const remaining = Math.max(0, Math.ceil(game.readyAt[index] - game.elapsed));
    button.setAttribute("aria-pressed", String(game.selected === index));
    button.classList.toggle("unaffordable", game.sugar < DEFENDERS[index].cost);
    cooldown.hidden = remaining === 0;
    if (remaining) setText(cooldown, remaining + "s");
  });
  const shoveling = game.selected === "shovel";
  shovel.setAttribute("aria-pressed", String(shoveling));
  plots.classList.toggle("has-shovel", shoveling);
  const canPlant = game.mode === "playing" && !shoveling
    && game.sugar >= DEFENDERS[game.selected].cost && game.readyAt[game.selected] <= game.elapsed;
  plots.classList.toggle("can-plant", canPlant);
  if (canPlant && previewDefender !== game.selected) {
    previewDefender = game.selected;
    plots.style.setProperty("--placement-art", 'url("assets/Plant' + previewDefender + '.png")');
  }
  const hint = game.mode === "playing" && game.messageUntil > game.elapsed ? game.message
    : game.selected === "shovel" ? "Tap a planted tile to remove its defender."
      : "Select a defender, then tap a garden tile.";
  setText(byId("hint"), hint);
  const waveCallout = byId("wave-callout");
  waveCallout.hidden = game.mode !== "playing" || game.elapsed >= game.waveFlashUntil;
  if (!waveCallout.hidden) setText(waveCallout, game.wave === LAST_WAVE ? "Final wave!" : "Wave " + game.wave);

  for (const { button, row, col } of plotButtons) {
    const plant = game.plants[row][col];
    const label = "Lane " + (row + 1) + ", tile " + (col + 1) + ", " + (plant ? DEFENDERS[plant.type].name : "empty");
    if (button.getAttribute("aria-label") !== label) {
      button.setAttribute("aria-label", label);
      button.classList.toggle("occupied", Boolean(plant));
    }
  }
}

function drawSprite(sheet, column, row, x, y, size, angle = 0, opacity = 1, flash = false) {
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.globalAlpha = opacity;
  if (flash) context.filter = "brightness(1.4) saturate(1.4)";
  context.drawImage(sheet, column * 128, row * 128, 128, 128, -size / 2, -size / 2, size, size);
  context.restore();
}

function healthBar(x, y, health, max, enemy) {
  if (health >= max || health <= 0) return;
  context.fillStyle = palette.healthTrack;
  context.fillRect(x - 16, y, 32, 5);
  context.fillStyle = enemy ? palette.enemyHealth : palette.defenderHealth;
  context.fillRect(x - 15, y + 1, 30 * health / max, 3);
}

function paintGarden(boardImage) {
  const { cellWidth, cellHeight } = BOARD;
  const turf = document.createElement("canvas");
  turf.width = cellWidth * COLS;
  turf.height = cellHeight * ROWS;
  const brush = turf.getContext("2d");
  brush.imageSmoothingEnabled = false;

  // Reuse intact patches of the board art so the visible squares follow the planting grid.
  const grass = [
    [[265, 144], [444, 202], [266, 317]],
    [[176, 144], [353, 202], [536, 260]],
  ];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const [sourceX, sourceY] = grass[(row + col) % 2][(row * 2 + col) % 3];
      brush.drawImage(boardImage, sourceX, sourceY, 70, 50,
        col * cellWidth, row * cellHeight, cellWidth, cellHeight);
    }
  }

  brush.fillStyle = palette.laneEdge;
  for (let row = 1; row < ROWS; row++) brush.fillRect(0, row * cellHeight - 1, turf.width, 2);
  return turf;
}

function drawBoard() {
  context.clearRect(0, 0, BOARD.width, BOARD.height);
  if (!art) return;
  context.drawImage(art.turf, BOARD.left, BOARD.top);
  const animate = !motionPreference.matches;
  for (const lane of game.plants) {
    for (const plant of lane) {
      if (!plant) continue;
      const { type, row, col, age } = plant;
      const meta = DEFENDERS[type];
      const primary = type < 3;
      const frame = animate ? Math.floor(age * 3.6 + (row + col) * .39) % 4 : 0;
      const phase = age * 3.2 + row * .5 + col * .22;
      const bounce = animate ? Math.sin(phase) : 0;
      const x = columnX(col);
      const y = rowY(row);
      drawSprite(primary ? art.primary : art.defense, frame, primary ? type : [0, 1, 3][type - 3],
        x, y - bounce * 2.2, UNIT * meta.size * (1 + bounce * .021), bounce * .026, 1,
        plant.flash > 0 || (animate && type === 4 && age > 3.8 && Math.sin(age * 9) > .45));
      healthBar(x, y - 26, plant.health, meta.health, false);
    }
  }

  for (const enemy of game.enemies) {
    const { type, row, x, age, dead, death } = enemy;
    const frame = dead ? 5 + Math.min(2, Math.floor(death * 6.8)) : animate ? Math.floor(age * 6) % 4 : 0;
    const y = rowY(row);
    const gait = age * (type === 3 ? 11 : 7.8);
    const bob = animate ? type === 4 ? Math.sin(age * 4) * 6 : Math.abs(Math.sin(gait)) * 3 : 0;
    drawSprite(art.enemies, frame, type, x, y - bob, UNIT * (type === 2 ? 1.14 : 1.02),
      animate ? Math.sin(gait) * .04 : 0, dead ? Math.max(.2, 1 - death * 1.6) : 1, enemy.flash > 0);
    healthBar(x, y - 27, enemy.health, enemy.maxHealth, true);
  }

  for (const shot of game.shots) {
    const y = rowY(shot.row) - 4 - (shot.kind === 1 ? Math.sin(shot.age * 5.5) * 10 : 0);
    drawSprite(art.primary, 8, shot.kind * 2, shot.x, y, UNIT * .5, animate ? shot.age * 4 : 0);
  }
  for (const effect of game.effects) {
    const progress = effect.age / effect.duration;
    const y = rowY(effect.row);
    if (effect.kind < 2) {
      const frame = Math.min(3, Math.floor(progress * 4));
      drawSprite(art.defense, frame, 2 + effect.kind * 2, effect.x, y,
        UNIT * effect.size * (1 + Math.sin(progress * Math.PI) * .26));
    } else {
      drawSprite(art.primary, 9, (effect.kind - 2) * 2, effect.x, y, UNIT * effect.size, 0, 1 - progress);
    }
  }
}

function renderCoins() {
  const liveIds = new Set();
  for (const coin of game.coins) {
    liveIds.add(coin.id);
    let button = coinButtons.get(coin.id);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "pickup";
      button.setAttribute("aria-label", "Collect 25 sugar");
      const icon = document.createElement("img");
      icon.src = sugarIcon;
      icon.width = 128;
      icon.height = 128;
      icon.alt = "";
      button.append(icon);
      button.addEventListener("click", () => {
        const restoreFocus = document.activeElement === button && button.matches(":focus-visible");
        game.collect(coin.id);
        if (restoreFocus) plotButtons[focusedTile].button.focus({ preventScroll: true });
      });
      coinButtons.set(coin.id, button);
      pickups.append(button);
    }
    const bob = motionPreference.matches ? 0 : Math.sin(coin.age * 3) * 3;
    button.style.left = percentX(coin.x);
    button.style.top = percentY(coin.y + bob);
    button.style.opacity = Math.min(1, (coin.life - coin.age) / 2);
  }
  for (const [id, button] of coinButtons) {
    if (!liveIds.has(id)) {
      if (document.activeElement === button && game.mode === "playing") {
        plotButtons[focusedTile].button.focus({ preventScroll: true });
      }
      button.remove();
      coinButtons.delete(id);
    }
  }
}

const tones = {
  select: [[540, 720, .08, .04]],
  plant: [[440, 695, .12, .07]],
  shoot: [[420, 680, .075, .025]],
  hit: [[265, 162, .085, .035]],
  pop: [[290, 115, .14, .055]],
  grow: [[690, 920, .12, .045]],
  sugar: [[660, 660, .08, .08], [880, 1040, .14, .08]],
  wave: [[440, 440, .12, .07], [587, 780, .22, .08]],
  burst: [[132, 47, .34, .13]],
  win: [[523, 523, .14, .08], [659, 659, .14, .08], [784, 1047, .28, .08]],
  lose: [[440, 392, .16, .07], [311, 196, .32, .08]],
};

function enableAudio() {
  if (muted) return;
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return;
  audioContext ??= new Audio();
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
}

function playSound(name) {
  if (muted || !audioContext || audioContext.state !== "running") return;
  for (const [index, [frequency, end, duration, gain]] of tones[name].entries()) {
    const t = audioContext.currentTime + index * .09;
    const oscillator = audioContext.createOscillator();
    const envelope = audioContext.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, t);
    oscillator.frequency.exponentialRampToValueAtTime(end, t + duration);
    envelope.gain.setValueAtTime(.001, t);
    envelope.gain.linearRampToValueAtTime(gain, t + .012);
    envelope.gain.exponentialRampToValueAtTime(.001, t + duration);
    oscillator.connect(envelope).connect(audioContext.destination);
    oscillator.start(t);
    oscillator.stop(t + duration);
  }
}

function toggleSound() {
  muted = !muted;
  sound.setAttribute("aria-pressed", String(!muted));
  enableAudio();
  playSound("sugar");
}

function frame(now) {
  const dt = lastTime ? Math.min(.07, (now - lastTime) / 1000) : 0;
  lastTime = now;
  if (game.mode === "playing") game.update(dt);
  syncMode();
  for (const event of new Set(game.sounds)) playSound(event);
  game.sounds.length = 0;
  drawBoard();
  renderCoins();
  renderHud();
  requestAnimationFrame(frame);
}

byId("help").addEventListener("click", () => openDialog(guide));
guide.addEventListener("close", closeDialog);
restart.addEventListener("click", () => {
  restartDialog.returnValue = "cancel";
  openDialog(restartDialog);
});
restartDialog.addEventListener("close", () => {
  if (restartDialog.returnValue === "restart") start();
  else closeDialog();
});
overlayAction.addEventListener("click", () => game.mode === "paused" ? togglePause() : start());
shovel.addEventListener("click", () => select("shovel"));
pause.addEventListener("click", togglePause);
sound.addEventListener("click", toggleSound);

plots.addEventListener("keydown", event => {
  const { row, col } = plotButtons[focusedTile];
  const direction = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
  if (!direction) return;
  event.preventDefault();
  const newRow = Math.max(0, Math.min(ROWS - 1, row + direction[0]));
  const newCol = Math.max(0, Math.min(COLS - 1, col + direction[1]));
  plotButtons[newRow * COLS + newCol].button.focus({ preventScroll: true });
});

document.addEventListener("keydown", event => {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || guide.open || restartDialog.open) return;
  const key = event.key.toLowerCase();
  if (key === "m") toggleSound();
  if (key === " " && (event.target.matches?.(".plot") || !event.target.closest?.("button")) && ["playing", "paused"].includes(game.mode)) {
    event.preventDefault();
    togglePause();
  }
  if (key === "escape" && ["playing", "paused"].includes(game.mode)) togglePause();
  if (key === "r" && !restart.disabled) restart.click();
  if (game.mode === "playing") {
    if (/^[1-6]$/.test(key)) select(Number(key) - 1);
    if (key === "x") select("shovel");
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && game.mode === "playing") {
    game.mode = "paused";
    syncMode(false);
  }
  lastTime = 0;
});

syncMode(false);
renderHud();
Promise.all(["PlantsPrimary.png", "PlantsDefense.png", "CandyEnemies.png", "CandyBoard.png", "SugarCube.png"].map(loadImage))
  .then(([primary, defense, enemies, board]) => {
    art = { primary, defense, enemies, turf: paintGarden(board) };
    overlayAction.removeAttribute("aria-busy");
    overlayAction.disabled = false;
    overlayAction.textContent = "Start game";
    requestAnimationFrame(frame);
  })
  .catch(() => {
    overlayAction.removeAttribute("aria-busy");
    overlayTitle.textContent = "The garden couldn’t load";
    overlayCopy.textContent = "Refresh the page to try again.";
    overlayAction.hidden = true;
  });
