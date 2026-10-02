// 24-Hour Stories Manager
const Stories = {
  storyGroups: [],
  currentGroupIndex: 0,
  currentStoryIndex: 0,
  storyTimer: null,
  progressInterval: null,
  isPaused: false,
  storyDurationMs: 5000,
  elapsedMs: 0,

  elements: {},

  init() {
    this.elements = {
      trayContainer: Utils.$('#stories-tray-container'),
      carousel: Utils.$('#stories-carousel'),

      // Viewer Elements
      viewerOverlay: Utils.$('#story-viewer-overlay'),
      progressContainer: Utils.$('#story-progress-container'),
      authorAvatar: Utils.$('#story-author-avatar'),
      authorName: Utils.$('#story-author-name'),
      timeAgo: Utils.$('#story-time-ago'),
      btnCloseViewer: Utils.$('#btn-close-story-viewer'),
      btnDeleteStory: Utils.$('#btn-delete-story'),
      mediaStage: Utils.$('#story-media-stage'),
      captionOverlay: Utils.$('#story-caption-overlay'),
      tapLeft: Utils.$('#story-tap-left'),
      tapRight: Utils.$('#story-tap-right'),
      viewsPill: Utils.$('#story-views-pill'),
      viewsCountText: Utils.$('#story-views-count-text'),
      replyForm: Utils.$('#story-reply-form'),
      replyInput: Utils.$('#story-reply-input'),
      viewersDrawer: Utils.$('#story-viewers-drawer'),
      viewersList: Utils.$('#story-viewers-list'),
      btnCloseDrawer: Utils.$('#btn-close-viewers-drawer'),

      // Create Story Modal
      modalCreate: Utils.$('#modal-create-story'),
      fileInput: Utils.$('#story-file-input'),
      previewImg: Utils.$('#story-create-preview-img'),
      previewVideo: Utils.$('#story-create-preview-video'),
      captionInput: Utils.$('#story-create-caption'),
      btnSubmitStory: Utils.$('#btn-submit-story')
    };

    this.bindUI();
    this.loadStories();
  },

  bindUI() {
    // Viewer close
    if (this.elements.btnCloseViewer) {
      this.elements.btnCloseViewer.addEventListener('click', () => this.closeViewer());
    }

    // Tap zones
    if (this.elements.tapLeft) {
      this.elements.tapLeft.addEventListener('click', () => this.prevStory());
    }
    if (this.elements.tapRight) {
      this.elements.tapRight.addEventListener('click', () => this.nextStory());
    }

    // Hold to pause
    if (this.elements.mediaStage) {
      this.elements.mediaStage.addEventListener('pointerdown', () => this.pauseStory());
      this.elements.mediaStage.addEventListener('pointerup', () => this.resumeStory());
      this.elements.mediaStage.addEventListener('pointerleave', () => this.resumeStory());
    }

    // Delete story
    if (this.elements.btnDeleteStory) {
      this.elements.btnDeleteStory.addEventListener('click', async () => {
        const currentStory = this.getCurrentStory();
        if (currentStory && await AppUI.confirm({title:'Delete this story?',description:'This story will be removed for everyone.',action:'Delete story'})) {
          try {
            await API.delete(`/stories/${currentStory.id}`);
            Utils.showToast('Story deleted', 'info');
            this.closeViewer();
            await this.loadStories();
          } catch (e) {
            Utils.showToast(e.message, 'error');
          }
        }
      });
    }

    // Story views drawer toggle
    if (this.elements.viewsPill) {
      this.elements.viewsPill.addEventListener('click', () => this.openViewersDrawer());
    }
    if (this.elements.btnCloseDrawer) {
      this.elements.btnCloseDrawer.addEventListener('click', () => this.closeViewersDrawer());
    }

    // Reply to story
    if (this.elements.replyForm) {
      this.elements.replyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = this.elements.replyInput.value.trim();
        const currentStory = this.getCurrentStory();
        if (!text || !currentStory) return;

        try {
          await API.post(`/stories/${currentStory.id}/reply`, { content: text });
          this.elements.replyInput.value = '';
          Utils.showToast('Reply sent to chat!', 'success');
        } catch (err) {
          Utils.showToast(err.message, 'error');
        }
      });
    }

    // Create Story file selection
    if (this.elements.fileInput) {
      this.elements.fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const isVideo = file.type.startsWith('video/');
        const url = URL.createObjectURL(file);

        if (isVideo) {
          this.elements.previewImg.classList.add('hidden');
          this.elements.previewVideo.classList.remove('hidden');
          this.elements.previewVideo.src = url;
        } else {
          this.elements.previewVideo.classList.add('hidden');
          this.elements.previewImg.classList.remove('hidden');
          this.elements.previewImg.src = url;
        }
      });
    }

    // Submit new story
    if (this.elements.btnSubmitStory) {
      this.elements.btnSubmitStory.addEventListener('click', async () => {
        const file = this.elements.fileInput.files[0];
        if (!file) {
          Utils.showToast('Please select a photo or video', 'warning');
          return;
        }

        if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) { Utils.showToast('Choose a photo or video for your story.', 'error'); return; }
        if (file.size > CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024) { Utils.showToast(`Choose a file smaller than ${CONFIG.MAX_FILE_SIZE_MB} MB.`, 'error'); return; }
        this.elements.btnSubmitStory.disabled = true;
        this.elements.btnSubmitStory.textContent = 'Posting...';

        try {
          // Upload media
          const uploadRes = await API.uploadFile(file);
          const isVideo = file.type.startsWith('video/');

          // Create story record
          await API.post('/stories', {
            media_url: uploadRes.file_url,
            media_type: isVideo ? 'VIDEO' : 'IMAGE',
            caption: this.elements.captionInput.value.trim()
          });

          Utils.showToast('Story posted successfully!', 'success');
          Utils.closeModal('modal-create-story');
          this.elements.captionInput.value = '';
          this.elements.fileInput.value = '';
          this.elements.previewImg.src = '';
          this.elements.previewVideo.src = '';
          await this.loadStories();
        } catch (err) {
          Utils.showToast('Your story couldn’t be posted. Please try again.', 'error');
        } finally {
          this.elements.btnSubmitStory.disabled = false;
          this.elements.btnSubmitStory.textContent = 'Post Story';
        }
      });
    }
  },

  async loadStories() {
    try {
      this.storyGroups = await API.get('/stories');
      this.renderCarousel();
    } catch (e) {
      if (this.elements.carousel) {
        this.elements.carousel.innerHTML = '<div class="shared-empty">Stories couldn’t load. <button class="text-button">Try again</button></div>';
        this.elements.carousel.querySelector('button').onclick = () => this.loadStories();
      }
    }
  },

  renderCarousel() {
    if (!this.elements.carousel) return;
    this.elements.carousel.innerHTML = '';

    const currentUser = Auth.getCurrentUser();
    const myGroup = this.storyGroups.find(g => g.user_id === currentUser.id);

    // 1. "Your Story" Item
    const myItem = document.createElement('button');
    myItem.type = 'button'; myItem.setAttribute('aria-label','Your story');
    myItem.className = 'story-circle-item';
    const myAvatar = AppUI.avatarUrl(currentUser.avatar_url,currentUser.display_name || currentUser.username);

    myItem.innerHTML = `
      <div class="story-avatar-ring ${myGroup && myGroup.stories.length > 0 ? 'unviewed' : 'viewed'}">
        <img src="${Utils.escapeHTML(myAvatar)}" alt="Your Story" class="story-avatar-img" />
        <span class="add-story-plus-badge">+</span>
      </div>
      <span class="story-user-label">Your Story</span>
    `;

    myItem.addEventListener('click', (e) => {
      // If clicked the plus badge or user has no stories, open create modal
      if (e.target.classList.contains('add-story-plus-badge') || !myGroup || myGroup.stories.length === 0) {
        Utils.openModal('modal-create-story');
      } else {
        // Open own stories
        const idx = this.storyGroups.findIndex(g => g.user_id === currentUser.id);
        this.openViewer(idx, 0);
      }
    });

    this.elements.carousel.appendChild(myItem);

    // 2. Friends' Stories
    this.storyGroups.forEach((group, index) => {
      if (group.user_id === currentUser.id) return; // Already rendered first

      const item = document.createElement('button');
      item.type = 'button'; item.setAttribute('aria-label',`Stories by ${group.display_name || group.username}`);
      item.className = 'story-circle-item';
      const avatar = AppUI.avatarUrl(group.avatar_url,group.display_name || group.username);
      const ringClass = group.all_viewed ? 'viewed' : 'unviewed';

      item.innerHTML = `
        <div class="story-avatar-ring ${ringClass}">
          <img src="${Utils.escapeHTML(avatar)}" alt="${Utils.escapeHTML(group.display_name)}" class="story-avatar-img" />
        </div>
        <span class="story-user-label">${Utils.escapeHTML(group.display_name || group.username)}</span>
      `;

      item.addEventListener('click', () => {
        // Find first unviewed story, or default to 0
        const firstUnviewed = group.stories.findIndex(s => !s.is_viewed);
        this.openViewer(index, firstUnviewed !== -1 ? firstUnviewed : 0);
      });

      this.elements.carousel.appendChild(item);
    });
  },

  getCurrentGroup() {
    return this.storyGroups[this.currentGroupIndex];
  },

  getCurrentStory() {
    const group = this.getCurrentGroup();
    return group ? group.stories[this.currentStoryIndex] : null;
  },

  openViewer(groupIndex, storyIndex = 0) {
    this.currentGroupIndex = groupIndex;
    this.currentStoryIndex = storyIndex;
    this.elements.viewerOverlay.classList.add('active');
    this.renderCurrentStory();
  },

  closeViewer() {
    this.stopStoryTimer();
    this.stopCurrentMedia();
    this.elements.viewerOverlay.classList.remove('active');
    this.closeViewersDrawer();
    this.loadStories(); // Refresh seen rings
  },

  stopCurrentMedia() {
    if (!this.elements.mediaStage) return;
    this.elements.mediaStage.querySelectorAll('video').forEach(video => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    });
    this.elements.mediaStage.querySelectorAll('.story-img-content, .story-video-content').forEach(media => media.remove());
  },

  renderCurrentStory() {
    const group = this.getCurrentGroup();
    if (!group) return this.closeViewer();

    const story = group.stories[this.currentStoryIndex];
    if (!story) return this.closeViewer();

    const currentUser = Auth.getCurrentUser();
    const isOwn = group.user_id === currentUser.id;

    // Header info
    this.elements.authorAvatar.src = AppUI.avatarUrl(group.avatar_url,group.display_name || group.username);
    this.elements.authorName.textContent = group.display_name || group.username;
    this.elements.timeAgo.textContent = Utils.formatLastSeen(false, story.created_at);

    // Delete button (own story only)
    this.elements.btnDeleteStory.classList.toggle('hidden', !isOwn);

    // Progress Bars
    this.renderProgressBars(group.stories.length, this.currentStoryIndex);

    // Media Stage
    this.stopCurrentMedia();
    const mediaUrl = API.resolveUrl(story.media_url);

    if (story.media_type === 'VIDEO') {
      const video = document.createElement('video');
      video.src = mediaUrl;
      video.autoplay = true;
      video.playsInline = true;
      video.className = 'story-video-content';
      this.elements.mediaStage.appendChild(video);
    } else {
      const img = document.createElement('img');
      img.src = mediaUrl; img.alt = story.caption || `Story by ${group.display_name || group.username}`;
      img.className = 'story-img-content';
      this.elements.mediaStage.appendChild(img);
    }

    // Caption
    if (story.caption) {
      this.elements.captionOverlay.textContent = story.caption;
      this.elements.captionOverlay.classList.remove('hidden');
    } else {
      this.elements.captionOverlay.classList.add('hidden');
    }

    // Footer: View count vs Reply input
    if (isOwn) {
      this.elements.viewsPill.classList.remove('hidden');
      this.elements.viewsCountText.textContent = `${story.views_count} views`;
      this.elements.replyForm.classList.add('hidden');
    } else {
      this.elements.viewsPill.classList.add('hidden');
      this.elements.replyForm.classList.remove('hidden');
    }

    // Record view if not own
    if (!isOwn && !story.is_viewed) {
      story.is_viewed = true;
      API.post(`/stories/${story.id}/view`).catch(() => {});
    }

    // Start progress timer
    this.startStoryTimer();
  },

  renderProgressBars(total, currentIndex) {
    this.elements.progressContainer.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const bar = document.createElement('div');
      bar.className = 'story-progress-bar';
      const fill = document.createElement('div');
      fill.className = 'story-progress-fill';
      fill.id = `story-prog-${i}`;

      if (i < currentIndex) {
        fill.style.width = '100%';
      } else if (i === currentIndex) {
        fill.style.width = '0%';
      }
      bar.appendChild(fill);
      this.elements.progressContainer.appendChild(bar);
    }
  },

  startStoryTimer() {
    this.stopStoryTimer();
    this.elapsedMs = 0;
    const intervalMs = 50;

    this.progressInterval = setInterval(() => {
      if (this.isPaused) return;

      this.elapsedMs += intervalMs;
      const pct = Math.min((this.elapsedMs / this.storyDurationMs) * 100, 100);
      const fill = document.getElementById(`story-prog-${this.currentStoryIndex}`);
      if (fill) fill.style.width = `${pct}%`;

      if (this.elapsedMs >= this.storyDurationMs) {
        this.nextStory();
      }
    }, intervalMs);
  },

  stopStoryTimer() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  },

  pauseStory() {
    this.isPaused = true;
  },

  resumeStory() {
    this.isPaused = false;
  },

  nextStory() {
    const group = this.getCurrentGroup();
    if (!group) return this.closeViewer();

    if (this.currentStoryIndex < group.stories.length - 1) {
      this.currentStoryIndex++;
      this.renderCurrentStory();
    } else {
      // Advance to next user's story group
      if (this.currentGroupIndex < this.storyGroups.length - 1) {
        this.currentGroupIndex++;
        this.currentStoryIndex = 0;
        this.renderCurrentStory();
      } else {
        this.closeViewer();
      }
    }
  },

  prevStory() {
    if (this.currentStoryIndex > 0) {
      this.currentStoryIndex--;
      this.renderCurrentStory();
    } else {
      // Go to previous user's story group
      if (this.currentGroupIndex > 0) {
        this.currentGroupIndex--;
        const prevGroup = this.getCurrentGroup();
        this.currentStoryIndex = prevGroup.stories.length - 1;
        this.renderCurrentStory();
      }
    }
  },

  async openViewersDrawer() {
    this.pauseStory();
    const currentStory = this.getCurrentStory();
    if (!currentStory) return;

    this.elements.viewersList.innerHTML = '<div class="empty-list-notice">Loading viewers...</div>';
    this.elements.viewersDrawer.classList.add('open');

    try {
      const viewers = await API.get(`/stories/${currentStory.id}/views`);
      if (viewers.length === 0) {
        this.elements.viewersList.innerHTML = '<div class="empty-list-notice">No views yet</div>';
        return;
      }

      this.elements.viewersList.innerHTML = '';
      viewers.forEach(v => {
        const item = document.createElement('div');
        item.className = 'drawer-viewer-item';
        const avatar = AppUI.avatarUrl(v.viewer_avatar,v.viewer_username);
        item.innerHTML = `
          <img src="${Utils.escapeHTML(avatar)}" class="user-avatar-sm" />
          <div style="flex:1;">
            <div style="font-weight:600; font-size:0.875rem;">${Utils.escapeHTML(v.viewer_name || v.viewer_username)}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${Utils.formatLastSeen(false, v.viewed_at)}</div>
          </div>
        `;
        this.elements.viewersList.appendChild(item);
      });
    } catch (e) {
      this.elements.viewersList.innerHTML = `<div class="empty-list-notice error-text">${e.message}</div>`;
    }
  },

  closeViewersDrawer() {
    this.elements.viewersDrawer.classList.remove('open');
    this.resumeStory();
  }
};
