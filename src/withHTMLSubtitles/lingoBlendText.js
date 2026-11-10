// Pure string helpers for LingoBlend (no DOM), testable with plain node.

var ENTITIES = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': '\'',
    '&apos;': '\'',
    '&nbsp;': ' ',
    '&lrm;': '',
    '&rlm;': ''
};

// Letters, combining marks and digits count as "word" characters.
// `\b` is ASCII-only in JS, so accented letters (é, ç, ã) need \p{...} with the `u` flag.
var WORD_CHAR = '[\\p{L}\\p{M}\\p{N}]';

function stripTags(text) {
    if (typeof text !== 'string') {
        return '';
    }

    return text
        .replace(/\r\n?/g, '\n')
        // ASS override blocks: {\an8}, {\i1}, {\pos(10,20)}
        .replace(/\{\\[^}]*\}/g, '')
        // ASS hard line breaks / hard spaces
        .replace(/\\N/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\h/g, ' ')
        // VTT/HTML tags: <i>, </b>, <font color="...">, <c.yellow>, <v Speaker>, <00:01.000>
        .replace(/<\/?[A-Za-z0-9.:_-][^>]*>/g, '')
        .replace(/&(amp|lt|gt|quot|#39|apos|nbsp|lrm|rlm);/g, function(entity) {
            return ENTITIES[entity];
        })
        .split('\n')
        .map(function(line) {
            return line.replace(/[ \t\u00A0]+/g, ' ').trim();
        })
        .filter(function(line) {
            return line.length > 0;
        })
        .join('\n');
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word, case-insensitive, Unicode-aware pattern for `source`.
// Whitespace inside a multi-word source matches any whitespace run (including "\n").
function buildSourceRegExp(source) {
    if (typeof source !== 'string') {
        return null;
    }

    var trimmed = source.trim();
    if (trimmed.length === 0) {
        return null;
    }

    var body = trimmed
        .split(/\s+/)
        .map(escapeRegExp)
        .join('\\s+');

    return new RegExp('(?<!' + WORD_CHAR + ')' + body + '(?!' + WORD_CHAR + ')', 'iu');
}

// Returns { index, length } of the first whole-word occurrence of `source` in `text`, or null.
function findSource(text, source) {
    var regexp = buildSourceRegExp(source);
    if (regexp === null || typeof text !== 'string') {
        return null;
    }

    var match = regexp.exec(text);
    return match === null ? null : { index: match.index, length: match[0].length };
}

function isUpperCase(text) {
    return text !== text.toLowerCase() && text === text.toUpperCase();
}

// Apply the capitalization style of `matched` (the original text) to `target`.
//   "Festas" -> "Feste", "FESTAS" -> "FESTE", "festas" -> "feste" (target unchanged)
function matchCase(matched, target) {
    if (typeof target !== 'string' || target.length === 0 || typeof matched !== 'string') {
        return target;
    }

    var letters = matched.replace(/[^\p{L}]/gu, '');
    if (letters.length === 0) {
        return target;
    }
    if (letters.length > 1 && isUpperCase(letters)) {
        return target.toUpperCase();
    }
    if (isUpperCase(letters.charAt(0))) {
        var chars = Array.from(target);
        return chars[0].toUpperCase() + chars.slice(1).join('');
    }

    return target;
}

// The cue text as the viewer sees it: every annotation swapped in place, like decorate() does on
// the DOM (first free occurrence, case matched). Swapped parts are never matched again.
function mixedText(text, annotations) {
    if (typeof text !== 'string') {
        return '';
    }

    var parts = [{ text: text, swapped: false }];
    (Array.isArray(annotations) ? annotations : []).forEach(function(annotation) {
        if (!annotation || typeof annotation.target !== 'string') {
            return;
        }
        for (var i = 0; i < parts.length; i++) {
            if (parts[i].swapped) {
                continue;
            }
            var value = parts[i].text;
            var match = findSource(value, annotation.source);
            if (match === null) {
                continue;
            }
            var matched = value.substr(match.index, match.length);
            parts.splice(i, 1,
                { text: value.slice(0, match.index), swapped: false },
                { text: matchCase(matched, annotation.target), swapped: true },
                { text: value.slice(match.index + match.length), swapped: false }
            );
            return;
        }
    });

    return parts.map(function(part) {
        return part.text;
    }).join('');
}

module.exports = {
    stripTags: stripTags,
    escapeRegExp: escapeRegExp,
    buildSourceRegExp: buildSourceRegExp,
    findSource: findSource,
    matchCase: matchCase,
    mixedText: mixedText
};
