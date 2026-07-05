'use strict';

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------- i18n ---

const STR = {
  en: {
    urlPlaceholder: 'Paste a YouTube video link…',
    analyze: 'ANALYZE',
    analyzing: 'SCAN…',
    netSettings: '⚙ network settings (proxy)',
    proxyPlaceholder: 'socks5://127.0.0.1:1080 or http://127.0.0.1:8080 — empty = direct',
    proxyHint: 'If YouTube is blocked by your ISP, point this at your VPN client\'s local proxy. Saved to <code>config.json</code>.',
    modeLabel: 'MODE',
    qualityLabel: 'QUALITY',
    modeFull: '🎬 Video + audio',
    modeVideo: '📹 Video only',
    modeAudio: '🎵 Audio only',
    download: '⬇ DOWNLOAD',
    queueTitle: 'DOWNLOAD QUEUE',
    clearDone: 'clear finished',
    empty: '— empty —',
    footer: 'files are saved to the <code>downloads/</code> folder next to the app',
    cancel: 'cancel',
    openFile: 'open file ⬈',
    left: 'left',
    bestQuality: 'Best available',
    noTitle: '(untitled)',
    requestFailed: 'Request failed',
    statuses: { queued: 'QUEUED', downloading: 'DOWNLOADING', processing: 'PROCESSING',
                done: 'DONE', error: 'ERROR', cancelled: 'CANCELLED' },
    modesShort: { full: '🎬 video+audio', video: '📹 video', audio: '🎵 audio' },
    fmtViews(n) {
      if (n == null) return '';
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M views';
      if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K views';
      return n + ' views';
    },
    fmtSpeed(bps) {
      if (!bps) return '';
      if (bps >= 1048576) return (bps / 1048576).toFixed(1) + ' MB/s';
      return (bps / 1024).toFixed(0) + ' KB/s';
    },
    maxShort: 'best',
  },
  ru: {
    urlPlaceholder: 'Вставь ссылку на YouTube видео…',
    analyze: 'АНАЛИЗ',
    analyzing: 'СКАН…',
    netSettings: '⚙ настройки сети (прокси)',
    proxyPlaceholder: 'socks5://127.0.0.1:1080 или http://127.0.0.1:8080 — пусто = напрямую',
    proxyHint: 'Если YouTube заблокирован провайдером — укажи локальный прокси своего VPN. Сохраняется в <code>config.json</code>.',
    modeLabel: 'РЕЖИМ',
    qualityLabel: 'КАЧЕСТВО',
    modeFull: '🎬 Видео + звук',
    modeVideo: '📹 Только видео',
    modeAudio: '🎵 Только звук',
    download: '⬇ СКАЧАТЬ',
    queueTitle: 'ОЧЕРЕДЬ ЗАГРУЗОК',
    clearDone: 'очистить завершённые',
    empty: '— пусто —',
    footer: 'файлы сохраняются в папку <code>downloads/</code> рядом с приложением',
    cancel: 'отмена',
    openFile: 'открыть файл ⬈',
    left: 'осталось',
    bestQuality: 'Максимальное',
    noTitle: '(без названия)',
    requestFailed: 'Ошибка запроса',
    statuses: { queued: 'В ОЧЕРЕДИ', downloading: 'ЗАГРУЗКА', processing: 'ОБРАБОТКА',
                done: 'ГОТОВО', error: 'ОШИБКА', cancelled: 'ОТМЕНЕНО' },
    modesShort: { full: '🎬 видео+звук', video: '📹 видео', audio: '🎵 звук' },
    fmtViews(n) {
      if (n == null) return '';
      if (n >= 1e6) return (n / 1e6).toFixed(1) + ' млн просмотров';
      if (n >= 1e3) return (n / 1e3).toFixed(0) + ' тыс. просмотров';
      return n + ' просмотров';
    },
    fmtSpeed(bps) {
      if (!bps) return '';
      if (bps >= 1048576) return (bps / 1048576).toFixed(1) + ' МБ/с';
      return (bps / 1024).toFixed(0) + ' КБ/с';
    },
    maxShort: 'макс.',
  },
};

let lang = localStorage.getItem('neontube-lang') || 'en';
const T = () => STR[lang];

function applyLang() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = T()[el.dataset.i18n];
  }
  for (const el of document.querySelectorAll('[data-i18n-html]')) {
    el.innerHTML = T()[el.dataset.i18nHtml];
  }
  for (const el of document.querySelectorAll('[data-i18n-ph]')) {
    el.placeholder = T()[el.dataset.i18nPh];
  }
  for (const b of document.querySelectorAll('#lang-toggle button')) {
    b.classList.toggle('active', b.dataset.lang === lang);
  }
  // re-render dynamic parts
  if (currentInfo) renderPreview(currentInfo);
  pollQueue();
}

$('#lang-toggle').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-lang]');
  if (!b || b.dataset.lang === lang) return;
  lang = b.dataset.lang;
  localStorage.setItem('neontube-lang', lang);
  applyLang();
});

// ------------------------------------------------------------- helpers ---

let currentInfo = null;
let currentMode = 'full';

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

// ------------------------------------------------------------- analyze ---

async function analyze() {
  const url = $('#url-input').value.trim();
  const errBox = $('#url-error');
  errBox.classList.add('hidden');
  if (!url) return;

  const btn = $('#analyze-btn');
  btn.disabled = true;
  btn.textContent = T().analyzing;
  $('#preview').classList.add('hidden');

  try {
    const r = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || T().requestFailed);
    currentInfo = data;
    renderPreview(data);
  } catch (e) {
    errBox.textContent = '⚠ ' + e.message;
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = T().analyze;
  }
}

function renderPreview(info) {
  $('#thumb').src = info.thumbnail || '';
  $('#duration').textContent = fmtDuration(info.duration);
  $('#title').textContent = info.title || T().noTitle;
  $('#channel').textContent = info.uploader || '';
  $('#views').textContent = T().fmtViews(info.view_count);

  const sel = $('#quality-select');
  const prev = sel.value;
  sel.innerHTML = '';
  const best = document.createElement('option');
  best.value = 'best';
  best.textContent = T().bestQuality;
  sel.appendChild(best);
  for (const h of info.heights || []) {
    const o = document.createElement('option');
    o.value = h;
    o.textContent = h + 'p' + (h >= 2160 ? ' (4K)' : h >= 1440 ? ' (2K)' : '');
    sel.appendChild(o);
  }
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;

  $('#preview').classList.remove('hidden');
}

// ------------------------------------------------------------ download ---

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
      throw new Error(data.error || T().requestFailed);
    }
    await pollQueue();
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
  }
}

// --------------------------------------------------------------- queue ---

async function pollQueue() {
  try {
    const r = await fetch('/api/queue');
    const items = await r.json();
    renderQueue(items);
  } catch { /* server may be restarting — skip this tick */ }
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
          <button class="cancel-btn hidden"></button>
          <a class="file-link hidden" target="_blank"></a>
        </div>`;
      el.querySelector('.job-title').textContent = j.title;
      el.querySelector('.cancel-btn').addEventListener('click', () => cancelJob(j.id));
      list.appendChild(el);
    }

    el.className = 'job ' + j.status;
    el.querySelector('.status-tag').textContent = T().statuses[j.status] || j.status;
    el.querySelector('.status-tag').className = 'status-tag st-' + j.status;
    el.querySelector('.bar-fill').style.width = (j.progress || 0) + '%';
    el.querySelector('.cancel-btn').textContent = T().cancel;

    const parts = [T().modesShort[j.mode] || j.mode];
    if (j.mode !== 'audio') parts.push(j.quality === 'best' ? T().maxShort : j.quality + 'p');
    if (j.status === 'downloading') {
      parts.push(Math.floor(j.progress) + '%');
      const sp = T().fmtSpeed(j.speed);
      if (sp) parts.push(sp);
      if (j.eta != null) parts.push(T().left + ' ' + fmtDuration(j.eta));
    }
    el.querySelector('.job-sub').textContent = parts.join('  ·  ');

    const errBox = el.querySelector('.job-error-text');
    errBox.classList.toggle('hidden', j.status !== 'error');
    if (j.error) errBox.textContent = j.error;

    el.querySelector('.cancel-btn').classList.toggle(
      'hidden', !['queued', 'downloading', 'processing'].includes(j.status));

    const link = el.querySelector('.file-link');
    link.textContent = T().openFile;
    if (j.status === 'done' && j.filename) {
      link.href = '/downloads/' + encodeURIComponent(j.filename);
      link.classList.remove('hidden');
    } else {
      link.classList.add('hidden');
    }
  }

  // drop cards for jobs that no longer exist (after "clear finished")
  for (const el of [...list.querySelectorAll('.job')]) {
    if (!seen.has(el.id)) el.remove();
  }
}

async function cancelJob(id) {
  await fetch('/api/cancel/' + id, { method: 'POST' });
  pollQueue();
}

// ------------------------------------------------------------ settings ---

async function loadSettings() {
  try {
    const r = await fetch('/api/settings');
    const s = await r.json();
    $('#proxy-input').value = s.proxy || '';
  } catch { /* non-critical */ }
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

// ---------------------------------------------------------------- init ---

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

applyLang();
setInterval(pollQueue, 800);
pollQueue();
loadSettings();
