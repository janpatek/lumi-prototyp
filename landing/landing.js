// ===== Nastavení landing page – vše, co se bude měnit, je tady =====
// appName: název aplikace (Ospalek). Doplní se do všech prvků s atributem data-app-name a do titulku stránky.
// appStoreUrl / googlePlayUrl: odkazy do obchodů. Dokud jsou prázdné, tlačítka vedou na # a ukazují štítek „Již brzy“.
const LANDING = {
  appName: 'Ospalek',
  appStoreUrl: '',
  googlePlayUrl: '',
};

// Název aplikace
document.querySelectorAll('[data-app-name]').forEach((el) => { el.textContent = LANDING.appName; });
document.title = document.title.replace(/^[^–]+/, LANDING.appName + ' ');

// Tlačítka do obchodů
document.querySelectorAll('[data-store]').forEach((a) => {
  const url = LANDING[a.dataset.store + 'Url'];
  if (url) {
    a.href = url;
    a.classList.remove('is-soon');
    a.removeAttribute('aria-disabled');
  } else {
    a.addEventListener('click', (e) => e.preventDefault());
  }
});

// Audio ukázka – vlastní tlačítko a průběh nad <audio>
const audio = document.getElementById('sample-audio');
const playBtn = document.getElementById('sample-play');
const bar = document.getElementById('sample-bar');
const time = document.getElementById('sample-time');
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

if (audio && playBtn) {
  playBtn.addEventListener('click', () => (audio.paused ? audio.play() : audio.pause()));
  audio.addEventListener('play', () => { playBtn.classList.add('playing'); playBtn.setAttribute('aria-label', 'Pozastavit ukázku'); });
  audio.addEventListener('pause', () => { playBtn.classList.remove('playing'); playBtn.setAttribute('aria-label', 'Přehrát ukázku'); });
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    bar.style.width = (audio.currentTime / audio.duration) * 100 + '%';
    time.textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`;
  });
  audio.addEventListener('ended', () => { bar.style.width = '0%'; });
  document.getElementById('sample-track').addEventListener('click', (e) => {
    if (!audio.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });
}
