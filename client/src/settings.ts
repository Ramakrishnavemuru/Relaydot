export type AccountSettings = {
  dm_policy: 'EVERYONE' | 'FOLLOWING' | 'NOBODY'
  group_invite_policy: 'EVERYONE' | 'FOLLOWING' | 'NOBODY'
  story_audience: 'EVERYONE' | 'FOLLOWING' | 'NOBODY'
  notifications_enabled: boolean
  direct_notifications: boolean
  group_notifications: boolean
  story_notifications: boolean
  notification_preview: boolean
  notification_sound: boolean
  dnd_until: string | null
  enter_to_send: boolean
  chat_text_size: 'SMALL' | 'NORMAL' | 'LARGE'
  chat_wallpaper: 'DEFAULT' | 'PLAIN' | 'DOTS'
  auto_download_images: boolean
  auto_download_videos: boolean
  media_quality: 'STANDARD' | 'ORIGINAL'
  call_ringtone: boolean
  call_notifications: boolean
  accent: 'INDIGO' | 'TEAL' | 'CORAL'
  density: 'COMFORTABLE' | 'COMPACT'
  reduced_motion: boolean
  high_contrast: boolean
}

export function applyAccountSettings(settings: AccountSettings) {
  const root = document.documentElement
  root.dataset.accent = settings.accent.toLowerCase()
  root.dataset.density = settings.density.toLowerCase()
  root.dataset.chatTextSize = settings.chat_text_size.toLowerCase()
  root.dataset.chatWallpaper = settings.chat_wallpaper.toLowerCase()
  root.dataset.reducedMotion = String(settings.reduced_motion)
  root.dataset.highContrast = String(settings.high_contrast)
  root.dataset.autoDownloadImages = String(settings.auto_download_images)
  root.dataset.autoDownloadVideos = String(settings.auto_download_videos)
  root.dataset.callRingtone = String(settings.call_ringtone)
  root.dataset.callNotifications = String(settings.call_notifications)
  root.dataset.enterToSend = String(settings.enter_to_send)
  root.dataset.notificationSound = String(settings.notification_sound)
  root.dataset.notificationPreview = String(settings.notification_preview)
  root.dataset.notificationsEnabled = String(settings.notifications_enabled)
  root.dataset.directNotifications = String(settings.direct_notifications)
  root.dataset.groupNotifications = String(settings.group_notifications)
  root.dataset.storyNotifications = String(settings.story_notifications)
  root.dataset.dndUntil = settings.dnd_until || ''
  root.dataset.mediaQuality = settings.media_quality.toLowerCase()
}
