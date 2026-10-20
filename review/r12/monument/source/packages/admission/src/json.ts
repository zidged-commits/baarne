/** Strict bounded JSON for the admission schemas. Reject duplicate keys at every level.
 * Numbers in these schemas are nonnegative safe integers only. No generic JSON/JCS claim.
 */
export function parse(text: string): any {
  if (typeof text !== 'string' || text.length > 64 * 1024 * 1024) throw Error('SIZE');
  let i = 0;
  const ws = () => { while (/\s/.test(text[i] ?? '') && i < text.length) { if (!' \n\r\t'.includes(text[i]!)) throw Error('JSON'); i++; } };
  function value(depth = 0): any {
    if (depth > 20) throw Error('DEPTH');
    ws(); const c = text[i];
    if (c === '"') {
      const start = i++;
      while (i < text.length) { const ch = text[i++]; if (ch === '\\') i++; else if (ch === '"') return JSON.parse(text.slice(start,i)); }
      throw Error('STRING');
    }
    if (c === '{') {
      i++; ws(); const out: Record<string,any> = Object.create(null);
      if (text[i] === '}') { i++; return out; }
      while (true) {
        ws(); if (text[i] !== '"') throw Error('KEY'); const key = value(depth+1);
        if (Object.hasOwn(out,key)) throw Error('DUPLICATE');
        ws(); if (text[i++] !== ':') throw Error('COLON'); out[key] = value(depth+1); ws();
        const end = text[i++]; if (end === '}') return out; if (end !== ',') throw Error('COMMA');
      }
    }
    if (c === '[') {
      i++; ws(); const out: any[] = []; if (text[i] === ']') { i++; return out; }
      while (true) { out.push(value(depth+1)); ws(); const end = text[i++]; if (end === ']') return out; if (end !== ',') throw Error('COMMA'); }
    }
    for (const [word,result] of [['null',null],['true',true],['false',false]] as const) {
      if (text.slice(i,i+word.length) === word) { i+=word.length; return result; }
    }
    const number = /^(0|[1-9][0-9]*)/.exec(text.slice(i));
    if (number) { i+=number[0].length; const n=Number(number[0]); if (!Number.isSafeInteger(n)) throw Error('NUMBER'); return n; }
    throw Error('JSON');
  }
  const result=value(); ws(); if (i !== text.length) throw Error('TRAILING'); return result;
}

export function canonical(x: any): string {
  if (Array.isArray(x)) return '['+x.map(canonical).join(',')+']';
  if (x !== null && typeof x === 'object') return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
  return JSON.stringify(x);
}
