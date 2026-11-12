"use strict";

const ROWS = 5;
const COLS = 9;
const LAST_WAVE = 10;
const BOARD = Object.freeze({ width: 960, height: 540, left: 166, top: 136, cellWidth: 70, cellHeight: 59 });
const UNIT = 52;
const columnX = col => BOARD.left + (col + .5) * BOARD.cellWidth;
const rowY = row => BOARD.top + (row + .5) * BOARD.cellHeight;
const plantX = plant => columnX(plant.col);

const DEFENDERS = [
  { name: "Peppermint Shooter", label: "Peppermint", cost: 100, health: 115, recharge: 5, size: .96, tip: "Fires mint shots down its lane." },
  { name: "Gummy Sunflower", label: "Gummy Sunflower", cost: 50, health: 100, recharge: 5, size: 1, tip: "Grows extra sugar for you to collect." },
  { name: "Lollipop Catapult", label: "Lollipop Catapult", cost: 150, health: 125, recharge: 8, size: 1, tip: "Lobs chocolate with splash damage." },
  { name: "Pop Rock Walnut", label: "Pop Rock Walnut", cost: 50, health: 560, recharge: 13, size: 1.05, tip: "Blocks monsters and absorbs heavy damage." },
  { name: "Cupcake Mine", label: "Cupcake Mine", cost: 25, health: 70, recharge: 10, size: .87, tip: "Arms in four seconds, then blasts nearby monsters." },
  { name: "Cherry Bomb", label: "Cherry Bomb", cost: 150, health: 100, recharge: 21, size: .99, tip: "Explodes quickly across nearby lanes." },
];

const MONSTERS = [
  { name: "Chocolate Golem", health: 190, speed: .40, damage: 24, score: 25 },
  { name: "Cupcake Crawler", health: 80, speed: .62, damage: 18, score: 15 },
  { name: "Gummy Bear Brute", health: 300, speed: .30, damage: 34, score: 25 },
  { name: "Ice Cream Runner", health: 65, speed: 1.02, damage: 17, score: 15 },
  { name: "Donut Floater", health: 95, speed: .69, damage: 18, score: 15 },
];

class CandyGarden {
  constructor(random = Math.random) {
    this.random = random;
    this.reset("title");
  }

  reset(mode = "playing") {
    this.mode = mode;
    this.elapsed = 0;
    this.sugar = 300;
    this.score = 0;
    this.defeated = 0;
    this.wave = 0;
    this.queued = 0;
    this.openingLanes = [];
    this.nextWave = 10;
    this.spawnTimer = 0;
    this.dropTimer = 3;
    this.selected = 0;
    this.readyAt = DEFENDERS.map(() => 0);
    this.plants = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    this.enemies = [];
    this.shots = [];
    this.coins = [];
    this.effects = [];
    this.sounds = [];
    this.nextCoinId = 1;
    this.message = "";
    this.messageUntil = 0;
    this.waveFlashUntil = 0;
  }

  range(low, high) {
    return low + (high - low) * this.random();
  }

  say(message) {
    this.message = message;
    this.messageUntil = this.elapsed + 3.3;
  }

  place(row, col) {
    if (this.mode !== "playing") return;
    const lane = this.plants[row];
    if (!lane || col < 0 || col >= COLS) return;
    if (this.selected === "shovel") {
      if (lane[col]) {
        lane[col] = null;
        this.sounds.push("pop");
        this.say("Defender removed.");
      } else {
        this.say("Choose a tile with a defender to remove.");
      }
      return;
    }
    const type = this.selected;
    const defender = DEFENDERS[type];
    if (lane[col]) return this.say("That tile already has a defender.");
    if (this.sugar < defender.cost) return this.say("Collect more sugar cubes.");
    if (this.readyAt[type] > this.elapsed) return this.say("That defender is recharging.");

    this.sugar -= defender.cost;
    this.readyAt[type] = this.elapsed + defender.recharge;
    lane[col] = { type, row, col, age: 0, health: defender.health, action: 0, flash: 0 };
    this.sounds.push("plant");
    if (type === 4) this.say("Cupcake Mine is arming.");
    if (type === 5) this.say("Cherry Bomb is about to burst!");
  }

  addCoin(x, y, falling = false) {
    this.coins.push({ id: this.nextCoinId++, x, y: falling ? 113 : y, targetY: y, age: 0, life: 12.5 });
  }

  collect(id) {
    if (this.mode !== "playing") return;
    const index = this.coins.findIndex(coin => coin.id === id);
    if (index < 0) return;
    this.coins.splice(index, 1);
    this.sugar += 25;
    this.score += 5;
    this.sounds.push("sugar");
    this.say("+25 sugar");
  }

  update(dt) {
    if (this.mode !== "playing") return;
    this.elapsed += dt;
    this.updateWaves(dt);
    this.updatePlants(dt);
    this.updateShots(dt);
    this.updateEnemies(dt);
    for (const coin of this.coins) {
      coin.age += dt;
      coin.y = Math.min(coin.targetY, coin.y + UNIT * 1.32 * dt);
    }
    for (const effect of this.effects) effect.age += dt;
    this.coins = this.coins.filter(coin => coin.age < coin.life);
    this.effects = this.effects.filter(effect => effect.age < effect.duration);
    if (this.mode === "playing" && this.wave === LAST_WAVE && this.queued === 0 && this.enemies.length === 0) {
      this.mode = "won";
      this.sounds.push("win");
    }
  }

  updateWaves(dt) {
    this.dropTimer -= dt;
    if (this.dropTimer <= 0) {
      this.addCoin(this.range(190, 750), this.range(166, 404), true);
      this.dropTimer = this.range(6, 8.5);
    }
    if (this.queued > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnEnemy();
        this.queued--;
        this.spawnTimer = this.range(1.45, 2.2) * Math.max(.68, 1 - this.wave * .016);
        if (this.queued === 0 && this.wave < LAST_WAVE) this.nextWave = this.wave < 3 ? 19 : 15.5;
      }
      return;
    }
    if (this.wave >= LAST_WAVE) return;
    this.nextWave -= dt;
    if (this.nextWave <= 0) {
      this.wave++;
      this.queued = 2 + this.wave * 2;
      this.openingLanes = this.wave <= 2 ? Array.from({ length: ROWS }, (_, row) => row) : [];
      this.spawnTimer = 0;
      this.waveFlashUntil = this.elapsed + 2.25;
      this.sugar += 15;
      this.sounds.push("wave");
    }
  }

  spawnEnemy() {
    const maxTypes = this.wave < 2 ? 2 : this.wave < 4 ? 3 : 5;
    let type = Math.floor(this.random() * maxTypes);
    if (this.wave === 1) type = 1;
    if (this.wave >= 6 && this.random() < .20) type = 4;
    const row = this.openingLanes.length
      ? this.openingLanes.splice(Math.floor(this.random() * this.openingLanes.length), 1)[0]
      : Math.floor(this.random() * ROWS);
    const health = MONSTERS[type].health * (1 + (this.wave - 1) * .065);
    this.enemies.push({
      type, row, x: this.range(891, 932), health, maxHealth: health, age: 0,
      attack: .45, death: 0, flash: 0, dead: false,
    });
  }

  updatePlants(dt) {
    for (const lane of this.plants) {
      for (const plant of lane) {
        if (!plant) continue;
        plant.age += dt;
        plant.action -= dt;
        plant.flash = Math.max(0, plant.flash - dt);
        const { type, row, col } = plant;
        const x = plantX(plant);
        if ((type === 0 || type === 2) && plant.action <= 0) {
          const target = this.enemies.some(enemy => enemy.health > 0 && enemy.row === row && enemy.x > x - 5);
          if (target) {
            const mint = type === 0;
            this.shots.push({ kind: mint ? 0 : 1, row, x: x + UNIT * .28, age: 0, speed: UNIT * (mint ? 5.3 : 3.3), damage: mint ? 24 : 53 });
            plant.action = mint ? 1.52 : 2.35;
            this.sounds.push("shoot");
          }
        }
        if (type === 1 && plant.age > 3 && plant.action <= 0) {
          this.addCoin(x + this.range(-19, 19), rowY(row) - 25);
          plant.action = 9;
          this.sounds.push("grow");
        }
        if (type === 4 && plant.age > 3.8 && this.enemies.some(enemy => enemy.health > 0 && enemy.row === row && Math.abs(enemy.x - x) < UNIT * .67)) {
          this.blast(x, row, 1.2, 300, 0);
          lane[col] = null;
        }
        if (type === 5 && plant.age >= .85) {
          this.blast(x, row, 2.3, 380, 1);
          lane[col] = null;
          this.say("Sweet explosion!");
        }
      }
    }
  }

  updateShots(dt) {
    this.shots = this.shots.filter(shot => {
      const lastX = shot.x;
      shot.age += dt;
      shot.x += shot.speed * dt;
      let target;
      for (const enemy of this.enemies) {
        if (enemy.health <= 0 || enemy.row !== shot.row) continue;
        if (enemy.x < lastX - UNIT * .44 || enemy.x > shot.x + UNIT * .44) continue;
        if (!target || enemy.x < target.x) target = enemy;
      }
      if (!target) return shot.x < BOARD.width + 24;

      target.health -= shot.damage;
      target.flash = .12;
      if (shot.kind === 1) {
        for (const enemy of this.enemies) {
          if (enemy === target || enemy.health <= 0) continue;
          if (Math.abs(enemy.x - target.x) < UNIT * .75 && Math.abs(enemy.row - shot.row) <= 1) {
            enemy.health -= 21;
            enemy.flash = .12;
          }
        }
      }
      this.addEffect(target.x, shot.row, shot.kind + 2, .25, .55);
      this.sounds.push("hit");
      return false;
    });
  }

  addEffect(x, row, kind, duration, size) {
    this.effects.push({ x, row, kind, duration, size, age: 0 });
  }

  blast(x, row, radius, damage, kind) {
    this.addEffect(x, row, kind, .64, kind === 0 ? 1.7 : 3.2);
    for (const enemy of this.enemies) {
      if (enemy.health <= 0) continue;
      if (Math.hypot(enemy.x - x, rowY(enemy.row) - rowY(row)) <= UNIT * radius) {
        enemy.health -= damage;
        enemy.flash = .12;
      }
    }
    this.sounds.push("burst");
  }

  updateEnemies(dt) {
    for (const enemy of this.enemies) {
      const stats = MONSTERS[enemy.type];
      if (enemy.health <= 0 && !enemy.dead) {
        enemy.dead = true;
        this.defeated++;
        this.score += stats.score;
        this.sounds.push("pop");
      }
      if (enemy.dead) {
        enemy.death += dt;
        continue;
      }
      enemy.age += dt;
      enemy.attack -= dt;
      enemy.flash = Math.max(0, enemy.flash - dt);
      const target = this.plants[enemy.row].find(plant => plant && enemy.x - plantX(plant) >= -UNIT * .38 && enemy.x - plantX(plant) <= UNIT * .52);
      if (target) {
        if (enemy.attack <= 0) {
          target.health -= stats.damage;
          target.flash = .16;
          enemy.attack = enemy.type === 3 ? .82 : 1.05;
          if (target.health <= 0) this.plants[target.row][target.col] = null;
          this.sounds.push("hit");
        }
      } else {
        enemy.x -= stats.speed * UNIT * (1 + .02 * (this.wave - 1)) * dt;
      }
      if (enemy.x < 57) {
        this.mode = "lost";
        this.sounds.push("lose");
        return;
      }
    }
    this.enemies = this.enemies.filter(enemy => enemy.death < .44);
  }
}
