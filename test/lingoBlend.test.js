// Run with: node test/lingoBlend.test.js
var assert = require('assert');
var text = require('../src/withHTMLSubtitles/lingoBlendText');
var lingoBlend = require('../src/withHTMLSubtitles/lingoBlend');

var failures = 0;
var pending = [];
function test(name, fn) {
    pending.push(function() {
        return Promise.resolve().then(fn).then(function() {
            console.log('ok   ' + name);
        }, function(error) {
            failures++;
            console.log('FAIL ' + name + '\n     ' + (error && error.stack || error));
        });
    });
}

// Replace the first match like decorate() does, but on a plain string.
function apply(str, source, target) {
    var m = text.findSource(str, source);
    if (m === null) return str;
    var matched = str.substr(m.index, m.length);
    return str.slice(0, m.index) + '[' + text.matchCase(matched, target) + ']' + str.slice(m.index + m.length);
}

// ---- stripTags ----
test('strips VTT/HTML tags', function() {
    assert.strictEqual(text.stripTags('<i>Eu não</i> <b>quero</b>'), 'Eu não quero');
    assert.strictEqual(text.stripTags('<font color="#ffff00">Olá</font>, João'), 'Olá, João');
    assert.strictEqual(text.stripTags('<c.yellow>oi</c> <v Maria>tchau</v>'), 'oi tchau');
    assert.strictEqual(text.stripTags('<00:00:01.000>a <u>b</u>'), 'a b');
});
test('strips ASS overrides and line breaks', function() {
    assert.strictEqual(text.stripTags('{\\an8}Vamos às festas'), 'Vamos às festas');
    assert.strictEqual(text.stripTags('{\\i1}Oi{\\i0}\\Ntudo bem?'), 'Oi\ntudo bem?');
});
test('normalizes newlines, entities and blank lines', function() {
    assert.strictEqual(text.stripTags('  linha um \r\n\r\n linha  dois  '), 'linha um\nlinha dois');
    assert.strictEqual(text.stripTags('Tom &amp; Jerry &lt;3'), 'Tom & Jerry <3');
    assert.strictEqual(text.stripTags('5 < 6 e 7 > 2'), '5 < 6 e 7 > 2');
    assert.strictEqual(text.stripTags(null), '');
});

// ---- findSource ----
test('whole-word match with accents (no partial words)', function() {
    assert.strictEqual(text.findSource('Ele não está aqui', 'está').index, 8);
    // "está" must not match inside "estávamos"
    assert.strictEqual(text.findSource('Nós estávamos lá', 'está'), null);
    // "ia" must not match inside "pátria" ... "á" before should not count as boundary
    assert.strictEqual(text.findSource('pátria', 'tria'), null);
    assert.strictEqual(text.findSource('ação', 'aç'), null);
    assert.strictEqual(text.findSource('coração', 'ação'), null);
    assert.strictEqual(text.findSource('Ação!', 'ação').index, 0);
});
test('case-insensitive including accented capitals', function() {
    assert.deepStrictEqual(text.findSource('ÉPOCA boa', 'época'), { index: 0, length: 5 });
    assert.deepStrictEqual(text.findSource('Não sei', 'não'), { index: 0, length: 3 });
});
test('multi-word source, also across a line break', function() {
    assert.deepStrictEqual(text.findSource('Faça de novo.', 'de novo'), { index: 5, length: 7 });
    assert.deepStrictEqual(text.findSource('Faça de\nnovo.', 'de novo'), { index: 5, length: 7 });
    assert.strictEqual(text.findSource('Faça de novos', 'de novo'), null);
});
test('regex special characters in source are literal', function() {
    assert.strictEqual(text.findSource('Quanto? (sim)', '(sim)').index, 8);
    assert.strictEqual(text.findSource('abc', 'a.c'), null);
    assert.strictEqual(text.findSource('texto', ''), null);
});
test('first occurrence; second replacement finds the next one', function() {
    var s = apply('casa, casa e casa', 'casa', 'X');
    assert.strictEqual(s, '[X], casa e casa');
});

// ---- matchCase ----
test('capitalization style is preserved', function() {
    assert.strictEqual(text.matchCase('Festas', 'feste'), 'Feste');
    assert.strictEqual(text.matchCase('festas', 'feste'), 'feste');
    assert.strictEqual(text.matchCase('FESTAS', 'feste'), 'FESTE');
    assert.strictEqual(text.matchCase('Época', 'epoca'), 'Epoca');
    assert.strictEqual(text.matchCase('Água', 'acqua'), 'Acqua');
    assert.strictEqual(text.matchCase('água', 'Acqua'), 'Acqua');
    assert.strictEqual(text.matchCase('É', 'è'), 'È');
    assert.strictEqual(text.matchCase('De novo', 'di nuovo'), 'Di nuovo');
    assert.strictEqual(text.matchCase('Á', 'ancora'), 'Ancora');
});
test('end-to-end string replacement', function() {
    assert.strictEqual(apply('Eu não quero só ir às Festas.', 'festas', 'feste'), 'Eu não quero só ir às [Feste].');
    assert.strictEqual(apply('Não, NÃO!', 'não', 'no'), '[No], NÃO!');
});

// ---- lingoBlend state machine (no DOM) ----
function makeCues() {
    var a = { startTime: 0, endTime: 2000, text: '<i>Olá</i> mundo' };
    var b = { startTime: 1000, endTime: 3000, text: '{\\an8}De novo' };
    var c = { startTime: 4000, endTime: 5000, text: '<b></b>' };
    var cuesByTime = { times: [0, 1000, 2000, 4000, 5000] };
    cuesByTime[0] = [a];
    cuesByTime[1000] = [a, b];
    cuesByTime[2000] = [b];
    cuesByTime[4000] = [c];
    cuesByTime[5000] = [];
    return cuesByTime;
}
function tick() {
    return new Promise(function(resolve) { setTimeout(resolve, 0); });
}

test('provider gets deduped, stripped cues; partial + final merge; stale ignored', function() {
    var statuses = [];
    var renders = 0;
    var owner = function() { renders++; };
    var onStatus = function(s) { statuses.push(s); };
    var calls = [];
    lingoBlend.on('status', onStatus);
    lingoBlend.setProvider(function(request, update) {
        calls.push({ request: request, update: update });
        return new Promise(function(resolve) { calls[calls.length - 1].resolve = resolve; });
    });
    lingoBlend.attach(owner, makeCues(), { trackId: 't1', lang: 'por' });
    return tick().then(function() {
        assert.strictEqual(calls.length, 1);
        var req = calls[0].request;
        assert.strictEqual(req.trackId, 't1');
        assert.strictEqual(req.lang, 'por');
        assert.deepStrictEqual(req.cues, [{ id: 'c0', text: 'Olá mundo' }, { id: 'c1', text: 'De novo' }]);
        assert.strictEqual(lingoBlend.getStatus().state, 'loading');

        calls[0].update({ c0: [{ source: 'mundo', target: 'mondo' }], bogus: [{ source: 'x', target: 'y' }] });
        assert.strictEqual(lingoBlend.getStatus().annotated, 1);
        assert.strictEqual(lingoBlend.getStatus().total, 2);
        calls[0].resolve({ c1: [{ source: 'De novo', target: 'di nuovo' }, { source: '', target: 'bad' }] });
        return tick();
    }).then(function() {
        var s = lingoBlend.getStatus();
        assert.deepStrictEqual(s, { state: 'ready', annotated: 2, total: 2 });
        assert.ok(renders >= 3);

        // refresh: new request; old update is stale and ignored
        lingoBlend.refresh();
        assert.strictEqual(lingoBlend.getStatus().annotated, 0);
        return tick();
    }).then(function() {
        assert.strictEqual(calls.length, 2);
        assert.strictEqual(calls[1].request.requestId, calls[0].request.requestId + 1);
        assert.strictEqual(calls[0].update({ c0: [{ source: 'mundo', target: 'mondo' }] }), false);
        assert.strictEqual(lingoBlend.getStatus().annotated, 0);

        lingoBlend.detach(function() {}); // other owner: no-op
        assert.strictEqual(lingoBlend.getStatus().state, 'loading');
        lingoBlend.detach(owner);
        assert.deepStrictEqual(lingoBlend.getStatus(), { state: 'idle', annotated: 0, total: 0 });
        calls[1].resolve({ c0: [{ source: 'mundo', target: 'mondo' }] });
        return tick();
    }).then(function() {
        assert.strictEqual(lingoBlend.getStatus().state, 'idle');
        assert.ok(statuses.length > 0);
        lingoBlend.off('status', onStatus);
        lingoBlend.setProvider(null);
    });
});

test('provider errors -> status error; disabled does not call provider until enabled', function() {
    var called = 0;
    var owner = function() {};
    lingoBlend.setEnabled(false);
    lingoBlend.setProvider(function() {
        called++;
        throw new Error('boom');
    });
    lingoBlend.attach(owner, makeCues(), { trackId: 't2', lang: 'pt' });
    return tick().then(function() {
        assert.strictEqual(called, 0);
        assert.strictEqual(lingoBlend.getStatus().state, 'idle');
        lingoBlend.setEnabled(true);
        return tick();
    }).then(function() {
        assert.strictEqual(called, 1);
        var s = lingoBlend.getStatus();
        assert.strictEqual(s.state, 'error');
        assert.strictEqual(s.error, 'boom');
        lingoBlend.detach(owner);
        lingoBlend.setProvider(null);
    });
});

pending.reduce(function(p, fn) { return p.then(fn); }, Promise.resolve()).then(function() {
    console.log(failures === 0 ? '\nall tests passed' : '\n' + failures + ' test(s) failed');
    process.exitCode = failures === 0 ? 0 : 1;
});
