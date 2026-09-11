(()=>{
const API="https://getcloudcord.com";
const NITRO=["Nitro","Nitro Bronze","Nitro Silver","Nitro Gold","Nitro Platinum","Nitro Diamond","Nitro Emerald","Nitro Ruby","Nitro Opal"];
const GIFT=["Gifting Patron","Gifting Champion","Gifting Luminary","Gifting Icon","Gifting Hero","Gifting Legend"];
let timer=null;
const state={profile:null,userId:null};
const getUserId=()=>{try{return String(vendetta.metro.findByProps("getCurrentUser")?.getCurrentUser?.()?.id||"")}catch{return ""}};
async function pull(){state.userId=state.userId||getUserId();if(!state.userId)return;try{const response=await fetch(`${API}/v1/profiles/user/${state.userId}?v=${Date.now()}`,{cache:"no-store"});if(response.ok){const payload=await response.json();state.profile=payload.profile||payload;globalThis.__CLOUDCORD_BRIDGE_PROFILE__=state.profile;}}catch{}}
return{onLoad(){state.userId=getUserId();globalThis.CloudCordBridge={api:API,state,nitroNames:NITRO,giftingNames:GIFT,setUserId(id){state.userId=String(id);pull()},pull};pull();timer=setInterval(pull,15000)},onUnload(){if(timer)clearInterval(timer);timer=null;delete globalThis.CloudCordBridge;delete globalThis.__CLOUDCORD_BRIDGE_PROFILE__},settings:null};
})()
