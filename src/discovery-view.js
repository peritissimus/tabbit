(async function initDiscoveryView() {
  const {keys, messages} = window.TabbitContracts;
  const FEED = keys.feed, BUILD = keys.feedBuild, PREFS = keys.feedPreferences, FEEDBACK = keys.feedFeedback;
  const $ = id => document.getElementById(id);
  const escape = value => String(value || "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
  const normalize = window.TabbitOrganizer.normalizeUrlForDuplicate;
  const state = { feed:null, build:null, prefs:{}, feedback:{}, filter:"all", expanded:false };
  const thumb = down => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${down ? ' style="transform:rotate(180deg)"' : ""}><path d="M7 10v10H3V10h4Zm0 0 5-7c2 0 3 2 2 4l-1 3h6a2 2 0 0 1 2 2l-2 7a2 2 0 0 1-2 1H7"/></svg>`;
  const running = () => state.build?.status === "running";
  function age(timestamp) {
    if (!Number.isFinite(timestamp)) return "";
    const hours=Math.max(0,Math.floor((Date.now()-timestamp)/3600000));
    return hours===0 ? "Updated just now" : hours<24 ? `Updated ${hours}h ago` : `Updated ${Math.floor(hours/24)}d ago`;
  }
  function voteButtons() {
    for (const button of document.querySelectorAll("[data-feed-vote]")) {
      if(Number(button.dataset.feedVote)===0){button.removeAttribute("aria-pressed");continue;}
      button.setAttribute("aria-pressed",String(state.feedback[normalize(button.dataset.feedUrl)]?.vote === Number(button.dataset.feedVote)));
    }
  }
  function render() {
    window.TabbitBuildTiming.render($("feedTiming"), state.build);
    const status=running() ? ({choosing:"Choosing sources…",reading:"Reading sources…",curating:"Picking the best…"}[state.build.phase] || "Building…") : age(state.feed?.createdAt);
    $("feedStatus").textContent=status;
    $("feedStatus").classList.toggle("is-processing", running());
    $("feedItems").setAttribute("aria-busy", String(running()));
    $("feedRefresh").disabled=running();
    $("feedRefresh").textContent=state.feed ? "Refresh" : "Build feed";
    $("feedMessage").textContent=state.build?.status==="failed" ? state.build.error : running() ? "You can close this tab. Your feed keeps building in the background." : !state.feed ? "Build once to discover news and products from your browsing. Uses the AI access chosen in Settings; Tune feed explains what is sent." : "";
    const items=Array.isArray(state.feed?.items) ? state.feed.items : [];
    const seen=Object.values(state.feedback).filter(i=>[1,-1].includes(i.vote)).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
    $("feedFilters").hidden=!items.length&&!seen.length;
    document.querySelectorAll("[data-feed-filter]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.feedFilter===state.filter)));
    let filtered=state.filter==="seen" ? seen : items.filter(i=>![1,-1].includes(state.feedback[normalize(i.url)]?.vote) && (state.filter==="all" || (state.filter==="labs" ? Boolean(i.lab) : i.kind===state.filter)));
    const shown=state.expanded ? filtered : filtered.slice(0,4);
    $("feedItems").innerHTML=shown.map(item=>{
      const posted=item.publishedAt && Number.isFinite(Date.parse(item.publishedAt)) ? `Posted ${new Date(item.publishedAt).toLocaleDateString(undefined,{month:"short",day:"numeric"})}` : "Date not provided";
      const traction=Number.isFinite(item.score) ? ` · ${item.score} HN points` : "";
      return `<article class="feed-card"><div class="feed-meta"><span class="feed-kind">${item.lab ? "Lab announcement" : item.kind==="product" ? "Product" : "News"}</span><span>${escape(item.source)}</span>${item.impact?.score >= 28 && item.impact?.confidence === "reported" ? '<span class="feed-impact">High impact</span>' : ""}</div><a class="feed-story" href="${escape(item.url)}" target="_blank" rel="noopener noreferrer"><h3>${escape(item.title)}</h3><p>${escape(item.summary)}</p></a><p class="feed-reason">${item.impact?.why ? `<span class="feed-why-label">Why it matters</span> ${escape(item.impact.why)}` : escape(item.reason)}</p><div class="feed-card-footer"><span class="feed-date">${escape(posted+traction)}</span><div class="feed-votes" aria-label="Feedback">${state.filter==="seen" ? `<span class="feed-rating">${item.vote===1 ? "Liked" : "Disliked"}</span><button type="button" data-feed-vote="0" data-feed-url="${escape(item.url)}" aria-label="Undo rating for ${escape(item.title)}">Undo</button>` : `<button type="button" data-feed-vote="1" data-feed-url="${escape(item.url)}" aria-label="More like ${escape(item.title)}" aria-pressed="false" title="More like this">${thumb(false)}</button><button type="button" data-feed-vote="-1" data-feed-url="${escape(item.url)}" aria-label="Less like ${escape(item.title)}" aria-pressed="false" title="Less like this">${thumb(true)}</button>`}</div></div></article>`;
    }).join("") || (running() && !state.feed ? Array.from({length:2}, () => '<div class="feed-card" aria-hidden="true"><div class="loading-lines"><span></span><span></span><span></span></div></div>').join("") : state.feed ? `<p class="feed-empty">${state.filter==='seen' ? 'Nothing seen yet. Like or dislike a story to move it here.' : 'No unseen picks here. Check Seen or refresh for more.'}</p>` : "");
    voteButtons();
    $("feedMore").hidden=filtered.length<=4;
    $("feedMore").textContent=state.expanded ? "Show fewer" : `More picks · ${filtered.length-4}`;
    $("feedSources").hidden=!state.feed;
    $("feedSourceList").innerHTML=(state.feed?.sources || []).map(source=>`<p><a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.title)}</a><span>${source.ok ? "Read" : `Unavailable · ${escape(source.error)}`}</span></p>`).join("");
  }
  async function load() {
    const saved=await chrome.storage.local.get([FEED,BUILD,PREFS,FEEDBACK]);
    state.feed=saved[FEED] || null; state.build=saved[BUILD] || null; state.prefs=saved[PREFS] || {}; state.feedback=saved[FEEDBACK] || {};
    render();
  }
  async function refresh() {
    $("feedRefresh").disabled=true;
    $("feedStatus").textContent="Starting…";
    try {
      const result=await chrome.runtime.sendMessage({type:messages.buildFeed});
      if (result?.error) throw new Error(result.error);
      if (result?.ok !== true) throw new Error("The background worker didn't start the feed. Reload Tabbit in chrome://extensions and try again.");
      await load();
    } catch(error) { $("feedMessage").textContent=error.message; $("feedRefresh").disabled=false; }
  }
  $("feedRefresh").addEventListener("click",refresh);
  $("feedMore").addEventListener("click",()=>{state.expanded=!state.expanded;render();});
  $("feedFilters").addEventListener("click",event=>{
    const b=event.target.closest("[data-feed-filter]"); if (!b) return;
    state.filter=b.dataset.feedFilter; state.expanded=false; render();
  });
  $("feedItems").addEventListener("click",async event=>{
    const b=event.target.closest("[data-feed-vote]"); if (!b) return;
    const buttons=[...b.closest('.feed-votes').querySelectorAll('button')];
    buttons.forEach(button=>button.disabled=true);
    try {
      const result=await chrome.runtime.sendMessage({type:messages.feedFeedback,url:b.dataset.feedUrl,vote:Number(b.dataset.feedVote)});
      if (!result?.ok) throw new Error(result?.error || "Could not save feedback. Reload Tabbit and try again.");
      const undo=Number(b.dataset.feedVote)===0;
      if(undo){state.filter="all";state.expanded=false;}
      await load();
      $("feedMessage").textContent=undo ? "Rating undone. The story is back in your feed." : "Moved to Seen. Your rating guides future picks; undo it there.";
      document.querySelector(`[data-feed-filter="${undo ? 'all' : 'seen'}"]`)?.focus();
    } catch(error) { $("feedMessage").textContent=error.message; }
    finally { buttons.forEach(button=>button.disabled=false); }
  });
  $("feedSettingsButton").addEventListener("click",()=>{
    $("feedInstructions").value=state.prefs.instructions || "";
    $("feedAutoRefresh").checked=state.prefs.autoRefresh!==false;
    $("feedFeedbackCount").textContent=`${Object.keys(state.feedback).length} rated items`;
    $("feedSettingsError").textContent=""; $("feedDialog").showModal();
  });
  const close=()=>{if (!$("feedSave").disabled) $("feedDialog").close();};
  $("feedClose").addEventListener("click",close); $("feedCancel").addEventListener("click",close);
  $("feedDialog").addEventListener("cancel",event=>{if ($("feedSave").disabled) event.preventDefault();});
  $("feedForm").addEventListener("submit",async event=>{
    event.preventDefault(); $("feedSave").disabled=true;
    try {
      const result=await chrome.runtime.sendMessage({type:messages.feedPreferences,instructions:$("feedInstructions").value,autoRefresh:$("feedAutoRefresh").checked});
      if (result?.error) throw new Error(result.error);
      const saved=await chrome.storage.local.get(PREFS); state.prefs=saved[PREFS] || {};
      $("feedDialog").close(); $("feedMessage").textContent="Instructions saved. Refresh to apply them.";
    } catch(error) { $("feedSettingsError").textContent=error.message; }
    finally { $("feedSave").disabled=false; }
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if (area!=="local") return;
    if (changes[FEEDBACK]) { state.feedback=changes[FEEDBACK].newValue || {}; render(); }
    if (changes[PREFS]) state.prefs=changes[PREFS].newValue || {};
    if (changes[FEED] || changes[BUILD]) {
      if (changes[FEED]) state.feed=changes[FEED].newValue || null;
      if (changes[BUILD]) state.build=changes[BUILD].newValue || null;
      render();
    }
  });
  // The search shortcut should not steal input from this editor.
  $("feedInstructions").addEventListener("keydown",event=>event.stopPropagation());
  try { await load(); } catch(error) { $("feedMessage").textContent="Couldn't load the saved feed. Reload to try again."; console.error(error); }
})();
