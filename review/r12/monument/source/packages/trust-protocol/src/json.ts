import { ProtocolValidationError } from './validation-error.ts';

// Only flat scalar objects are part of this protocol. Avoid a general-purpose
// JSON parser and reject duplicates BEFORE JSON.parse could discard evidence.
export function parseRecordJson(text: string): unknown {
  if (typeof text !== 'string' || text.length > 4096 || new TextEncoder().encode(text).length > 4096) {
    throw new ProtocolValidationError('JSON_INPUT');
  }
  let offset = 0;
  const fail = (): never => { throw new ProtocolValidationError('JSON_INPUT'); };
  const whitespace = () => { while (/[\x20\t\r\n]/.test(text[offset] ?? '') && offset < text.length) offset++; };
  const consume = (character: string) => {
    whitespace();
    if (text[offset++] !== character) fail();
  };
  const string = (): string => {
    whitespace();
    const token = /^"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(text.slice(offset))?.[0];
    if (!token) return fail();
    offset += token.length;
    return JSON.parse(token) as string;
  };
  consume('{');
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  whitespace();
  if (text[offset] !== '}') {
    for (;;) {
      const key = string();
      if (Object.hasOwn(values, key)) throw new ProtocolValidationError('DUPLICATE_KEY');
      consume(':');
      whitespace();
      let value: unknown;
      if (text[offset] === '"') value = string();
      else {
        // Integer decimal lexical form avoids precision loss before validation.
        const token = /^(?:true|false|null|0|[1-9][0-9]*)/.exec(text.slice(offset))?.[0];
        if (!token) return fail();
        offset += token.length;
        value = JSON.parse(token) as unknown;
      }
      values[key] = value;
      whitespace();
      if (text[offset] !== ',') break;
      offset++;
    }
  }
  consume('}');
  whitespace();
  if (offset !== text.length) fail();
  return values;
}
