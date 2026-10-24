import { runScript, send, fail } from "./_db.js";
import { randomInt } from "node:crypto";

// A single atomic operation per request. v3 isolates the acknowledged protocol
// from old clients, whose destructive LPOP relay cannot safely share these queues.
export const MULTIPLAYER_LUA = `
local b = cjson.decode(ARGV[1])
local now = tonumber(ARGV[2])
local p = 'gc:v3:'
local function key(s) return p..s end
local function get(s) return redis.call('GET', key(s)) end
local function put(s, v, ttl) redis.call('SET', key(s), v, 'EX', ttl) end
local function reply(v) return cjson.encode(v) end
local function error(status, msg) return reply({status=status, error=msg}) end
local function matched(h, g)
  local room = h.peer
  local hm = {status='matched', role='host', opp=g}
  local gm = {status='matched', role='guest', opp=h}
  put('mm:'..h.peer, reply(hm), 120)
  put('mm:'..g.peer, reply(gm), 120)
  put('room:'..room, reply({h=h.pid,g=g.pid}), 7200)
  put('seen:'..room..':h', now, 7200)
  put('seen:'..room..':g', now, 7200)
  redis.call('ZREM', key('queue'), h.peer, g.peer)
  redis.call('ZREM', 'gc:mq:online', h.pid, g.pid)
  return gm
end
if b.action == 'leave' then
  put('cancel:'..b.peer, '1', 120)
  redis.call('ZREM', key('queue'), b.peer)
  if get('active:'..b.pid) == b.peer then
    redis.call('DEL', key('active:'..b.pid))
    redis.call('ZREM', 'gc:mq:online', b.pid)
  end
  local code = get('code-for:'..b.peer)
  if code then redis.call('DEL', key('code:'..code)) end
  local mm = get('mm:'..b.peer)
  if mm then
    local match = cjson.decode(mm)
    local role = match.role == 'host' and 'h' or 'g'
    local room = role == 'h' and b.peer or match.opp.peer
    put('left:'..room..':'..role, '1', 7200)
  end
  return reply({ok=true})
end
if b.action == 'poll' or b.action == 'code_create' or b.action == 'code_join' then
  if get('cancel:'..b.peer) then return error(409, 'Búsqueda cancelada') end
  local mm = get('mm:'..b.peer)
  if mm then return mm end
  put('active:'..b.pid, b.peer, 25)
  local me = {pid=b.pid,peer=b.peer,nick=b.nick}
  put('entry:'..b.peer, reply(me), 25)
  if b.action == 'code_create' then
    local previous = get('code-for:'..b.peer)
    if previous then return reply({code=previous}) end
    if not redis.call('SET', key('code:'..b.code), reply(me), 'NX', 'EX', 600) then
      return error(409, 'Código ocupado. Creá otra sala.')
    end
    put('code-for:'..b.peer, b.code, 600)
    return reply({code=b.code})
  end
  if b.action == 'code_join' then
    local raw = get('code:'..b.code)
    if not raw then return error(404, 'No existe esa sala o ya se usó') end
    local host = cjson.decode(raw)
    if host.pid == b.pid then return error(400, 'Esa es tu propia sala') end
    if get('active:'..host.pid) ~= host.peer or get('cancel:'..host.peer) then
      return error(404, 'Tu amigo ya no está esperando')
    end
    if get('mm:'..host.peer) then return error(409, 'La sala ya tiene rival') end
    local result = matched(host, me)
    redis.call('DEL', key('code:'..b.code))
    return reply(result)
  end
  if b.private then return reply({status='waiting',searching=0}) end
  redis.call('ZREMRANGEBYSCORE', key('queue'), '-inf', now-25000)
  local candidates = redis.call('ZRANGE', key('queue'), 0, 63)
  for _, peer in ipairs(candidates) do
    if peer ~= b.peer then
      local raw = get('entry:'..peer)
      if raw then
        local host = cjson.decode(raw)
        if host.pid ~= b.pid and get('active:'..host.pid) == peer and not get('mm:'..peer) and not get('cancel:'..peer) then
          return reply(matched(host, me))
        end
      end
      redis.call('ZREM', key('queue'), peer)
    end
  end
  redis.call('ZADD', key('queue'), now, b.peer)
  redis.call('EXPIRE', key('queue'), 60)
  redis.call('ZADD', 'gc:mq:online', now, b.pid)
  redis.call('ZREMRANGEBYSCORE', 'gc:mq:online', 0, now-25000)
  return reply({status='waiting',searching=redis.call('ZCARD',key('queue'))})
end
local raw = get('room:'..b.room)
if not raw then return error(404, 'La partida expiró') end
local members = cjson.decode(raw)
local role = members.h == b.pid and 'h' or members.g == b.pid and 'g' or nil
if not role then return error(403, 'No pertenecés a esta partida') end
local other = role == 'h' and 'g' or 'h'
local base = b.room..':'
if b.action == 'signal' then
  if (b.kind == 'offer' and role ~= 'g') or (b.kind == 'answer' and role ~= 'h') then return error(403, 'Rol inválido') end
  put('sig:'..base..b.kind, b.sdp, 90)
  return reply({ok=true})
end
if b.action == 'wait' then return reply({sdp=get('sig:'..base..b.kind) or cjson.null}) end
if b.action == 'exit' then
  put('left:'..base..role, '1', 7200)
  return reply({ok=true})
end
if b.action == 'claim' then
  local owner = get('winner:'..b.room)
  if owner then return reply({decided=true,winner=owner==b.pid}) end
  local seen = tonumber(get('seen:'..base..other) or now)
  if not get('left:'..base..other) and now-seen < 20000 then return reply({decided=false}) end
  put('winner:'..b.room, b.pid, 7200)
  return reply({decided=true,winner=true})
end
if b.action ~= 'relay' then return error(400, 'Acción inválida') end
if get('left:'..base..role) then return error(409, 'Ya saliste de esta partida') end
put('seen:'..base..role, now, 7200)
local mine, theirs = key('events:'..base..role), key('events:'..base..other)
local last = tonumber(get('batch:'..base..role) or 0)
if b.seq > last+1 then return error(409, 'Lote fuera de orden') end
if b.seq > last then
  if redis.call('ZCARD', mine) + #b.msgs > 512 then return error(429, 'Esperando al rival') end
  for i,m in ipairs(b.msgs) do
    local id = b.seq*100+i
    redis.call('ZADD', mine, id, reply({id=id,m=m}))
  end
  redis.call('EXPIRE', mine, 120)
  if b.state and b.state ~= cjson.null then put('state:'..base..role, reply(b.state), 3) end
  put('batch:'..base..role, b.seq, 7200)
end
redis.call('ZREMRANGEBYSCORE', theirs, '-inf', b.ack)
local events = redis.call('ZRANGE', theirs, 0, 99)
local state = get('state:'..base..other)
return reply({events=events,state=state and cjson.decode(state) or cjson.null,left=get('left:'..base..other)=='1'})
`;

const clean = (v, max = 60) => String(v || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, max);
const integer = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 1e12;
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { ok: false, error: "Usá POST" });
  try {
    let input;
    try { input = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
    catch { return send(res, 400, { ok: false, error: "JSON inválido" }); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return send(res, 400, { ok: false, error: "Datos inválidos" });
    if (input.protocol !== 3) return send(res, 409, { ok: false, error: "Actualizá la página para jugar con la versión nueva." });
    const b = { ...input, pid: clean(input.pid, 40), peer: clean(input.peer), room: clean(input.room),
      nick: String(input.nick || "RIVAL").replace(/[<>"\\|]/g, "").toUpperCase().slice(0, 14) };
    const search = ["poll", "leave", "code_create", "code_join"].includes(b.action);
    const actions = ["poll", "leave", "code_create", "code_join", "signal", "wait", "relay", "exit", "claim"];
    let valid = b.pid.length >= 8 && actions.includes(b.action) && (search ? b.peer.length >= 8 : b.room.length >= 8);
    if (b.action === "signal" || b.action === "wait") valid &&= ["offer", "answer"].includes(b.kind);
    if (b.action === "signal") valid &&= typeof b.sdp === "string" && b.sdp.length > 0 && b.sdp.length <= 20000;
    if (b.action === "relay") {
      valid &&= integer(b.seq) && b.seq > 0 && integer(b.ack) && Array.isArray(b.msgs) && b.msgs.length <= 60;
      valid &&= (b.msgs || []).every(m => m && typeof m === "object" && typeof m.t === "string" && m.t !== "s" && JSON.stringify(m).length <= 4096);
      valid &&= !b.state || (b.state.t === "s" && JSON.stringify(b.state).length <= 4096);
    }
    if (b.action === "code_create" || b.action === "code_join") {
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      b.code = String(b.code || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 48);
      if (!b.code && b.action === "code_create") b.code = Array.from({length: 6}, () => alphabet[randomInt(alphabet.length)]).join("");
      valid &&= b.code.length >= 4;
    }
    if (!valid || JSON.stringify(b).length > 65536) return send(res, 400, { ok: false, error: "Datos inválidos" });
    const raw = await runScript(MULTIPLAYER_LUA, [JSON.stringify(b), String(Date.now())]);
    const result = JSON.parse(raw);
    if (result.error) return send(res, result.status, { ok: false, error: result.error });
    if (result.events) result.events = (Array.isArray(result.events) ? result.events : []).map(e => JSON.parse(e));
    return send(res, 200, { ...result, ok: true });
  } catch (e) { fail(res, e); }
}
