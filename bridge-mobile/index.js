const API="https://getcloudcord.com";
const NITRO=["Nitro","Nitro Bronze","Nitro Silver","Nitro Gold","Nitro Platinum","Nitro Diamond","Nitro Emerald","Nitro Ruby","Nitro Opal"];
const GIFT=["Gifting Patron","Gifting Champion","Gifting Luminary","Gifting Icon","Gifting Hero","Gifting Legend"];
let timer;
const state={profile:null,userId:null};
async function pull(){if(!state.userId)return;try{const r=await fetch(`${API}/v1/profiles/user/${state.userId}?v=${Date.now()}`);if(r.ok){const j=await r.json();state.profile=j.profile||j;globalThis.__CLOUDCORD_BRIDGE_PROFILE__=state.profile;}}catch{}}
const plugin={manifest:{id:"com.cloudcord.bridge",version:"0.1.0",type:"plugin",spec:3,main:"",display:{name:"CloudCord Bridge",description:"Fake Profile, BotCord and basic badge sync",authors:[{name:"xohus"}]}},start(context={}){state.userId=String(context.userId||globalThis.__CLOUDCORD_USER_ID__||"");globalThis.CloudCordBridge={api:API,state,nitroNames:NITRO,giftingNames:GIFT,setUserId(id){state.userId=String(id);pull();},pull};pull();timer=setInterval(pull,15000);},stop(){if(timer)clearInterval(timer);timer=null;delete globalThis.CloudCordBridge;}};
if(typeof module!=="undefined")module.exports=plugin;
export default plugin;
