/**
 * CloudCord Backend (Cloudflare Worker)
 * Handles:
 * 1. Global Fake Profiles Synchronization (/api/profiles)
 * 2. Live Installs Counter (/api/installs)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // CORS Headers for the desktop client and website to access it
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ----------------------------------------------------
    // LIVE INSTALLS API (/api/installs)
    // ----------------------------------------------------
    if (request.method === "GET" && url.pathname === "/api/installs") {
      try {
        const storedCount = await env.PROFILES.get("live_installs_count");
        const count = Number(storedCount);
        if (!Number.isSafeInteger(count) || count < 0) {
          return new Response(JSON.stringify({ error: "Verified install count unavailable" }), {
            status: 503,
            headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        }

        return new Response(JSON.stringify({ count, verified: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Verified install count unavailable" }), {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
    }

    // ----------------------------------------------------
    // PROFILES API (/api/profiles)
    // ----------------------------------------------------
    if (request.method === "GET" && url.pathname === "/api/profiles") {
      try {
        const { keys } = await env.PROFILES.list();
        const profiles = {};
        
        for (const key of keys) {
          if (key.name === "live_installs_count") continue;
          const data = await env.PROFILES.get(key.name);
          if (data) {
            profiles[key.name] = JSON.parse(data);
          }
        }
        
        return new Response(JSON.stringify(profiles), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Failed to fetch profiles" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/profiles/")) {
      const userId = url.pathname.split("/").pop();
      
      if (!userId || userId.length < 15) {
        return new Response(JSON.stringify({ error: "Invalid User ID" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      try {
        const body = await request.json();
        const allowedData = {
          username: body.username,
          globalName: body.globalName,
          avatar: body.avatar,
          banner: body.banner,
          bio: body.bio,
          accentColor: body.accentColor,
          accentColor2: body.accentColor2,
          pronouns: body.pronouns,
          badgeFlags: body.badgeFlags,
          nitro: body.nitro,
          nitroLevel: body.nitroLevel,
          nitroSince: body.nitroSince,
          boostMonths: body.boostMonths,
          giftLevel: body.giftLevel,
          customBadgeIds: body.customBadgeIds,
          oldName: body.oldName,
          decorationAsset: body.decorationAsset
        };

        await env.PROFILES.put(userId, JSON.stringify(allowedData));

        return new Response(JSON.stringify({ success: true, message: "Profile saved globally!" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Invalid JSON or server error" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};
