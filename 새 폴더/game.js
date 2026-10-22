// ============================================================
// 🍿 팝콘 서바이벌 - 보스 탄막 피하기 게임
// ============================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', () => { resize(); });

// ============================================================
// 상수 & 설정
// ============================================================
const DIFFICULTY_CFG = {
  easy:    { bossHpMult: 0.7, bulletSpeedMult: 0.75, patternInterval: 3200, bulletCount: 0.7 },
  normal:  { bossHpMult: 1.0, bulletSpeedMult: 1.0,  patternInterval: 2500, bulletCount: 1.0 },
  hard:    { bossHpMult: 1.4, bulletSpeedMult: 1.3,  patternInterval: 1900, bulletCount: 1.3 },
  extreme: { bossHpMult: 2.0, bulletSpeedMult: 1.65, patternInterval: 1300, bulletCount: 1.6 },
};

const CHAR_TYPES = {
  healer:  { emoji: '🌽', color: '#f5d020', maxHp: 120, skill: '피격 직후 소량 회복',  skillCd: 4000 },
  shield:  { emoji: '🛡️', color: '#60a5fa', maxHp: 100, skill: '0.8초 무적 방어막',    skillCd: 4000 },
  catcher: { emoji: '🤾', color: '#4ade80', maxHp: 90,  skill: '탄환 1개 되돌려 보내기', skillCd: 4000 },
};

const UPGRADE_POOL = [
  { id:'maxhp',     type:'stat',    icon:'❤️',  name:'최대 HP +25',       desc:'최대 HP가 25 증가합니다.',           apply: p => { p.maxHp += 25; p.hp = Math.min(p.hp + 25, p.maxHp); } },
  { id:'speed',     type:'stat',    icon:'👟',  name:'이동 가속 +15%',    desc:'가속력이 15% 빨라집니다.',           apply: p => { p.accelMult = (p.accelMult||1) * 1.15; } },
  { id:'dashcd',    type:'skill',   icon:'⚡',  name:'대쉬 쿨타임 -1초',  desc:'대쉬 쿨타임이 1초 단축됩니다.',     apply: p => { p.dashCdMax = Math.max(1500, p.dashCdMax - 1000); } },
  { id:'dashinv',   type:'skill',   icon:'🔮',  name:'대쉬 무적 연장',    desc:'대쉬 무적 시간이 50% 늘어납니다.',  apply: p => { p.dashInvMult = (p.dashInvMult||1) * 1.5; } },
  { id:'dashcharge',type:'skill',   icon:'🔋',  name:'대쉬 충전 +1',      desc:'대쉬 최대 충전 횟수가 1 증가합니다.', apply: p => { p.dashMaxCharges++; p.dashCharges = Math.min(p.dashCharges+1, p.dashMaxCharges); } },
  { id:'dashblast', type:'special', icon:'💢',  name:'대쉬 충격파',       desc:'대쉬 시 근처 탄환을 밀어냅니다.',   apply: p => { p.dashBlast = true; } },
  { id:'skillcd',   type:'skill',   icon:'⏩',  name:'스킬 쿨타임 -20%',  desc:'캐릭터 스킬 쿨타임이 20% 감소합니다.', apply: p => { p.skillCdMax *= 0.8; } },
  { id:'dmgreduce', type:'stat',    icon:'🛡️',  name:'피격 감소 -12%',    desc:'받는 피해가 12% 감소합니다.',       apply: p => { p.dmgReduce = (p.dmgReduce||0) + 0.12; } },
  { id:'healrate',  type:'stat',    icon:'💊',  name:'힐량 +30%',         desc:'모든 회복 효과가 30% 증가합니다.',   apply: p => { p.healMult = (p.healMult||1) * 1.3; } },
  { id:'hitbox',    type:'special', icon:'🎯',  name:'피격 판정 축소',    desc:'피격 판정이 30% 줄어듭니다.',       apply: p => { p.hitboxMult = (p.hitboxMult||1) * 0.7; } },
];

// ============================================================
// 전역 상태
// ============================================================
const G = {
  screen: 'menu',
  selectedChar: 'healer',
  selectedDiff: 'normal',
  diffCfg: DIFFICULTY_CFG['normal'],
  round: 1,
  player: null,
  boss: null,
  bullets: [],
  particles: [],
  telegraphs: [],
  keys: {},
  mouseX: 0, mouseY: 0,
  kills: 0,
  startTime: 0,
  gameOver: false,
  animFrame: null,
};

// 아레나 반경 (화면 중앙의 원형 경기장)
function arenaR() { return Math.min(canvas.width, canvas.height) * 0.42; }
function arenaCX() { return canvas.width / 2; }
function arenaCY() { return canvas.height / 2; }

// ============================================================
// PLAYER
// ============================================================
class Player {
  constructor(charType) {
    const cd = CHAR_TYPES[charType];
    this.charType = charType;
    this.emoji = cd.emoji;
    this.color = cd.color;
    this.x = arenaCX();
    this.y = arenaCY() + 80;
    this.r = 18;         // 표시 반경
    this.hitR = 7;       // 실제 피격 판정 (작음!)
    this.hitboxMult = 1;
    this.maxHp = cd.maxHp;
    this.hp = this.maxHp;
    this.dmgReduce = 0;
    this.healMult = 1;

    // 관성 이동
    this.vx = 0; this.vy = 0;
    this.accelMult = 1;
    this.baseAccel = 0.3228;  // 0.2152 * 1.5
    this.friction = 0.90;
    this.maxSpeed = 4.842;    // 3.228 * 1.5

    // 대쉬
    this.dashMaxCharges = 2;
    this.dashCharges = 2;
    this.dashCdMax = 5000;
    this.dashCooldowns = [0, 0];
    this.dashInvMult = 1;
    this.dashBlast = false;
    this.isDashing = false;
    this.dashTimer = 0;
    this.dashVx = 0; this.dashVy = 0;
    this.dashDuration = 200;

    // 스킬
    this.skillCdMax = cd.skillCd;
    this.skillTimer = 0;
    this.skillActive = false;
    this.skillDurationTimer = 0;
    this.skillDuration = 800;

    // 무적
    this.invulnTimer = 0;
    this.hitFlash = 0;

    // 이동 방향 (대쉬용)
    this.facingX = 0;
    this.facingY = 1;

    this.alive = true;
  }

  update(dt) {
    if (!this.alive) return;

    // ── 입력 ──────────────────────────────────────────────
    let ix = 0, iy = 0;
    if (G.keys['KeyW'] || G.keys['ArrowUp'])    iy -= 1;
    if (G.keys['KeyS'] || G.keys['ArrowDown'])  iy += 1;
    if (G.keys['KeyA'] || G.keys['ArrowLeft'])  ix -= 1;
    if (G.keys['KeyD'] || G.keys['ArrowRight']) ix += 1;

    const moving = ix !== 0 || iy !== 0;
    if (moving) {
      const len = Math.sqrt(ix*ix + iy*iy);
      this.facingX = ix / len;
      this.facingY = iy / len;
    }

    // ── 관성 이동 ─────────────────────────────────────────
    if (!this.isDashing) {
      const accel = this.baseAccel * this.accelMult;
      const maxSpd = this.maxSpeed * this.accelMult;

      if (moving) {
        const len = Math.sqrt(ix*ix + iy*iy);
        this.vx += (ix / len) * accel;
        this.vy += (iy / len) * accel;
      }
      // 마찰 (항상 적용 → 자연스러운 감속)
      this.vx *= this.friction;
      this.vy *= this.friction;

      // 속도 제한
      const curSpd = Math.sqrt(this.vx*this.vx + this.vy*this.vy);
      if (curSpd > maxSpd) {
        this.vx = (this.vx / curSpd) * maxSpd;
        this.vy = (this.vy / curSpd) * maxSpd;
      }
    } else {
      // 대쉬 중
      this.dashTimer -= dt;
      this.vx = this.dashVx;
      this.vy = this.dashVy;
      if (this.dashTimer <= 0) {
        this.isDashing = false;
        // 대쉬 후 관성 유지
        this.vx *= 0.45;
        this.vy *= 0.45;
        if (this.dashBlast) {
          pushBulletsAway(this.x, this.y, 90);
          spawnParticles(this.x, this.y, 18, '#60a5fa', 5, 400);
        }
      }
    }

    // ── 위치 이동 ─────────────────────────────────────────
    this.x += this.vx;
    this.y += this.vy;

    // 아레나 경계 클램프
    const ar = arenaR() - this.r;
    const cx = arenaCX(), cy = arenaCY();
    const dx = this.x - cx, dy = this.y - cy;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist > ar) {
      const ang = Math.atan2(dy, dx);
      this.x = cx + Math.cos(ang) * ar;
      this.y = cy + Math.sin(ang) * ar;
      // 벽 충돌 시 수직 속도 제거
      const nx = Math.cos(ang), ny = Math.sin(ang);
      const dot = this.vx*nx + this.vy*ny;
      if (dot > 0) { this.vx -= dot*nx*1.5; this.vy -= dot*ny*1.5; }
    }

    // ── 타이머 ────────────────────────────────────────────
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    this.skillTimer  = Math.max(0, this.skillTimer - dt);
    this.hitFlash    = Math.max(0, this.hitFlash - dt);

    if (this.skillActive) {
      this.skillDurationTimer -= dt;
      if (this.skillDurationTimer <= 0) this.skillActive = false;
    }

    // 대쉬 쿨타임
    for (let i = 0; i < 2; i++) {
      if (this.dashCooldowns[i] > 0) {
        this.dashCooldowns[i] = Math.max(0, this.dashCooldowns[i] - dt);
        if (this.dashCooldowns[i] === 0 && this.dashCharges < this.dashMaxCharges) {
          this.dashCharges++;
        }
      }
    }
  }

  dash() {
    if (this.dashCharges <= 0 || this.isDashing) return;
    this.dashCharges--;

    // 빈 슬롯에 쿨타임 부여
    const slot = this.dashCooldowns.findIndex((v, i) => i < this.dashMaxCharges && v === 0);
    if (slot !== -1) this.dashCooldowns[slot] = this.dashCdMax;

    const dashSpeed = 5;  // 대쉬 거리 절반
    let dx = this.facingX, dy = this.facingY;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) { dx = 0; dy = -1; }

    this.dashVx = dx * dashSpeed;
    this.dashVy = dy * dashSpeed;
    this.isDashing = true;
    this.dashTimer = this.dashDuration;
    this.invulnTimer = Math.round(this.dashDuration * this.dashInvMult);

    spawnParticles(this.x, this.y, 12, this.color, 4, 350);
  }

  useSkill() {
    if (this.skillTimer > 0 || this.skillActive) return;
    this.skillTimer = this.skillCdMax;
    this.skillActive = true;
    this.skillDurationTimer = this.skillDuration;

    if (this.charType === 'healer') {
      const heal = Math.round(20 * (this.healMult||1));
      this.hp = Math.min(this.maxHp, this.hp + heal);
      spawnParticles(this.x, this.y, 18, '#4ade80', 4, 600);
    } else if (this.charType === 'shield') {
      this.invulnTimer = Math.max(this.invulnTimer, this.skillDuration);
      spawnParticles(this.x, this.y, 20, '#60a5fa', 3, 800);
    } else if (this.charType === 'catcher') {
      // 가장 가까운 탄환 하나 되돌려 보내기
      let nearest = null, minD = 200;
      G.bullets.forEach(b => {
        const d = Math.hypot(b.x - this.x, b.y - this.y);
        if (d < minD) { minD = d; nearest = b; }
      });
      if (nearest) {
        const bx = G.boss ? G.boss.x : arenaCX();
        const by = G.boss ? G.boss.y : 0;
        const bdx = bx - nearest.x, bdy = by - nearest.y;
        const bl = Math.sqrt(bdx*bdx + bdy*bdy) || 1;
        const spd = Math.sqrt(nearest.vx*nearest.vx + nearest.vy*nearest.vy) * 1.5;
        nearest.vx = (bdx/bl) * spd;
        nearest.vy = (bdy/bl) * spd;
        nearest.fromPlayer = true;
        spawnParticles(nearest.x, nearest.y, 10, '#facc15', 4, 400);
      }
    }
  }

  takeDamage(dmg) {
    if (this.invulnTimer > 0) return;
    const reduced = dmg * (1 - Math.min(0.7, this.dmgReduce));
    this.hp -= reduced;
    this.hitFlash = 300;
    this.invulnTimer = 900; // 피격 무적
    spawnParticles(this.x, this.y, 10, '#ef4444', 3, 400);
    shakeCamera(5, 200);
    if (this.hp <= 0) { this.hp = 0; this.alive = false; }
  }

  draw() {
    // 피격 깜빡임
    if (this.hitFlash > 0 && Math.floor(this.hitFlash / 80) % 2 === 1) {
      ctx.globalAlpha = 0.35;
    }

    // 대쉬 잔상
    if (this.isDashing) {
      for (let t = 1; t <= 3; t++) {
        ctx.globalAlpha = 0.12 * (4 - t);
        ctx.beginPath();
        ctx.arc(
          this.x - this.dashVx * t * 0.15,
          this.y - this.dashVy * t * 0.15,
          this.r, 0, Math.PI*2
        );
        ctx.fillStyle = this.color;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 쉴드 오라
    if (this.charType === 'shield' && this.skillActive) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r + 10, 0, Math.PI*2);
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#60a5fa';
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // 무적 중 글로우
    if (this.invulnTimer > 0 && !this.isDashing) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r + 6, 0, Math.PI*2);
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(Date.now() * 0.015);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 본체 글로우
    const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.r * 1.7);
    grad.addColorStop(0, this.color + '44');
    grad.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r * 1.7, 0, Math.PI*2);
    ctx.fillStyle = grad;
    ctx.fill();

    // 캐릭터 원
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI*2);
    ctx.fillStyle = this.color + '33';
    ctx.fill();
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 이모지
    ctx.font = `${this.r * 1.4}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.emoji, this.x, this.y + 1);

    // 실제 피격 판정 표시 (작은 점)
    const hR = this.hitR * this.hitboxMult;
    ctx.beginPath();
    ctx.arc(this.x, this.y, hR, 0, Math.PI*2);
    ctx.fillStyle = '#ffffff55';
    ctx.fill();

    // 대쉬 충전 도트
    for (let i = 0; i < this.dashMaxCharges; i++) {
      const dotX = this.x - (this.dashMaxCharges - 1) * 7 + i * 14;
      const dotY = this.y + this.r + 12;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 4, 0, Math.PI*2);
      ctx.fillStyle = i < this.dashCharges ? '#38bdf8' : '#1e3a5f';
      ctx.shadowColor = i < this.dashCharges ? '#38bdf8' : 'transparent';
      ctx.shadowBlur = 4;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.globalAlpha = 1;
  }
}

// ============================================================
// BOSS - 라운드별 탄막 패턴
// ============================================================
class Boss {
  constructor(round, diffCfg) {
    this.round = round;
    this.diffCfg = diffCfg;
    this.x = arenaCX();
    this.y = arenaCY();          // 중앙 고정
    this.r = 38 + round * 3;
    this.maxHp = Math.round((400 + round * 250) * diffCfg.bossHpMult);
    this.hp = this.maxHp;
    this.alive = true;
    this.phase = 1;
    this.enraged = false;

    // 패턴 클리어 시스템
    this.patternClearCount = 4 + round; // 라운드1=5, 라운드2=6...
    this.patternsExecuted = 0;
    this.cleared = false;

    // 패턴 타이머
    this.patternTimer = 1500; // 첫 공격 딜레이
    this.telegraphTimer = 0;
    this.telegraphDuration = 1100;
    this.currentTelegraph = null;
    this.pendingPattern = null;
    this.inTelegraph = false;

    // 보스 외형 (라운드별)
    const bossSkins = ['👾','🎃','🤖','👹','💀','🔥','⚡','🌋'];
    this.emoji = bossSkins[(round - 1) % bossSkins.length];

    // 가용 패턴 목록 (라운드 증가마다 패턴 추가)
    this.patterns = this._buildPatterns();

    this.attackCount = 0;
  }

  _buildPatterns() {
    const base = ['spread', 'ring', 'aimed'];
    if (this.round >= 2) base.push('spiral');
    if (this.round >= 3) base.push('cross', 'fan_aimed');
    if (this.round >= 4) base.push('double_ring', 'wave');
    if (this.round >= 5) base.push('chaos');
    return base;
  }

  update(dt) {
    if (!this.alive) return;

    // 페이즈 전환
    if (this.hp < this.maxHp * 0.4 && !this.enraged) {
      this.enraged = true;
      this.telegraphDuration = 750;
      this.diffCfg = {
        ...this.diffCfg,
        bulletSpeedMult: this.diffCfg.bulletSpeedMult * 1.25,
        patternInterval: this.diffCfg.patternInterval * 0.7,
      };
      spawnParticles(this.x, this.y, 30, '#dc2626', 6, 800);
    }

    // 보스 중앙 고정
    this.x = arenaCX();
    this.y = arenaCY();

    // 패턴 진행
    this.patternTimer -= dt;

    if (!this.inTelegraph && this.patternTimer <= 0) {
      this._startTelegraph();
    }

    if (this.inTelegraph) {
      this.telegraphTimer -= dt;
      if (this.telegraphTimer <= 0) {
        this._executePattern();
        this.inTelegraph = false;
        this.patternTimer = this.diffCfg.patternInterval * (0.8 + Math.random() * 0.4);
      }
    }
  }

  _startTelegraph() {
    const p = G.player;
    const list = [...this.patterns];
    const idx = Math.floor(Math.random() * list.length);
    this.pendingPattern = list[idx];
    this.inTelegraph = true;
    this.telegraphTimer = this.telegraphDuration;

    // 예고 데이터 생성
    const tels = [];
    if (this.pendingPattern === 'spread' || this.pendingPattern === 'aimed' || this.pendingPattern === 'fan_aimed') {
      const ang = p ? Math.atan2(p.y - this.y, p.x - this.x) : Math.PI/2;
      tels.push({ type: 'fan', x: this.x, y: this.y, angle: ang, spread: Math.PI/4, r: 420, timer: this.telegraphDuration, maxTimer: this.telegraphDuration });
    } else if (this.pendingPattern === 'ring' || this.pendingPattern === 'double_ring') {
      tels.push({ type: 'ring', x: this.x, y: this.y, r: 200, timer: this.telegraphDuration, maxTimer: this.telegraphDuration });
    } else if (this.pendingPattern === 'cross') {
      for (let a = 0; a < Math.PI*2; a += Math.PI/2) {
        tels.push({ type: 'line', x: this.x, y: this.y, angle: a, len: 500, timer: this.telegraphDuration, maxTimer: this.telegraphDuration });
      }
    } else if (this.pendingPattern === 'spiral' || this.pendingPattern === 'wave' || this.pendingPattern === 'chaos') {
      tels.push({ type: 'ring', x: this.x, y: this.y, r: 300, timer: this.telegraphDuration, maxTimer: this.telegraphDuration });
    }
    G.telegraphs.push(...tels);
  }

  _executePattern() {
    const p = this.pendingPattern;
    const bs = this.diffCfg.bulletSpeedMult;
    const bc = this.diffCfg.bulletCount;
    const player = G.player;

    if (p === 'spread') {
      // 플레이어 방향 부채꼴
      const ang = player ? Math.atan2(player.y - this.y, player.x - this.x) : Math.PI/2;
      const cnt = Math.round(7 * bc);
      for (let i = 0; i < cnt; i++) {
        const a = ang - 0.55 + (1.1 / (cnt-1)) * i;
        this._spawnBullet(Math.cos(a)*3.2*bs, Math.sin(a)*3.2*bs, '🧂', 15);
      }
    } else if (p === 'ring') {
      const cnt = Math.round(12 * bc);
      for (let i = 0; i < cnt; i++) {
        const a = (i/cnt)*Math.PI*2;
        this._spawnBullet(Math.cos(a)*2.5*bs, Math.sin(a)*2.5*bs, '🧈', 14);
      }
    } else if (p === 'aimed') {
      const cnt = Math.round(4 * bc);
      for (let i = 0; i < cnt; i++) {
        setTimeout(() => {
          if (!player || !player.alive || !G.boss || !G.boss.alive) return;
          const ang = Math.atan2(player.y - this.y, player.x - this.x) + (Math.random()-0.5)*0.3;
          this._spawnBullet(Math.cos(ang)*4.0*bs, Math.sin(ang)*4.0*bs, '🌶️', 18);
        }, i * 220);
      }
    } else if (p === 'spiral') {
      const total = Math.round(18 * bc);
      for (let i = 0; i < total; i++) {
        setTimeout(() => {
          if (!G.boss || !G.boss.alive) return;
          const a = (i / total) * Math.PI * 4 + this.attackCount * 0.8;
          this._spawnBullet(Math.cos(a)*2.8*bs, Math.sin(a)*2.8*bs, '🫙', 13);
        }, i * 70);
      }
    } else if (p === 'cross') {
      for (let a = 0; a < Math.PI*2; a += Math.PI/2) {
        const cnt = Math.round(5 * bc);
        for (let j = 0; j < cnt; j++) {
          setTimeout(() => {
            if (!G.boss || !G.boss.alive) return;
            this._spawnBullet(Math.cos(a)*( 2.5 + j*0.6)*bs, Math.sin(a)*(2.5+j*0.6)*bs, '🔥', 16);
          }, j * 100);
        }
      }
    } else if (p === 'fan_aimed') {
      const ang = player ? Math.atan2(player.y - this.y, player.x - this.x) : Math.PI/2;
      const cnt = Math.round(10 * bc);
      for (let i = 0; i < cnt; i++) {
        const a = ang - 0.7 + (1.4/(cnt-1))*i;
        this._spawnBullet(Math.cos(a)*3.8*bs, Math.sin(a)*3.8*bs, '🌽', 16);
      }
    } else if (p === 'double_ring') {
      [10, 18].forEach((cnt2, ri) => {
        const cnt = Math.round(cnt2 * bc);
        const offset = ri * (Math.PI / cnt);
        const spd = ri === 0 ? 2.2 : 3.2;
        for (let i = 0; i < cnt; i++) {
          const a = (i/cnt)*Math.PI*2 + offset;
          setTimeout(() => {
            if (!G.boss || !G.boss.alive) return;
            this._spawnBullet(Math.cos(a)*spd*bs, Math.sin(a)*spd*bs, '🍿', 14);
          }, ri * 300);
        }
      });
    } else if (p === 'wave') {
      const cnt = Math.round(20 * bc);
      for (let i = 0; i < cnt; i++) {
        setTimeout(() => {
          if (!G.boss || !G.boss.alive) return;
          const a = (i/cnt)*Math.PI*2;
          const waveMod = Math.sin(i*0.6) * 0.6;
          this._spawnBullet(Math.cos(a)*(2.5+waveMod)*bs, Math.sin(a)*(2.5+waveMod)*bs, '💧', 13);
        }, i * 55);
      }
    } else if (p === 'chaos') {
      const cnt = Math.round(30 * bc);
      for (let i = 0; i < cnt; i++) {
        setTimeout(() => {
          if (!G.boss || !G.boss.alive) return;
          const a = Math.random() * Math.PI * 2;
          const spd = 1.8 + Math.random() * 3.0;
          this._spawnBullet(Math.cos(a)*spd*bs, Math.sin(a)*spd*bs, ['🧂','🧈','🌶️','🫙','🍿'][Math.floor(Math.random()*5)], 15);
        }, i * 40);
      }
    }

    this.attackCount++;
    this.patternsExecuted++;
    if (this.patternsExecuted >= this.patternClearCount) {
      this.cleared = true;
    }
  }

  _spawnBullet(vx, vy, emoji, dmg) {
    G.bullets.push(new Bullet(this.x, this.y, vx, vy, emoji, dmg));
  }

  takeDamage(dmg) {
    if (!this.alive) return;
    this.hp -= dmg;
    spawnParticles(this.x, this.y, 8, '#fbbf24', 3, 300);
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  draw() {
    // 격분 오라
    if (this.enraged) {
      const glow = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.r * 2.8);
      glow.addColorStop(0, '#dc262655');
      glow.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * 2.8, 0, Math.PI*2);
      ctx.fillStyle = glow;
      ctx.fill();
    }

    // 몸체
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI*2);
    ctx.fillStyle = this.enraged ? '#4a0000' : '#1a0020';
    ctx.fill();
    ctx.strokeStyle = this.enraged ? '#ef4444' : '#9333ea';
    ctx.lineWidth = 3;
    ctx.shadowColor = this.enraged ? '#ef4444' : '#9333ea';
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 이모지
    ctx.font = `${this.r * 1.5}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.emoji, this.x, this.y + 1);

    // 패턴 진행 바
    const bw = this.r * 3.2, bh = 9;
    const bx = this.x - bw/2, by = this.y - this.r - 18;
    ctx.fillStyle = '#0f0f1a';
    ctx.beginPath(); ctx.roundRect(bx-2, by-2, bw+4, bh+4, 4); ctx.fill();
    ctx.fillStyle = '#1f1f3a';
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 3); ctx.fill();
    const pPct = Math.min(1, this.patternsExecuted / this.patternClearCount);
    ctx.fillStyle = '#9333ea';
    ctx.shadowColor = '#9333ea';
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.roundRect(bx, by, bw * pPct, bh, 3); ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 11px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.emoji}  패턴 ${this.patternsExecuted} / ${this.patternClearCount}${this.enraged ? '  💢격분' : ''}`, this.x, by - 5);

    // 예고 중 경고 표시
    if (this.inTelegraph) {
      const warn = '⚠️';
      ctx.font = '20px serif';
      ctx.textAlign = 'center';
      ctx.fillText(warn, this.x + this.r + 8, this.y - this.r - 2);
    }
  }
}

// ============================================================
// BULLET
// ============================================================
class Bullet {
  constructor(x, y, vx, vy, emoji, dmg) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.emoji = emoji || '🧂';
    this.dmg = dmg || 15;
    this.r = 8;
    this.life = 7000;
    this.fromPlayer = false;
  }

  update(dt) {
    this.x += this.vx;
    this.y += this.vy;
    this.life -= dt;

    // 아레나 밖으로 나가면 제거
    const cx = arenaCX(), cy = arenaCY();
    if (Math.hypot(this.x - cx, this.y - cy) > arenaR() + 40) this.life = 0;
    if (this.life <= 0) return;

    // 플레이어 피격
    if (!this.fromPlayer && G.player && G.player.alive) {
      const hR = G.player.hitR * (G.player.hitboxMult||1);
      if (Math.hypot(this.x - G.player.x, this.y - G.player.y) < hR + this.r) {
        G.player.takeDamage(this.dmg);
        this.life = 0;
        return;
      }
    }

    // 플레이어 투사체 → 보스 피격
    if (this.fromPlayer && G.boss && G.boss.alive) {
      if (Math.hypot(this.x - G.boss.x, this.y - G.boss.y) < G.boss.r + this.r) {
        G.boss.takeDamage(40);
        this.life = 0;
      }
    }
  }

  draw() {
    ctx.font = '15px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.emoji, this.x, this.y);
  }
}

// ============================================================
// PARTICLE
// ============================================================
class Particle {
  constructor(x, y, vx, vy, color, life) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.color = color;
    this.life = life;
    this.maxLife = life;
    this.r = 2 + Math.random() * 3;
  }
  update(dt) {
    this.x += this.vx; this.y += this.vy;
    this.vy += 0.08;
    this.vx *= 0.97; this.vy *= 0.97;
    this.life -= dt;
  }
  draw() {
    const alpha = Math.max(0, this.life / this.maxLife);
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r * alpha, 0, Math.PI*2);
    ctx.fillStyle = this.color;
    ctx.globalAlpha = alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ============================================================
// 헬퍼
// ============================================================
function spawnParticles(x, y, count, color, speed, life) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.7);
    G.particles.push(new Particle(x, y, Math.cos(a)*s, Math.sin(a)*s, color, life));
  }
}

function pushBulletsAway(x, y, radius) {
  G.bullets.forEach(b => {
    const d = Math.hypot(b.x - x, b.y - y);
    if (d < radius && d > 0) {
      const force = (1 - d/radius) * 8;
      b.vx += (b.x - x) / d * force;
      b.vy += (b.y - y) / d * force;
    }
  });
}

let camShake = { x: 0, y: 0, timer: 0, str: 0 };
function shakeCamera(str, dur) {
  camShake.str = Math.max(camShake.str, str);
  camShake.timer = Math.max(camShake.timer, dur);
}

// ============================================================
// 예고선 그리기
// ============================================================
function drawTelegraphs(t) {
  G.telegraphs = G.telegraphs.filter(tel => {
    tel.timer -= 16;
    if (tel.timer <= 0) return false;
    const fade = tel.timer / tel.maxTimer;
    const pulse = 0.3 + 0.4 * Math.abs(Math.sin(t * 0.009));
    ctx.save();
    ctx.globalAlpha = pulse * fade;

    if (tel.type === 'line') {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 28;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tel.x, tel.y);
      ctx.lineTo(tel.x + Math.cos(tel.angle)*tel.len, tel.y + Math.sin(tel.angle)*tel.len);
      ctx.stroke();
      ctx.globalAlpha = pulse * fade * 0.6;
      ctx.strokeStyle = '#fca5a5';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (tel.type === 'ring') {
      ctx.beginPath();
      ctx.arc(tel.x, tel.y, tel.r, 0, Math.PI*2);
      ctx.fillStyle = '#9333ea22';
      ctx.fill();
      ctx.strokeStyle = '#9333ea';
      ctx.lineWidth = 3;
      ctx.stroke();
    } else if (tel.type === 'fan') {
      ctx.beginPath();
      ctx.moveTo(tel.x, tel.y);
      ctx.arc(tel.x, tel.y, tel.r, tel.angle - tel.spread/2, tel.angle + tel.spread/2);
      ctx.closePath();
      ctx.fillStyle = '#ef444422';
      ctx.fill();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
    return true;
  });
}

// ============================================================
// 배경 & 아레나
// ============================================================
function drawBackground() {
  ctx.fillStyle = '#07040f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 타일 패턴
  ctx.strokeStyle = 'rgba(120,80,200,0.04)';
  ctx.lineWidth = 1;
  const gs = 55;
  for (let x = 0; x < canvas.width; x += gs) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += gs) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
}

function drawArena(t) {
  const cx = arenaCX(), cy = arenaCY(), r = arenaR();

  // 배경 fill
  const arenaBg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  arenaBg.addColorStop(0, '#110820');
  arenaBg.addColorStop(0.7, '#0d0618');
  arenaBg.addColorStop(1, '#06030e');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.fillStyle = arenaBg;
  ctx.fill();

  // 회전하는 장식 링
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t * 0.0004);
  const dashCount = 24;
  for (let i = 0; i < dashCount; i++) {
    const a = (i / dashCount) * Math.PI * 2;
    const x1 = Math.cos(a) * (r - 18), y1 = Math.sin(a) * (r - 18);
    const x2 = Math.cos(a) * (r - 4),  y2 = Math.sin(a) * (r - 4);
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = `hsl(${270 + i*4},60%,55%)`;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // 경계선
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.strokeStyle = '#7c3aed';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#7c3aed';
  ctx.shadowBlur = 20;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // 중심 크로스
  ctx.strokeStyle = 'rgba(120,80,200,0.12)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 10]);
  ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
  ctx.setLineDash([]);
}

// ============================================================
// HUD 업데이트
// ============================================================
function updateHUD() {
  const p = G.player;
  if (!p) return;

  // HP
  const hpPct = Math.max(0, p.hp / p.maxHp);
  const hue = hpPct > 0.5 ? 140 : hpPct > 0.25 ? 40 : 0;
  document.getElementById('hp-bar').style.width = `${hpPct*100}%`;
  document.getElementById('hp-bar').style.background = `linear-gradient(90deg, hsl(${hue},70%,45%), hsl(${hue},70%,60%))`;
  document.getElementById('hp-text').textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;

  // 대쉬 충전
  for (let i = 0; i < 2; i++) {
    const ce = document.getElementById(`dash-${i+1}`);
    const fe = document.getElementById(`dash-fill-${i+1}`);
    const has = i < p.dashCharges;
    ce.classList.toggle('cooldown', !has);
    if (!has && p.dashCooldowns[i] > 0) {
      fe.style.height = `${(1 - p.dashCooldowns[i]/p.dashCdMax)*100}%`;
    } else {
      fe.style.height = has ? '100%' : '0%';
    }
  }

  // 스킬 쿨타임
  const sRate = p.skillTimer > 0 ? 1 - p.skillTimer/p.skillCdMax : 1;
  document.getElementById('skill-cooldown-bar').style.width = `${sRate*100}%`;
  document.getElementById('skill-icon').textContent = CHAR_TYPES[p.charType].emoji;

  // 라운드 표시
  document.getElementById('round-count').textContent = G.round;

  // 패턴 진행
  if (G.boss) {
    document.getElementById('survivors-count').textContent =
      `${G.boss.patternsExecuted}/${G.boss.patternClearCount}`;
  }
}

// ============================================================
// 업그레이드 화면
// ============================================================
function showUpgradeScreen() {
  setScreen('upgrade');
  document.querySelector('.upgrade-title').textContent = `🌟 라운드 ${G.round} 클리어!`;

  const pool = [...UPGRADE_POOL];
  for (let i = pool.length-1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i+1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const choices = pool.slice(0, 3);

  const container = document.getElementById('upgrade-cards');
  container.innerHTML = '';
  choices.forEach(upg => {
    const card = document.createElement('div');
    card.className = `upgrade-card ${upg.type}`;
    card.innerHTML = `
      <div class="upgrade-icon">${upg.icon}</div>
      <div class="upgrade-type">${{stat:'스탯 강화',skill:'스킬 강화',special:'특수 효과'}[upg.type]}</div>
      <div class="upgrade-name">${upg.name}</div>
      <div class="upgrade-desc">${upg.desc}</div>
    `;
    card.addEventListener('click', () => {
      upg.apply(G.player);
      G.round++;
      startBossRound();
    });
    container.appendChild(card);
  });
}

// ============================================================
// 결과 화면
// ============================================================
function showResultScreen(won) {
  setScreen('result');
  document.getElementById('result-emoji').textContent = won ? '🏆' : '💀';
  document.getElementById('result-title').textContent = won ? '🎉 클리어!' : '탈락...';
  const elapsed = Math.round((Date.now() - G.startTime) / 1000);
  const m = Math.floor(elapsed/60), s = elapsed%60;
  document.getElementById('result-stats').innerHTML = `
    <div class="stat-item"><div class="stat-value">${G.round}</div><div class="stat-label">라운드</div></div>
    <div class="stat-item"><div class="stat-value">${m}:${String(s).padStart(2,'0')}</div><div class="stat-label">생존 시간</div></div>
    <div class="stat-item"><div class="stat-value">${G.kills}</div><div class="stat-label">처치</div></div>
  `;
}

// ============================================================
// 게임 초기화 & 라운드 시작
// ============================================================
function initGame() {
  G.round = 1;
  G.kills = 0;
  G.startTime = Date.now();
  G.gameOver = false;
  G.bullets = [];
  G.particles = [];
  G.telegraphs = [];
  G.diffCfg = { ...DIFFICULTY_CFG[G.selectedDiff] };
  G.player = new Player(G.selectedChar);
  G.boss = null;
  document.getElementById('kill-feed').innerHTML = '';
  document.getElementById('boss-warning').classList.add('hidden');
  document.getElementById('storm-warning').classList.add('hidden');
}

function startBossRound() {
  G.bullets = [];
  G.telegraphs = [];
  G.diffCfg = { ...DIFFICULTY_CFG[G.selectedDiff] };

  // 보스 생성
  G.boss = new Boss(G.round, G.diffCfg);

  // 플레이어 위치 리셋
  G.player.x = arenaCX();
  G.player.y = arenaCY() + arenaR() * 0.55;
  G.player.vx = 0; G.player.vy = 0;

  setScreen('game');

  document.getElementById('boss-warning').classList.remove('hidden');
  document.getElementById('boss-warning').textContent = `👾 라운드 ${G.round} 보스 등장!`;
  setTimeout(() => document.getElementById('boss-warning').classList.add('hidden'), 2500);
}

// ============================================================
// 게임 루프
// ============================================================
let lastTime = 0;
let gameTime = 0;
let bossDefeatedHandled = false;

function gameLoop(ts) {
  const dt = Math.min(ts - lastTime, 80);
  lastTime = ts;
  gameTime += dt;

  if (G.screen !== 'game') {
    G.animFrame = requestAnimationFrame(gameLoop);
    return;
  }

  // ── 카메라 쉐이크 ─────────────────────────────────────
  let shX = 0, shY = 0;
  if (camShake.timer > 0) {
    camShake.timer -= dt;
    const s = camShake.str * (camShake.timer / 300);
    shX = (Math.random()-.5) * s * 2;
    shY = (Math.random()-.5) * s * 2;
    if (camShake.timer <= 0) camShake.str = 0;
  }

  ctx.save();
  ctx.translate(shX, shY);

  // ── 그리기 순서 ───────────────────────────────────────
  drawBackground();
  drawArena(gameTime);
  drawTelegraphs(gameTime);

  // 탄환 업데이트 & 그리기
  G.bullets = G.bullets.filter(b => b.life > 0);
  G.bullets.forEach(b => { b.update(dt); if (b.life > 0) b.draw(); });

  // 파티클
  G.particles = G.particles.filter(p => p.life > 0);
  G.particles.forEach(p => { p.update(dt); p.draw(); });

  // 보스
  if (G.boss && !G.boss.cleared) {
    G.boss.update(dt);
    G.boss.draw();
  }

  // 플레이어
  if (G.player && G.player.alive) {
    G.player.update(dt);
    G.player.draw();
  }

  ctx.restore();
  updateHUD();

  // ── 종료 체크 ─────────────────────────────────────────
  if (!G.gameOver) {
    if (G.player && !G.player.alive) {
      G.gameOver = true;
      spawnParticles(G.player.x, G.player.y, 30, '#ef4444', 5, 800);
      setTimeout(() => showResultScreen(false), 1600);
    } else if (G.boss && G.boss.cleared && !bossDefeatedHandled) {
      bossDefeatedHandled = true;
      G.kills++;
      spawnParticles(G.boss.x, G.boss.y, 40, '#fbbf24', 7, 900);
      shakeCamera(8, 400);
      setTimeout(() => {
        bossDefeatedHandled = false;
        showUpgradeScreen();
      }, 1400);
    }
  }

  G.animFrame = requestAnimationFrame(gameLoop);
}

// ============================================================
// 화면 전환
// ============================================================
function setScreen(name) {
  G.screen = name;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`${name}-screen`);
  if (el) el.classList.add('active');
}

// ============================================================
// 입력
// ============================================================
window.addEventListener('keydown', e => {
  G.keys[e.code] = true;
  if (G.screen !== 'game') return;
  if (e.code === 'KeyQ') { e.preventDefault(); G.player?.dash(); }
  if (e.code === 'Space') { e.preventDefault(); G.player?.useSkill(); }
});
window.addEventListener('keyup', e => { G.keys[e.code] = false; });
window.addEventListener('mousemove', e => { G.mouseX = e.clientX; G.mouseY = e.clientY; });

// ============================================================
// 메뉴 이벤트
// ============================================================
document.querySelectorAll('.char-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    G.selectedChar = card.dataset.char;
  });
});
document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    G.selectedDiff = btn.dataset.diff;
  });
});
document.getElementById('start-btn').addEventListener('click', () => {
  initGame();
  startBossRound();
  if (!G.animFrame) G.animFrame = requestAnimationFrame(gameLoop);
});
document.getElementById('restart-btn').addEventListener('click', () => {
  initGame();
  startBossRound();
  setScreen('game');
});
document.getElementById('menu-btn').addEventListener('click', () => {
  G.gameOver = true;
  setScreen('menu');
});

// ============================================================
// 시작
// ============================================================
setScreen('menu');
G.animFrame = requestAnimationFrame(gameLoop);
