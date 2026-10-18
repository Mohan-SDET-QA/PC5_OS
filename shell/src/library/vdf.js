// Minimal parser for Valve's text KeyValues format (libraryfolders.vdf, *.acf).
function parse(text) {
  const tokens = [];
  const re = /"((?:[^"\\]|\\.)*)"|([{}])|\/\/[^\n]*/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) tokens.push({ str: m[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"') });
    else if (m[2]) tokens.push({ brace: m[2] });
  }
  let i = 0;
  function obj() {
    const out = {};
    while (i < tokens.length) {
      const t = tokens[i++];
      if (t.brace === '}') return out;
      const key = t.str;
      const next = tokens[i++];
      if (!next) break;
      out[key] = next.brace === '{' ? obj() : next.str;
    }
    return out;
  }
  return obj();
}

module.exports = { parse };
