/* 爻 · 网页前端（由 tools/build_web.mjs 内联进单文件 HTML） */

const Y = globalThis.__YAO__;
const {
  BY_ID, BY_NAME, nameOf, ben, dong, zhi, cuo, zong, hu, bianShu, dangWei,
  toDigits, renderLines, lex, parse, buildIr, Machine,
  LEVELS, makeStepper, par, flippedLines,
  judge, loadCorpus, yaoTitle, POS_NAMES,
} = Y;

const $ = (id) => document.getElementById(id);
const id = (name) => BY_NAME.get(name).id;
const corpus = loadCorpus();

// ─────────────────────────────────────────── 机器

const ir = buildIr(parse(globalThis.__YAO_SRC__.yaoZhen));
const step = makeStepper(ir);
const machine = new Machine(ir);

// ─────────────────────────────────────────── 局势

const S = {
  level: 0,
  steps: 0,
  parNow: 0,
  levelStart: machine.state,
  over: false,
};

const targetBen = () => id(LEVELS[S.level].target);
const budget = () => S.parNow + 2;

function beginLevel() {
  S.steps = 0;
  S.levelStart = machine.state;
  S.parNow = par(step, ben(machine.state), targetBen()) ?? 99;
  S.over = false;
}

// ─────────────────────────────────────────── 渲染

function artFor(gua, movingMask, pos) {
  const yang = (gua >> (pos - 1)) & 1;
  const moving = (movingMask >> (pos - 1)) & 1;
  const spans = yang
    ? '<span class="full"></span>'
    : '<span class="half"></span><span class="gap"></span><span class="half"></span>';
  return spans;
}

function renderBoard() {
  const st = machine.state;
  const g = ben(st);
  const d = dong(st);
  const board = $('board');
  board.textContent = '';

  for (let p = 6; p >= 1; p--) {
    const yang = (g >> (p - 1)) & 1;
    const moving = (d >> (p - 1)) & 1;
    const row = document.createElement('button');
    row.className = 'yao-row' + (yang ? '' : ' yin') + (moving ? ' moving' : '');
    row.dataset.pos = p;
    row.innerHTML =
      `<span class="yao-label">${POS_NAMES[p]}</span>` +
      `<span class="yao-art">${artFor(g, d, p)}</span>`;
    row.addEventListener('click', () => press(p));
    board.appendChild(row);
  }
}

function renderHud() {
  const lv = LEVELS[S.level];
  const t = targetBen();
  $('level').innerHTML = `第 <b>${S.level + 1}</b> / ${LEVELS.length} 关 · ${lv.title}`;
  $('target').innerHTML = `目标 <b>${lv.target}</b>`;
  $('steps').textContent = `步数 ${S.steps} / ${budget()}`;
  $('par').textContent = `最优 ${S.parNow}`;
  $('steps').style.color = S.steps > S.parNow ? 'var(--accent)' : '';

  const cur = ben(machine.state);
  const md = BY_ID[cur];
  document.title = `爻 · ${md.name}`;
}

function render() {
  renderHud();
  renderBoard();
}

function msg(html, ok = false) {
  const el = $('msg');
  el.innerHTML = html;
  el.className = 'msg' + (ok ? ' ok' : '');
}

// ─────────────────────────────────────────── 操作

function press(n) {
  if (S.over) return;

  const r = machine.step('行', n);
  if (!r.ok) {
    msg('这一爻按不动。');
    return;
  }
  S.steps++;

  const cur = ben(machine.state);
  const t = targetBen();

  if (cur === t) {
    win();
    return;
  }
  if (S.steps > budget()) {
    machine.state = S.levelStart;
    S.steps = 0;
    render();
    msg('卦象散乱。步数用尽，本关重来。');
    return;
  }
  render();
  msg(`按第 ${n} 爻，翻转 ${flippedLines(n).map((p) => POS_NAMES[p]).join('、')}。`);
}

function win() {
  const lv = LEVELS[S.level];
  const text = corpus.entries[lv.target].c;
  const perfect = S.steps === S.parNow;
  render();

  if (S.level + 1 >= LEVELS.length) {
    S.over = true;
    msg(`<b>成。</b>「${text}」\n\n六关皆过。你走完了这一局。`, true);
    return;
  }

  S.over = true;
  msg(
    `<b>成。</b>「${text}」` +
      (perfect ? '　<span class="dim">最优解</span>' : '') +
      `\n\n<button id="next">下一关 →</button>`,
    true
  );
  $('next').addEventListener('click', () => {
    S.level++;
    beginLevel();
    render();
    msg(`第 ${S.level + 1} 关：走到 ${LEVELS[S.level].target}。${LEVELS[S.level].hint}`);
  });
}

/** 最短路径的第一步，用于提示 */
function nextHint() {
  const from = ben(machine.state);
  const to = targetBen();
  if (from === to) return null;

  const prev = new Map([[from, null]]);
  const q = [from];
  while (q.length) {
    const b = q.shift();
    if (b === to) break;
    for (let n = 1; n <= 6; n++) {
      const nx = step(b, n);
      if (nx === null || prev.has(nx)) continue;
      prev.set(nx, [b, n]);
      q.push(nx);
    }
  }
  if (!prev.has(to)) return null;

  let cur = to;
  let last = null;
  while (prev.get(cur)) {
    const [p, n] = prev.get(cur);
    last = n;
    cur = p;
  }
  return last;
}

// ─────────────────────────────────────────── 卦盘

/** 用真正的词法器解析字面量：卦名 / 爻串 / 卦象字符 / 名/掩码 */
function parseLiteral(text) {
  const toks = lex(text).filter((t) => t.type !== 'eof');
  if (toks.length !== 1) throw new Error('只支持单个卦字面量');
  if (toks[0].type !== 'bian') throw new Error('需要一个卦字面量');
  return toks[0].value;
}

function card(title, sub, lines, qi) {
  const art = lines.map((l) => l).join('\n');
  return (
    `<div class="card">` +
    `<h3>${title} <span class="dim">${sub}</span></h3>` +
    `<pre>${art}</pre>` +
    (qi ? `<p class="qi">${qi}</p>` : '') +
    `</div>`
  );
}

function lookup(text) {
  const out = $('lookup-out');
  const q = text.trim();
  if (!q) {
    out.innerHTML = '';
    return;
  }

  let v;
  try {
    v = parseLiteral(q);
  } catch (err) {
    out.innerHTML = `<div class="out err">看不懂「${esc(q)}」。试试：既济、987789、泰/初上。</div>`;
    return;
  }

  const g = ben(v);
  const d = dong(v);
  const md = BY_ID[g];

  const parts = [];
  const art = renderLines(v, { labels: true, ascii: false }).join('\n');
  parts.push(
    `<div class="card">` +
      `<h3>${md.name} <span class="dim">${md.glyph}　文王序 ${md.order}</span></h3>` +
      `<div class="meta">上${md.upper} 下${md.lower} · 当位 ${dangWei(g)}/6 · ` +
      `${d === 0 ? '静卦' : `${bianShu(v)} 爻动`} · [${toDigits(v)}]</div>` +
      `<pre>${art}</pre>` +
      `<p class="qi">${corpus.entries[md.name].c}</p>` +
      `</div>`
  );

  parts.push(
    `<div class="card">` +
      `<div class="meta">互 ${nameOf(hu(g))}　错 ${nameOf(cuo(g))}　综 ${nameOf(zong(g))}` +
      (d ? `　之 ${nameOf(zhi(v))}` : '') +
      `</div>` +
      `</div>`
  );

  if (d) {
    const j = judge(v, corpus);
    const rows = j.entries
      .map((e, i) => {
        const star = j.entries.length > 1 && i === j.main ? '（主）' : '';
        return `<div class="meta">${e.label ?? e.hexName}${star}</div><p class="qi">${e.text}</p>`;
      })
      .join('');
    parts.push(
      `<div class="card">` +
        `<h3>断 <span class="dim">${j.rule}</span></h3>` +
        rows +
        `</div>`
    );
  }

  out.innerHTML = parts.join('');
}

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ─────────────────────────────────────────── 绑定

function bindTabs() {
  const tabs = [...document.querySelectorAll('.tabs button')];
  for (const b of tabs) {
    b.addEventListener('click', () => {
      for (const o of tabs) o.classList.toggle('on', o === b);
      for (const id of ['game', 'lookup', 'about']) {
        $('tab-' + id).hidden = id !== b.dataset.tab;
      }
      if (b.dataset.tab === 'lookup') $('q').focus();
    });
  }
}

function bindKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if ($('tab-game').hidden) return;
    if (/^[1-6]$/.test(e.key)) {
      e.preventDefault();
      press(Number(e.key));
    }
  });
}

function bindButtons() {
  $('retry').addEventListener('click', () => {
    machine.state = S.levelStart;
    S.steps = 0;
    render();
    msg('本关重来。');
  });

  $('hint').addEventListener('click', () => {
    const n = nextHint();
    if (n === null) {
      msg('已经在这里了。');
      return;
    }
    const row = document.querySelector(`.yao-row[data-pos="${n}"]`);
    if (row) {
      row.style.background = '#2a3340';
      setTimeout(() => { row.style.background = ''; }, 900);
    }
    msg(`提示：先按第 ${n} 爻。`);
  });

  let timer = null;
  $('q').addEventListener('input', (e) => {
    clearTimeout(timer);
    const val = e.target.value;
    timer = setTimeout(() => lookup(val), 140);
  });
}

// ─────────────────────────────────────────── 启动

bindTabs();
bindKeys();
bindButtons();
beginLevel();
render();
msg(`第 1 关：走到 <b>${LEVELS[0].target}</b>。${LEVELS[0].hint}`);
