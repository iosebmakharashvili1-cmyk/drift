const J=(o,s=200,h={})=>new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json',...h}});
const enc=new TextEncoder(),hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const sha=async s=>hex(await crypto.subtle.digest('SHA-256',enc.encode(s)));
async function hash(pw,salt){const k=await crypto.subtle.importKey('raw',enc.encode(pw),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode(salt),iterations:100000},k,256))}
const cookie=(r,k)=>(r.headers.get('cookie')||'').split(/;\s*/).map(c=>c.split('=')).find(c=>c[0]===k)?.[1];
async function me(req,env){const t=cookie(req,'sid');if(!t)return null;return env.DB.prepare('SELECT u.id,u.name FROM sessions s JOIN users u ON u.id=s.uid WHERE s.sid=? AND s.exp>?').bind(await sha(t),Date.now()).first()}
async function login(env,uid){const t=hex(crypto.getRandomValues(new Uint8Array(32)));await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await sha(t),uid,Date.now()+2592e6).run();return `sid=${t}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`}

// Spotify link import (client-credentials; needs SPOTIFY_ID / SPOTIFY_SECRET secrets)
let sp={t:'',exp:0};
async function spTok(env){if(sp.exp>Date.now())return sp.t;const r=await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{authorization:'Basic '+btoa(env.SPOTIFY_ID+':'+env.SPOTIFY_SECRET),'content-type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});const j=await r.json();sp={t:j.access_token,exp:Date.now()+(j.expires_in-60)*1000};return sp.t}
async function spGet(env,p){const r=await fetch(p.startsWith('http')?p:'https://api.spotify.com/v1'+p,{headers:{authorization:'Bearer '+await spTok(env)}});if(!r.ok)throw new Error('Spotify returned '+r.status);return r.json()}
async function imp(env,url){const m=url.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist)\/([A-Za-z0-9]+)/);if(!m)throw new Error('Unsupported link');if(!env.SPOTIFY_ID)throw new Error('Import is not configured on this server');const [,k,id]=m,tr=x=>({title:x.name,artist:x.artists[0].name,dur:Math.round((x.duration_ms||0)/1000)});
 if(k==='track'){const x=await spGet(env,'/tracks/'+id);return{name:x.name,tracks:[tr(x)]}}
 if(k==='album'){const x=await spGet(env,'/albums/'+id);return{name:x.name,tracks:x.tracks.items.map(tr)}}
 const x=await spGet(env,'/playlists/'+id+'?fields=name,tracks(items(track(name,duration_ms,artists(name))),next)');let it=x.tracks.items,n=x.tracks.next;while(n&&it.length<1000){const j=await spGet(env,n);it=it.concat(j.items);n=j.next}
 return{name:x.name,tracks:it.filter(i=>i.track).map(i=>tr(i.track)).slice(0,1000)}}

export default{async fetch(req,env){const u=new URL(req.url),p=u.pathname;
 if(!p.startsWith('/api/'))return new Response('Not found',{status:404});
 try{
 if(req.method!=='GET'&&!(req.headers.get('content-type')||'').includes('json'))return J({error:'Bad request'},400);
 const U=await me(req,env);
 if(p==='/api/me')return J({user:U});
 if(p==='/api/signup'||p==='/api/login'){const b=await req.json(),name=String(b.name||'').toLowerCase(),pw=String(b.password||'');
  if(!/^[a-z0-9_]{3,24}$/.test(name)||pw.length<8)return J({error:'Username: 3-24 chars (a-z, 0-9, _). Password: 8+ chars.'},400);
  if(p==='/api/signup'){const id=crypto.randomUUID(),salt=hex(crypto.getRandomValues(new Uint8Array(16)));
   try{await env.DB.prepare('INSERT INTO users VALUES(?,?,?,?,?)').bind(id,name,salt,await hash(pw,salt),Date.now()).run()}catch(e){return J({error:'Username taken'},409)}
   return J({user:{id,name}},200,{'set-cookie':await login(env,id)})}
  const r=await env.DB.prepare('SELECT * FROM users WHERE name=?').bind(name).first();
  if(!r||await hash(pw,r.salt)!==r.hash)return J({error:'Wrong username or password'},401);
  return J({user:{id:r.id,name}},200,{'set-cookie':await login(env,r.id)})}
 if(p==='/api/logout'){const t=cookie(req,'sid');if(t)await env.DB.prepare('DELETE FROM sessions WHERE sid=?').bind(await sha(t)).run();return J({user:null},200,{'set-cookie':'sid=; Max-Age=0; Path=/'})}
 if(p==='/api/lyrics'){const q=new URLSearchParams({track_name:u.searchParams.get('title')||'',artist_name:u.searchParams.get('artist')||''});const d=+u.searchParams.get('dur');if(d)q.set('duration',d);
  const r=await fetch('https://lrclib.net/api/get?'+q,{headers:{'user-agent':'Drift/1.0'},cf:{cacheTtl:86400,cacheEverything:true}});if(!r.ok)return J({synced:null});const j=await r.json();return J({synced:j.syncedLyrics||null,plain:j.plainLyrics||null})}
 if(!U)return J({error:'Log in first'},401);
 if(p==='/api/library'){if(req.method==='GET'){const r=await env.DB.prepare('SELECT data FROM lib WHERE uid=?').bind(U.id).first();return J({data:r?JSON.parse(r.data):null})}
  const t=await req.text();if(t.length>5e5)return J({error:'Too large'},413);JSON.parse(t);
  await env.DB.prepare('INSERT INTO lib VALUES(?,?,?) ON CONFLICT(uid) DO UPDATE SET data=excluded.data,updated=excluded.updated').bind(U.id,t,Date.now()).run();return J({ok:true})}
 if(p==='/api/e'&&req.method==='GET'){const k=u.searchParams.get('kind');if(!['gig','album','list'].includes(k))return J({error:'Bad kind'},400);
  const r=await env.DB.prepare(`SELECT id,artist,day,data FROM entries WHERE uid=? AND kind=? ORDER BY COALESCE(day,'') DESC,created DESC LIMIT 500`).bind(U.id,k).all(),items=r.results;
  if(k==='gig'){const o=await env.DB.prepare(`SELECT e.artist,e.day,u.name FROM entries e JOIN follows f ON f.followee=e.uid AND f.follower=? JOIN users u ON u.id=e.uid WHERE e.kind='gig' AND e.day IS NOT NULL LIMIT 3000`).bind(U.id).all();
   for(const g of items)g.others=g.day?[...new Set(o.results.filter(x=>x.artist===g.artist&&x.day===g.day).map(x=>x.name))].slice(0,10):[]}
  return J({items})}
 if(p==='/api/e'&&req.method==='POST'){const b=await req.json(),id=String(b.id||crypto.randomUUID()).slice(0,64),k=['gig','album','list'].includes(b.kind)?b.kind:null;if(!k)return J({error:'Bad kind'},400);
  const data=JSON.stringify(b.data||{});if(data.length>20000)return J({error:'Too large'},413);
  const ex=await env.DB.prepare('SELECT 1 x FROM entries WHERE id=? AND uid=?').bind(id,U.id).first(),c=await env.DB.prepare('SELECT COUNT(*) c FROM entries WHERE uid=? AND kind=?').bind(U.id,k).first();
  if(!ex&&c.c>=2000)return J({error:'Entry limit reached'},400);
  await env.DB.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET artist=excluded.artist,day=excluded.day,data=excluded.data WHERE entries.uid=excluded.uid').bind(id,U.id,k,String(b.artist||'').slice(0,200),/^\d{4}-\d\d-\d\d$/.test(b.day||'')?b.day:null,data,Date.now()).run();return J({id})}
 const dm=p.match(/^\/api\/e\/([\w-]{1,64})$/);if(dm&&req.method==='DELETE'){await env.DB.prepare('DELETE FROM entries WHERE id=? AND uid=?').bind(dm[1],U.id).run();return J({ok:true})}
 if(p==='/api/follow'&&req.method==='GET'){const r=await env.DB.prepare('SELECT u.name FROM follows f JOIN users u ON u.id=f.followee WHERE f.follower=?').bind(U.id).all();return J({names:r.results.map(x=>x.name)})}
 if(p==='/api/follow'||p==='/api/unfollow'){const b=await req.json(),t=await env.DB.prepare('SELECT id FROM users WHERE name=?').bind(String(b.name||'').toLowerCase()).first();if(!t||t.id===U.id)return J({error:'No such user'},404);
  if(p==='/api/follow'){const c=await env.DB.prepare('SELECT COUNT(*) c FROM follows WHERE follower=?').bind(U.id).first();if(c.c>=500)return J({error:'Follow limit reached'},400);await env.DB.prepare('INSERT OR IGNORE INTO follows VALUES(?,?)').bind(U.id,t.id).run()}
  else await env.DB.prepare('DELETE FROM follows WHERE follower=? AND followee=?').bind(U.id,t.id).run();return J({ok:true})}
 if(p==='/api/feed'){const r=await env.DB.prepare(`SELECT e.kind,e.artist,e.day,e.data,u.name FROM entries e JOIN follows f ON f.followee=e.uid AND f.follower=? JOIN users u ON u.id=e.uid WHERE e.kind IN ('gig','album') ORDER BY e.created DESC LIMIT 40`).bind(U.id).all();return J({items:r.results})}
 if(p==='/api/setlist'){if(!env.SETLISTFM_KEY)return J({error:'Setlist lookup is not configured on this server'},501);const q=new URLSearchParams({artistName:u.searchParams.get('artist')||'',p:'1'}),d=u.searchParams.get('date')||'';
  if(/^\d{4}-\d\d-\d\d$/.test(d)){const [y,mo,da]=d.split('-');q.set('date',`${da}-${mo}-${y}`)}
  const r=await fetch('https://api.setlist.fm/rest/1.0/search/setlists?'+q,{headers:{'x-api-key':env.SETLISTFM_KEY,accept:'application/json'}});if(!r.ok)return J({error:'No setlist found'},404);
  const j=await r.json(),s=(j.setlist||[]).find(x=>x.sets&&x.sets.set&&x.sets.set.some(t=>t.song&&t.song.length));if(!s)return J({error:'No setlist found'},404);
  return J({songs:s.sets.set.flatMap(t=>(t.song||[]).map(x=>x.name)).filter(Boolean)})}
 if(p==='/api/import'){const b=await req.json();return J(await imp(env,String(b.url||'')))}
 if(p==='/api/rooms'&&req.method==='POST'){const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',id=[...crypto.getRandomValues(new Uint8Array(6))].map(x=>A[x%A.length]).join('');
  await env.DB.prepare('INSERT INTO rooms VALUES(?,?,?)').bind(id,U.id,Date.now()).run();return J({id})}
 const w=p.match(/^\/api\/rooms\/([A-Z0-9]{6})\/ws$/);
 if(w){if(req.headers.get('origin')!==u.origin)return J({error:'Forbidden'},403);
  const room=await env.DB.prepare('SELECT host FROM rooms WHERE id=?').bind(w[1]).first();if(!room)return J({error:'No such room'},404);
  const h=new Headers(req.headers);h.set('x-role',room.host===U.id?'host':'guest');h.set('x-name',U.name);
  return env.ROOM.get(env.ROOM.idFromName(w[1])).fetch(new Request(req,{headers:h}))}
 return J({error:'Not found'},404);
 }catch(e){return J({error:e.message||'Server error'},500)}}};

// One Durable Object per listening room: host broadcasts playback state, guests follow. Cap: 50 listeners.
export class Room{constructor(s){this.s=s}
 async fetch(req){if(req.headers.get('upgrade')!=='websocket')return new Response('Expected websocket',{status:426});
  if(this.s.getWebSockets().length>=50)return new Response(JSON.stringify({error:'Room is full (50)'}),{status:403});
  const role=req.headers.get('x-role'),name=req.headers.get('x-name'),pair=new WebSocketPair(),sv=pair[1];
  this.s.acceptWebSocket(sv,[role,name]);sv.send(JSON.stringify({type:'hello',role}));
  const st=await this.s.storage.get('st');if(st)sv.send(JSON.stringify(st));this.n();
  return new Response(null,{status:101,webSocket:pair[0]})}
 bc(o){const t=JSON.stringify(o);for(const w of this.s.getWebSockets())try{w.send(t)}catch(e){}}
 n(skip){this.bc({type:'n',n:this.s.getWebSockets().filter(w=>w!==skip).length})}
 async webSocketMessage(ws,msg){if(typeof msg!=='string'||msg.length>2000)return;let m;try{m=JSON.parse(msg)}catch(e){return}
  const [role,name]=this.s.getTags(ws);
  if(m.type==='state'&&role==='host'){const st={type:'state',key:String(m.key).slice(0,300),pos:+m.pos||0,playing:!!m.playing,t:Date.now()};await this.s.storage.put('st',st);this.bc(st)}
  else if(m.type==='react')this.bc({type:'react',e:String(m.e).slice(0,4),name})}
 webSocketClose(ws){this.n(ws)}
 webSocketError(ws){this.n(ws)}}
