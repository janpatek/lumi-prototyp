// Skládaný hlas: pohádka se čte po větách a každá věta je samostatná nahrávka.
// Věty bez jmen a míst (jen s tvary podle rodu a čísla) se namluví jednou pro všechny rodiny,
// pro rodinu se dogenerují jen věty s jejími údaji. Stejná věta = stejný klíč = stejná nahrávka,
// takže i „Dobrou noc, Toníku.“ se zaplatí jen jednou pro všechny Toníky.
// Soubor běží v prohlížeči i v Node (tools/hlas), proto bez závislostí.

(function (root) {
  // Odstavec → věty. Uvnitř přímé řeči („…“) se nedělí, aby postava nezměnila hlas uprostřed repliky.
  // Za větou s malým písmenem pokračuje uvozovací věta („Ahoj,“ pípla hvězdička.), ta se taky nedělí.
  function splitLines(t) {
    const out = [];
    let cur = '';
    let q = 0;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      cur += ch;
      if (ch === '„') q++;
      if (ch === '“') q = Math.max(0, q - 1);
      const end = /[.!?…]/.test(ch) || (ch === '“' && /[.!?…]/.test(t[i - 1]));
      if (!end || q > 0 || (i + 1 < t.length && t[i + 1] !== ' ')) continue;
      if (/[a-záčďéěíňóřšťúůýž]/.test(t[i + 2] || '')) continue;
      out.push(norm(cur));
      cur = '';
    }
    if (norm(cur)) out.push(norm(cur));
    return out;
  }
  const norm = (s) => s.replace(/\s+/g, ' ').trim();

  // krátký stabilní otisk textu (2× FNV-1a 32 bit) – název souboru s nahrávkou
  function lineKey(text) {
    const s = norm(text);
    let a = 0x811c9dc5, b = 0x01000193 ^ s.length;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
      b ^= b >>> 13;
    }
    return a.toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  }

  // Pohádka pro konkrétní rodinu → odstavce s větami a klíči
  function planStory(segs) {
    return segs.map((s, i) => ({ i, sfx: s.sfx, pause: s.pause, lines: splitLines(s.t).map((t) => ({ t, key: lineKey(t) })) }));
  }

  const api = { splitLines, lineKey, planStory };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VOICE_LINES = api;
})(typeof window !== 'undefined' ? window : globalThis);
