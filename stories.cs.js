// Pohádky – česká verze. Pro novou zemi zkopíruj soubor (např. stories.sk.js) a přelož.
//
// Každá pohádka je šablona: funkce text(c) dostane kontext rodiny a vrátí odstavce.
// Hrdinů může být víc (sourozenci) – texty proto počítají s jednotným i množným číslem.
//   c.H            hrdina/hrdinové v 1. pádě ("Toník" / "Toník a Eliška")
//   c.h.gen / dat / acc / voc / ins             další pády ("Toníkovi a Elišce")
//   c.g(m, f, mpl, fpl)  tvar podle rodu a čísla: kluk, holka, víc dětí (aspoň jeden kluk), víc holek
//                        fpl lze vynechat – u sloves se odvodí z mpl ("šli" → "šly")
//   c.n(jedno, víc)      tvar jen podle čísla ("má" / "mají", "tebe" / "vás")
//   c.sib, c.sg(m, f)    sourozenec, který v pohádce není hlavním hrdinou (nebo null)
//   c.p1, c.p2     rodiče: .full ("maminka Petra"), .nom/.gen/.dat/.acc/.ins ("maminka"), .g(m, f)
//   c.inTown       "v Benešově"                c.near  okolní obce   c.attr  atrakce v okolí
//   c.food, c.animal                           oblíbené jídlo a zvíře hrdinů
// cover.img = ilustrace náhledu (3:4), cover.imgF = verze s holčičkou (když jsou hrdinkami jen holky), emoji a barvy jsou záloha, než se obrázek načte.
// Odstavec: { t: text, sfx?: 'sparkle'|'magic'|'car'|'horn'|'birds'|'owl'|'paper'|'wind'|'ding', pause?: sekundy }

window.CATEGORIES = [
  { id: 'all', label: 'Vše' },
  { id: 'noc', label: '🌙 Na dobrou noc' },
  { id: 'auto', label: '🚗 Do auta' },
  { id: 'dobro', label: '🗺️ Dobrodružství' },
  { id: 'zivot', label: '🌱 Ze života' },
];

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const listCz = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' a ' + a[a.length - 1]);

window.STORIES = [
  {
    id: 'hvezdicka',
    free: true,
    cats: ['noc'],
    ages: [2, 7],
    mood: 'lullaby',
    cover: { img: 'covers/hvezdicka.jpg', imgF: 'covers/hvezdicka-f.jpg', emoji: '🌟', g1: '#1d2b64', g2: '#6a4c93' },
    title: (c) => `Hvězdička, která spadla k ${c.h.dat}`,
    text: (c) => [
      { t: `Bylo nebylo, ${c.inTown} stál jeden docela obyčejný dům. A v tom domě ${c.g('bydlel', 'bydlela', 'bydleli')} ${c.H}.` },
      { t: `Jednoho večera, když už měsíc svítil nad střechami, ${c.g('uslyšel', 'uslyšela', 'uslyšeli')} ${c.H} za oknem tiché cinknutí. Cink! Na parapetu ležela malinká zářící hvězdička.`, sfx: 'sparkle' },
      { t: `„Ahoj,“ pípla hvězdička. „Spadla jsem z nebe a nevím, jak se vrátit domů. ${c.n('Pomůžeš', 'Pomůžete')} mi, ${c.h.voc}?“` },
      { t: `${c.H} ani chvilku ${c.g('neváhal', 'neváhala', 'neváhali')}.${c.sib ? ` Potichu ${c.g('vzbudil', 'vzbudila', 'vzbudili')} i ${c.sib.acc}, protože ve více se hvězdičky zachraňují mnohem líp.` : ''} Hvězdičku ${c.g('vzal', 'vzala', 'vzali')} opatrně do dlaní. Hřála jako hrnek teplého kakaa.` },
      { t: `Vtom do pokoje ${c.p1.g('nakoukl', 'nakoukla')} ${c.p1.full}. „Copak to tady tak svítí?“ A když ${c.p1.g('uslyšel', 'uslyšela')}, co se stalo, ${c.p1.g('usmál', 'usmála')} se: „Hvězdy se vracejí domů jen tehdy, když jim někdo zazpívá tu nejtišší písničku na světě.“` },
      { t: `Tak ${c.H} ${c.g('začal', 'začala', 'začali')} broukat. Tiše, tichounce, jako když padá sníh. Hvězdička se zachvěla, zazářila a začala stoupat výš a výš – nad zahradu, nad střechy, až vysoko k mrakům.`, sfx: 'magic' },
      { t: c.near.length ? `Odtamtud bylo vidět celé okolí – ${listCz(c.near.slice(0, 3))}. Všechna ta místa už spala pod peřinou tmy.` : `Odtamtud bylo vidět celé okolí. Všechny vesnice a města už spaly pod peřinou tmy.` },
      { t: `Z nebe pak hvězdička zablikala na rozloučenou: jednou, dvakrát, třikrát. To znamená „děkuju“ ve hvězdné řeči.`, sfx: 'sparkle' },
      { t: `${c.H} ${c.g('zalezl', 'zalezla', 'zalezli')} pod peřinu. Víčka ${c.g('měl', 'měla', 'měli')} těžká a ${c.n('hlavu plnou', 'hlavy plné')} hvězdného prachu. A kdykoli se od té doby ${c.n('podívá', 'podívají')} na noční oblohu, jedna hvězdička svítí trochu víc než ostatní. Ta, která patří ${c.h.dat}. Dobrou noc, ${c.h.voc}.` },
    ],
  },
  {
    id: 'vyprava',
    free: true,
    cats: ['dobro'],
    ages: [4, 9],
    mood: 'adventure',
    cover: { img: 'covers/vyprava.jpg', imgF: 'covers/vyprava-f.jpg', emoji: '🗺️', g1: '#1b5e20', g2: '#9ccc65' },
    title: (c) => c.n(`${c.H} a velká výprava`, `Velká výprava ${c.h.gen}`),
    text: (c) => [
      { t: `V sobotu ráno to ${c.H} ${c.g('věděl', 'věděla', 'věděli')} hned, jak ${c.g('otevřel', 'otevřela', 'otevřeli')} oči: dnes se jede na výpravu! A cíl? ${c.attr[0] ? cap(c.attr[0]) : 'Starý hrad na kopci'}!`, sfx: 'birds' },
      { t: `${cap(c.p1.full)} ${c.p1.g('balil', 'balila')} svačinu. A protože to byl výjimečný den, ${c.p1.g('přibalil', 'přibalila')} i to, co ${c.n('má', 'mají')} ${c.H} ze všeho nejradši: ${c.food}.${c.p2 ? ` ${cap(c.p2.full)} mezitím ${c.p2.g('studoval', 'studovala')} mapu a ${c.p2.g('tvrdil', 'tvrdila')}, že zná zkratku. Nikdo ${c.p2.g('mu', 'jí')} to moc nevěřil.` : ''}` },
      { t: `${c.near.length ? `Cestou projeli kolem míst, která ${c.H} dobře ${c.n('zná', 'znají')} – ${listCz(c.near.slice(0, 3))}.` : 'Cestou projeli kolem polí, lesů a rybníků.'} ${c.H} ${c.g('počítal', 'počítala', 'počítali')} všechny krávy, které ${c.g('uviděl', 'uviděla', 'uviděli')}. Bylo jich sedmnáct a půl. Ta půlka byla schovaná za stodolou.`, sfx: 'car' },
      { t: `Když dorazili na místo, ${c.H} ${c.g('zůstal', 'zůstala', 'zůstali')} stát s ${c.n('otevřenou pusou', 'otevřenými pusami')}. Pod velkým kamenem u cesty totiž ležel zmuchlaný papírek. Byla na něm mapa, křížek a vzkaz: „Poklad najde jen to dítě, které je statečné a laskavé.“`, sfx: 'paper' },
      { t: `${c.n(`„To jsem přece já!“ ${c.g('zvolal', 'zvolala')} ${c.H}.${c.sib ? ` „A já taky!“ ${c.sg('přidal', 'přidala')} se ${c.sib.nom}.` : ''}`, `„To jsme přece my!“ ${c.g('', '', 'zvolali')} ${c.H} jednohlasně.`)} A tak se vydali po stopách z mapy – přes kořeny, kolem pařezu, který vypadal jako spící medvěd, až k malému dutému stromu.` },
      { t: `Uvnitř stromu seděla veverka a vypadala moc smutně. Ztratila všechny své zásoby oříšků na zimu. ${c.H} ${c.g('nezaváhal', 'nezaváhala', 'nezaváhali')} a ${c.g('pomohl', 'pomohla', 'pomohli')} jí hledat. Jeden oříšek byl v trávě, dva pod listím a jeden – kdo by to řekl – v kapse ${c.p1.gen}.` },
      { t: `Veverka byla tak šťastná, že ${c.h.dat} darovala to nejvzácnější, co měla: ${c.n('lesklý žalud, který prý přináší', 'lesklé žaludy, které prý přinášejí')} odvahu. „Tak to je ten poklad,“ ${c.p1.g('usmál', 'usmála')} se ${c.p1.nom}. „Poklad se nenajde. Poklad se udělá – dobrým skutkem.“`, sfx: 'magic' },
      { t: `Domů se vraceli, když slunce zapadalo. ${c.H} ${c.g('držel', 'držela', 'drželi')} v ${c.n('dlani žalud', 'dlaních žaludy')} a ${c.g('věděl', 'věděla', 'věděli')}, že tohle byla ta nejlepší výprava na světě.` },
    ],
  },
  {
    id: 'hadanky',
    free: true,
    cats: ['auto'],
    ages: [3, 8],
    mood: 'road',
    cover: { img: 'covers/hadanky.jpg', emoji: '🚗', g1: '#e65100', g2: '#ffb74d' },
    title: (c) => `Hádankové auto ${c.h.gen}`,
    text: (c) => [
      { t: `Pozor, pozor! Právě startuje to nejkouzelnější auto na světě – Hádankové auto! Řídí ho ${c.p1.full} a ${c.g('hlavním navigátorem je', 'hlavní navigátorkou je', 'hlavními navigátory jsou', 'hlavními navigátorkami jsou')} ${c.H}.`, sfx: 'car' },
      { t: `Hádankové auto jede jen tehdy, když posádka uhádne hádanku. Takže, ${c.h.voc}, ${c.n('jsi', 'jste')} ${c.g('připravený', 'připravená', 'připravení', 'připravené')}? První hádanka!` },
      { t: `Má to čtyři kola, volant, a právě v tom ${c.n('sedíš', 'sedíte')}. Co je to?`, pause: 6 },
      { t: `Auto, přece! Správně! Brrrm – a jedeme dál.`, sfx: 'ding' },
      { t: `Druhá hádanka: Je to žluté, je to zahnuté a opice to milujou.`, pause: 6 },
      { t: `Banán! Výborně. Hádankové auto zrychluje. A teď hádanka o ${c.n('tobě', 'vás')}: Co ${c.n('má', 'mají')} ${c.H} ze všeho nejradši k jídlu?`, sfx: 'ding', pause: 6 },
      { t: `${cap(c.food)}! No jasně. Hádankové auto ví všechno. Teď úkol pro celou posádku: kdo první uvidí za oknem něco červeného, zavolá „červená!“`, sfx: 'ding', pause: 10 },
      { t: `A poslední, nejtěžší hádanka: Kam asi jedeme? ${c.near[0] ? `Že by třeba ${c.near[0]}?` : 'Že by k babičce?'} Nebo úplně jinam? ${c.n('Zeptej', 'Zeptejte')} se ${c.p1.gen}!`, pause: 6 },
      { t: `Hádankové auto děkuje za jízdu. Posádka byla skvělá – ${c.g('hlavně navigátor', 'hlavně navigátorka', 'hlavně navigátoři', 'hlavně navigátorky')} ${c.H}. Píp píp!`, sfx: 'horn' },
    ],
  },
  {
    id: 'drak',
    free: false,
    cats: ['noc'],
    ages: [2, 6],
    mood: 'lullaby',
    cover: { img: 'covers/drak.jpg', emoji: '🐉', g1: '#004d40', g2: '#4db6ac' },
    title: () => `Drak, který se bál tmy`,
    text: (c) => [
      { t: `Daleko za lesem, nedaleko místa, kterému se říká ${c.near[0] || c.town || 'Zelený Dolík'}, žil v jeskyni malý drak Fousek.` },
      { t: `Fousek uměl foukat obláčky kouře ve tvaru srdíček a uměl létat pozpátku. Jen jedno neuměl: nebát se tmy. Každý večer se schoulil do klubíčka a třásl se jako želé.` },
      { t: `Jednou večer ${c.p1.g('šel', 'šla')} kolem jeskyně ${c.p1.full} a s ${c.p1.g('ním', 'ní')} ${c.H}.`, sfx: 'owl' },
      { t: `„Slyšíš to?“ ${c.g('zašeptal', 'zašeptala', 'zašeptali')} ${c.H}. Z jeskyně se ozývalo tiché vzlykání. ${c.H} se ${c.g('nebál', 'nebála', 'nebáli')} a ${c.g('nakoukl', 'nakoukla', 'nakoukli')} dovnitř. „Ahoj, draku. Proč pláčeš?“` },
      { t: `„Bojím se tmy,“ fňukal Fousek. „Ve tmě je všechno strašidelné.“` },
      { t: `${c.H} se ${c.g('posadil', 'posadila', 'posadili')} vedle něj. „Víš, co ${c.n('dělám já', 'děláme my')}, když se ${c.n('bojím', 'bojíme')}? ${c.n('Zavřu', 'Zavřeme')} oči a ${c.n('myslím', 'myslíme')} na to nejlepší jídlo na světě – ${c.food}. A pak si ${c.n('vzpomenu', 'vzpomeneme')}, že tma je jenom den, který zhasnul světlo, aby se mohl vyspat.“` },
      { t: `„A tma umí i krásné věci,“ ${c.p1.g('dodal', 'dodala')} ${c.p1.nom}. „Bez tmy bychom neviděli hvězdy. A podívejte – světlušky!“ Kolem jeskyně se rozsvítily stovky malých zelených světýlek.`, sfx: 'sparkle' },
      { t: `Fousek přestal plakat. Opatrně vyfoukl obláček a ten se v měsíčním světle zatřpytil jako stříbro. „Tma je vlastně docela hezká,“ zívl.` },
      { t: `Od té doby Fousek spí každou noc klidně. A když se mu přece jen zasteskne, vzpomene si na ${c.h.acc}, ${c.g('nejstatečnějšího kamaráda', 'nejstatečnější kamarádku', 'nejstatečnější kamarády', 'nejstatečnější kamarádky')} na světě. Dobrou noc, Fousku. Dobrou noc, ${c.h.voc}.` },
    ],
  },
  {
    id: 'lednice',
    free: false,
    cats: ['dobro'],
    ages: [3, 8],
    mood: 'adventure',
    cover: { img: 'covers/lednice.jpg', emoji: '🧀', g1: '#f9a825', g2: '#fff176' },
    title: (c) => c.n(`${c.H} a kouzelná lednice`, `Kouzelná lednice ${c.h.gen}`),
    text: (c) => [
      { t: `U vás doma, ${c.inTown}, stojí v kuchyni lednice. Vypadá úplně obyčejně. Ale jen do té doby, než ji o půlnoci ${c.n('otevře', 'otevřou')} ${c.H}.` },
      { t: `Jedné noci ${c.g('dostal', 'dostala', 'dostali')} ${c.H} hlad. ${c.g('Připlížil', 'Připlížila', 'Připlížili')} se do kuchyně, ${c.g('otevřel', 'otevřela', 'otevřeli')} lednici – a uvnitř nesvítilo světýlko, ale celé malé město!`, sfx: 'magic' },
      { t: `Po poličkách jezdily tramvaje z okurek, na mostě z mrkve stál strážník z jogurtu a všude to vonělo jako to nejlepší jídlo na světě: ${c.food}.` },
      { t: `„Konečně ${c.n('jsi', 'jste')} tady!“ ozvalo se z horní poličky. Stála tam malinká postavička v kuchařské čepici – Kuchtík, strážce lednice. Na zástěře měl obrázek a víš, co na něm bylo? ${cap(c.animal)}! ${c.n(`Přesně to zvíře, které má ${c.H} nejradši.`, `Přesně to, co mají ${c.H} nejradši.`)}` },
      { t: `„Máme problém,“ vysvětlil Kuchtík. „Někdo ukradl ze sýra všechny díry! Bez děr je to jen obyčejná kostka. ${c.n('Pomůžeš', 'Pomůžete')} nám zloděje najít?“` },
      { t: `${c.H} se ${c.g('vydal', 'vydala', 'vydali')} pátrat. Za máslem nic. Za kečupem nic. Ale za sklenicí s marmeládou ${c.g('uslyšel', 'uslyšela', 'uslyšeli')} podezřelé chroupání.` },
      { t: `Byla to myška Bára! V tlapkách držela díry ze sýra a omlouvala se: „Já jen… chtěla jsem si z nich udělat okna do domečku.“` },
      { t: `${c.H} ${c.g('dostal', 'dostala', 'dostali')} nápad. „Co kdybys díry vrátila – a okna ti uděláme z koleček okurky?“ Myška radostí zatleskala.`, sfx: 'ding' },
      { t: `Sýr měl zase díry, myška měla okna a Kuchtík ${c.h.dat} na poděkování připravil malou porci jídla, které ${c.n('má', 'mají')} nejradši: ${c.food}.` },
      { t: `Ráno ${c.p1.nom} ${c.p1.g('otevřel', 'otevřela')} lednici a ${c.p1.g('divil', 'divila')} se, proč v sýru chybí jeden malý kousek. ${c.H} se jen ${c.g('usmíval', 'usmívala', 'usmívali')}. Některá tajemství je lepší nechat v lednici.` },
    ],
  },
  {
    id: 'zubar',
    free: false,
    cats: ['zivot'],
    ages: [3, 7],
    mood: 'lullaby',
    cover: { img: 'covers/zubar.jpg', imgF: 'covers/zubar-f.jpg', emoji: '🦷', g1: '#ad1457', g2: '#f48fb1' },
    title: (c) => `${c.H} ${c.n('jde', 'jdou')} statečně k zubaři`,
    text: (c) => [
      { t: `Dnes ${c.n('půjde', 'půjdou')} ${c.H} k zubaři. A víš co? Bude to docela dobrodružný den.` },
      { t: `Ráno si ${c.H} ${c.g('vyčistil', 'vyčistila', 'vyčistili')} zuby tak pečlivě, že se zrcadlo v koupelně skoro rozzářilo. Šup nahoru, šup dolů, kolečka dokola.`, sfx: 'sparkle' },
      { t: `V čekárně to vonělo trochu jako mátové bonbony. ${cap(c.p1.full)} ${c.p1.g('vzal', 'vzala')} ${c.h.acc} za ruku a ${c.p1.g('řekl', 'řekla')}: „Jsem tady s ${c.n('tebou', 'vámi')}. Celou dobu.“` },
      { t: `„${c.H}?“ ozvala se sestřička s úsměvem. „${c.n('Pojď', 'Pojďte')} dál, už na ${c.n('tebe', 'vás')} čekáme.“`, sfx: 'ding' },
      { t: `Zubní křeslo bylo jako vesmírná loď. Zvedalo se nahoru – bzzz – a ${c.H} ${c.g('byl', 'byla', 'byli')} najednou ${c.g('kapitánem', 'kapitánkou', 'kapitány', 'kapitánkami')} celé lodi.`, sfx: 'magic' },
      { t: `Paní doktorka vzala malé zrcátko a začala počítat zuby: „Jeden, dva, tři… dvacet! To je ale krásná sbírka.“ Trochu to lechtalo, ale vůbec to nebolelo.` },
      { t: `„${c.n('Otevři', 'Otevřete')} pusu jako krokodýl,“ řekla doktorka. „A teď jako hroch!“ ${c.H} ${c.g('otevřel', 'otevřela', 'otevřeli')} ${c.n('pusu tak velkou', 'pusy tak velké')}, že se doktorka musela zasmát.` },
      { t: `„Hotovo! Zoubky jsou zdravé jako jablíčka.“ A protože ${c.H} ${c.g('byl', 'byla', 'byli')} tak ${c.g('statečný', 'statečná', 'stateční', 'statečné')}, ${c.g('dostal', 'dostala', 'dostali')} ${c.g('samolepku', 'samolepku', 'každý samolepku', 'každá samolepku')} se lvem.` },
      { t: `Cestou domů ${c.p1.g('řekl', 'řekla')} ${c.p1.nom}: „Jsem na ${c.n('tebe', 'vás')} moc ${c.p1.g('pyšný', 'pyšná')}, ${c.h.voc}.“ A ${c.H} ${c.g('věděl', 'věděla', 'věděli')}, že příště už se ${c.n('nebude', 'nebudou')} bát vůbec.` },
    ],
  },
];
