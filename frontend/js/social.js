/* Relay social workspace. The API owns all data; this file only renders it. */
(() => {
  if (!Auth.requireAuth()) return;
  const svg = children => ['svg',{'xmlns':'http://www.w3.org/2000/svg',width:24,height:24,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.8,'stroke-linecap':'round','stroke-linejoin':'round'},children];
  window.RelayIcons.heart = svg([['path',{d:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z'}]]);
  window.RelayIcons.bookmark = svg([['path',{d:'M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v18l-7-5-7 5z'}]]);
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = value => Utils.escapeHTML(String(value ?? ''));
  const icon = name => AppUI.icon(name);
  const base = 'social.html';
  const link = (view, id, extra = '') => `${base}?view=${encodeURIComponent(view)}${id == null ? '' : `&id=${encodeURIComponent(id)}`}${extra}`;
  const params = new URLSearchParams(location.search);
  const state = {view: params.get('view') || 'home', id: params.get('id'), mode: 'for_you', offset: 0,
    next: null, items: [], user: Auth.getCurrentUser(), activePost: null, previousFocus: null, searchTimer: null};
  const content = $('#social-content');
  const avatar = user => AppUI.avatarUrl(user?.avatar_url, user?.display_name || user?.username || 'Member');
  const parseTime = value => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
  const timeAgo = value => { const ms = Date.now() - parseTime(value).getTime(); const min = Math.max(0, Math.floor(ms / 60000)); return min < 1 ? 'now' : min < 60 ? `${min}m` : min < 1440 ? `${Math.floor(min / 60)}h` : `${Math.floor(min / 1440)}d`; };
  const message = (title, detail, type = 'empty') => `<div class="social-${type}">${icon(type === 'error' ? 'alert-circle' : 'messages')}<h2>${esc(title)}</h2><p>${esc(detail)}</p>${type === 'error' ? '<button class="btn btn-secondary" data-action="retry">Try again</button>' : ''}</div>`;
  const loading = () => '<div class="social-skeleton"></div><div class="social-skeleton"></div><div class="social-skeleton"></div>';
  const setTitle = (title, eyebrow = 'YOUR SPACE TO CONNECT') => { $('#social-title').textContent = title; $('#social-eyebrow').textContent = eyebrow; document.title = `${title} · Relay`; };
  const request = (endpoint, options) => API.request(`/social${endpoint}`, options);
  const get = (endpoint, query) => API.get(`/social${endpoint}`, query);
  const post = (endpoint, body) => API.post(`/social${endpoint}`, body);
  const patch = (endpoint, body) => request(endpoint, {method:'PATCH', body});
  const del = endpoint => API.delete(`/social${endpoint}`);
  const toast = (text, kind = 'success') => Utils.showToast(text, kind);
  const safeUrl = url => { try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : ''; } catch { return ''; } };
  const richText = text => {
    const re = /(https?:\/\/[^\s<>]+|#[A-Za-z0-9_]{1,50}\b|@[A-Za-z0-9_]{3,30}\b)/g;
    let out = '', from = 0;
    for (const m of String(text || '').matchAll(re)) {
      out += esc(text.slice(from, m.index)); const token = m[0];
      if (token[0] === '#') out += `<a href="${link('hashtag', token.slice(1).toLowerCase())}">${esc(token)}</a>`;
      else if (token[0] === '@') out += `<a href="${link('search', null, `&q=${encodeURIComponent(token.slice(1))}`)}">${esc(token)}</a>`;
      else { const url = safeUrl(token); out += url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(token)}</a>` : esc(token); }
      from = m.index + token.length;
    }
    return out + esc(String(text || '').slice(from));
  };
  const button = (label, action, id, iconName, active = false, count = '') => `<button type="button" data-action="${action}" data-id="${id}" class="${active ? 'active' : ''}" aria-label="${esc(label)}" title="${esc(label)}">${icon(iconName)}${count !== '' ? `<span>${esc(count)}</span>` : ''}</button>`;
  const poll = p => {
    if (!p.poll?.length) return '';
    const total = p.poll_total || 0;
    return `<div class="poll-box" aria-label="Poll">${p.poll.map(o => {
      const pct = total && o.votes !== null ? Math.round(o.votes * 100 / total) : 0;
      return `<button class="poll-option" type="button" data-action="vote" data-id="${p.id}" data-option="${o.id}" ${p.my_vote ? 'disabled' : ''}><span class="poll-fill" style="width:${p.my_vote ? pct : 0}%"></span><span>${esc(o.label)}</span>${p.my_vote ? `<span>${pct}%</span>` : ''}</button>`;
    }).join('')}<span class="poll-note">${p.poll_total === null ? 'Vote to see results' : `${total} ${total === 1 ? 'vote' : 'votes'}${p.my_vote ? ' · You voted' : ''}`}</span></div>`;
  };
  const postCard = (p, nested = false) => {
    const author = p.author || {};
    const name = author.display_name || author.username || 'Member';
    const media = p.media_url ? p.media_type === 'VIDEO'
      ? `<video class="post-media video" controls preload="metadata" src="${esc(API.resolveUrl(p.media_url))}"></video>`
      : `<img class="post-media" src="${esc(API.resolveUrl(p.media_url))}" alt="Post by ${esc(name)}" loading="lazy">` : '';
    const original = p.original ? `<a class="post-quote" href="${link('post', p.original.id)}"><strong>${esc(p.original.author?.display_name || p.original.author?.username)}</strong>${esc(p.original.content?.slice(0,180) || 'View shared post')}</a>` : p.quote_of_id || p.repost_of_id ? '<div class="post-quote">Original post unavailable</div>' : '';
    return `<article class="social-post" data-post="${p.id}">${p.repost_of_id ? `<div class="post-repost-label">${icon('refresh')} ${esc(name)} reposted</div>` : ''}<div class="post-head"><a href="${link('profile', p.author_id)}"><img class="post-avatar" src="${esc(avatar(author))}" alt=""></a><div class="post-author"><a href="${link('profile', p.author_id)}">${esc(name)}</a><small>@${esc(author.username)} · <a href="${link('post', p.id)}">${timeAgo(p.created_at)}</a>${p.edited_at ? ' · edited' : ''}</small></div>${p.community_id ? `<a class="post-context" href="${link('community', p.community_id)}">${esc(p.community_name)}</a>` : ''}${!nested ? button('More options', 'post-menu', p.id, 'more') : ''}</div><div class="post-body">${p.content ? `<div class="post-text">${richText(p.content)}</div>` : ''}${media}${poll(p)}${original}</div>${!nested ? `<div class="post-actions">${button('Comment', 'comment', p.id, 'message', false, p.comments_count)}${button(p.my_reaction ? 'Unlike' : 'Like', 'react', p.id, 'heart', !!p.my_reaction, p.likes_count)}${button('Repost', 'repost', p.id, 'refresh', false, p.reposts_count)}${button(p.bookmarked ? 'Remove bookmark' : 'Bookmark', 'bookmark', p.id, 'bookmark', p.bookmarked)}${button('Share', 'share', p.id, 'forward')}</div>` : ''}</article>`;
  };
  const updateCard = p => { const old = $(`[data-post="${p.id}"]`); if (old) { old.outerHTML = postCard(p); } };
  const cardList = items => items.length ? items.map(p => postCard(p)).join('') : message('No posts yet', 'The conversation starts when someone shares a thought.');
  const loadAside = async () => {
    try { const tags = await get('/trending'); $('#aside-trending').innerHTML = tags.length ? tags.map(t => `<a href="${link('hashtag', t.name)}">#${esc(t.name)}<small>${t.posts} recent posts</small></a>`).join('') : '<p>No trends yet. Start a conversation.</p>'; } catch { $('#aside-trending').textContent = 'Topics are unavailable right now.'; }
    try { const data = await get('/communities', {limit:4}); $('#aside-communities').innerHTML = data.items.length ? data.items.map(c => `<a href="${link('community', c.id)}">${esc(c.name)}<small>${c.member_count} members</small></a>`).join('') : '<p>No communities yet. Create the first one.</p>'; } catch { $('#aside-communities').textContent = 'Communities are unavailable right now.'; }
  };
  const feedTabs = () => `<div class="feed-tabs" role="tablist" aria-label="Feed"><button data-action="feed-mode" data-mode="for_you" role="tab" aria-selected="${state.mode === 'for_you'}" class="${state.mode === 'for_you' ? 'active' : ''}">For you</button><button data-action="feed-mode" data-mode="following" role="tab" aria-selected="${state.mode === 'following'}" class="${state.mode === 'following' ? 'active' : ''}">Following</button></div>`;
  const loadStories = async () => {
    try {
      const groups = await API.get('/stories');
      const strip = $('#home-stories');
      if (!strip) return;
      strip.innerHTML = `<button class="story-person" data-action="create-story" type="button"><img src="${esc(avatar(state.user))}" alt=""><span>Your story +</span></button>` + groups.filter(g => g.user_id !== state.user?.id).slice(0,12).map(g => `<button class="story-person ${g.all_viewed ? 'viewed' : ''}" data-action="story" data-id="${g.stories[0]?.id}" type="button"><img src="${esc(avatar(g))}" alt=""><span>${esc(g.display_name)}</span></button>`).join('');
      state.stories = groups;
    } catch { const strip = $('#home-stories'); if (strip) strip.innerHTML = '<span class="composer-hint">Stories are unavailable right now.</span>'; }
  };
  const reelTile = reel => `<a class="social-reel-tile" href="reels.html?id=${esc(reel.public_id)}"><img src="${esc(API.resolveUrl(reel.thumbnail_url))}" alt="${esc(reel.caption.slice(0,70) || 'Reel')}"><span>${icon('video')} @${esc(reel.creator.username)}</span></a>`;
  const loadHomeReels = async () => { const strip = $('#home-reels'); if (!strip) return;
    try { const data = await API.get('/reels',{mode:'for_you',limit:4});
      strip.innerHTML = data.items.length ? `<div class="social-reels-heading"><h2>Watch a little</h2><a href="reels.html">See all Reels ${icon('arrow-right')}</a></div><div class="social-reels-strip">${data.items.map(reelTile).join('')}</div>` : `<a class="social-reels-empty" href="reels.html">${icon('video')} Explore Reels <span>Short stories from your community</span></a>`;
    } catch { strip.innerHTML = ''; }
  };
  const renderHome = async (reset = true) => {
    setTitle('Home');
    if (reset) { state.offset = 0; state.items = []; content.innerHTML = `<div id="home-stories" class="story-strip"></div><div id="home-reels"></div><button class="social-composer-trigger" data-action="compose"><img src="${esc(avatar(state.user))}" alt=""><span>What's on your mind?</span>${icon('compose')}</button>${feedTabs()}<div id="feed-items">${loading()}</div>`; loadStories(); loadHomeReels(); }
    try {
      const result = await get('/feed', {mode:state.mode, offset:state.offset, limit:15});
      state.items.push(...result.items); state.next = result.next_offset;
      $('#feed-items').innerHTML = cardList(state.items) + (state.next !== null ? '<button class="load-more" data-action="load-more">Load more posts</button>' : '');
    } catch (error) { $('#feed-items').innerHTML = message('Feed unavailable', error.message, 'error'); }
  };
  const pagedPosts = async (endpoint, targetId, key, emptyTitle, emptyText, append = false) => {
    const target = $(`#${targetId}`); if (!target) return;
    const offset = append ? state[`${key}Offset`] : 0;
    if (!append) target.innerHTML = loading();
    try { const data = await get(endpoint,{limit:15,offset});
      if (append) target.querySelector('.load-more')?.remove(); else target.innerHTML = '';
      target.insertAdjacentHTML('beforeend', data.items.length ? data.items.map(postCard).join('') : append ? '' : message(emptyTitle,emptyText));
      state[`${key}Offset`] = data.next_offset;
      if (data.next_offset !== null) target.insertAdjacentHTML('beforeend', `<button class="load-more" data-action="${key}">Load more</button>`);
    } catch (e) { target.innerHTML = message('Could not load posts',e.message,'error'); }
  };
  const renderBookmarks = async () => { setTitle('Bookmarks', 'SAVED FOR LATER'); content.innerHTML = '<div id="bookmark-posts"></div>'; await pagedPosts('/bookmarks','bookmark-posts','more-bookmarks','No bookmarks yet','Save posts to revisit them here.'); };
  const renderPost = async () => {
    setTitle('Post', 'THE CONVERSATION'); content.innerHTML = loading();
    try {
      const p = await get(`/posts/${state.id}`); state.activePost = p;
      content.innerHTML = `<button class="detail-back" data-action="back">${icon('arrow-left')} Back</button>${postCard(p)}<div id="thread-items"></div><form id="comment-form" class="comment-form"><img src="${esc(avatar(state.user))}" alt=""><textarea name="content" maxlength="2000" required placeholder="Add to the conversation" aria-label="Write a comment"></textarea><button class="btn btn-primary" type="submit">Reply</button></form><div id="comments-list">${loading()}</div>`;
      get(`/posts/${p.thread_parent_id || p.id}/thread`).then(rows => { if (rows.length > 1 && $('#thread-items')) $('#thread-items').innerHTML = `<h2 class="search-section-title">Thread</h2>${rows.filter(item => item.id !== p.id).map(item => postCard(item)).join('')}`; }).catch(()=>{});
      await loadComments();
    } catch (e) { content.innerHTML = message('Post unavailable', e.message, 'error'); }
  };
  const loadComments = async (append = false) => {
    const target = $('#comments-list'); if (!target) return;
    const offset = append ? Number(target.dataset.offset || 0) : 0;
    try { const data = await get(`/posts/${state.id}/comments`, {offset,limit:20});
      const html = data.items.map(c => `<div class="comment-item ${c.parent_id ? 'reply' : ''}" data-comment="${c.id}"><div class="comment-item-head"><img src="${esc(avatar(c.author))}" alt=""><a href="${link('profile', c.author.id)}">${esc(c.author.display_name || c.author.username)}</a><small>@${esc(c.author.username)} · ${timeAgo(c.created_at)}</small></div><p>${richText(c.content)}</p><div class="comment-item-actions"><button data-action="reply-comment" data-id="${c.id}" data-name="${esc(c.author.username)}">Reply</button><button data-action="like-comment" data-id="${c.id}" aria-pressed="${c.liked}">${c.liked ? 'Liked' : 'Like'} · ${c.likes_count}</button>${c.author.id === state.user?.id ? `<button data-action="delete-comment" data-id="${c.id}">Delete</button>` : `<button data-action="report-comment" data-id="${c.id}">Report</button>`}</div></div>`).join('');
      if (append) target.querySelector('.load-more')?.remove(); else target.innerHTML = '';
      target.insertAdjacentHTML('beforeend', html || (!append ? message('No replies yet', 'Start the conversation.') : ''));
      if (data.next_offset !== null) target.insertAdjacentHTML('beforeend', '<button class="load-more" data-action="more-comments">Load more replies</button>');
      target.dataset.offset = data.next_offset ?? offset + data.items.length;
    } catch (e) { target.innerHTML = message('Replies unavailable', e.message, 'error'); }
  };
  const renderProfile = async () => {
    const id = state.id || state.user?.id; if (!id) return;
    content.innerHTML = loading();
    try { const p = await get(`/profiles/${id}`); state.profile = p; setTitle(p.id === state.user?.id ? 'Your profile' : p.display_name || p.username, 'PEOPLE ON RELAY');
      const own = p.id === state.user?.id;
      const cover = p.cover_url ? `style="background-image:url('${esc(API.resolveUrl(p.cover_url))}')"` : '';
      content.innerHTML = `<div class="social-profile-cover" ${cover}></div><div class="social-profile-info"><img src="${esc(avatar(p))}" alt=""><div class="profile-actions">${own ? `<a href="profile.html" class="btn btn-secondary">Edit profile</a>` : `<button class="btn ${p.is_following ? 'btn-secondary' : 'btn-primary'}" data-action="follow" data-id="${p.id}">${p.is_following ? 'Following' : 'Follow'}</button><button class="btn btn-secondary" data-action="message-user" data-id="${p.id}">Message</button>`}</div><h2>${esc(p.display_name || p.username)}</h2><small>@${esc(p.username)}</small>${p.bio ? `<p>${esc(p.bio)}</p>` : ''}${p.website ? `<a href="${esc(safeUrl(p.website))}" target="_blank" rel="noopener noreferrer">${esc(p.website)}</a>` : ''}<div class="profile-stats"><button data-action="people-list" data-id="${p.id}" data-kind="followers"><b>${p.followers_count}</b> followers</button><button data-action="people-list" data-id="${p.id}" data-kind="following"><b>${p.following_count}</b> following</button><button data-action="profile-tab" data-tab="posts"><b>${p.posts_count}</b> posts</button></div><small>Joined ${parseTime(p.created_at).toLocaleDateString(undefined,{month:'long',year:'numeric'})}</small></div><div class="profile-tabs" role="tablist">${['posts','replies','media','reels'].map(t => `<button data-action="profile-tab" data-tab="${t}" class="${t === 'posts' ? 'active' : ''}" role="tab" aria-selected="${t === 'posts'}">${t[0].toUpperCase()+t.slice(1)}</button>`).join('')}</div><div id="profile-posts">${loading()}</div>`;
      if (!own) $('.profile-actions').insertAdjacentHTML('beforeend', `<button class="btn btn-secondary" data-action="profile-menu" data-id="${p.id}" aria-label="More profile options">${icon('more')}</button>`);
      await loadProfileTab('posts');
    } catch (e) { content.innerHTML = message('Profile unavailable', e.message, 'error'); }
  };
  const loadProfileTab = async (tab, append = false) => {
    $$('.profile-tabs button').forEach(b => { b.classList.toggle('active', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    const target = $('#profile-posts'); if (!target) return; if (!append) target.innerHTML = loading();
    if (tab === 'reels') {
      try { const data = await API.get('/reels',{creator_id:state.profile.id,limit:15,offset:append ? state.profileOffset : 0});
        if (append) target.querySelector('.load-more')?.remove(); else target.innerHTML = '';
        target.classList.add('profile-reel-grid');
        target.insertAdjacentHTML('beforeend',data.items.length ? data.items.map(reel => `<a class="profile-reel" href="reels.html?id=${esc(reel.public_id)}"><img src="${esc(API.resolveUrl(reel.thumbnail_url))}" alt="${esc(reel.caption.slice(0,80) || 'Reel')}"><span>${icon('video')} ${reel.views_count} views</span></a>`).join('') : append ? '' : message('No Reels yet','Videos will appear here when shared.'));
        state.profileTab = tab; state.profileOffset = data.next_offset;
        if (data.next_offset !== null) target.insertAdjacentHTML('beforeend','<button class="load-more" data-action="more-profile-posts">Load more Reels</button>');
      } catch(e) { target.innerHTML = message('Could not load Reels',e.message,'error'); }
      return;
    }
    target.classList.remove('profile-reel-grid');
    try { const data = await get(`/profiles/${state.profile.id}/posts`, {tab,limit:15,offset:append ? state.profileOffset : 0});
      if (append) target.querySelector('.load-more')?.remove(); else target.innerHTML = '';
      target.insertAdjacentHTML('beforeend', data.items.length ? data.items.map(item => item.post ? `<div class="post-repost-label">${esc(item.comment.content.slice(0,120))}</div>${postCard(item.post)}` : postCard(item)).join('') : append ? '' : message(`No ${tab} yet`, 'There is nothing to show here yet.'));
      state.profileTab = tab; state.profileOffset = data.next_offset;
      if (data.next_offset !== null) target.insertAdjacentHTML('beforeend','<button class="load-more" data-action="more-profile-posts">Load more</button>');
    } catch (e) { target.innerHTML = message('Could not load posts', e.message, 'error'); }
  };
  const $$ = selector => [...document.querySelectorAll(selector)];
  const communityCard = c => `<a class="community-card" href="${link('community',c.id)}"><span class="community-card-icon">${c.avatar_url ? `<img src="${esc(API.resolveUrl(c.avatar_url))}" alt="">` : icon('users')}</span><span class="community-card-main"><h3>${esc(c.name)}</h3><p>${esc(c.description || 'A space to connect and share.')}</p><small>${c.member_count} members${c.my_role ? ` · ${esc(c.my_role.toLowerCase())}` : ''}</small></span>${icon('arrow-right')}</a>`;
  const loadCommunities = async (append = false) => { const target = $('#communities-list'); if (!target) return;
    try { const data = await get('/communities',{limit:20,offset:append ? state.communityOffset : 0});
      if (append) target.querySelector('.load-more')?.remove(); else target.innerHTML = '';
      target.insertAdjacentHTML('beforeend',data.items.length ? data.items.map(communityCard).join('') : append ? '' : message('No communities yet','Create a space around something you care about.'));
      state.communityOffset = data.next_offset;
      if (data.next_offset !== null) target.insertAdjacentHTML('beforeend','<button class="load-more" data-action="more-communities">Load more communities</button>');
    } catch (e) { target.innerHTML = message('Communities unavailable',e.message,'error'); }
  };
  const renderCommunities = async () => { setTitle('Communities', 'FIND YOUR PEOPLE'); content.innerHTML = `<div class="page-intro"><div><h2>Better together</h2><p>Find a space for the conversations that matter to you.</p></div><button class="btn btn-primary" data-action="create-community">Create</button></div><div id="communities-list" class="social-list">${loading()}</div>`; await loadCommunities(); };
  const renderCommunity = async () => { content.innerHTML = loading();
    try { const c = await get(`/communities/${state.id}`); state.community = c; setTitle(c.name, 'COMMUNITY');
      content.innerHTML = `<div class="social-profile-cover" ${c.banner_url ? `style="background-image:url('${esc(API.resolveUrl(c.banner_url))}')"` : ''}></div><div class="social-profile-info"><span class="community-card-icon" style="margin-top:-25px;position:relative">${c.avatar_url ? `<img src="${esc(API.resolveUrl(c.avatar_url))}" alt="">` : icon('users')}</span><div class="profile-actions">${c.my_role ? `${c.my_role === 'OWNER' ? '' : `<button class="btn btn-secondary" data-action="leave-community" data-id="${c.id}">Leave</button>`}<a class="btn btn-secondary" href="chat.html?conversation=${c.conversation_id}">Open chat</a>` : `<button class="btn btn-primary" data-action="join-community" data-id="${c.id}">Join community</button>`}</div><h2>${esc(c.name)}</h2><p>${esc(c.description)}</p><div class="profile-stats"><button data-action="community-members" data-id="${c.id}"><b>${c.member_count}</b> members</button><span class="composer-hint">${c.my_role ? `Role: ${esc(c.my_role.toLowerCase())}` : 'Join to take part'}</span></div></div>${c.my_role ? `<button class="social-composer-trigger" data-action="compose" data-community="${c.id}"><img src="${esc(avatar(state.user))}" alt=""><span>Share with ${esc(c.name)}…</span>${icon('compose')}</button>` : ''}<div id="community-posts">${loading()}</div>`;
      $('.profile-actions').insertAdjacentHTML('beforeend', `${['OWNER','MODERATOR'].includes(c.my_role) ? `<button class="btn btn-secondary" data-action="edit-community" data-id="${c.id}">Edit</button>` : ''}<button class="btn btn-secondary" data-action="report-community" data-id="${c.id}" aria-label="Report community">${icon('more')}</button>`);
      await pagedPosts(`/communities/${c.id}/posts`,'community-posts','more-community-posts','No community posts yet', c.my_role ? 'Share the first post in this community.' : 'Join to start the conversation.');
    } catch (e) { content.innerHTML = message('Community unavailable', e.message, 'error'); }
  };
  const notificationCard = n => {
    const phrases = {follow:'started following you',like:'liked your post',comment:'commented on your post',reply:'replied to your comment',mention:'mentioned you',repost:'reposted your post',quote:'quoted your post',community_join:'joined your community',community_post:'shared in a community',message:'sent you a message',thread_reply:'replied in your thread',reel_like:'liked your Reel',reel_comment:'commented on your Reel',reel_reply:'replied to your Reel comment',reel_share:'shared your Reel',reel_mention:'mentioned you in a Reel'};
    const href = n.entity_type === 'post' ? link('post',n.entity_id) : n.entity_type === 'reel' ? `reels.html?reel_id=${n.entity_id}` : n.entity_type === 'community' ? link('community',n.entity_id) : n.entity_type === 'conversation' ? `chat.html?conversation=${n.entity_id}` : link('profile',n.entity_id);
    return `<a class="notification-item ${n.read ? '' : 'unread'}" href="${href}"><img src="${esc(avatar(n.actor))}" alt=""><div><p><strong>${esc(n.actor?.display_name || n.actor?.username || 'A member')}</strong> ${esc(phrases[n.type] || n.type)}</p><small>${timeAgo(n.created_at)} ago</small></div></a>`;
  };
  const loadNotifications = async (append = false) => {
    const target = $('#notification-list'); if (!target) return;
    try { const data = await get('/notifications',{limit:25,offset:append ? state.notificationOffset : 0});
      if (append) target.querySelector('.load-more')?.remove(); else target.innerHTML = '';
      target.insertAdjacentHTML('beforeend',data.items.length ? data.items.map(notificationCard).join('') : append ? '' : message("You're all caught up",'New activity will appear here.'));
      state.notificationOffset = data.next_offset;
      if (data.next_offset !== null) target.insertAdjacentHTML('beforeend','<button class="load-more" data-action="more-notifications">Load more activity</button>');
      $('#notification-summary').textContent = data.unread ? `${data.unread} unread` : "You're all caught up";
      $('#read-all').classList.toggle('hidden',!data.unread);
      const badge = $('#nav-unread'); badge.textContent = data.unread; badge.classList.toggle('hidden',!data.unread);
    } catch (e) { target.innerHTML = message('Notifications unavailable',e.message,'error'); }
  };
  const renderNotifications = async () => { setTitle('Notifications', 'STAY IN THE LOOP');
    content.innerHTML = '<div class="page-intro"><div><h2>Activity</h2><p id="notification-summary"></p></div><button id="read-all" class="btn btn-secondary hidden" data-action="read-all">Mark all read</button></div><div id="notification-list"></div>';
    $('#notification-list').innerHTML = loading(); await loadNotifications();
  };
  const renderHashtag = async () => { setTitle(`#${state.id}`, 'TOPIC'); content.innerHTML = loading();
    try { const data = await get(`/hashtags/${encodeURIComponent(state.id)}`,{limit:15}); content.innerHTML = `<div class="page-intro"><p>${data.count} posts about #${esc(data.name)}</p></div><div id="hashtag-reels"></div><div id="hashtag-posts"></div>`; state['more-hashtag-postsOffset'] = data.next_offset; $('#hashtag-posts').innerHTML = data.items.length ? data.items.map(postCard).join('') + (data.next_offset !== null ? '<button class="load-more" data-action="more-hashtag-posts">Load more</button>' : '') : message('No posts yet', 'Be the first to use this topic.');
      API.get('/reels',{q:`#${state.id}`,limit:6}).then(result => { const target=$('#hashtag-reels'); if (target && result.items.length) target.innerHTML=`<div class="social-reels-heading"><h2>Reels about #${esc(state.id)}</h2><a href="reels.html?q=${encodeURIComponent('#'+state.id)}">See all ${icon('arrow-right')}</a></div><div class="social-reels-strip">${result.items.map(reelTile).join('')}</div>`; }).catch(()=>{});
    }
    catch (e) { content.innerHTML = message('Topic unavailable', e.message, 'error'); }
  };
  const renderSearch = async (query = params.get('q') || '') => { setTitle('Explore', 'DISCOVER RELAY');
    content.innerHTML = `<form id="search-page-form" class="search-page-form" role="search"><input id="search-page-input" type="search" value="${esc(query)}" autocomplete="off" placeholder="Search people, posts, communities, topics" aria-label="Search"></form><div id="search-results">${query ? loading() : message('Discover something new', 'Search people, posts, communities, and topics.')}</div>`;
    if (query) await searchFor(query);
  };
  const searchItem = (kind, item) => kind === 'people' ? `<a class="search-person" href="${link('profile',item.id)}"><img src="${esc(avatar(item))}" alt=""><span>${esc(item.display_name || item.username)}<small>@${esc(item.username)}</small></span></a>` : kind === 'topics' ? `<a class="search-person" href="${link('hashtag',item.name)}">#${esc(item.name)}</a>` : kind === 'communities' ? communityCard(item) : postCard(item);
  const searchFor = async (query, append = false) => { const target = $('#search-results'); if (!target) return; const term = query.trim();
    if (!term) { target.innerHTML = message('Discover something new', 'Search people, posts, communities, and topics.'); return; }
    if (!append) { state.searchTerm = term; state.searchOffset = 0; target.innerHTML = loading(); }
    try { const data = await get('/search',{q:term,limit:10,offset:state.searchOffset});
      if (term !== state.searchTerm) return;
      if (!append) target.innerHTML = '';
      target.querySelector('.load-more')?.remove();
      for (const [kind,title] of [['people','People'],['topics','Topics'],['communities','Communities'],['posts','Posts']]) {
        if (!data[kind].length) continue;
        let section = target.querySelector(`[data-search-kind="${kind}"]`);
        if (!section) { target.insertAdjacentHTML('beforeend',`<section data-search-kind="${kind}"><h2 class="search-section-title">${title}</h2><div class="${kind === 'communities' ? 'social-list' : ''}"></div></section>`); section = target.querySelector(`[data-search-kind="${kind}"]`); }
        section.lastElementChild.insertAdjacentHTML('beforeend',data[kind].map(item => searchItem(kind,item)).join(''));
      }
      if (!target.children.length) target.innerHTML = message('No results', 'Try another search term.');
      state.searchOffset += 10;
      if (Object.values(data).some(items => items.length === 10)) target.insertAdjacentHTML('beforeend','<button class="load-more" data-action="more-search">Load more results</button>');
    } catch (e) { target.innerHTML = message('Search unavailable', e.message, 'error'); }
  };
  const route = () => ({home:renderHome,post:renderPost,profile:renderProfile,communities:renderCommunities,community:renderCommunity,notifications:renderNotifications,bookmarks:renderBookmarks,search:renderSearch,hashtag:renderHashtag}[state.view] || renderHome)();
  const dialog = (title, html) => { state.previousFocus = document.activeElement; $('#dialog-title').textContent = title; $('#dialog-body').innerHTML = html; $('#social-dialog').classList.remove('hidden'); $('.social-shell').inert = true; $('.social-mobile-nav').inert = true; AppUI.decorate($('#social-dialog')); $('#social-dialog').querySelector('textarea,input,button')?.focus(); };
  const closeDialog = () => { $('#social-dialog').classList.add('hidden'); $('#dialog-body').innerHTML = ''; $('.social-shell').inert = false; $('.social-mobile-nav').inert = false; state.previousFocus?.focus?.(); };
  const composer = (preset = {}) => {
    const quote = preset.quote || null;
    const editing = preset.edit || null;
    dialog(editing ? 'Edit post' : quote ? 'Quote post' : 'Create post', `<form class="dialog-form" id="compose-form" data-form="compose"><label>What's happening?<textarea name="content" maxlength="5000" placeholder="Share an idea, a moment, or a question…">${esc(editing?.content || '')}</textarea></label><div id="mention-results" class="aside-list hidden"></div>${quote ? `<div class="post-quote"><strong>Quoting ${esc(quote.author?.display_name || quote.author?.username)}</strong>${esc(quote.content?.slice(0,180))}</div>` : ''}${!editing ? `<label>Photo, GIF, or video<input name="media" type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4"></label><button type="button" class="btn btn-secondary" data-action="toggle-poll">Add poll</button><div id="poll-fields" class="hidden"><label>Poll options, one per line<textarea name="poll" maxlength="600" placeholder="Option one&#10;Option two" rows="4"></textarea></label></div>` : ''}<div class="form-row"><label>Who can see this?<select name="visibility">${['EVERYONE','FOLLOWERS','FRIENDS','ONLY_ME'].map(v => `<option ${v === (editing?.visibility || 'EVERYONE') ? 'selected' : ''} value="${v}">${v.replace('_',' ').toLowerCase().replace(/^./,x=>x.toUpperCase())}</option>`).join('')}</select></label><label>Who can reply?<select name="reply_policy">${['EVERYONE','FOLLOWERS','FOLLOWING','NOBODY'].map(v => `<option ${v === (editing?.reply_policy || 'EVERYONE') ? 'selected' : ''} value="${v}">${v.toLowerCase().replace(/^./,x=>x.toUpperCase())}</option>`).join('')}</select></label></div><p class="composer-hint">Use #topics and @mentions to connect with others. Posts can contain up to 5,000 characters.</p><div class="dialog-actions"><button type="button" class="btn btn-secondary" data-action="emoji">Add emoji</button><button type="submit" class="btn btn-primary">${editing ? 'Save' : 'Post'}</button></div></form>`);
    const form = $('#compose-form'); form.dataset.quote = quote?.id || ''; form.dataset.edit = editing?.id || ''; form.dataset.community = preset.community || ''; form.dataset.thread = preset.thread || '';
    form.querySelector('textarea[name=content]').addEventListener('input', event => { clearTimeout(state.searchTimer); const match = event.target.value.slice(0,event.target.selectionStart).match(/@([a-zA-Z0-9_]{1,30})$/); const results = $('#mention-results'); if (!match) { results.classList.add('hidden'); return; } state.searchTimer = setTimeout(async () => { try { const people = await get('/mentions/suggestions',{q:match[1]}); results.innerHTML = people.map(u => `<button type="button" data-action="insert-mention" data-name="${esc(u.username)}" class="btn btn-secondary">@${esc(u.username)}</button>`).join(''); results.classList.toggle('hidden', !people.length); } catch { results.classList.add('hidden'); } },250); });
  };
  const createCommunityDialog = () => dialog('Create a community', `<form class="dialog-form" data-form="community"><label>Name<input name="name" required minlength="3" maxlength="100" placeholder="A place for…"></label><label>Description<textarea name="description" maxlength="2000" placeholder="What is this community about?"></textarea></label><div class="dialog-actions"><button class="btn btn-secondary" type="button" data-action="close-dialog">Cancel</button><button class="btn btn-primary" type="submit">Create community</button></div></form>`);
  const editCommunityDialog = c => dialog('Edit community', `<form class="dialog-form" data-form="edit-community" data-id="${c.id}"><label>Name<input name="name" required minlength="3" maxlength="100" value="${esc(c.name)}"></label><label>Description<textarea name="description" maxlength="2000">${esc(c.description)}</textarea></label><div class="dialog-actions"><button class="btn btn-secondary" type="button" data-action="close-dialog">Cancel</button><button class="btn btn-primary" type="submit">Save changes</button></div></form>`);
  const reportDialog = (entityType,id) => dialog('Report content', `<form class="dialog-form" data-form="report" data-type="${entityType}" data-id="${id}"><p class="composer-hint">Reports are reviewed. The content remains available while it is reviewed.</p><label>Reason<select name="reason"><option value="spam">Spam</option><option value="harassment">Harassment</option><option value="impersonation">Impersonation</option><option value="inappropriate">Inappropriate content</option><option value="scam">Scam</option><option value="other">Other</option></select></label><label>Additional details (optional)<textarea name="details" maxlength="500" rows="3"></textarea></label><div class="dialog-actions"><button class="btn btn-secondary" type="button" data-action="close-dialog">Cancel</button><button class="btn btn-primary" type="submit">Send report</button></div></form>`);
  const shareDialog = async id => { dialog('Share post', `<div class="dialog-form">${loading()}</div>`);
    try { const conversations = await API.get('/conversations'); $('#dialog-body').innerHTML = `<div class="dialog-form"><button class="btn btn-secondary" data-action="copy-post" data-id="${id}">${icon('copy')} Copy link</button><p class="composer-hint">Send this post into a chat or group</p>${conversations.length ? conversations.map(c => `<button class="btn btn-secondary" data-action="send-post" data-id="${id}" data-conversation="${c.id}">${icon(c.type === 'GROUP' ? 'users' : 'message')} ${esc(c.name || c.other_user?.display_name || c.other_user?.username || 'Conversation')}</button>`).join('') : '<p class="composer-hint">Start a chat to share with someone.</p>'}</div>`; }
    catch (e) { $('#dialog-body').innerHTML = message('Chats unavailable',e.message,'error'); }
  };
  const postMenu = async id => { const p = await get(`/posts/${id}`); const moderator = state.community?.id === p.community_id && ['OWNER','MODERATOR'].includes(state.community?.my_role); dialog('Post options', `<div class="dialog-form">${p.author_id === state.user?.id ? `<button class="btn btn-secondary" data-action="edit-post" data-id="${id}">${icon('edit')} Edit post</button><button class="btn btn-secondary" data-action="continue-thread" data-id="${p.thread_parent_id || id}">${icon('plus')} Continue thread</button><button class="btn btn-secondary" data-action="delete-post" data-id="${id}">${icon('trash')} Delete post</button>` : `<button class="btn btn-secondary" data-action="report-post" data-id="${id}">${icon('alert-circle')} Report post</button><button class="btn btn-secondary" data-action="block-user" data-id="${p.author_id}">${icon('shield')} Block user</button>`}${moderator ? `<button class="btn btn-secondary" data-action="pin-community-post" data-id="${id}" data-pinned="${p.pinned}">${icon('pin')} ${p.pinned ? 'Unpin' : 'Pin'} post</button><button class="btn btn-secondary" data-action="remove-community-post" data-id="${id}">${icon('trash')} Remove from community</button>` : ''}<button class="btn btn-secondary" data-action="quote" data-id="${id}">${icon('compose')} Quote post</button><button class="btn btn-secondary" data-action="copy-post" data-id="${id}">${icon('copy')} Copy link</button></div>`); };
  const viewStory = async id => {
    const story = state.stories?.flatMap(g => g.stories).find(s => s.id === Number(id)); if (!story) return;
    const media = story.media_type === 'VIDEO' ? `<video class="post-media" controls autoplay src="${esc(API.resolveUrl(story.media_url))}"></video>` : story.media_type === 'IMAGE' ? `<img class="post-media" src="${esc(API.resolveUrl(story.media_url))}" alt="Story">` : `<p class="post-text">${esc(story.caption)}</p>`;
    dialog('Story', `<div class="dialog-form">${media}<p>${esc(story.caption || '')}</p><small class="composer-hint">Expires ${new Date(story.expires_at).toLocaleString()}</small></div>`);
    if (!story.is_own) API.post(`/stories/${id}/view`,{}).catch(()=>{});
  };
  const createStoryDialog = () => dialog('Add a story', `<form class="dialog-form" data-form="story"><label>Photo or video (optional)<input type="file" name="media" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4"></label><label>Text or caption<textarea name="caption" maxlength="500" placeholder="Share a moment…"></textarea></label><label>Who can see this?<select name="visibility"><option value="EVERYONE">Everyone</option><option value="FOLLOWERS">Followers</option><option value="FRIENDS">Friends</option><option value="ONLY_ME">Only me</option></select></label><p class="composer-hint">Stories disappear after 24 hours.</p><div class="dialog-actions"><button class="btn btn-secondary" type="button" data-action="close-dialog">Cancel</button><button class="btn btn-primary" type="submit">Share story</button></div></form>`);
  const action = async (name, el) => {
    const id = Number(el.dataset.id);
    if (name === 'retry') return route();
    if (name === 'back') return history.length > 1 ? history.back() : location.assign(base);
    if (name === 'close-dialog') return closeDialog();
    if (name === 'compose') return composer({community:el.dataset.community});
    if (name === 'create-community') return createCommunityDialog();
    if (name === 'create-story') return createStoryDialog();
    if (name === 'story') return viewStory(id);
    if (name === 'feed-mode') { state.mode = el.dataset.mode; state.offset = 0; return renderHome(); }
    if (name === 'load-more') { state.offset = state.next; $('#feed-items .load-more')?.remove(); return renderHome(false); }
    if (name === 'more-comments') return loadComments(true);
    if (name === 'profile-tab') return loadProfileTab(el.dataset.tab);
    if (name === 'more-profile-posts') return loadProfileTab(state.profileTab,true);
    if (name === 'more-bookmarks') return pagedPosts('/bookmarks','bookmark-posts','more-bookmarks','No bookmarks yet','Save posts to revisit them here.',true);
    if (name === 'more-community-posts') return pagedPosts(`/communities/${state.community.id}/posts`,'community-posts','more-community-posts','No community posts yet','Share the first post in this community.',true);
    if (name === 'more-hashtag-posts') return pagedPosts(`/hashtags/${encodeURIComponent(state.id)}`,'hashtag-posts','more-hashtag-posts','No posts yet','Be the first to use this topic.',true);
    if (name === 'more-communities') return loadCommunities(true);
    if (name === 'more-notifications') return loadNotifications(true);
    if (name === 'more-search') return searchFor(state.searchTerm,true);
    if (name === 'post-menu') return postMenu(id);
    if (name === 'comment') return location.assign(link('post',id));
    if (name === 'react') { const current = el.classList.contains('active'); const p = current ? await del(`/posts/${id}/reaction`) : await post(`/posts/${id}/reaction`,{emoji:'❤️'}); updateCard(p); return; }
    if (name === 'bookmark') { const current = el.classList.contains('active'); const p = current ? await del(`/posts/${id}/bookmark`) : await post(`/posts/${id}/bookmark`,{}); updateCard(p); toast(current ? 'Removed from bookmarks' : 'Saved to bookmarks'); return; }
    if (name === 'repost') { await post(`/posts/${id}/repost`,{}); toast('Reposted'); return route(); }
    if (name === 'quote') { const p = await get(`/posts/${id}`); return composer({quote:p}); }
    if (name === 'continue-thread') return composer({thread:id});
    if (name === 'share') return shareDialog(id);
    if (name === 'copy-post') { await navigator.clipboard.writeText(new URL(link('post',id),location.href).href); toast('Link copied'); return closeDialog(); }
    if (name === 'send-post') { await post(`/posts/${id}/share-to-chat`,{conversation_id:Number(el.dataset.conversation)}); toast('Sent to chat'); return closeDialog(); }
    if (name === 'edit-post') { const p = await get(`/posts/${id}`); return composer({edit:p}); }
    if (name === 'delete-post') { if (await AppUI.confirm({title:'Delete post?',description:'This post will no longer be visible.',action:'Delete post'})) { await del(`/posts/${id}`); closeDialog(); toast('Post deleted'); if (state.view === 'post') location.assign(base); else route(); } return; }
    if (name === 'report-post') return reportDialog('post',id);
    if (name === 'report-comment') return reportDialog('comment',id);
    if (name === 'profile-menu') return dialog('Profile options', `<div class="dialog-form"><button class="btn btn-secondary" data-action="report-user" data-id="${id}">${icon('alert-circle')} Report user</button><button class="btn btn-secondary" data-action="block-user" data-id="${id}">${icon('shield')} Block user</button></div>`);
    if (name === 'report-user') return reportDialog('user',id);
    if (name === 'report-community') return reportDialog('community',id);
    if (name === 'edit-community') return editCommunityDialog(state.community);
    if (name === 'pin-community-post') { if (el.dataset.pinned === 'true') await del(`/communities/${state.community.id}/posts/${id}/pin`); else await post(`/communities/${state.community.id}/posts/${id}/pin`,{}); closeDialog(); return renderCommunity(); }
    if (name === 'remove-community-post') { if (await AppUI.confirm({title:'Remove this post?',description:'It will disappear from the community.',action:'Remove'})) { await del(`/communities/${state.community.id}/posts/${id}`); closeDialog(); renderCommunity(); } return; }
    if (name === 'block-user') { if (await AppUI.confirm({title:'Block this person?',description:'You will no longer see each other’s content or be able to message.',action:'Block'})) { await API.post(`/users/${id}/block`,{}); closeDialog(); toast('Person blocked'); route(); } return; }
    if (name === 'vote') { const p = await post(`/posts/${id}/vote`,{option_id:Number(el.dataset.option)}); updateCard(p); return; }
    if (name === 'follow') { const following = el.textContent.trim() === 'Following'; if (following) await del(`/profiles/${id}/follow`); else await post(`/profiles/${id}/follow`,{}); return renderProfile(); }
    if (name === 'message-user') { const c = await API.post('/conversations/direct',{recipient_id:id}); location.assign(`chat.html?conversation=${c.id}`); return; }
    if (name === 'people-list') { const kind = el.dataset.kind; const data = await get(`/profiles/${id}/${kind}`); dialog(kind[0].toUpperCase()+kind.slice(1), `<div class="social-list">${data.items.length ? data.items.map(p => `<a class="search-person" href="${link('profile',p.id)}"><img src="${esc(avatar(p))}" alt=""><span>${esc(p.display_name || p.username)}<small>@${esc(p.username)}</small></span></a>`).join('') : message(`No ${kind} yet`,'People will appear here.')}</div>`); return; }
    if (name === 'join-community') { await post(`/communities/${id}/join`,{}); return renderCommunity(); }
    if (name === 'leave-community') { if (await AppUI.confirm({title:'Leave community?',description:'You can join again later.',action:'Leave'})) { await del(`/communities/${id}/join`); renderCommunity(); } return; }
    if (name === 'community-members') { const data = await get(`/communities/${id}/members`); const owner = state.community?.my_role === 'OWNER'; dialog('Members', `<div class="dialog-form">${data.items.map(item => `<div class="search-person"><img src="${esc(avatar(item.user))}" alt=""><span>${esc(item.user.display_name || item.user.username)}<small>${esc(item.role.toLowerCase())}</small></span>${owner && item.role !== 'OWNER' ? `<button class="btn btn-secondary" data-action="toggle-moderator" data-id="${item.user.id}" data-role="${item.role}">${item.role === 'MODERATOR' ? 'Make member' : 'Make moderator'}</button>` : ''}</div>`).join('')}</div>`); return; }
    if (name === 'toggle-moderator') { await patch(`/communities/${state.community.id}/members/${id}`,{role:el.dataset.role === 'MODERATOR' ? 'MEMBER' : 'MODERATOR'}); toast('Role updated'); return action('community-members',{dataset:{id:state.community.id}}); }
    if (name === 'read-all') { await post('/notifications/read',{}); return renderNotifications(); }
    if (name === 'toggle-poll') return $('#poll-fields').classList.toggle('hidden');
    if (name === 'emoji') { const field = $('#compose-form textarea[name=content]'); field.value += ' 🙂'; field.focus(); return; }
    if (name === 'insert-mention') { const field = $('#compose-form textarea[name=content]'); field.value = field.value.replace(/@[a-zA-Z0-9_]*$/,`@${el.dataset.name} `); $('#mention-results').classList.add('hidden'); field.focus(); return; }
    if (name === 'reply-comment') { const form = $('#comment-form'); if (!form) return; form.dataset.parent = id; form.querySelector('textarea').placeholder = `Reply to @${el.dataset.name}`; form.querySelector('textarea').focus(); return; }
    if (name === 'like-comment') { const liked = el.getAttribute('aria-pressed') === 'true'; if (liked) await del(`/comments/${id}/like`); else await post(`/comments/${id}/like`,{}); return loadComments(); }
    if (name === 'delete-comment') { if (await AppUI.confirm({title:'Delete comment?',description:'This reply will be removed.',action:'Delete'})) { await del(`/comments/${id}`); loadComments(); } return; }
  };
  document.addEventListener('click', async event => { const el = event.target.closest('[data-action]'); if (!el) return; event.preventDefault(); if (el.disabled) return; el.disabled = true; try { await action(el.dataset.action,el); } catch (e) { toast(e.message,'error'); } finally { if (el.isConnected) el.disabled = false; } });
  $('#dialog-close').addEventListener('click', closeDialog);
  $('#social-dialog').addEventListener('click', e => { if (e.target.id === 'social-dialog') closeDialog(); });
  document.addEventListener('keydown', e => {
    const overlay = $('#social-dialog'); if (overlay.classList.contains('hidden')) return;
    if (e.key === 'Escape') { closeDialog(); return; }
    if (e.key !== 'Tab') return;
    const choices = [...overlay.querySelectorAll('button,input,textarea,select,a[href]')].filter(el => !el.disabled && !el.closest('.hidden'));
    if (!choices.length) return;
    if (e.shiftKey && document.activeElement === choices[0]) { e.preventDefault(); choices.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === choices.at(-1)) { e.preventDefault(); choices[0].focus(); }
  });
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (form.id === 'comment-form') {
      event.preventDefault(); const field = form.querySelector('textarea'); if (!field.value.trim()) return;
      const button = form.querySelector('button'); button.disabled = true;
      try { await post(`/posts/${state.id}/comments`,{content:field.value.trim(), parent_id:form.dataset.parent ? Number(form.dataset.parent) : null}); field.value = ''; delete form.dataset.parent; field.placeholder = 'Add to the conversation'; await loadComments(); const p = await get(`/posts/${state.id}`); updateCard(p); }
      catch (e) { toast(e.message,'error'); } finally { button.disabled = false; } return;
    }
    if (form.id === 'quick-search' || form.id === 'search-page-form') { event.preventDefault(); const q = form.querySelector('input').value.trim(); if (form.id === 'quick-search') location.assign(link('search',null,`&q=${encodeURIComponent(q)}`)); else searchFor(q); return; }
    if (!form.dataset.form) return;
    event.preventDefault(); const button = form.querySelector('button[type=submit]'); button.disabled = true;
    try {
      const fields = new FormData(form);
      if (form.dataset.form === 'compose') {
        const file = fields.get('media'); let media_url = null, media_type = null;
        if (file?.size) { if (!['image/png','image/jpeg','image/webp','image/gif','video/mp4'].includes(file.type)) throw Error('Choose a PNG, JPEG, WebP, GIF, or MP4 file.'); if (file.size > CONFIG.MAX_FILE_SIZE_MB*1024*1024) throw Error('File is too large.'); button.textContent = 'Uploading…'; const uploaded = await API.uploadFile(file); media_url = uploaded.file_url; media_type = file.type === 'image/gif' ? 'GIF' : file.type.startsWith('video/') ? 'VIDEO' : 'IMAGE'; }
        const options = !$('#poll-fields')?.classList.contains('hidden') ? String(fields.get('poll') || '').split('\n').map(s=>s.trim()).filter(Boolean) : null;
        const body = {content:String(fields.get('content') || '').trim(), visibility:fields.get('visibility'), reply_policy:fields.get('reply_policy')};
        if (form.dataset.edit) await patch(`/posts/${form.dataset.edit}`,body);
        else { Object.assign(body,{media_url,media_type,community_id:form.dataset.community ? Number(form.dataset.community) : null,quote_of_id:form.dataset.quote ? Number(form.dataset.quote) : null,thread_parent_id:form.dataset.thread ? Number(form.dataset.thread) : null,poll_options:options}); await post('/posts',body); }
        closeDialog(); toast(form.dataset.edit ? 'Post updated' : 'Post shared'); route(); loadAside();
      } else if (form.dataset.form === 'community') {
        const c = await post('/communities',{name:fields.get('name'),description:fields.get('description')}); closeDialog(); location.assign(link('community',c.id));
      } else if (form.dataset.form === 'edit-community') {
        await patch(`/communities/${form.dataset.id}`,{name:fields.get('name'),description:fields.get('description'),avatar_url:state.community.avatar_url,banner_url:state.community.banner_url}); closeDialog(); toast('Community updated'); renderCommunity();
      } else if (form.dataset.form === 'report') {
        await post('/reports',{entity_type:form.dataset.type,entity_id:Number(form.dataset.id),reason:fields.get('reason'),details:fields.get('details')}); closeDialog(); toast('Report submitted');
      } else if (form.dataset.form === 'story') {
        const file = fields.get('media'); const caption = String(fields.get('caption') || '').trim(); let media_url = '', media_type = 'TEXT';
        if (file?.size) { if (!['image/png','image/jpeg','image/webp','image/gif','video/mp4'].includes(file.type)) throw Error('Choose an image or MP4 video.'); const uploaded = await API.uploadFile(file); media_url = uploaded.file_url; media_type = file.type.startsWith('video/') ? 'VIDEO' : 'IMAGE'; }
        if (!caption && !media_url) throw Error('Add text, a photo, or a video.');
        await API.post('/stories',{media_url,media_type,caption,visibility:fields.get('visibility')}); closeDialog(); toast('Story shared'); if (state.view === 'home') loadStories();
      }
    } catch (e) { toast(e.message,'error'); } finally { if (button.isConnected) { button.disabled = false; button.textContent = form.dataset.form === 'compose' ? 'Post' : button.textContent; } }
  });
  $('#sidebar-compose').onclick = () => composer(); $('#mobile-compose').onclick = () => composer();
  $('#header-search').onclick = () => location.assign(link('search'));
  $('#social-theme').onclick = () => AppUI.setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  $('#search-page-input')?.addEventListener('input',()=>{});
  document.addEventListener('input', e => { if (e.target.id !== 'search-page-input') return; clearTimeout(state.searchTimer); const q = e.target.value; state.searchTimer = setTimeout(()=>searchFor(q),350); });
  document.querySelectorAll(`[data-nav="${state.view === 'post' || state.view === 'hashtag' ? 'home' : state.view === 'community' ? 'communities' : state.view}"]`).forEach(el => { el.classList.add('active'); el.setAttribute('aria-current','page'); });
  AppUI.decorate();
  (async () => {
    try { state.user = await Auth.fetchMyProfile(); } catch { if (!Auth.isAuthenticated() || !state.user) return; }
    $('#sidebar-avatar').src = avatar(state.user); $('#sidebar-name').textContent = state.user.display_name || state.user.username; $('#sidebar-handle').textContent = `@${state.user.username}`;
    WSClient.on('social_notification', data => { const badge = $('#nav-unread'); badge.textContent = Number(badge.textContent || 0) + 1; badge.classList.remove('hidden'); toast(`${data.actor?.display_name || data.actor?.username || 'Someone'}: new activity`,'info'); if (state.view === 'notifications') renderNotifications(); });
    WSClient.connect();
    route(); loadAside();
    if (params.get('compose') === '1') composer();
    get('/notifications',{limit:1}).then(data=>{const badge=$('#nav-unread');badge.textContent=data.unread;badge.classList.toggle('hidden',!data.unread);}).catch(()=>{});
  })();
})();
