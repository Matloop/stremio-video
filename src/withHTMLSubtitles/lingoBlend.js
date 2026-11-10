// LingoBlend: replaces some words of the rendered subtitles with clickable translations.
// Singleton shared by all withHTMLSubtitles instances (only one player at a time is expected).
// See docs/CONTRACT.md sections 2 and 3.

var EventEmitter = require('eventemitter3');
var lingoBlendText = require('./lingoBlendText');

var WORD_CLASS = 'lingoblend-word';
var WORD_EVENT = 'lingoblend:word';
var HOVER_BACKGROUND = 'rgba(34, 211, 238, 0.22)';
var STOPPED_EVENTS = ['mousedown', 'pointerdown', 'dblclick', 'touchstart'];

var events = new EventEmitter();
var provider = null;
var enabled = true;
var requestId = 0;
var settled = false;
// { owner, trackId, lang, cues: [{ id, text }], idByCue: Map<cue, id>, textById: { [id]: text } }
var session = null;
var annotations = {};
var currentStatus = { state: 'idle', annotated: 0, total: 0 };

function countAnnotated() {
    return Object.keys(annotations).filter(function(cueId) {
        return annotations[cueId].length > 0;
    }).length;
}

function setStatus(state, error) {
    currentStatus = {
        state: state,
        annotated: countAnnotated(),
        total: session !== null ? session.cues.length : 0
    };
    if (error !== undefined) {
        currentStatus.error = error && error.message ? error.message : String(error);
    }
    events.emit('status', Object.assign({}, currentStatus));
}

function notifyRender() {
    if (session !== null && typeof session.owner === 'function') {
        session.owner();
    }
}

function isValidAnnotation(annotation) {
    return annotation !== null &&
        typeof annotation === 'object' &&
        typeof annotation.source === 'string' &&
        annotation.source.trim().length > 0 &&
        typeof annotation.target === 'string' &&
        annotation.target.length > 0;
}

function merge(partial) {
    if (session === null || partial === null || typeof partial !== 'object') {
        return false;
    }

    var changed = false;
    Object.keys(partial).forEach(function(cueId) {
        if (!Object.prototype.hasOwnProperty.call(session.textById, cueId) || !Array.isArray(partial[cueId])) {
            return;
        }

        annotations[cueId] = partial[cueId].filter(isValidAnnotation);
        changed = true;
    });

    return changed;
}

function buildSession(owner, cuesByTime, info) {
    var idByCue = new Map();
    var textById = {};
    var cues = [];
    var times = cuesByTime && Array.isArray(cuesByTime.times) ? cuesByTime.times : [];
    times.forEach(function(time) {
        (cuesByTime[time] || []).forEach(function(cue) {
            if (!cue || idByCue.has(cue)) {
                return;
            }

            var id = 'c' + idByCue.size;
            var text = lingoBlendText.stripTags(cue.text);
            idByCue.set(cue, id);
            textById[id] = text;
            if (text.length > 0) {
                cues.push({ id: id, text: text });
            }
        });
    });

    return {
        owner: owner,
        trackId: info && info.trackId !== undefined ? info.trackId : null,
        lang: info && info.lang !== undefined ? info.lang : null,
        cues: cues,
        idByCue: idByCue,
        textById: textById
    };
}

function startRequest() {
    var currentRequestId = ++requestId;
    annotations = {};
    settled = false;

    if (session === null || provider === null || !enabled) {
        settled = true;
        setStatus('idle');
        notifyRender();
        return;
    }

    var currentProvider = provider;
    var request = {
        requestId: currentRequestId,
        trackId: session.trackId,
        lang: session.lang,
        cues: session.cues.map(function(cue) {
            return { id: cue.id, text: cue.text };
        })
    };
    function update(partial) {
        if (currentRequestId !== requestId) {
            return false;
        }
        if (merge(partial)) {
            setStatus(settled ? currentStatus.state : 'loading');
            notifyRender();
        }
        return true;
    }

    setStatus('loading');
    notifyRender();
    Promise.resolve()
        .then(function() {
            return currentProvider(request, update);
        })
        .then(function(result) {
            if (currentRequestId !== requestId) {
                return;
            }

            merge(result);
            settled = true;
            setStatus('ready');
            notifyRender();
        })
        .catch(function(error) {
            if (currentRequestId !== requestId) {
                return;
            }

            settled = true;
            setStatus('error', error);
            notifyRender();
        });
}

// ---- public API (CONTRACT.md section 2) ----

function setProvider(nextProvider) {
    nextProvider = typeof nextProvider === 'function' ? nextProvider : null;
    if (nextProvider === provider) {
        return;
    }

    provider = nextProvider;
    startRequest();
}

function setEnabled(value) {
    value = value === true;
    if (enabled === value) {
        return;
    }

    enabled = value;
    // First enable for this track (no request made yet): ask the provider now.
    if (enabled && session !== null && provider !== null && currentStatus.state === 'idle') {
        startRequest();
        return;
    }

    notifyRender();
}

function refresh() {
    startRequest();
}

function on(eventName, listener) {
    events.on(eventName, listener);
}

function off(eventName, listener) {
    events.off(eventName, listener);
}

function getStatus() {
    return Object.assign({}, currentStatus);
}

function isEnabled() {
    return enabled;
}

// ---- internal API used by withHTMLSubtitles ----

// `owner` is a function called whenever the subtitles must be re-rendered.
function attach(owner, cuesByTime, info) {
    session = buildSession(owner, cuesByTime, info);
    startRequest();
}

function detach(owner) {
    if (session === null || session.owner !== owner) {
        return;
    }

    session = null;
    requestId++;
    annotations = {};
    settled = true;
    setStatus('idle');
}

function collectTextNodes(node, result) {
    for (var child = node.firstChild; child !== null; child = child.nextSibling) {
        if (child.nodeType === 3) {
            result.push(child);
        } else if (child.nodeType === 1 && !(child.classList && child.classList.contains(WORD_CLASS))) {
            collectTextNodes(child, result);
        }
    }

    return result;
}

function stopPropagation(event) {
    event.stopPropagation();
}

function createWordElement(doc, annotation, text, cueText) {
    var span = doc.createElement('span');
    span.className = WORD_CLASS;
    span.setAttribute('data-lingoblend-source', annotation.source);
    span.textContent = text;
    span.style.textDecoration = 'underline';
    span.style.textDecorationLine = 'underline';
    span.style.textDecorationColor = '#22d3ee';
    span.style.textDecorationThickness = '2px';
    span.style.textUnderlineOffset = '4px';
    span.style.color = '#a5f3fc';
    span.style.cursor = 'pointer';
    span.style.pointerEvents = 'auto';
    span.style.borderRadius = '0.15em';
    span.addEventListener('mouseenter', function() {
        span.style.backgroundColor = HOVER_BACKGROUND;
    });
    span.addEventListener('mouseleave', function() {
        span.style.backgroundColor = '';
    });
    STOPPED_EVENTS.forEach(function(eventName) {
        span.addEventListener(eventName, stopPropagation);
    });
    span.addEventListener('click', function(event) {
        event.stopPropagation();
        event.preventDefault();
        var CustomEventCtor = (doc.defaultView && doc.defaultView.CustomEvent) || CustomEvent;
        span.dispatchEvent(new CustomEventCtor(WORD_EVENT, {
            bubbles: true,
            detail: {
                annotation: Object.assign({}, annotation),
                cueText: cueText,
                // idioma da legenda (track.lang, ex.: 'eng', 'pob'), para o cartão mostrar "Em inglês:" etc.
                lang: session !== null ? session.lang : null,
                rect: span.getBoundingClientRect()
            }
        }));
    });

    return span;
}

function replaceFirst(cueNode, annotation, cueText) {
    var textNodes = collectTextNodes(cueNode, []);
    for (var i = 0; i < textNodes.length; i++) {
        var textNode = textNodes[i];
        var match = lingoBlendText.findSource(textNode.nodeValue, annotation.source);
        if (match === null) {
            continue;
        }

        var matchNode = textNode.splitText(match.index);
        matchNode.splitText(match.length);
        var text = lingoBlendText.matchCase(matchNode.nodeValue, annotation.target);
        var span = createWordElement(cueNode.ownerDocument, annotation, text, cueText);
        matchNode.parentNode.replaceChild(span, matchNode);
        return true;
    }

    return false;
}

// Replace annotated words inside a rendered cue node. `cue` is the parsed cue object
// the node was built from (same object reference as in cuesByTime).
function decorate(cueNode, cue) {
    if (!enabled || session === null || !cueNode || !cue) {
        return;
    }

    var cueId = session.idByCue.get(cue);
    var cueAnnotations = cueId !== undefined ? annotations[cueId] : null;
    if (!cueAnnotations || cueAnnotations.length === 0) {
        return;
    }

    cueAnnotations.forEach(function(annotation) {
        try {
            replaceFirst(cueNode, annotation, session.textById[cueId]);
        } catch (error) {
            console.error('lingoBlend', error);
        }
    });
}

module.exports = {
    setProvider: setProvider,
    setEnabled: setEnabled,
    refresh: refresh,
    on: on,
    off: off,
    getStatus: getStatus,
    isEnabled: isEnabled,
    attach: attach,
    detach: detach,
    decorate: decorate,
    WORD_CLASS: WORD_CLASS,
    WORD_EVENT: WORD_EVENT
};
