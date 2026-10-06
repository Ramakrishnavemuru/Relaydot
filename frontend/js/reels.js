/* Dedicated Reel experience. Video and social data remain owned by the existing API. */
(() => {
  if (!Auth.requireAuth()) return;
  const shape = children => ['svg',{xmlns:'http://www.w3.org/2000/svg',width:24,height:24,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.8,'stroke-linecap':'round','stroke-linejoin':'round'},children];
  Object.assign(window.RelayIcons,{
    play:shape([['polygon',{points:'6 3 20 12 6 21 6 3'}]]),
    pause:shape([['rect',{x:5,y:3,width:5,height:18}],['rect',{x:14,y:3,width:5,height:18}]]),
    heart:shape([['path',{d:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z'}]]),
    bookmark:shape([['path',{d:'M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v18l-7-5-7 5z'}]]),
    'volume-2':shape([['polygon',{points:'11 5 6 9 2 9 2 15 6 15 11 19 11 5'}],['path',{d:'M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14'}]]),
    'volume-x':shape([['polygon',{points:'11 5 6 9 2 9 2 15 6 15 11 19 11 5'}],['path',{d:'m17 9 5 6m0-6-5 6'}]]),
    'chevron-up':shape([['path',{d:'m18 15-6-6-6 6'}]]),
    maximize:shape([['path',{d:'M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3'}]])
  });
  const $ = selector => document.querySelector(selector);
  const esc = value => Utils.escapeHTML(String(value ?? ''));
  const icon = key => AppUI.icon(key);
  const state = {items:[],index:0,offset:0,next:null,mode:'for_you',query:'',loading:false,
    muted:localStorage.getItem('relay-reels-muted') !== 'false',user:Auth.getCurrentUser(),
    replyTo:null,commentOffset:0,watchedMs:0,playStarted:null,lastNav:0,objectUrl:null,
    recordedFile:null,mediaStream:null,recorder:null};
  const current = () => state.items[state.index];
  const toast = (text,kind='success') => Utils.showToast(text,kind);
  const media = path => API.resolveUrl(path);
  const avatar = user => AppUI.avatarUrl(user?.avatar_url,user?.display_name || user?.username);
  const link = reel => new URL(`reels.html?id=${encodeURIComponent(reel.public_id)}`,location.href).href;
  const caption = text => esc(text).replace(/#([A-Za-z0-9_]{1,50})\b/g,
    (_,tag)=>`<a href="reels.html?q=${encodeURIComponent('#'+tag)}">#${tag}</a>`).replace(/@([A-Za-z0-9_]{3,30})\b/g,
    (_,name)=>`<a href="social.html?view=search&q=${encodeURIComponent(name)}">@${name}</a>`);
  const empty = (title,detail,action='') => `<div class="reel-empty">${icon('play')}<h2>${esc(title)}</h2><p>${esc(detail)}</p>${action}</div>`;
  const controls = reel => `<div class="reel-actions">
    <button data-action="like" aria-label="${reel.liked?'Unlike':'Like'} Reel" class="${reel.liked?'active':''}"><span>${icon('heart')}</span><span>${reel.likes_count}</span></button>
    <button data-action="comments" aria-label="Comments"><span>${icon('message')}</span><span>${reel.comments_count}</span></button>
    <button data-action="share" aria-label="Share Reel"><span>${icon('forward')}</span><span>${reel.shares_count}</span></button>
    <button data-action="bookmark" aria-label="${reel.bookmarked?'Remove saved Reel':'Save Reel'}" class="${reel.bookmarked?'active':''}"><span>${icon('bookmark')}</span><span>Save</span></button>
    <button data-action="more" aria-label="More Reel options"><span>${icon('more')}</span></button>
  </div>`;
  const updateButtons = () => { const reel=current(); if(!reel)return; const actions=$('.reel-actions'); if(actions)actions.outerHTML=controls(reel); };
  const pause = () => { const video=$('#active-reel-video'); if(video)video.pause(); if(state.playStarted){state.watchedMs+=performance.now()-state.playStarted;state.playStarted=null;} };
  const recordView = () => { const reel=current(); const watched=state.watchedMs+(state.playStarted?performance.now()-state.playStarted:0);
    if(!reel||reel.status!=='PUBLISHED'||watched<3000)return;
    const sessionKey=`relay-reel-session-${reel.public_id}`;
    let sessionId=sessionStorage.getItem(sessionKey);
    if(!sessionId){sessionId=crypto.randomUUID();sessionStorage.setItem(sessionKey,sessionId);}
    API.post(`/reels/${reel.public_id}/view`,{session_id:sessionId,watched_ms:Math.round(Math.min(watched,180000)),
      completed:!!$('#active-reel-video')?.ended}).catch(()=>{});
  };
  const refreshCurrent = async () => { const reel=current(); if(!reel)return; try { state.items[state.index]=await API.get(`/reels/${reel.public_id}`); updateButtons(); } catch {} };
  const render = () => { const reel=current(); const host=$('#reel-content');
    $('#previous-reel').disabled=state.index===0;
    $('#next-reel').disabled=state.index===state.items.length-1&&state.next===null;
    if(!reel){host.innerHTML=empty(state.query?'No matching Reels':'No Reels yet',
      state.mode==='following'?'Follow creators to see their videos here.':'Be the first to share a moment.',
      '<button class="btn btn-primary" data-action="create">Create a Reel</button>');return;}
    history.replaceState(null,'',`reels.html?id=${encodeURIComponent(reel.public_id)}`);
    if(!['PUBLISHED','READY'].includes(reel.status)){
      host.innerHTML=empty(reel.status==='FAILED'?'Processing failed':reel.status==='READY'?'Your draft is ready':'Your Reel is processing',
        reel.error || 'We’ll make it available as soon as it is ready.',
        `<button class="btn btn-primary" data-action="manage">Manage Reel</button>`);return;
    }
    host.innerHTML=`${reel.thumbnail_url?`<div class="reel-placeholder" id="reel-placeholder"><img src="${esc(media(reel.thumbnail_url))}" alt=""></div>`:''}
      <video id="active-reel-video" playsinline autoplay muted preload="auto" poster="${esc(media(reel.thumbnail_url))}" src="${esc(media(reel.video_url))}" aria-label="Reel by ${esc(reel.creator.username)}"></video>
      <div class="reel-gradient"></div><div class="reel-topline"><span>${reel.status==='READY'?'DRAFT':'REEL'} · ${Math.round(reel.duration||0)}s</span><div><button data-action="fullscreen" aria-label="Fullscreen">${icon('maximize')}</button> <button data-action="mute" aria-label="${state.muted?'Unmute':'Mute'}">${icon(state.muted?'volume-x':'volume-2')}</button></div></div>
      <button class="reel-player-button" data-action="play" aria-label="Play or pause">${icon('pause')}</button>
      ${reel.status==='READY'?`<div class="reel-actions"><button data-action="manage" aria-label="Manage draft"><span>${icon('edit')}</span><span>Edit</span></button></div>`:controls(reel)}<div class="reel-caption"><div class="reel-creator"><img src="${esc(avatar(reel.creator))}" alt=""><a href="social.html?view=profile&id=${reel.creator_id}">@${esc(reel.creator.username)}</a>
      ${reel.creator_id!==state.user?.id?`<button data-action="follow">${reel.following?'Following':'Follow'}</button>`:''}</div><p>${caption(reel.caption)}</p></div>
      <div class="reel-progress" role="slider" tabindex="0" aria-label="Playback progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>`;
    const video=$('#active-reel-video'); video.muted=state.muted;
    video.onplay=()=>{state.playStarted=performance.now();$('#reel-placeholder')?.remove();$('.reel-player-button').innerHTML=icon('pause');};
    video.onpause=()=>{if(state.playStarted){state.watchedMs+=performance.now()-state.playStarted;state.playStarted=null;}$('.reel-player-button').innerHTML=icon('play');};
    video.onended=()=>{recordView();next();};
    video.ontimeupdate=()=>{const value=video.duration?Math.round(video.currentTime/video.duration*100):0;
      $('.reel-progress span').style.width=`${value}%`;$('.reel-progress').setAttribute('aria-valuenow',String(value));
      if(state.watchedMs+(state.playStarted?performance.now()-state.playStarted:0)>3000&&!video.dataset.viewed){video.dataset.viewed='true';recordView();}};
    video.onerror=()=>{toast('Video could not load. Try again.','error');const button=$('.reel-player-button');
      button.dataset.action='retry-video';button.setAttribute('aria-label','Retry video');button.style.opacity='1';button.innerHTML=icon('refresh');};
    video.play().catch(()=>{video.muted=true;state.muted=true;video.play().catch(()=>{});});
    if(reel.thumbnail_url){const nextReel=state.items[state.index+1];if(nextReel?.thumbnail_url){const image=new Image();image.src=media(nextReel.thumbnail_url);}}
    $('#reel-comments').classList.add('hidden');
  };
  const load = async (reset=false) => { if(state.loading)return; state.loading=true;
    if(reset){pause();recordView();state.items=[];state.index=0;state.offset=0;state.next=null;state.watchedMs=0;state.playStarted=null;
      $('#reel-content').innerHTML=empty('Loading Reels','Finding something worth watching…');}
    try { const data=await API.get('/reels',{mode:state.mode,q:state.query,offset:state.offset,limit:8});
      const known=new Set(state.items.map(r=>r.public_id));state.items.push(...data.items.filter(r=>!known.has(r.public_id)));
      state.next=data.next_offset;state.offset=data.next_offset??state.offset;
      if(reset)render();
    } catch(error){if(reset)$('#reel-content').innerHTML=empty('Reels unavailable',error.message,
      '<button class="btn btn-secondary" data-action="retry">Try again</button>');}
    finally{state.loading=false;}
  };
  const move=async delta=>{if(performance.now()-state.lastNav<400)return;state.lastNav=performance.now();
    const target=state.index+delta;if(target<0)return;
    if(target>=state.items.length){if(state.next!==null){await load();if(target>=state.items.length)return;}else return;}
    pause();recordView();state.index=target;state.watchedMs=0;state.playStarted=null;render();
    if(state.items.length-state.index<=2&&state.next!==null)load();
  };
  const next=()=>move(1);
  const dialog=(title,html)=>{pause();$('#reel-dialog-title').textContent=title;$('#reel-dialog-body').innerHTML=html;
    $('#reel-dialog').classList.remove('hidden');$('.reels-shell').inert=true;AppUI.decorate($('#reel-dialog'));
    $('#reel-dialog').querySelector('input,textarea,button')?.focus();};
  const closeDialog=()=>{if(state.uploadRequest){state.uploadRequest.abort();state.uploadRequest=null;}
    if(state.recorder?.state==='recording')state.recorder.stop();
    state.mediaStream?.getTracks().forEach(track=>track.stop());state.mediaStream=null;state.recorder=null;state.recordedFile=null;
    if(state.objectUrl){URL.revokeObjectURL(state.objectUrl);state.objectUrl=null;}
    $('#reel-dialog').classList.add('hidden');$('.reels-shell').inert=false;$('#active-reel-video')?.play().catch(()=>{});};
  const composer=()=>{state.recordedFile=null;dialog('Create Reel',`<form id="reel-create-form" class="reel-form">
      <label>Choose a video <input name="video" type="file" accept="video/mp4,video/webm"></label>
      <div class="actions"><button class="btn btn-secondary" type="button" data-action="record">Record video</button><button class="btn btn-secondary hidden" type="button" data-action="stop-record">Stop recording</button></div>
      <p class="hint">MP4 or WebM · up to 60 MB · 1–180 seconds. We optimize your video and choose a cover frame.</p>
      <div id="reel-upload-preview"></div><label>Caption <textarea name="caption" maxlength="2200" placeholder="Tell the story. Add #topics and @people."></textarea></label>
      <label>Who can watch? <select name="visibility"><option value="EVERYONE">Everyone</option><option value="FOLLOWERS">Followers</option><option value="FRIENDS">Mutual follows</option><option value="ONLY_ME">Only me</option></select></label>
      <label><input type="checkbox" name="allow_comments" checked> Allow comments</label>
      <label><input type="checkbox" name="allow_download"> Allow downloads</label>
      <progress id="reel-upload-progress" value="0" max="100" class="hidden"></progress><p id="reel-upload-status" class="hint" role="status"></p>
      <div class="actions"><button class="btn btn-secondary" type="submit" name="intent" value="draft">Save draft</button><button class="btn btn-primary" type="submit" name="intent" value="publish">Publish Reel</button></div>
    </form>`);};
  const upload=(formData,progress)=>new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();state.uploadRequest=xhr;xhr.open('POST',`${CONFIG.API_BASE_URL}/reels`);
    xhr.setRequestHeader('Authorization',`Bearer ${API.getToken()}`);xhr.upload.onprogress=e=>{if(e.lengthComputable)progress(Math.round(e.loaded/e.total*100));};
    xhr.onload=()=>{state.uploadRequest=null;let body={};try{body=JSON.parse(xhr.responseText);}catch{}if(xhr.status>=200&&xhr.status<300)resolve(body);
      else reject(Error(body.detail||'Upload failed. Please try again.'));};xhr.onerror=()=>{state.uploadRequest=null;reject(Error('Upload failed. Check your connection and retry.'));};xhr.onabort=()=>reject(Error('Upload cancelled.'));xhr.send(formData);});
  const loadComments=async (append=false)=>{const reel=current();if(!reel)return;const list=$('#reel-comment-list');
    if(!append){state.commentOffset=0;list.textContent='Loading comments…';}
    try{const data=await API.get(`/reels/${reel.public_id}/comments`,{offset:state.commentOffset,limit:20});
      if(!append)list.innerHTML='';else list.querySelector('.load-comments')?.remove();
      if(!data.items.length&&!append)list.innerHTML='<p>No comments yet. Start the conversation.</p>';
      data.items.forEach(c=>list.insertAdjacentHTML('beforeend',`<article class="reel-comment ${c.parent_id?'reply':''}" data-comment="${c.id}">
        <div class="reel-comment-head"><img src="${esc(avatar(c.author))}" alt=""><b>@${esc(c.author.username)}</b>${c.pinned?'<small>📌 Pinned by creator</small>':''}<small>${new Date(c.created_at).toLocaleDateString()}</small></div>
        <p>${esc(c.content)}</p><div class="reel-comment-actions"><button data-action="reply-comment" data-id="${c.id}" data-name="${esc(c.author.username)}">Reply</button>
        <button data-action="like-comment" data-id="${c.id}" data-liked="${c.liked}">${c.liked?'Unlike':'Like'} · ${c.likes_count}</button>
        ${reel.creator_id===state.user?.id&&!c.parent_id?`<button data-action="${c.pinned?'unpin-comment':'pin-comment'}" data-id="${c.id}">${c.pinned?'Unpin':'Pin'}</button>`:''}
        ${c.author.id===state.user?.id||reel.creator_id===state.user?.id?`<button data-action="delete-comment" data-id="${c.id}">Delete</button>`:`<button data-action="report-comment" data-id="${c.id}">Report</button>`}</div></article>`));
      state.commentOffset=data.next_offset??state.commentOffset+data.items.length;
      if(data.next_offset!==null)list.insertAdjacentHTML('beforeend','<button class="btn btn-secondary load-comments" data-action="more-comments">Load more</button>');
    }catch(error){list.textContent=error.message;}};
  const share=async()=>{const reel=current();dialog('Share Reel','<div class="reel-list">Loading chats…</div>');
    try{const chats=await API.get('/conversations');$('#reel-dialog-body').innerHTML=`<div class="reel-list">
      <button data-action="copy">Copy Reel link</button><button data-action="repost">Share to social feed</button>
      <p>Send to a chat or group</p>${chats.map(c=>`<button data-action="send-chat" data-conversation="${c.id}">${esc(c.name||c.other_user?.display_name||c.other_user?.username||'Conversation')}</button>`).join('')||'<p>Start a chat to share this Reel.</p>'}</div>`;
    }catch(error){$('#reel-dialog-body').textContent=error.message;}};
  const manage=async()=>{const reel=current();let analytics=null;try{analytics=await API.get(`/reels/${reel.public_id}/analytics`);}catch{}
    dialog('Manage Reel',`<div class="reel-list"><p>${esc(reel.status)} · ${reel.views_count||0} views</p>
      ${analytics?`<p>${analytics.likes} likes · ${analytics.comments} comments · ${analytics.saves} saves · ${Math.round(analytics.average_watch_ms/1000)}s avg watch</p>`:''}
      <button data-action="edit">Edit caption and privacy</button>${reel.video_url?'<button data-action="choose-cover">Choose cover frame</button>':''}${reel.status==='READY'?'<button data-action="publish">Publish draft</button>':''}
      ${reel.status==='PUBLISHED'?'<button data-action="archive">Archive Reel</button>':''}${reel.status==='ARCHIVED'?'<button data-action="restore">Restore Reel</button>':''}
      <button data-action="delete">Delete Reel</button></div>`);};
  const edit=()=>{const reel=current();dialog('Edit Reel',`<form id="reel-edit-form" class="reel-form"><label>Caption<textarea name="caption" maxlength="2200">${esc(reel.caption)}</textarea></label>
      <label>Visibility<select name="visibility">${['EVERYONE','FOLLOWERS','FRIENDS','ONLY_ME'].map(v=>`<option value="${v}" ${v===reel.visibility?'selected':''}>${v.replace('_',' ')}</option>`).join('')}</select></label>
      <label><input type="checkbox" name="allow_comments" ${reel.allow_comments?'checked':''}> Allow comments</label>
      <label><input type="checkbox" name="allow_download" ${reel.allow_download?'checked':''}> Allow downloads</label>
      <button class="btn btn-primary" type="submit">Save changes</button></form>`);};
  document.addEventListener('click',async event=>{const button=event.target.closest('[data-action]');if(!button)return;
    const action=button.dataset.action,reel=current();button.disabled=true;
    try{if(action==='create')return composer();if(action==='retry')return load(true);
      if(action==='record'){
        if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('Recording is unavailable in this browser. Choose a video file instead.');
        const type=['video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(value=>MediaRecorder.isTypeSupported(value));
        if(!type)throw Error('This browser cannot record a supported Reel format.');
        const stream=await navigator.mediaDevices.getUserMedia({video:{aspectRatio:9/16},audio:true});state.mediaStream=stream;
        const recorder=new MediaRecorder(stream,{mimeType:type});state.recorder=recorder;const chunks=[];
        recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
        recorder.onstop=()=>{stream.getTracks().forEach(track=>track.stop());state.mediaStream=null;
          if(state.recorder!==recorder||$('#reel-dialog').classList.contains('hidden'))return;
          const ext=type.startsWith('video/mp4')?'mp4':'webm';state.recordedFile=new File(chunks,`recorded-reel.${ext}`,{type:ext==='mp4'?'video/mp4':'video/webm'});
          if(state.objectUrl)URL.revokeObjectURL(state.objectUrl);state.objectUrl=URL.createObjectURL(state.recordedFile);
          $('#reel-upload-preview').innerHTML=`<video controls muted playsinline src="${esc(state.objectUrl)}"></video>`;
          $('#reel-upload-status').textContent='Recording ready. Add a caption and publish.';};
        recorder.start();button.classList.add('hidden');$('#reel-create-form [data-action="stop-record"]').classList.remove('hidden');
        $('#reel-upload-status').textContent='Recording…';return;
      }
      if(action==='stop-record'){if(state.recorder?.state==='recording')state.recorder.stop();button.classList.add('hidden');$('#reel-create-form [data-action="record"]').classList.remove('hidden');return;}
      if(!reel)return;
      if(action==='like'){state.items[state.index]=reel.liked?await API.delete(`/reels/${reel.public_id}/like`):await API.post(`/reels/${reel.public_id}/like`,{});updateButtons();}
      if(action==='bookmark'){state.items[state.index]=reel.bookmarked?await API.delete(`/reels/${reel.public_id}/bookmark`):await API.post(`/reels/${reel.public_id}/bookmark`,{});updateButtons();toast(reel.bookmarked?'Removed from saved':'Reel saved');}
      if(action==='comments'){if(!reel.allow_comments){toast('Comments are disabled','info');return;}$('#reel-comments').classList.remove('hidden');loadComments();}
      if(action==='share')await share();
      if(action==='more')dialog('Reel options',`<div class="reel-list"><button data-action="copy">Copy link</button>${reel.creator_id===state.user?.id?'<button data-action="manage">Manage Reel</button>':'<button data-action="report">Report Reel</button><button data-action="not-interested">Not interested</button>'}${reel.allow_download?'<button data-action="download">Download Reel</button>':''}</div>`);
      if(action==='play'){const video=$('#active-reel-video');if(video?.paused)video.play();else video?.pause();}
      if(action==='retry-video'){state.items[state.index]=await API.get(`/reels/${reel.public_id}`);render();}
      if(action==='mute'){state.muted=!state.muted;localStorage.setItem('relay-reels-muted',String(state.muted));$('#active-reel-video').muted=state.muted;button.innerHTML=icon(state.muted?'volume-x':'volume-2');button.setAttribute('aria-label',state.muted?'Unmute':'Mute');}
      if(action==='fullscreen')$('#reel-content').requestFullscreen?.();
      if(action==='follow'){if(reel.following)await API.delete(`/social/profiles/${reel.creator_id}/follow`);else await API.post(`/social/profiles/${reel.creator_id}/follow`,{});reel.following=!reel.following;button.textContent=reel.following?'Following':'Follow';}
      if(action==='copy'){await navigator.clipboard.writeText(link(reel));closeDialog();toast('Reel link copied');}
      if(action==='send-chat'){await API.post(`/reels/${reel.public_id}/share`,{conversation_id:Number(button.dataset.conversation)});closeDialog();toast('Sent to chat');refreshCurrent();}
      if(action==='repost'){await API.post('/social/posts',{content:`Watch this Reel by @${reel.creator.username}\n${link(reel)}`,visibility:'EVERYONE'});closeDialog();toast('Shared to your feed');}
      if(action==='not-interested'){closeDialog();next();}
      if(action==='report')dialog('Report Reel',`<form id="reel-report-form" class="reel-form"><label>Reason<select name="reason"><option value="spam">Spam</option><option value="harassment">Harassment</option><option value="inappropriate">Inappropriate content</option><option value="scam">Scam</option><option value="other">Other</option></select></label><label>Details<textarea name="details" maxlength="500"></textarea></label><button type="submit" class="btn btn-primary">Send report</button></form>`);
      if(action==='report-comment')dialog('Report comment',`<form id="reel-report-form" data-comment-id="${Number(button.dataset.id)}" class="reel-form"><label>Reason<select name="reason"><option value="spam">Spam</option><option value="harassment">Harassment</option><option value="inappropriate">Inappropriate content</option><option value="scam">Scam</option><option value="other">Other</option></select></label><label>Details<textarea name="details" maxlength="500"></textarea></label><button type="submit" class="btn btn-primary">Send report</button></form>`);
      if(action==='download'){const a=document.createElement('a');a.href=media(reel.video_url);a.download=`reel-${reel.public_id}.mp4`;a.click();closeDialog();}
      if(action==='manage')await manage();
      if(action==='edit')edit();
      if(action==='choose-cover')dialog('Choose cover',`<form id="reel-cover-form" class="reel-form"><img src="${esc(media(reel.thumbnail_url))}" alt="Current cover" style="max-width:180px;max-height:240px;margin:auto"><label>Frame at <span id="cover-time">0s</span><input type="range" name="time_seconds" min="0" max="${Math.max(0,Math.floor(reel.duration-0.2))}" value="0" step="0.5"></label><label>Or upload a cover image<input type="file" name="image" accept="image/png,image/jpeg,image/webp"></label><button class="btn btn-primary" type="submit">Save cover</button></form>`);
      if(action==='publish'){state.items[state.index]=await API.request(`/reels/${reel.public_id}`,{method:'PATCH',body:{publish:true}});closeDialog();render();toast('Reel published');}
      if(action==='archive'||action==='restore'){state.items[state.index]=await API.request(`/reels/${reel.public_id}`,{method:'PATCH',body:{archive:action==='archive'}});closeDialog();render();toast(action==='archive'?'Reel archived':'Reel restored');}
      if(action==='delete'){if(await AppUI.confirm({title:'Delete Reel?',description:'It will disappear from feeds and chats.',action:'Delete'})){await API.delete(`/reels/${reel.public_id}`);closeDialog();await load(true);toast('Reel deleted');}}
      if(action==='reply-comment'){state.replyTo=Number(button.dataset.id);$('#reel-comment-input').placeholder=`Reply to @${button.dataset.name}`;$('#reel-comment-input').focus();}
      if(action==='more-comments')loadComments(true);
      if(action==='like-comment'){const id=Number(button.dataset.id);if(button.dataset.liked==='true')await API.delete(`/reels/${reel.public_id}/comments/${id}/like`);else await API.post(`/reels/${reel.public_id}/comments/${id}/like`,{});loadComments();}
      if(action==='pin-comment'||action==='unpin-comment'){const path=`/reels/${reel.public_id}/comments/${Number(button.dataset.id)}/pin`;
        if(action==='pin-comment')await API.post(path,{});else await API.delete(path);loadComments();}
      if(action==='delete-comment'){if(await AppUI.confirm({title:'Delete comment?',description:'This comment will be removed.',action:'Delete'})){await API.delete(`/reels/${reel.public_id}/comments/${button.dataset.id}`);loadComments();refreshCurrent();}}
    }catch(error){toast(error.message,'error');}finally{if(button.isConnected)button.disabled=false;}});
  $('#reel-comment-form').onsubmit=async event=>{event.preventDefault();const reel=current(),input=$('#reel-comment-input');if(!reel||!input.value.trim())return;
    const button=event.target.querySelector('button');button.disabled=true;
    try{await API.post(`/reels/${reel.public_id}/comments`,{content:input.value.trim(),parent_id:state.replyTo});input.value='';state.replyTo=null;input.placeholder='Add a comment…';loadComments();refreshCurrent();}
    catch(error){toast(error.message,'error');}finally{button.disabled=false;}};
  document.addEventListener('submit',async event=>{const form=event.target;if(!['reel-create-form','reel-edit-form','reel-report-form','reel-cover-form'].includes(form.id))return;
    event.preventDefault();const reel=current(),submit=event.submitter||form.querySelector('[type=submit]');submit.disabled=true;
    try{if(form.id==='reel-create-form'){const fields=new FormData(form),file=state.recordedFile||fields.get('video');
        if(!file||!file.size||file.size>60*1024*1024||!['video/mp4','video/webm'].includes(file.type))throw Error('Choose an MP4 or WebM video up to 60 MB.');
        fields.set('video',file);
        fields.set('publish',String(submit.value!=='draft'));fields.set('allow_comments',String(fields.has('allow_comments')));fields.set('allow_download',String(fields.has('allow_download')));
        const progress=$('#reel-upload-progress'),status=$('#reel-upload-status');progress.classList.remove('hidden');status.textContent='Uploading…';
        const uploaded=await upload(fields,value=>{progress.value=value;status.textContent=`Uploading… ${value}%`;});
        status.textContent='Processing video and generating cover…';closeDialog();toast('Reel uploaded. Processing continues in the background.');
        state.mode='mine';document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode==='mine');b.setAttribute('aria-selected',String(b.dataset.mode==='mine'));});await load(true);
        if(uploaded.public_id){const at=state.items.findIndex(r=>r.public_id===uploaded.public_id);if(at>=0){state.index=at;render();}}}
      if(form.id==='reel-edit-form'){const fields=new FormData(form);state.items[state.index]=await API.request(`/reels/${reel.public_id}`,{method:'PATCH',body:{caption:fields.get('caption'),visibility:fields.get('visibility'),allow_comments:fields.has('allow_comments'),allow_download:fields.has('allow_download')}});closeDialog();render();toast('Reel updated');}
      if(form.id==='reel-report-form'){const fields=new FormData(form);const path=form.dataset.commentId?`/comments/${form.dataset.commentId}/report`:'/report';await API.request(`/reels/${reel.public_id}${path}`,{method:'POST',body:fields});closeDialog();toast('Report submitted');}
      if(form.id==='reel-cover-form'){const fields=new FormData(form);if(fields.get('image')?.size){if(fields.get('image').size>5*1024*1024)throw Error('Cover exceeds 5 MB.');state.items[state.index]=await API.request(`/reels/${reel.public_id}/cover-upload`,{method:'POST',body:fields});}
        else state.items[state.index]=await API.request(`/reels/${reel.public_id}/cover`,{method:'POST',body:fields});closeDialog();render();toast('Cover updated');}}
    catch(error){toast(error.message,'error');}finally{if(submit.isConnected)submit.disabled=false;}});
  $('#reel-dialog').onclick=event=>{if(event.target.id==='reel-dialog')closeDialog();};$('#close-reel-dialog').onclick=closeDialog;
  $('#close-comments').onclick=()=>$('#reel-comments').classList.add('hidden');
  $('#create-reel').onclick=composer;$('#mobile-create-reel').onclick=composer;
  $('#previous-reel').onclick=()=>move(-1);$('#next-reel').onclick=next;
  document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{state.mode=button.dataset.mode;state.query='';$('#reel-query').value='';
    document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-selected',String(b===button));});load(true);});
  $('#reel-search').onsubmit=event=>{event.preventDefault();state.query=$('#reel-query').value.trim();state.mode='new';load(true);};
  $('#reel-dialog').addEventListener('change',event=>{if(event.target.name==='video'){
    if(state.objectUrl)URL.revokeObjectURL(state.objectUrl);const file=event.target.files[0];if(!file)return;
    state.objectUrl=URL.createObjectURL(file);$('#reel-upload-preview').innerHTML=`<video controls muted playsinline src="${esc(state.objectUrl)}"></video>`;}});
  $('#reel-dialog').addEventListener('input',event=>{if(event.target.name==='time_seconds')$('#cover-time').textContent=`${event.target.value}s`;});
  $('#reel-content').addEventListener('dblclick',event=>{if(event.target.id==='active-reel-video'&&!current()?.liked)$('[data-action="like"]')?.click();});
  $('.reels-viewer').addEventListener('wheel',event=>{if(Math.abs(event.deltaY)<15||!$('#reel-dialog').classList.contains('hidden'))return;
    event.preventDefault();move(event.deltaY>0?1:-1);},{passive:false});
  let touchY=0;$('#reel-content').addEventListener('touchstart',event=>{touchY=event.touches[0].clientY;},{passive:true});
  $('#reel-content').addEventListener('touchend',event=>{const delta=touchY-event.changedTouches[0].clientY;if(Math.abs(delta)>60)move(delta>0?1:-1);},{passive:true});
  document.addEventListener('keydown',event=>{if(!$('#reel-dialog').classList.contains('hidden')){if(event.key==='Escape')closeDialog();return;}
    if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
    if(event.key==='ArrowDown'){event.preventDefault();next();}if(event.key==='ArrowUp'){event.preventDefault();move(-1);}
    if(event.key===' '){event.preventDefault();const video=$('#active-reel-video');if(video?.paused)video.play();else video?.pause();}
    if(event.key.toLowerCase()==='m'&&$('#active-reel-video'))$('[data-action="mute"]').click();
    if(event.key==='Escape')$('#reel-comments').classList.add('hidden');});
  $('#reel-content').addEventListener('click',event=>{if(event.target.closest('.reel-progress')){
    const bar=$('.reel-progress'),video=$('#active-reel-video');if(video?.duration)video.currentTime=(event.clientX-bar.getBoundingClientRect().left)/bar.clientWidth*video.duration;}});
  $('#reel-content').addEventListener('keydown',event=>{if(!event.target.matches('.reel-progress'))return;
    const video=$('#active-reel-video');if(!video?.duration)return;
    if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();video.currentTime=Math.max(0,Math.min(video.duration,video.currentTime+(event.key==='ArrowRight'?5:-5)));}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();recordView();}else $('#active-reel-video')?.play().catch(()=>{});});
  AppUI.decorate();WSClient.on('reel.ready',data=>{toast('Your Reel is ready');if(state.mode==='mine')load(true);});
  WSClient.on('reel.failed',data=>{toast(data.error||'Reel processing failed','error');if(state.mode==='mine')load(true);});
  WSClient.connect();
  (async()=>{try{state.user=await Auth.fetchMyProfile();}catch{}const params=new URLSearchParams(location.search);
    if(params.has('q')){$('#reel-query').value=params.get('q');state.query=params.get('q');state.mode='new';}
    if(params.has('id')||params.has('reel_id')){try{const reel=params.has('id')?await API.get(`/reels/${encodeURIComponent(params.get('id'))}`):await API.get(`/reels/id/${Number(params.get('reel_id'))}`);state.items=[reel];render();}catch(error){toast(error.message,'error');}}
    await load(!state.items.length);})();
})();
