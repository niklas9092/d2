import { DurableObject } from "cloudflare:workers";
const THEMES=new Set(["animals","fruits","mystery","nature","space","home","body","city"]);
const FOUR_HOURS=4*60*60*1000;
function cleanRoom(v){return(String(v||"").toUpperCase().replace(/[^A-ZÅÄÖ0-9_-]/g,"").slice(0,16)||"RUM");}
function cleanTheme(v){return THEMES.has(String(v||""))?String(v):"mystery";}

export default{
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
export class RoomLobby extends DurableObject{async fetch(){return Response.json({rooms:[]});}}

export class GameRoom extends DurableObject{
  constructor(ctx,env){
    super(ctx,env);this.ctx=ctx;this.env=env;this.players=new Map();this.lastTouchWrite=0;
    for(const ws of ctx.getWebSockets()){
      const a=ws.deserializeAttachment();
      if(a?.playerId)this.players.set(a.playerId,{name:a.name||"SPELARE",clientKey:a.clientKey||a.playerId});
    }
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping","pong"));
  }
  emptyGame(theme="mystery"){return{theme:cleanTheme(theme),slots:[],complete:[],scores:{},cubes:[],cubeOwners:{},cubeSeq:0,physicsHostId:"",freezeCooldowns:{},lastActivity:Date.now()};}
  async touch(game,force=false){
    const now=Date.now();game.lastActivity=now;
    if(force||now-this.lastTouchWrite>60000){
      this.lastTouchWrite=now;await this.ctx.storage.put("game",game);await this.ctx.storage.setAlarm(now+FOUR_HOURS);
    }
  }
  activePlayerIds(){return this.ctx.getWebSockets().map(ws=>(ws.deserializeAttachment()||{}).playerId).filter(Boolean);}
  chooseHost(excludeId=""){
    for(const id of this.activePlayerIds())if(id!==excludeId)return id;
    return "";
  }
  async alarm(){
    const game=(await this.ctx.storage.get("game"))||this.emptyGame(),now=Date.now(),last=Number(game.lastActivity)||0;
    if(now-last>=FOUR_HOURS){
      const reset=this.emptyGame(game.theme);await this.ctx.storage.put("game",reset);
      if(this.ctx.getWebSockets().length)await this.broadcast({type:"reset",players:this.playerObject(),scores:{},theme:reset.theme});
      await this.ctx.storage.setAlarm(now+FOUR_HOURS);
    }else await this.ctx.storage.setAlarm(last+FOUR_HOURS);
  }
  async fetch(request){
    const url=new URL(request.url),room=cleanRoom(decodeURIComponent(url.pathname.slice(4)));
    const name=this.cleanName(url.searchParams.get("name"));
    const clientKey=String(url.searchParams.get("client")||crypto.randomUUID()).slice(0,80);
    const selectedTheme=cleanTheme(url.searchParams.get("theme"));
    for(const existing of this.ctx.getWebSockets()){
      const info=existing.deserializeAttachment()||{};
      if((info.name||"").toUpperCase()!==name.toUpperCase())continue;
      if(info.clientKey===clientKey){try{existing.close(4001,"Replaced by reconnect");}catch{}}
      else{
        const pair=new WebSocketPair(),[client,server]=Object.values(pair);this.ctx.acceptWebSocket(server);
        server.send(JSON.stringify({type:"join-error",message:`Namnet ${name} används redan i rummet.`}));
        server.close(4009,"Name already in use");return new Response(null,{status:101,webSocket:client});
      }
    }
    let game=(await this.ctx.storage.get("game"))||this.emptyGame(selectedTheme);
    if(!game.lastActivity||Date.now()-Number(game.lastActivity)>=FOUR_HOURS)game=this.emptyGame(selectedTheme);
    game.theme=cleanTheme(game.theme||selectedTheme);game.slots=Array.isArray(game.slots)?game.slots:[];
    game.complete=Array.isArray(game.complete)?game.complete:[];game.scores=game.scores||{};
    game.cubes=Array.isArray(game.cubes)?game.cubes:[];
    game.cubeOwners=game.cubeOwners||{};
    game.freezeCooldowns=game.freezeCooldowns||{};
    const activeIds=this.activePlayerIds();
    if(!game.physicsHostId||!activeIds.includes(game.physicsHostId))game.physicsHostId=this.chooseHost();

    const playerId=clientKey,pair=new WebSocketPair(),[client,server]=Object.values(pair);
    server.serializeAttachment({playerId,name,clientKey,room});this.ctx.acceptWebSocket(server);
    this.players.set(playerId,{name,clientKey});
    game.scores[playerId]||={name,score:0};game.scores[playerId].name=name;
    if(!game.physicsHostId)game.physicsHostId=playerId;
    await this.touch(game,true);

    const poses={};for(const existing of this.ctx.getWebSockets()){
      if(existing===server)continue;const info=existing.deserializeAttachment()||{};
      if(info.playerId&&info.latestPose)poses[info.playerId]=info.latestPose;
    }
    server.send(JSON.stringify({type:"welcome",playerId,players:this.playerObject(),scores:game.scores,
      theme:game.theme,state:{slots:game.slots,complete:game.complete},poses,cubes:game.cubes,
      cubeOwners:game.cubeOwners,physicsHostId:game.physicsHostId,cubeSeq:Number(game.cubeSeq)||0}));
    await this.broadcastPresence(game);
    await this.broadcast({type:"physics-host",playerId:game.physicsHostId});
    return new Response(null,{status:101,webSocket:client});
  }
  async webSocketMessage(ws,message){
    let data;try{data=JSON.parse(typeof message==="string"?message:new TextDecoder().decode(message));}catch{return;}
    const a=ws.deserializeAttachment()||{},playerId=a.playerId,name=a.name||"SPELARE";
    let game=(await this.ctx.storage.get("game"))||this.emptyGame();game.scores=game.scores||{};
    game.scores[playerId]||={name,score:0};game.scores[playerId].name=name;game.cubeOwners=game.cubeOwners||{};

    if(data.type==="pose"&&data.pose){
      ws.serializeAttachment({...a,latestPose:data.pose});await this.touch(game,false);
      await this.broadcastExcept(ws,{type:"pose",playerId,playerName:name,pose:data.pose});return;
    }
    if(data.type==="cube-sync"&&playerId===game.physicsHostId&&Array.isArray(data.cubes)){
      game.cubeSeq=(Number(game.cubeSeq)||0)+1;
      game.cubes=data.cubes.slice(0,260);
      await this.touch(game,false);
      await this.broadcastExcept(ws,{type:"cube-sync",seq:game.cubeSeq,cubes:game.cubes});
      return;
    }
    if(data.type==="claim-cube"){
      const cubeId=String(data.cubeId||"").slice(0,20),now=Date.now(),current=game.cubeOwners[cubeId];
      if(!cubeId)return;
      if(!current||current.ownerId===playerId||now>=Number(current.protectedUntil||0)){
        const oldOwner=current?.ownerId||"";
        game.cubeOwners[cubeId]={ownerId:playerId,protectedUntil:now+3000};
        await this.touch(game,true);
        if(oldOwner&&oldOwner!==playerId)await this.sendTo(oldOwner,{type:"cube-owner",cubeId,ownerId:playerId});
        await this.sendTo(playerId,{type:"claim-granted",cubeId,hand:data.hand==="left"?"left":"right"});
        await this.broadcast({type:"cube-owner",cubeId,ownerId:playerId,protectedUntil:now+3000});
      }else await this.sendTo(playerId,{type:"claim-denied",cubeId,remaining:current.protectedUntil-now});
      return;
    }
    if(data.type==="release-cube"){
      const cubeId=String(data.cubeId||"").slice(0,20),current=game.cubeOwners[cubeId];
      if(current?.ownerId===playerId){delete game.cubeOwners[cubeId];await this.touch(game,true);await this.broadcast({type:"cube-owner",cubeId,ownerId:""});}
      return;
    }
    if(data.type==="freeze-attempt"){
      const now=Date.now();
      const readyAt=Number(game.freezeCooldowns[playerId]||0);
      if(now<readyAt){
        await this.sendTo(playerId,{type:"freeze-denied",remaining:readyAt-now});
        return;
      }

      game.freezeCooldowns[playerId]=now+60000;
      const targetId=String(data.targetId||"");
      await this.touch(game,true);
      await this.sendTo(playerId,{type:"freeze-ready",readyAt:now+60000});

      if(targetId&&targetId!==playerId&&this.players.has(targetId)){
        // Frysning påverkar endast spelarens rigg och kontroller.
        // Fysikvärden fortsätter köra kubfysiken i sin separata loop.
        await this.broadcast({type:"freeze",targetId,by:playerId,duration:10000});
      }
      return;
    }
    if(data.type==="state"&&data.state){
      const oldComplete=new Set(game.complete||[]);
      const oldLocked=new Set((game.slots||[]).filter(s=>s?.locked===true).map(s=>`${s.wordkey}:${s.index}`));
      const nextSlots=Array.isArray(data.state.slots)?data.state.slots.slice(0,300):game.slots;
      const nextComplete=Array.isArray(data.state.complete)?[...new Set(data.state.complete.filter(v=>typeof v==="string"))]:[];
      let newLetters=0;
      const placedCubeIds=new Set();
      for(const slot of nextSlots){
        if(!slot)continue;
        if(slot.filled===true&&slot.cube){
          placedCubeIds.add(slot.cube);
          if(game.cubeOwners[slot.cube])delete game.cubeOwners[slot.cube];
        }
        if(slot.locked!==true)continue;
        const key=`${slot.wordkey}:${slot.index}`;
        if(!oldLocked.has(key))newLetters++;
      }
      const newly=nextComplete.filter(k=>!oldComplete.has(k));
      game.scores[playerId].score+=newLetters+newly.length*10;game.slots=nextSlots;game.complete=nextComplete;
      await this.touch(game,true);
      await this.broadcast({type:"state",players:this.playerObject(),scores:game.scores,state:{slots:game.slots,complete:game.complete}});
      for(const cubeId of placedCubeIds){
        await this.broadcast({type:"cube-owner",cubeId,ownerId:"",placed:true});
      }
      const labels=new Map((Array.isArray(data.state.completedWords)?data.state.completedWords:[]).filter(i=>i&&typeof i.key==="string").map(i=>[i.key,String(i.word||"").slice(0,24)]));
      for(const key of newly)await this.broadcast({type:"celebration",playerId,playerName:name,word:labels.get(key)||"WORD"});
      return;
    }
    if(data.type==="reset"){
      const theme=cleanTheme(data.theme||game.theme),scores={};for(const[id,p]of this.players)scores[id]={name:p.name,score:0};
      game=this.emptyGame(theme);game.scores=scores;await this.touch(game,true);
      await this.broadcast({type:"reset",players:this.playerObject(),scores,theme});return;
    }
  }
  async webSocketClose(ws){
    const a=ws.deserializeAttachment()||{};if(a.playerId)this.players.delete(a.playerId);
    const game=(await this.ctx.storage.get("game"))||this.emptyGame();
    for(const[cubeId,owner]of Object.entries(game.cubeOwners||{}))if(owner.ownerId===a.playerId)delete game.cubeOwners[cubeId];
    if(game.physicsHostId===a.playerId||!this.activePlayerIds().includes(game.physicsHostId)){
      game.physicsHostId=this.chooseHost(a.playerId);
    }
    await this.touch(game,true);
    await this.broadcastPresence(game);
    await this.broadcast({type:"physics-host",playerId:game.physicsHostId});
  }
  async webSocketError(ws){await this.webSocketClose(ws);}
  cleanName(v){return String(v||"").toUpperCase().replace(/[^A-ZÅÄÖ0-9_-]/g,"").slice(0,12);}
  playerObject(){return Object.fromEntries(this.players.entries());}
  async sendTo(id,payload){const text=JSON.stringify(payload);for(const ws of this.ctx.getWebSockets()){const a=ws.deserializeAttachment()||{};if(a.playerId===id){try{ws.send(text);}catch{}return;}}}
  async broadcastPresence(game){await this.broadcast({type:"presence",players:this.playerObject(),scores:game.scores||{}});}
  async broadcastExcept(sender,payload){const text=JSON.stringify(payload);for(const ws of this.ctx.getWebSockets()){if(ws===sender)continue;try{ws.send(text);}catch{}}}
  async broadcast(payload){const text=JSON.stringify(payload);for(const ws of this.ctx.getWebSockets()){try{ws.send(text);}catch{}}}
}
