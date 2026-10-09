// Timeline: open in the side column on wide screens, collapsed on narrow ones.
(function () {
  var timeline = document.querySelector('details.timeline');
  if (!timeline || !window.matchMedia) return;
  var narrow = window.matchMedia('(max-width: 64rem)');
  function sync() { timeline.open = !narrow.matches; }
  sync();
  if (narrow.addEventListener) narrow.addEventListener('change', sync);
  else if (narrow.addListener) narrow.addListener(sync);
})();

// Catalog search: filters entries as you type. Umlauts and their spelled-out
// forms are treated alike, so "Goethe" also finds "Göthe" and vice versa;
// "straße" matches the catalog's abbreviation "str.".
(function () {
  function normalize(s) {
    return s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/ß/g, 'ss').replace(/strasse/g, 'str')
      .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')
      .replace(/\s+/g, ' ');
  }

  function run() {
    var box = document.querySelector('.search');
    var input = document.getElementById('suche');
    if (!box || !input) return;

    var hits = document.getElementById('treffer');
    var empty = document.getElementById('keine-treffer');
    var list = document.querySelector('.catalog-list');
    var entries = Array.prototype.slice.call(document.querySelectorAll('.entry'));
    var groups = Array.prototype.slice.call(document.querySelectorAll('.letter-group'));
    var texts = null;

    function update() {
      var q = normalize(input.value.trim());
      if (!texts) texts = entries.map(function (el) { return normalize(el.textContent); });

      var count = 0;
      entries.forEach(function (el, i) {
        var match = !q || texts[i].indexOf(q) !== -1;
        el.hidden = !match;
        if (match) count++;
      });

      groups.forEach(function (group) {
        var visible = !!group.querySelector('.entry:not([hidden])');
        group.hidden = !visible;
        var link = document.querySelector('.az a[href="#' + group.id + '"]');
        if (link) link.classList.toggle('is-empty', !visible);
      });

      hits.textContent = count + (q ? ' Treffer' : ' Einträge');
      empty.hidden = count > 0;
    }

    box.hidden = false;
    input.addEventListener('input', function () {
      update();
      if (list.getBoundingClientRect().top < 0) list.scrollIntoView();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && input.value) {
        input.value = '';
        update();
      }
    });
    update();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();

// Enhance person entries: add German Wikipedia links only if an exact page exists.
// Handles names formatted as "Last, First" by converting to "First Last".
// Leaves existing links untouched and works in batches to avoid excessive requests.
(function () {
  function textContent(el) {
    return (el.textContent || el.innerText || '').replace(/\s+/g, ' ').trim();
  }

  function cleanPart(s) {
    // remove parentheses and surrounding spaces, common quotes
    return s.replace(/\(.*?\)/g, '').replace(/["'‘’“”]/g, '').replace(/\s+/g, ' ').trim();
  }

  function lastFirstToFirstLast(raw) {
    // Expecting "Last, First Middle" or single-name (skip single-name)
    if (!raw) return '';
    var parts = raw.split(',');
    if (parts.length >= 2) {
      var last = cleanPart(parts[0]);
      var first = cleanPart(parts.slice(1).join(',')).replace(/^und\s+/, '');
      if (!first || !last) return '';
      return (first + ' ' + last).replace(/\s+/g, ' ').trim();
    }
    // If already "First Last" or mononym, return as-is (but mononym will be skipped later)
    return cleanPart(raw);
  }

  function titleToHref(title) {
    return 'https://de.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/\s/g, '_'));
  }

  function unique(arr) {
    var seen = Object.create(null), out = [];
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (!v) continue;
      if (!seen[v]) { seen[v] = true; out.push(v); }
    }
    return out;
  }

  function chunk(arr, size) {
    var res = [];
    for (var i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
    return res;
  }

  function addLinks(mapping, existing) {
    // mapping: el -> title; existing: Set of confirmed titles
    Object.keys(mapping).forEach(function (key) {
      var data = mapping[key];
      var el = data.el;
      var title = data.title;
      if (!title || !existing.has(title)) return;
      // Skip if already linked
      if (el.querySelector('a')) return;
      var a = document.createElement('a');
      a.href = titleToHref(title);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = textContent(el) || title;
      // replace content
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(a);
    });
  }

  function run() {
    var nameEls = Array.prototype.slice.call(document.querySelectorAll('.entry-name'));
    if (!nameEls.length) return;

    // Collect candidates
    var candidates = [];
    var map = {}; // id -> { el, title }
    var idCounter = 0;

    nameEls.forEach(function (el) {
      // Preserve any pre-existing link
      if (el.querySelector('a')) return;
      var raw = textContent(el);
      if (!raw) return;

      var title = lastFirstToFirstLast(raw);
      // Skip mononyms (too ambiguous)
      if (!title || title.indexOf(' ') < 0) return;
      // Some entries carry extra commas (e.g., nobiliary particles), keep as-is; Wikipedia handles them.

      var id = 'n' + (++idCounter);
      map[id] = { el: el, title: title };
      candidates.push(title);
    });

    if (!candidates.length) return;

    var uniqueTitles = unique(candidates);
    var batches = chunk(uniqueTitles, 40); // conservative batch size

    var confirmed = new Set();
    var pending = batches.length;

    function onDone() {
      if (--pending === 0) addLinks(map, confirmed);
    }

    batches.forEach(function (batch) {
      var url = 'https://de.wikipedia.org/w/api.php?action=query&format=json&origin=*' +
                '&titles=' + encodeURIComponent(batch.join('|'));
      fetch(url)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data || !data.query || !data.query.pages) return;
          var pages = data.query.pages;
          Object.keys(pages).forEach(function (pid) {
            var p = pages[pid];
            if (p && p.pageid && !p.missing && p.title) {
              confirmed.add(p.title);
            }
          });
        })
        .catch(function () { /* ignore; graceful degradation */ })
        .finally(onDone);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();

// Load pre-generated additions from additional.html to avoid cross-origin restrictions.
(function () {
  function insertAdditional(html) {
    if (!html) return;
    var target = document.querySelector('.catalog-list') || document.querySelector('main') || document.body;
    var wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    target.appendChild(wrapper);
  }

  function run() {
    fetch('additional.html', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('no file'); return r.text(); })
      .then(insertAdditional)
      .catch(function () { /* No additions generated yet */ });
  }

  function scheduleRun() {
    if (window.__textMerged) { run(); return; }
    var fired = false; function once() { if (fired) return; fired = true; run(); }
    document.addEventListener('text-merged', once);
    setTimeout(once, 2000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleRun);
  else scheduleRun();
})();
