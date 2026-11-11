# Nové pohádky – postup

1. Koncepty se píšou do `koncepty/pohadky/<písmeno>.js` (`window.STORIES_DRAFT`) podle `ZADANI.md` – formát, délky, pravidla pro levný hlas a tón.
2. `node tools/pohadky/over.mjs` vyrenderuje každou pohádku pro testovací rodiny (kluk, holka, dvě děti, dvě holky, bez okolí) a hlídá chyby, délku (5/10/15 min stejným vzorcem jako aplikace) a podíl osobních vět. `--text <id>` vypíše celý text.
3. `node tools/pohadky/nahled.mjs` sestaví `koncepty/pohadky/nahled.html` – stránku ke schválení (publikovaná jako Artifact „Nové pohádky Ospalka“). Hodnocení Schválit / Upravit / Vyřadit a poznámky se ukládají do její databáze (kolekce `hodnoceni`).
4. Schválené pohádky se přesunou do `app/stories.cs.js` (`node tools/pohadky/prenest.mjs a b …`) (bez polí `delka`, `pro`, `pozn`), dostanou obálku ve `covers/`, namluví se společné věty (`tools/hlas/README.md`) a zvuk do pozadí.
