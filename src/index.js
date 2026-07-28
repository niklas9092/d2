import { DurableObject } from "cloudflare:workers";

const THEMES = new Set(["animals","fruits","mystery","nature","space","home","body","city"]);
const ROOMS = new Set(["ROOM1","ROOM2","ROOM3","ROOM4","ROOM5"]);
function cleanRoom(value){
  const room=String(value||"").toUpperCase();
  return ROOMS.has(room)?room:"ROOM1";
}
function cleanTheme(value){
  const theme=String(value||"");
  return THEMES.has(theme)?theme:"mystery";
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname.startsWith("/ws/")){
      if(request.headers.get("Upgrade")!=="websocket")return new Response("WebSocket upgrade required",{status:426});
      const room=cleanRoom(decodeURIComponent(url.pathname.slice(4)));
      return env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(room)).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};

export class RoomLobby extends DurableObject {
  async fetch(){return Response.json({rooms:[]});}
}

export class GameRoom extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);this.ctx=ctx;this.env=env;this.players=new Map();
    for(const ws of ctx.getWebSockets()){
      const a=ws.deserializeAttachment();
      if(a?.playerId)this.players.set(a.playerId,{name:a.name||"SPELARE",clientKey:a.clientKey||a.playerId});
    }
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping","pong"));
  }

  async fetch(request){
    const url=new URL(request.url);
    const room=cleanRoom(decodeURIComponent(url.pathname.slice(4)));
    const name=this.cleanName(url.searchParams.get("name"));
    const clientKey=String(url.searchParams.get("client")||crypto.randomUUID()).slice(0,80);
    const mode=url.searchParams.get("mode")==="new"?"new":"continue";
    const selectedTheme=cleanTheme(url.searchParams.get("theme"));

    for(const existing of this.ctx.getWebSockets()){
      const info=existing.deserializeAttachment()||{};
      if((info.name||"").toUpperCase()!==name.toUpperCase())continue;
      if(info.clientKey===clientKey){try{existing.close(4001,"Replaced by reconnect");}catch{}}
      else{
        const pair=new WebSocketPair();const [client,server]=Object.values(pair);
        this.ctx.acceptWebSocket(server);
        server.send(JSON.stringify({type:"join-error",message:`Namnet ${name} används redan i rummet.`}));
        server.close(4009,"Name already in use");
        return new Response(null,{status:101,webSocket:client});
      }
    }

    let game=(await this.ctx.storage.get("game"))||{theme:selectedTheme,slots:[],complete:[],scores:{},drawings:[]};
    if(mode==="new"){
      game={theme:selectedTheme,slots:[],complete:[],scores:{},drawings:[]};
    }else if(!game.theme){
      game.theme=(game.slots||[]).length?"mystery":selectedTheme;
    }
    game.theme=cleanTheme(game.theme);
    game.drawings=Array.isArray(game.drawings)?game.drawings.slice(-600):[];

    if(mode==="new"){
      for(const [id,p] of this.players)game.scores[id]={name:p.name,score:0};
    }

    const playerId=clientKey;
    const pair=new WebSocketPair();const [client,server]=Object.values(pair);
    server.serializeAttachment({playerId,name,clientKey,room});
    this.ctx.acceptWebSocket(server);
    this.players.set(playerId,{name,clientKey});
    game.scores[playerId]||={name,score:0};
    game.scores[playerId].name=name;
    await this.ctx.storage.put("game",game);

    const poses={};
    for(const existing of this.ctx.getWebSockets()){
      if(existing===server)continue;
      const info=existing.deserializeAttachment()||{};
      if(info.playerId&&info.latestPose)poses[info.playerId]=info.latestPose;
    }

    server.send(JSON.stringify({
      type:"welcome",playerId,players:this.playerObject(),scores:game.scores,
      theme:game.theme,drawings:game.drawings,
      state:{slots:game.slots||[],complete:game.complete||[]},poses
    }));
    await this.broadcastPresence(game);
    if(mode==="new"){
      await this.broadcastExcept(server,{type:"reset",scores:game.scores,theme:game.theme});
    }
    return new Response(null,{status:101,webSocket:client});
  }

  async webSocketMessage(ws,message){
    let data;try{data=JSON.parse(typeof message==="string"?message:new TextDecoder().decode(message));}catch{return;}
    const a=ws.deserializeAttachment()||{};
    const playerId=a.playerId,name=a.name||"SPELARE";
    let game=(await this.ctx.storage.get("game"))||{theme:"mystery",slots:[],complete:[],scores:{},drawings:[]};
    game.scores[playerId]||={name,score:0};game.scores[playerId].name=name;

    if(data.type==="pose"&&data.pose){
      ws.serializeAttachment({...a,latestPose:data.pose});
      await this.broadcastExcept(ws,{type:"pose",playerId,playerName:name,pose:data.pose});
      return;
    }

    if(data.type==="draw"&&Array.isArray(data.points)){
      const valid=data.points.slice(0,20).map(p=>({
        x:Math.max(-24,Math.min(24,Number(p.x)||0)),
        y:Math.max(.1,Math.min(19,Number(p.y)||0)),
        z:Math.max(-24,Math.min(24,Number(p.z)||0)),
        color:/^#[0-9a-f]{6}$/i.test(String(p.color||""))?p.color:"#ffffff"
      }));
      game.drawings=[...(game.drawings||[]),...valid].slice(-600);
      await this.ctx.storage.put("game",game);
      await this.broadcastExcept(ws,{type:"draw",playerId,points:valid});
      return;
    }

    if(data.type==="state"&&data.state){
      const oldComplete=new Set(game.complete||[]);
      const oldLocked=new Set((game.slots||[]).filter(s=>s&&s.locked===true).map(s=>`${s.wordkey}:${s.index}`));
      const nextSlots=Array.isArray(data.state.slots)?data.state.slots.slice(0,300):game.slots;
      const nextComplete=Array.isArray(data.state.complete)?[...new Set(data.state.complete.filter(v=>typeof v==="string"))]:[];
      let newCorrectLetters=0;
      for(const slot of nextSlots){
        if(!slot||slot.locked!==true)continue;
        const key=`${slot.wordkey}:${slot.index}`;
        if(!oldLocked.has(key))newCorrectLetters++;
      }
      const newlyCompleted=nextComplete.filter(key=>!oldComplete.has(key));
      game.scores[playerId].score+=newCorrectLetters+newlyCompleted.length*10;
      game.slots=nextSlots;game.complete=nextComplete;
      await this.ctx.storage.put("game",game);
      await this.broadcast({type:"state",players:this.playerObject(),scores:game.scores,state:{slots:game.slots,complete:game.complete}});

      const labels=new Map((Array.isArray(data.state.completedWords)?data.state.completedWords:[])
        .filter(i=>i&&typeof i.key==="string").map(i=>[i.key,String(i.word||"").slice(0,24)]));
      for(const key of newlyCompleted){
        await this.broadcast({type:"celebration",playerId,playerName:name,word:labels.get(key)||"WORD"});
      }
      return;
    }

    if(data.type==="reset"){
      const theme=cleanTheme(data.theme||game.theme);
      const scores={};for(const [id,p] of this.players)scores[id]={name:p.name,score:0};
      game={theme,slots:[],complete:[],scores,drawings:[]};
      await this.ctx.storage.put("game",game);
      await this.broadcast({type:"reset",players:this.playerObject(),scores,theme});
    }
  }

  async webSocketClose(ws){
    const a=ws.deserializeAttachment()||{};
    if(a.playerId)this.players.delete(a.playerId);
    const game=(await this.ctx.storage.get("game"))||{scores:{}};
    await this.broadcastPresence(game);
  }
  async webSocketError(ws){await this.webSocketClose(ws);}
  cleanName(v){return String(v||"").toUpperCase().replace(/[^A-ZÅÄÖ0-9_-]/g,"").slice(0,12);}
  playerObject(){return Object.fromEntries(this.players.entries());}
  async broadcastPresence(game){await this.broadcast({type:"presence",players:this.playerObject(),scores:game.scores||{}});}
  async broadcastExcept(sender,payload){
    const text=JSON.stringify(payload);
    for(const ws of this.ctx.getWebSockets()){if(ws===sender)continue;try{ws.send(text);}catch{}}
  }
  async broadcast(payload){
    const text=JSON.stringify(payload);
    for(const ws of this.ctx.getWebSockets()){try{ws.send(text);}catch{}}
  }
}
