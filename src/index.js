import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/ws/")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket upgrade required", { status: 426 });
      }
      const room = decodeURIComponent(url.pathname.slice(4)).toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 12) || "DJUR123";
      return env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(room)).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.players = new Map();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a?.playerId) this.players.set(a.playerId, { name: a.name || "SPELARE", clientKey: a.clientKey || a.playerId });
    }
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    const url = new URL(request.url);
    const name = this.cleanName(url.searchParams.get("name"));
    const clientKey = String(url.searchParams.get("client") || crypto.randomUUID()).slice(0,80);
    for (const existing of this.ctx.getWebSockets()) {
      const info = existing.deserializeAttachment() || {};
      if ((info.name || '').toUpperCase() !== name.toUpperCase()) continue;
      if (info.clientKey === clientKey) { try { existing.close(4001, 'Replaced by reconnect'); } catch {} }
      else {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        server.send(JSON.stringify({ type: 'join-error', message: `Namnet ${name} används redan i rummet.` }));
        server.close(4009, 'Name already in use');
        return new Response(null, { status: 101, webSocket: client });
      }
    }
    const playerId = clientKey;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.serializeAttachment({ playerId, name, clientKey });
    this.ctx.acceptWebSocket(server);
    this.players.set(playerId, { name, clientKey });

    const game = (await this.ctx.storage.get("game")) || { slots: [], complete: [], scores: {} };
    game.scores[playerId] ||= { name, score: 0 };
    await this.ctx.storage.put("game", game);

    server.send(JSON.stringify({
      type: "welcome",
      playerId,
      players: this.playerObject(),
      scores: game.scores,
      state: { slots: game.slots || [], complete: game.complete || [] },
    }));
    await this.broadcastPresence(game);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    let data;
    try { data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)); }
    catch { return; }

    const a = ws.deserializeAttachment() || {};
    const playerId = a.playerId;
    const name = a.name || "SPELARE";
    let game = (await this.ctx.storage.get("game")) || { slots: [], complete: [], scores: {} };
    game.scores[playerId] ||= { name, score: 0 };
    game.scores[playerId].name = name;

    if (data.type === "pose" && data.pose) {
      await this.broadcastExcept(ws, { type: "pose", playerId, pose: data.pose });
      return;
    }

    if (data.type === "state" && data.state) {
      const oldComplete = new Set(game.complete || []);
      const oldLocked = new Set((game.slots || []).filter(s => s && s.locked === true).map(s => `${s.wordkey}:${s.index}`));
      const nextSlots = Array.isArray(data.state.slots) ? data.state.slots.slice(0, 200) : game.slots;
      const nextComplete = Array.isArray(data.state.complete) ? [...new Set(data.state.complete.filter(v => typeof v === "string"))] : [];

      let newCorrectLetters = 0;
      for (const slot of nextSlots) {
        if (!slot || slot.locked !== true) continue;
        const key = `${slot.wordkey}:${slot.index}`;
        if (!oldLocked.has(key)) newCorrectLetters += 1;
      }
      let newWords = 0;
      for (const key of nextComplete) if (!oldComplete.has(key)) newWords += 1;
      game.scores[playerId].score += newCorrectLetters + newWords * 10;
      game.slots = nextSlots;
      game.complete = nextComplete;
      await this.ctx.storage.put("game", game);
      await this.broadcast({ type: "state", players: this.playerObject(), scores: game.scores, state: { slots: game.slots, complete: game.complete } });
      return;
    }

    if (data.type === "reset") {
      const scores = {};
      for (const [id, p] of this.players) scores[id] = { name: p.name, score: 0 };
      game = { slots: [], complete: [], scores };
      await this.ctx.storage.put("game", game);
      await this.broadcast({ type: "reset", players: this.playerObject(), scores });
    }
  }

  async webSocketClose(ws) {
    const a = ws.deserializeAttachment() || {};
    if (a.playerId) this.players.delete(a.playerId);
    const game = (await this.ctx.storage.get("game")) || { slots: [], complete: [], scores: {} };
    await this.broadcastPresence(game);
  }

  async webSocketError(ws) { await this.webSocketClose(ws); }

  cleanName(v) {
    return (String(v || "SPELARE").toUpperCase().replace(/[^A-ZÅÄÖ0-9_-]/g, "").slice(0, 12) || "SPELARE");
  }

  playerObject() { return Object.fromEntries(this.players.entries()); }

  async broadcastPresence(game) {
    await this.broadcast({ type: "presence", players: this.playerObject(), scores: game.scores || {} });
  }

  async broadcastExcept(sender, payload) {
    const text = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === sender) continue;
      try { ws.send(text); } catch {}
    }
  }

  async broadcast(payload) {
    const text = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(text); } catch {}
    }
  }
}
