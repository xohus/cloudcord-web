'use strict';
const express = require('express');
const SERVICES = new Set(['steam','youtube','roblox','github','twitch','spotify','reddit','x']);
const HOSTS = {steam:['steamcommunity.com'],youtube:['youtube.com','www.youtube.com'],roblox:['roblox.com','www.roblox.com'],github:['github.com'],twitch:['twitch.tv','www.twitch.tv'],spotify:['open.spotify.com'],reddit:['reddit.com','www.reddit.com'],x:['x.com','twitter.com']};
function accountIdentity(service,input) {
    if(!SERVICES.has(service)) throw new Error('Unsupported service. You can enter this connection manually.');
    let value=String(input||'').trim();
    if(!value||value.length>2048) throw new Error('Enter an account link, username or ID.');
    if(/^https?:\/\//i.test(value)) {
        if(/(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(value)) throw new Error('Use a direct account profile link.');
        const url=new URL(value);
        if(url.protocol!=='https:'||url.username||url.password||url.port||!HOSTS[service].includes(url.hostname)) throw new Error('Use an HTTPS account link from the selected service.');
        value=decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g,'');
    }
    value=value.replace(/^@/,'');
    if(service==='steam') {const match=value.match(/^(?:(profiles|id)\/)?([A-Za-z0-9_-]{1,100})$/);if(!match)throw new Error('Use a Steam profile ID or vanity account link.');return {kind:match[1]||(/^\d{17}$/.test(match[2])?'profiles':'id'),id:match[2]};}
    if(service==='roblox') {const match=value.match(/^(?:users\/)?(\d{1,20})(?:\/profile)?$/);if(match)return {id:match[1]};if(!/^[A-Za-z0-9_]{3,20}$/.test(value))throw new Error('Use a Roblox username or user profile link.');return {username:value};}
    if(service==='youtube') {const match=value.match(/^(?:(channel|user)\/)?(@?[A-Za-z0-9_.-]{1,100})$/);if(!match)throw new Error('Use a YouTube channel link or handle.');return {kind:match[1]||'handle',id:match[2].replace(/^@/,'')};}
    if(service==='reddit') value=value.replace(/^(?:user|u)\//,'');
    if(!/^[A-Za-z0-9_.-]{1,100}$/.test(value)) throw new Error('Use an account username or profile link.');
    return {id:value};
}
function plain(value) {return String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();}
function xmlValue(xml,key) {return plain(xml.match(new RegExp(`<${key}\\b[^>]*>([\\s\\S]*?)<\\/${key}>`))?.[1]);}
function findObjects(root,key,limit=30) {
    const found=[],queue=[root];let visited=0;
    while(queue.length&&found.length<limit&&visited++<50000){const value=queue.pop();if(!value||typeof value!=='object')continue;if(value[key])found.push(value[key]);for(const child of Object.values(value))if(child&&typeof child==='object')queue.push(child);}
    return found;
}
function youtubeData(html) {
    const match=/\bytInitialData\s*=\s*/g.exec(html);if(!match)return null;
    const start=match.index+match[0].length;let depth=0,string=false,escape=false;
    for(let i=start;i<html.length;i++){const c=html[i];if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;}else{if(c==='"')string=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){try{return JSON.parse(html.slice(start,i+1));}catch{return null;}}}}
    return null;
}
function makeConnectionService({fetchImpl=fetch,steamKey=process.env.STEAM_API_KEY||''}={}) {
    async function read(url,options={}) {
        // URLs are constructed below from validated identifiers, never fetched verbatim from a user.
        const response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(10000),headers:{'User-Agent':'CloudCord-Public-Preview/1.0',...options.headers}});
        if(!response.ok)throw new Error(response.status===404?'Public account was not found.':'This service could not provide public information. Try again later or customize manually.');
        const length=Number(response.headers.get('content-length')||0);if(length>3*1024*1024)throw new Error('Public response is too large.');
        const chunks=[];let bytes=0;
        if(response.body){for await(const chunk of response.body){bytes+=chunk.length;if(bytes>3*1024*1024)throw new Error('Public response is too large.');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks).toString('utf8');}
        const text=await response.text();if(Buffer.byteLength(text)>3*1024*1024)throw new Error('Public response is too large.');return text;
    }
    const json=async(url,options)=>JSON.parse(await read(url,options));
    async function lookup(service,input) {
        const identity=accountIdentity(service,input);
        const base={service,accountId:identity.id||'',username:'',displayName:'',avatar:'',banner:'',bio:'',url:'',details:[],items:[],mode:'fetched',fetchedAt:new Date().toISOString()};
        if(service==='steam') {
            const xml=await read(`https://steamcommunity.com/${identity.kind}/${encodeURIComponent(identity.id)}/?xml=1`);
            const id=xmlValue(xml,'steamID64'),name=xmlValue(xml,'steamID');if(!/^\d{17}$/.test(id)||!name)throw new Error('Steam public profile information is unavailable or private.');
            Object.assign(base,{accountId:id,username:name,displayName:name,avatar:xmlValue(xml,'avatarFull'),bio:xmlValue(xml,'summary').slice(0,1000),url:`https://steamcommunity.com/profiles/${id}`,details:[{label:'Visibility',value:xmlValue(xml,'privacyState')||'Public information only'},{label:'Status',value:xmlValue(xml,'stateMessage')}]});
            if(steamKey){try{const owned=await json(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(steamKey)}&steamid=${id}&include_appinfo=1&include_played_free_games=1`);base.items=(owned.response?.games||[]).slice(0,30).map(game=>({id:String(game.appid),title:game.name||String(game.appid),image:game.img_icon_url?`https://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_icon_url}.jpg`:'',url:`https://store.steampowered.com/app/${game.appid}`,subtitle:`${Math.round((game.playtime_forever||0)/60)} hours played`}));}catch{base.details.push({label:'Games',value:'Private or unavailable. You can choose games manually.'});}}
            else base.details.push({label:'Games',value:'Automatic library import is not configured. Search and choose games manually.'});
            return base;
        }
        if(service==='roblox') {
            let id=identity.id;if(!id){const result=await json('https://users.roblox.com/v1/usernames/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({usernames:[identity.username],excludeBannedUsers:false})});id=String(result.data?.[0]?.id||'');}
            if(!/^\d+$/.test(id))throw new Error('Roblox account was not found.');
            const user=await json(`https://users.roblox.com/v1/users/${id}`);Object.assign(base,{accountId:id,username:user.name,displayName:user.displayName||user.name,bio:user.description||'',url:`https://www.roblox.com/users/${id}/profile`,details:[{label:'Joined',value:String(user.created||'')}]});
            try{const image=await json(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${id}&size=150x150&format=Png&isCircular=false`);base.avatar=image.data?.[0]?.imageUrl||'';}catch{}
            try{const games=await json(`https://games.roblox.com/v2/users/${id}/games?accessFilter=Public&limit=10&sortOrder=Desc`);base.items=(games.data||[]).map(game=>({id:String(game.id),title:game.name,image:'',url:`https://www.roblox.com/games/${game.rootPlace?.id||''}`,subtitle:'Public experience'}));}catch{}
            return base;
        }
        if(service==='github') {
            const user=await json(`https://api.github.com/users/${encodeURIComponent(identity.id)}`);
            Object.assign(base,{accountId:String(user.id),username:user.login,displayName:user.name||user.login,avatar:user.avatar_url,bio:user.bio||'',url:user.html_url,details:[{label:'Public repositories',value:String(user.public_repos)},{label:'Followers',value:String(user.followers)}]});
            try{
                const repos=await json(`https://api.github.com/users/${encodeURIComponent(identity.id)}/repos?type=owner&sort=updated&per_page=30`);
                base.items=repos.filter(repo=>!repo.private).slice(0,30).map(repo=>({id:String(repo.id),title:repo.full_name||repo.name,image:repo.owner?.avatar_url||'',url:repo.html_url,subtitle:String(repo.description||'').slice(0,200)}));
            }catch{base.details.push({label:'Repository previews',value:'Unavailable. You can choose public repositories manually.'});}
            return base;
        }
        if(service==='youtube') {
            const url=`https://www.youtube.com/${identity.kind==='handle'?'@'+encodeURIComponent(identity.id):identity.kind+'/'+encodeURIComponent(identity.id)}`;
            const data=youtubeData(await read(url));const metadata=findObjects(data,'channelMetadataRenderer',1)[0];if(!metadata?.title)throw new Error('YouTube public channel information is unavailable. Try its full channel link or customize manually.');
            const pictures=metadata.avatar?.thumbnails||[];const header=findObjects(data,'c4TabbedHeaderRenderer',1)[0];const banners=header?.banner?.thumbnails||[];
            const handle=String(metadata.vanityChannelUrl||'').match(/\/@([^/?#]+)/)?.[1]||(identity.kind==='handle'?identity.id:'');
            return {...base,accountId:metadata.externalId||identity.id,username:handle?'@'+handle:'',displayName:metadata.title,avatar:pictures.at(-1)?.url||'',banner:banners.at(-1)?.url||'',bio:metadata.description||'',url:metadata.channelUrl||url,items:findObjects(data,'videoRenderer',20).map(video=>({id:video.videoId,title:video.title?.runs?.map(run=>run.text).join('')||video.title?.simpleText||'',image:video.thumbnail?.thumbnails?.at(-1)?.url||'',url:`https://www.youtube.com/watch?v=${video.videoId}`,subtitle:video.viewCountText?.simpleText||''}))};
        }
        throw new Error('Automatic public fetching is not available for this service yet. You can customize its preview manually.');
    }
    async function search(service,query) {
        const term=String(query||'').trim();if(!term)return [];
        if(term.length>2048)throw new Error('Enter a shorter search or content link.');
        if(service==='github'){
            let repository=term;
            if(/^https?:\/\//i.test(term)){
                const url=new URL(term);
                if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||url.port)throw new Error('Paste a GitHub repository link or owner/repository.');
                repository=url.pathname.replace(/^\/+|\/+$/g,'');
            }
            const match=repository.match(/^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100})$/);
            if(!match||['.','..'].includes(match[2]))throw new Error('Paste a GitHub repository link or owner/repository.');
            const repo=await json(`https://api.github.com/repos/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`);
            if(repo.private)throw new Error('Public account was not found.');
            return [{id:String(repo.id),title:repo.full_name||repository,image:repo.owner?.avatar_url||'',url:`https://github.com/${match[1]}/${match[2]}`,subtitle:String(repo.description||'').slice(0,200)}];
        }
        if(service==='steam'){const result=await json(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`);return(result.items||[]).filter(item=>item.type==='app').slice(0,20).map(item=>({id:String(item.id),title:item.name,image:item.tiny_image||'',url:`https://store.steampowered.com/app/${item.id}`,subtitle:'Selected game · custom preview'}));}
        if(service==='roblox'){
            let universe=term;
            if(/^https:\/\//i.test(term)){
                const url=new URL(term),match=url.pathname.match(/^\/games\/(\d{1,20})(?:\/[^/]*)?\/?$/);
                if(!HOSTS.roblox.includes(url.hostname)||url.protocol!=='https:'||url.username||url.password||url.port||!match)throw new Error('Paste a Roblox game link or universe ID.');
                const resolved=await json(`https://apis.roblox.com/universes/v1/places/${match[1]}/universe`);
                universe=String(resolved.universeId||'');
            }
            if(!/^\d{1,20}$/.test(universe))throw new Error('Paste a Roblox game link or universe ID.');
            const result=await json(`https://games.roblox.com/v1/games?universeIds=${universe}`);
            const items=(result.data||[]).map(game=>({id:String(game.id),title:game.name,image:'',url:`https://www.roblox.com/games/${game.rootPlaceId}`,subtitle:'Selected experience · custom preview'}));
            try{const images=await json(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universe}&size=150x150&format=Png&isCircular=false`);for(const item of items)item.image=images.data?.find(image=>String(image.targetId)===item.id)?.imageUrl||'';}catch{}
            return items;
        }
        if(service==='youtube'){
            if(!/^https?:\/\//i.test(term)){
                const data=youtubeData(await read(`https://www.youtube.com/results?search_query=${encodeURIComponent(term.slice(0,200))}`));
                if(!data)throw new Error('YouTube public search is unavailable. Paste a video link or add content manually.');
                return findObjects(data,'videoRenderer',20).filter(video=>/^[A-Za-z0-9_-]{11}$/.test(video.videoId||'')).map(video=>({id:video.videoId,title:video.title?.runs?.map(run=>run.text).join('')||video.title?.simpleText||'',image:video.thumbnail?.thumbnails?.at(-1)?.url||'',url:`https://www.youtube.com/watch?v=${video.videoId}`,subtitle:video.ownerText?.runs?.map(run=>run.text).join('')||video.viewCountText?.simpleText||''}));
            }
            let url;try{url=new URL(term);}catch{throw new Error('Paste a YouTube video link to choose a video.');}
            if(!['www.youtube.com','youtube.com','youtu.be'].includes(url.hostname)||url.protocol!=='https:'||url.username||url.password||url.port)throw new Error('Paste a YouTube video link to choose a video.');
            const id=url.hostname==='youtu.be'?url.pathname.slice(1):url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)\/?$/)?.[1];
            if(!/^[A-Za-z0-9_-]{11}$/.test(id||''))throw new Error('Paste a YouTube video link to choose a video.');
            const canonical=`https://www.youtube.com/watch?v=${id}`;
            const result=await json(`https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`);
            return[{id,title:result.title,image:result.thumbnail_url||'',url:canonical,subtitle:result.author_name||''}];
        }
        throw new Error(service==='roblox'?'Enter a Roblox universe ID to choose an experience.':'Search is unavailable for this service; add a custom item manually.');
    }
    // Share public requests across viewers, without caching failures or retaining unbounded data.
    const cache=new Map(),pending=new Map();
    let cacheBytes=0;
    function dropCached(key){const stored=cache.get(key);if(stored)cacheBytes-=stored.bytes;cache.delete(key);}
    function cached(operation,name) {
        return async(service,input)=>{
            const query=String(input||'').trim();
            if(query.length>2048)throw new Error('Enter a shorter account link or search.');
            const key=JSON.stringify([name,service,query]);
            const entry=cache.get(key);
            if(entry&&entry.expires>Date.now())return structuredClone(entry.value);
            dropCached(key);
            let request=pending.get(key);
            if(!request){
                if(pending.size>=32)throw new Error('This service could not provide public information. Try again later or customize manually.');
                request=Promise.resolve().then(()=>operation(service,query)).then(value=>{
                    const bytes=Buffer.byteLength(JSON.stringify(value));
                    for(const [storedKey,stored] of cache)if(stored.expires<=Date.now())dropCached(storedKey);
                    if(bytes<=8*1024*1024){
                        while(cache.size>=200||cacheBytes+bytes>8*1024*1024)dropCached(cache.keys().next().value);
                        cache.set(key,{value:structuredClone(value),bytes,expires:Date.now()+60000});
                        cacheBytes+=bytes;
                    }
                    return value;
                }).finally(()=>pending.delete(key));
                pending.set(key,request);
            }
            return structuredClone(await request);
        };
    }
    return {lookup:cached(lookup,'lookup'),search:cached(search,'search')};
}
function makeCustomConnectionsRouter(options) {
    const router=express.Router(),service=makeConnectionService(options);
    const handler=operation=>async(req,res)=>{try{const result=await operation(String(req.query.service||''),String(req.query.query||req.query.account||''));res.set('Cache-Control','no-store').json({result});}catch(error){
        // Do not expose raw provider payloads, request URLs, credentials or internal errors.
        const message=String(error?.message||'');
        const safe=/^(?:Unsupported service\.|Enter |Use |Steam public |Roblox account |Paste |YouTube public |Automatic public |Search is unavailable|Public account was not found\.|Public response is too large\.|This service could not provide)/.test(message)&&!(error instanceof SyntaxError||error instanceof TypeError);
        res.status(400).json({error:safe?message:'The public service did not respond. Try again or customize manually.'});
    }};
    router.get('/lookup',handler(service.lookup));router.get('/search',handler(service.search));return router;
}
module.exports={makeCustomConnectionsRouter,makeConnectionService,accountIdentity,youtubeData};
