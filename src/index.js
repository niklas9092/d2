import { DurableObject } from "cloudflare:workers";

function cleanRoom(value) {
  return (String(value || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 12));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/rooms") {
      const lobby = env.LOBBY.get(env.LOBBY.idFromName("GLOBAL"));
      return lobby.fetch(request);
    }

    if (url.pathname.startsWith("/api/rooms/") && request.method === "DELETE") {
      const room = cleanRoom(decodeURIComponent(url.pathname.slice("/api/rooms/".length)));
      if (!room) return Response.json({ message: "Ogiltig rumskod." }, { status: 400 });
      const roomStub = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(room));
      const check = await roomStub.fetch(new Request("https://internal/admin/delete", { method: "POST" }));
      const result = await check.json();
      if (!check.ok) return Response.json(result, { status: check.status });
      const lobby = env.LOBBY.get(env.LOBBY.idFromName("GLOBAL"));
      await lobby.fetch(new Request(`https://internal/room/${room}`, { method: "DELETE" }));
      return Response.json({ ok: true });
    }

    if (url.pathname.startsWith("/ws/")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket upgrade required", { status: 426 });
      }
      const room = cleanRoom(decodeURIComponent(url.pathname.slice(4)));
      if (!room) return new Response("Room required", { status: 400 });
      return env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(room)).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};

export class RoomLobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const rooms = (await this.ctx.storage.get("rooms")) || {};

    if (request.method === "GET") {
      const list = Object.values(rooms)
        .filter(room => room && room.name)
        .sort((a, b) => (b.players - a.players) || (b.updatedAt - a.updatedAt))
        .slice(0, 40);
      return Response.json({ rooms: list });
    }

    const room = cleanRoom(decodeURIComponent(url.pathname.slice("/room/".length)));
    if (!room) return new Response("Bad room", { status: 400 });

    if (request.method === "DELETE") {
      delete rooms[room];
      await this.ctx.storage.put("rooms", rooms);
      return Response.json({ ok: true });
    }

    if (request.method === "POST") {
      const data = await request.json().catch(() => ({}));
      rooms[room] = {
        name: room,
        players: Math.max(0, Number(data.players) || 0),
        words: Math.max(0, Number(data.words) || 0),
        updatedAt: Date.now(),
      };
      await this.ctx.storage.put("rooms", rooms);
      return Response.json({ ok: true });
    }

    return new Response("Method not allowed", { status: 405 });
  }
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.players = new Map();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a?.playerId) this.players.set(a.playerId, { name: a.name || "SPELARE", clientKey: a.clientKey || a.playerId });
    }
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/admin/delete" && request.method === "POST") {
      if (this.ctx.getWebSockets().length > 0) {
        return Response.json({ message: "Rummet används fortfarande och kan inte raderas." }, { status: 409 });
      }
      await this.ctx.storage.deleteAll();
      return Response.json({ ok: true });
    }

    const room = cleanRoom(decodeURIComponent(url.pathname.slice(4)));
    const name = this.cleanName(url.searchParams.get("name"));
    const clientKey = String(url.searchParams.get("client") || crypto.randomUUID()).slice(0, 80);

    for (const existing of this.ctx.getWebSockets()) {
      const info = existing.deserializeAttachment() || {};
      if ((info.name || "").toUpperCase() !== name.toUpperCase()) continue;
      if (info.clientKey === clientKey) {
        try { existing.close(4001, "Replaced by reconnect"); } catch {}
      } else {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        server.send(JSON.stringify({ type: "join-error", message: `Namnet ${name} används redan i rummet.` }));
        server.close(4009, "Name already in use");
        return new Response(null, { status: 101, webSocket: client });
      }
    }

    const playerId = clientKey;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ playerId, name, clientKey, room });
    this.ctx.acceptWebSocket(server);
    this.players.set(playerId, { name, clientKey });

    const game = (await this.ctx.storage.get("game")) || { slots: [], complete: [], scores: {} };
    game.scores[playerId] ||= { name, score: 0 };
    await this.ctx.storage.put("game", game);

    const poses = {};
    for (const existing of this.ctx.getWebSockets()) {
      if (existing === server) continue;
      const info = existing.deserializeAttachment() || {};
      if (info.playerId && info.latestPose) poses[info.playerId] = info.latestPose;
    }

    server.send(JSON.stringify({
      type: "welcome",
      playerId,
      players: this.playerObject(),
      scores: game.scores,
      state: { slots: game.slots || [], complete: game.complete || [] },
      poses,
    }));
    await this.broadcastPresence(game);
    await this.updateLobby(room, game);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    let data;
    try { data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)); }
    catch { return; }

    const a = ws.deserializeAttachment() || {};
    const playerId = a.playerId;
    const name = a.name || "SPELARE";
    const room = a.room || "";
    let game = (await this.ctx.storage.get("game")) || { slots: [], complete: [], scores: {} };
    game.scores[playerId] ||= { name, score: 0 };
    game.scores[playerId].name = name;

    if (data.type === "pose" && data.pose) {
      // Spara senaste pose i WebSocket-attachment. Den överlever DO-hibernation
      // och kan skickas direkt till spelare som ansluter senare.
      ws.serializeAttachment({ ...a, latestPose: data.pose });
      await this.broadcastExcept(ws, {
        type: "pose",
        playerId,
        playerName: name,
        pose: data.pose,
      });
      return;
    }

    if (data.type === "state" && data.state) {
      const oldComplete = new Set(game.complete || []);
      const oldLocked = new Set((game.slots || []).filter(s => s && s.locked === true).map(s => `${s.wordkey}:${s.index}`));
      const nextSlots = Array.isArray(data.state.slots) ? data.state.slots.slice(0, 300) : game.slots;
      const nextComplete = Array.isArray(data.state.complete) ? [...new Set(data.state.complete.filter(v => typeof v === "string"))] : [];

      let newCorrectLetters = 0;
      for (const slot of nextSlots) {
        if (!slot || slot.locked !== true) continue;
        const key = `${slot.wordkey}:${slot.index}`;
        if (!oldLocked.has(key)) newCorrectLetters += 1;
      }
      const newlyCompleted = [];
      for (const key of nextComplete) if (!oldComplete.has(key)) newlyCompleted.push(key);
      const newWords = newlyCompleted.length;

      game.scores[playerId].score += newCorrectLetters + newWords * 10;
      game.slots = nextSlots;
      game.complete = nextComplete;

      // Durable Object storage write occurs for every newly received placement,
      // including each correct locked letter.
      await this.ctx.storage.put("game", game);
      await this.broadcast({ type: "state", players: this.playerObject(), scores: game.scores, state: { slots: game.slots, complete: game.complete } });

      const labels = new Map(
        (Array.isArray(data.state.completedWords) ? data.state.completedWords : [])
          .filter(item => item && typeof item.key === "string")
          .map(item => [item.key, String(item.word || "").slice(0, 24)])
      );
      for (const key of newlyCompleted) {
        const word = labels.get(key) || "WORD";
        await this.broadcast({
          type: "celebration",
          playerId,
          playerName: name,
          word,
        });
      }

      await this.updateLobby(room, game);
      return;
    }

    if (data.type === "reset") {
      const scores = {};
      for (const [id, p] of this.players) scores[id] = { name: p.name, score: 0 };
      game = { slots: [], complete: [], scores };
      await this.ctx.storage.put("game", game);
      await this.broadcast({ type: "reset", players: this.playerObject(), scores });
      await this.updateLobby(room, game);
    }
  }

  async webSocketClose(ws) {
    const a = ws.deserializeAttachment() || {};
    if (a.playerId) this.players.delete(a.playerId);
    const game = (await this.ctx.storage.get("game")) || { slots: [], complete: [], scores: {} };
    await this.broadcastPresence(game);
    await this.updateLobby(a.room || "", game);
  }

  async webSocketError(ws) { await this.webSocketClose(ws); }

  cleanName(v) {
    return String(v || "").toUpperCase().replace(/[^A-ZÅÄÖ0-9_-]/g, "").slice(0, 12);
  }

  playerObject() { return Object.fromEntries(this.players.entries()); }

  async updateLobby(room, game) {
    if (!room) return;
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName("GLOBAL"));
    await lobby.fetch(new Request(`https://internal/room/${room}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        players: this.ctx.getWebSockets().length,
        words: (game.complete || []).length,
      }),
    }));
  }

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
