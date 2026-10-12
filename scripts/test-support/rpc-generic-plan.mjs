import assert from "node:assert/strict";

// These RPC definitions use scalar arguments with literal defaults. Keep quoted
// text intact when splitting arguments or replacing parameter identifiers.
export function splitSqlArguments(value) {
  if (!value.trim()) return [];
  const parts = [];
  let start = 0, depth = 0, quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "'") {
      if (quoted && value[index + 1] === "'") { index += 1; continue; }
      quoted = !quoted;
    } else if (!quoted) {
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (char === "," && depth === 0) {
        parts.push(value.slice(start, index).trim()); start = index + 1;
      }
    }
  }
  assert.ok(!quoted && depth === 0, "unbalanced SQL arguments");
  parts.push(value.slice(start).trim());
  return parts;
}

export function sqlRpcDefinition(definition) {
  const header = definition.match(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([^]*?)\)\s+RETURNS/i);
  const body = definition.match(/AS (\$\w*\$)([^]*?)\1\s*;?\s*$/i);
  assert.ok(header && body && /LANGUAGE sql\b/i.test(definition), "expected a SQL RPC definition");
  const args = splitSqlArguments(header[2]).map((argument) => {
    const match = argument.match(/^(\w+)\s+(.+?)(?:\s+DEFAULT\s+[^]*)?$/i);
    assert.ok(match, `unsupported RPC argument: ${argument}`);
    return { name: match[1], type: match[2] };
  });
  return { name: header[1], args, body: body[2].trim().replace(/;\s*$/, "") };
}

export function prepareRpcBody(definition, name = "rpc_generic") {
  assert.match(name, /^[a-z_][a-z_0-9]*$/);
  const rpc = sqlRpcDefinition(definition);
  const parameters = new Map(rpc.args.map((argument, index) => [argument.name, `$${index + 1}`]));
  const body = rpc.body.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[^]*?\*\/|\b[a-z_][a-z_0-9]*\b/gi,
    (token) => parameters.get(token) ?? token);
  const types = rpc.args.map(({ type }) => type).join(",");
  return `PREPARE ${name}${types ? `(${types})` : ""} AS ${body};`;
}

export function executeRpc(name, values) {
  assert.match(name, /^[a-z_][a-z_0-9]*$/);
  return `EXECUTE ${name}${values.length ? `(${values.join(",")})` : ""};`;
}

// A call also exercises the SQL function's own cached plan. EXPLAIN shape gates
// use prepareRpcBody instead, so the planner's internal joins are visible.
export function prepareRpcCall(statement, definition, name = "rpc_perf") {
  const rpc = sqlRpcDefinition(definition);
  const prefix = statement.trim().match(new RegExp(`^SELECT public\\.${rpc.name}\\(`));
  assert.ok(prefix, "performance gate expects a single RPC SELECT");
  const rest = statement.trim().slice(prefix[0].length);
  let quoted = false, depth = 0, end = -1;
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "'") {
      if (quoted && rest[index + 1] === "'") { index += 1; continue; }
      quoted = !quoted;
    } else if (!quoted) {
      if (rest[index] === "(") depth += 1;
      if (rest[index] === ")") {
        if (depth === 0) { end = index; break; }
        depth -= 1;
      }
    }
  }
  assert.ok(end >= 0, "unterminated RPC call");
  const values = splitSqlArguments(rest.slice(0, end));
  assert.equal(values.length, rpc.args.length);
  const types = rpc.args.map(({ type }) => type).join(",");
  const call = `SELECT public.${rpc.name}(${values.map((_, index) => `$${index + 1}`).join(",")})${rest.slice(end + 1).replace(/;\s*$/, "")}`;
  return `PREPARE ${name}${types ? `(${types})` : ""} AS ${call};\n${executeRpc(name, values)}`;
}
