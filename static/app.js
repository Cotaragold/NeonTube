'use strict';

const $ = (sel) => document.querySelector(sel);

let currentInfo = null;
let currentMode = 'full';

// ------------------------------------------------------------- helpers ---

function fmtDuration(sec) {
  if (sec == null) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h ? String(m).padStart(2, '0') : m;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function fmtViews(n) {
  if (n == null) return '';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' млн просмотров';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + ' тыс. просмотров';
  return n + ' просмотров';
}

function fmtSpeed(bps) {
  if (!bps) return '';
  if (bps >= 1048576) return (bps / 1048576).toFixed(1) + ' МБ/с';
  return (bps / 1024).toFixed(0) + ' КБ/с';
}

const STATUS_RU = {
  queued: 'В ОЧЕРЕДИ',
  downloading: 'ЗАГРУЗКА',
  processing: 'ОБРАБОТКА',
  done: 'ГОТОВО',
  error: 'ОШИБКА',
  cancelled: 'ОТМЕНЕНО',
};

const MODE_RU = { full: '🎬 видео+звук', video: '📹 видео', audio: '🎵 звук' };

// -------------------------------------------------------------- анализ ---

async function analyze() {
  const url = $('#url-input').value.trim();
  const errBox = $('#url-error');
  errBox.classList.add('hidden');
  if (!url) return;

  const btn = $('#analyze-btn');
  btn.disabled = true;
  btn.textContent = 'СКАН…';
  $('#preview').classList.add('hidden');

  try {
    const r = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Ошибка запроса');
    currentInfo = data;
    renderPreview(data);
  } catch (e) {
    errBox.textContent = '⚠ ' + e.message;
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'АНАЛИЗ';
  }
}

function renderPreview(info) {
  $('#thumb').src = info.thumbnail || '';
  $('#duration').textContent = fmtDuration(info.duration);
  $('#title').textContent = info.title || '(без названия)';
  $('#channel').textContent = info.uploader || '';
  $('#views').textContent = fmtViews(info.view_count);

  const sel = $('#quality-select');
  sel.innerHTML = '';
  const best = document.createElement('option');
  best.value = 'best';
  best.textContent = 'Максимальное';
  sel.appendChild(best);
  for (const h of info.heights || []) {
    const o = document.createElement('option');
    o.value = h;
    o.textContent = h + 'p' + (h >= 2160 ? ' (4K)' : h >= 1440 ? ' (2K)' : '');
    sel.appendChild(o);
  }

  $('#preview').classList.remove('hidden');
}

// ------------------------------------------------------------ скачать ---

async function enqueue() {
  if (!currentInfo) return;
  const btn = $('#download-btn');
  btn.disabled = true;
  try {
    const r = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: currentInfo.url,
        title: currentInfo.title,
        thumbnail: currentInfo.thumbnail,
        mode: currentMode,
        quality: currentMode === 'audio' ? 'best' : $('#quality-select').value,
      }),
    });
    if (!r.ok) {
      const data = await r.json();
      throw new Error(data.error || 'Ошибка');
    }
    await pollQueue();
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
  }
}

// ------------------------------------------------------------- очередь ---

async function pollQueue() {
  try {
    const r = await fetch('/api/queue');
    const items = await r.json();
    renderQueue(items);
  } catch { /* сервер мог перезапускаться — молча пропускаем тик */ }
}

function renderQueue(items) {
  const list = $('#queue-list');
  $('#queue-empty').style.display = items.length ? 'none' : 'block';

  const seen = new Set();
  for (const j of items) {
    seen.add('job-' + j.id);
    let el = document.getElementById('job-' + j.id);
    if (!el) {
      el = document.createElement('div');
      el.id = 'job-' + j.id;
      el.className = 'job';
      el.innerHTML = `
        ${j.thumbnail
          ? `<img src="${j.thumbnail}" alt="">`
          : `<div class="no-thumb">▶</div>`}
        <div>
          <div class="job-title"></div>
          <div class="job-sub"></div>
          <div class="bar"><div class="bar-fill"></div></div>
          <div class="job-error-text hidden"></div>
        </div>
        <div class="job-actions">
          <span class="status-tag"></span>
          <button class="cancel-btn hidden">отмена</button>
          <a class="file-link hidden" target="_blank">открыть файл ⬈</a>
        </div>`;
      el.querySelector('.job-title').textContent = j.title;
      el.querySelector('.cancel-btn').addEventListener('click', () => cancelJob(j.id));
      list.appendChild(el);
    }

    el.className = 'job ' + j.status;
    el.querySelector('.status-tag').textContent = STATUS_RU[j.status] || j.status;
    el.querySelector('.status-tag').className = 'status-tag st-' + j.status;
    el.querySelector('.bar-fill').style.width = (j.progress || 0) + '%';

    const parts = [MODE_RU[j.mode] || j.mode];
    if (j.mode !== 'audio') parts.push(j.quality === 'best' ? 'макс.' : j.quality + 'p');
    if (j.status === 'downloading') {
      parts.push(Math.floor(j.progress) + '%');
      const sp = fmtSpeed(j.speed);
      if (sp) parts.push(sp);
      if (j.eta != null) parts.push('осталось ' + fmtDuration(j.eta));
    }
    el.querySelector('.job-sub').textContent = parts.join('  ·  ');

    const errBox = el.querySelector('.job-error-text');
    errBox.classList.toggle('hidden', j.status !== 'error');
    if (j.error) errBox.textContent = j.error;

    el.querySelector('.cancel-btn').classList.toggle(
      'hidden', !['queued', 'downloading', 'processing'].includes(j.status));

    const link = el.querySelector('.file-link');
    if (j.status === 'done' && j.filename) {
      link.href = '/downloads/' + encodeURIComponent(j.filename);
      link.classList.remove('hidden');
    } else {
      link.classList.add('hidden');
    }
  }

  // убираем карточки задач, которых больше нет (после «очистить»)
  for (const el of [...list.querySelectorAll('.job')]) {
    if (!seen.has(el.id)) el.remove();
  }
}

async function cancelJob(id) {
  await fetch('/api/cancel/' + id, { method: 'POST' });
  pollQueue();
}

// ---------------------------------------------------------------- init ---

async function loadSettings() {
  try {
    const r = await fetch('/api/settings');
    const s = await r.json();
    $('#proxy-input').value = s.proxy || '';
  } catch { /* не критично */ }
}

$('#proxy-save').addEventListener('click', async () => {
  const btn = $('#proxy-save');
  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proxy: $('#proxy-input').value }),
  });
  btn.textContent = '✓';
  setTimeout(() => { btn.textContent = 'OK'; }, 1200);
});

$('#analyze-btn').addEventListener('click', analyze);
$('#url-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') analyze(); });
$('#download-btn').addEventListener('click', enqueue);
$('#clear-btn').addEventListener('click', async () => {
  await fetch('/api/clear', { method: 'POST' });
  pollQueue();
});

$('#mode-btns').addEventListener('click', (e) => {
  const btn = e.target.closest('.mode-btn');
  if (!btn) return;
  currentMode = btn.dataset.mode;
  for (const b of document.querySelectorAll('.mode-btn')) {
    b.classList.toggle('active', b === btn);
  }
  $('#quality-group').style.visibility = currentMode === 'audio' ? 'hidden' : 'visible';
});

setInterval(pollQueue, 800);
pollQueue();
loadSettings();
