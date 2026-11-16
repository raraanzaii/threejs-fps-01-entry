// EMBERLINE — hud.js: every DOM touch lives here. The simulation never
// touches the document; it calls these small setters, and the HUD updates
// only when a value actually changes (cheap text writes, no layout churn).
import { WEAPONS, GRENADES, ARMOUR_PRICE } from './weapons.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    hud: $('hud'), timer: $('timer'), scoreEmber: $('score-ember'), scoreAsh: $('score-ash'),
    aliveEmber: $('alive-ember'), aliveAsh: $('alive-ash'), bombState: $('bomb-state'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    banner: $('banner'), feed: $('feed'), hint: $('hint'),
    healthNum: $('health-num'), money: $('money'),
    ammo: $('ammo'), ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'),
    weaponName: $('weapon-name'), bombPrompt: $('bombprompt'),
    plantBar: $('plantbar'), plantFill: $('plantfill'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    play: $('play'), buy: $('buy'), buyList: $('buy-list'),
    buyMoney: $('buy-money'), buyRound: $('buy-round'),
  };
  const last = { timer: '', hp: -1, money: -1, mag: -1, reserve: -1, weapon: '', aliveE: '', aliveA: '', bomb: '', score: '' };
  let hitTimer = null;
  let feedItems = [];

  function setText(el, key, value) {
    if (last[key] !== value) { last[key] = value; el.textContent = value; }
  }

  return {
    els,
    onPlay(handler) { els.play.addEventListener('click', handler); },
    onDeploy(handler) { $('deploy').addEventListener('click', handler); },
    onBuyRow(handler) {
      els.buyList.addEventListener('click', (e) => {
        const row = e.target.closest('[data-buy]');
        if (row) handler(row.dataset.buy);
      });
    },
    showOverlay(kind, score) {
      els.overlay.hidden = false;
      if (kind === 'start') {
        els.overlayTitle.innerHTML = 'EMBER<span class="e">LINE</span>';
        els.overlayCopy.textContent = 'Duskport Harbor, 19:40. Four Ember raiders against four Ash guards. Plant the charge at Crane Yard or the Fuel Depot — or wipe the other team out.';
        els.play.textContent = 'Click to play';
      } else if (kind === 'paused') {
        els.overlayTitle.textContent = 'Paused';
        els.overlayCopy.textContent = 'Click to jump back in. The harbor waits.';
        els.play.textContent = 'Resume';
      } else if (kind === 'end') {
        els.overlayTitle.textContent = 'Round over';
        els.overlayCopy.textContent = `Score: Ember ${score.ember} — ${score.ash} Ash. Next round starts shortly.`;
        els.play.textContent = 'Next round';
      }
    },
    hideOverlay() { els.overlay.hidden = true; },
    showBuy(round, money, owned, grenades, armour) {
      els.buy.hidden = false;
      els.buyRound.textContent = String(round);
      els.buyMoney.textContent = `$${money}`;
      const rows = [];
      for (const def of [WEAPONS.rifle, WEAPONS.smg]) {
        const has = owned.includes(def.id);
        rows.push(`<div class="buy-row${has ? ' owned' : ''}" data-buy="${def.id}">
          <span class="nm">${def.name}</span><span class="ds">${def.damage} dmg · ${def.mag} rnd mag · ${def.auto ? 'auto' : 'semi'}</span>
          <span class="pr">${has ? 'OWNED' : '$' + def.price}</span></div>`);
      }
      for (const def of [GRENADES.frag, GRENADES.smoke]) {
        const count = grenades[def.id] || 0;
        rows.push(`<div class="buy-row" data-buy="${def.id}">
          <span class="nm">${def.name}</span><span class="ds">carry ${count} · press G to throw</span>
          <span class="pr">$${def.price}</span></div>`);
      }
      rows.push(`<div class="buy-row${armour ? ' owned' : ''}" data-buy="armour">
        <span class="nm">KEVLAR VEST</span><span class="ds">absorbs half of damage taken</span>
        <span class="pr">${armour ? 'OWNED' : '$' + ARMOUR_PRICE}</span></div>`);
      els.buyList.innerHTML = rows.join('');
    },
    hideBuy() { els.buy.hidden = true; },
    setTimer(seconds, low) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      setText(els.timer, 'timer', text);
      els.timer.classList.toggle('low', !!low);
    },
    setScore(ember, ash) {
      const key = `${ember}-${ash}`;
      if (last.score === key) return;
      last.score = key;
      els.scoreEmber.textContent = String(ember);
      els.scoreAsh.textContent = String(ash);
    },
    setAlive(emberAlive, ashAlive) {
      const e = '●'.repeat(emberAlive) + '○'.repeat(Math.max(0, 4 - emberAlive));
      const a = '●'.repeat(ashAlive) + '○'.repeat(Math.max(0, 4 - ashAlive));
      setText(els.aliveEmber, 'aliveE', e);
      setText(els.aliveAsh, 'aliveA', a);
    },
    setBomb(text) { setText(els.bombState, 'bomb', text); },
    setHealth(hp) {
      setText(els.healthNum, 'hp', String(Math.max(0, Math.ceil(hp))));
      els.healthNum.classList.toggle('low', hp <= 30);
    },
    setMoney(money) { setText(els.money, 'money', `$${money}`); },
    setAmmo(mag, reserve, weaponName) {
      if (last.mag !== mag) { last.mag = mag; els.ammoMag.textContent = String(mag); }
      if (last.reserve !== reserve) { last.reserve = reserve; els.ammoReserve.textContent = `/ ${reserve}`; }
      if (last.weapon !== weaponName) { last.weapon = weaponName; els.weaponName.textContent = weaponName; }
      els.ammo.classList.toggle('empty', mag === 0);
    },
    setSpread(spread) {
      // Crosshair gap in px: 5 at rest, up to ~26 spraying on the move.
      const gap = 5 + Math.min(1, spread / 0.09) * 21;
      els.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    },
    hitMarker(kill, holdMs) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', !!kill);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on'), holdMs || 90);
    },
    killFeed(text, headshot) {
      feedItems.unshift({ text, headshot });
      feedItems = feedItems.slice(0, 5);
      els.feed.innerHTML = feedItems.map((f) => `<div class="k${f.headshot ? ' hs' : ''}">${f.text}</div>`).join('');
      setTimeout(() => {
        feedItems = feedItems.filter((f) => f.text !== text);
        els.feed.innerHTML = feedItems.map((f) => `<div class="k${f.headshot ? ' hs' : ''}">${f.text}</div>`).join('');
      }, 6000);
    },
    banner(title, sub, kind) {
      els.banner.hidden = false;
      els.banner.className = kind || '';
      els.banner.innerHTML = `<h2>${title}</h2><p>${sub}</p>`;
    },
    hideBanner() { els.banner.hidden = true; },
    setHint(text) { els.hint.textContent = text; },
    setBombPrompt(mode) {
      // mode: null | 'plant' | 'defuse' | 'planting' | 'defusing'
      if (!mode) { els.bombPrompt.hidden = true; els.plantBar.hidden = true; return; }
      els.bombPrompt.hidden = false;
      els.bombPrompt.innerHTML = mode === 'plant' ? 'HOLD <b>E</b> — PLANT THE CHARGE'
        : mode === 'defuse' ? 'HOLD <b>E</b> — DEFUSE THE CHARGE'
        : mode === 'planting' ? 'PLANTING…' : 'DEFUSING…';
      els.plantBar.hidden = mode === 'plant' || mode === 'defuse';
    },
    setPlantProgress(frac) {
      els.plantFill.style.width = `${Math.round(frac * 100)}%`;
    },
  };
}
