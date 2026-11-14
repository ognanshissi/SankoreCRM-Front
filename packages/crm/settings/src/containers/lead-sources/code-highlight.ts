/**
 * Coloration syntaxique des extraits du guide d'installation (TypeScript/TSX et HTML).
 *
 * Volontairement minimale et sans dépendance : elle ne colore que le code que ce guide génère
 * lui-même (`framework-snippets.ts`), pas du code arbitraire. Le résultat est du HTML échappé
 * jeton par jeton, à poser avec `[innerHTML]` ; les classes `tok-*` sont stylées par le composant.
 */
export type HighlightLanguage = 'typescript' | 'html';

const TS_KEYWORDS = new Set([
  'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'declare',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'from',
  'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'keyof', 'let', 'new', 'null',
  'of', 'private', 'protected', 'public', 'readonly', 'return', 'static', 'super', 'switch', 'this',
  'throw', 'true', 'try', 'type', 'typeof', 'undefined', 'var', 'void', 'while', 'yield',
]);
const TS_BUILTIN_TYPES = new Set(['string', 'number', 'boolean', 'unknown', 'any', 'never', 'object']);

const TS_TOKEN = new RegExp(
  [
    String.raw`(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/)`,
    String.raw`(?<string>'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|` + '`' + String.raw`(?:\\.|[^` + '`' + String.raw`\\])*` + '`)',
    String.raw`(?<jsx><\/?[A-Za-z][\w.-]*)`,
    String.raw`(?<decorator>@[A-Za-z_]\w*)`,
    String.raw`(?<number>\b\d[\d_]*(?:\.\d+)?\b)`,
    String.raw`(?<call>[A-Za-z_$][\w$]*(?=\s*(?:<[\w<>, ]*>)?\())`,
    String.raw`(?<ident>[A-Za-z_$][\w$]*)`,
  ].join('|'),
  'g',
);

/** Un `<` ouvre une balise JSX après `return`, `(`, `=>`, `?`… — après un nom, c'est un générique. */
const JSX_CONTEXT = /(?:^|[^\w$])(?:return|[(?:,=>&|{}])\s*$/;

const HTML_TOKEN = /(?<comment><!--[\s\S]*?-->)|(?<tagOpen><\/?[A-Za-z][\w-]*)|(?<tagClose>\/?>)|(?<string>"[^"]*"|'[^']*')|(?<attr>[A-Za-z_:][\w:.-]*)/g;

export function highlightCode(code: string, language: HighlightLanguage): string {
  return language === 'html' ? highlightHtml(code) : highlightTypeScript(code);
}

function highlightTypeScript(code: string): string {
  let out = '';
  let last = 0;
  for (const m of code.matchAll(TS_TOKEN)) {
    const index = m.index ?? 0;
    const text = m[0];
    const g = m.groups ?? {};
    out += escapeHtml(code.slice(last, index));
    last = index + text.length;

    if (g['comment']) out += wrap('comment', text);
    else if (g['string']) out += wrap('string', text);
    else if (g['jsx']) {
      if (JSX_CONTEXT.test(code.slice(Math.max(0, index - 20), index))) {
        const slash = text.startsWith('</') ? 2 : 1;
        out += wrap('punct', text.slice(0, slash)) + wrap('tag', text.slice(slash));
      } else {
        // Générique (`useRef<HTMLDivElement>`) : le `<` reste neutre, le nom est un type.
        out += escapeHtml('<') + wrap('type', text.slice(1));
      }
    } else if (g['decorator']) out += wrap('decorator', text);
    else if (g['number']) out += wrap('number', text);
    else if (g['call']) out += TS_KEYWORDS.has(text) ? wrap('keyword', text) : wrap('fn', text);
    else if (TS_KEYWORDS.has(text)) out += wrap('keyword', text);
    else if (TS_BUILTIN_TYPES.has(text) || /^[A-Z]/.test(text)) out += wrap('type', text);
    else out += escapeHtml(text);
  }
  return out + escapeHtml(code.slice(last));
}

function highlightHtml(code: string): string {
  let out = '';
  let last = 0;
  let inTag = false;
  for (const m of code.matchAll(HTML_TOKEN)) {
    const index = m.index ?? 0;
    const text = m[0];
    const g = m.groups ?? {};
    out += escapeHtml(code.slice(last, index));
    last = index + text.length;

    if (g['comment']) out += wrap('comment', text);
    else if (g['tagOpen']) {
      inTag = true;
      const slash = text.startsWith('</') ? 2 : 1;
      out += wrap('punct', text.slice(0, slash)) + wrap('tag', text.slice(slash));
    } else if (g['tagClose']) {
      inTag = false;
      out += wrap('punct', text);
    } else if (inTag && g['string']) out += wrap('string', text);
    else if (inTag && g['attr']) out += wrap('attr', text);
    else out += escapeHtml(text);
  }
  return out + escapeHtml(code.slice(last));
}

function wrap(kind: string, text: string): string {
  return `<span class="tok-${kind}">${escapeHtml(text)}</span>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
