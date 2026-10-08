export type User = {
  id: number
  username: string
  display_name?: string | null
  avatar_url?: string | null
  cover_url?: string | null
  bio?: string | null
  website?: string | null
  is_online?: boolean
  followers_count?: number
  following_count?: number
  posts_count?: number
  is_following?: boolean
}

export type Page<T> = { items: T[]; next_offset: number | null }

export type Post = {
  id: number
  author_id: number
  author: User
  content: string
  media_url?: string | null
  media_type?: 'IMAGE' | 'VIDEO' | 'GIF' | null
  created_at: string
  likes_count: number
  comments_count: number
  reposts_count: number
  my_reaction?: string | null
  bookmarked: boolean
  original?: Post | null
  poll?: { id: number; label: string; votes?: number | null }[]
  my_vote?: number | null
  poll_total?: number | null
}

export type Conversation = {
  id: number
  type: 'DIRECT' | 'GROUP'
  name?: string | null
  avatar_url?: string | null
  other_user?: User | null
  unread_count: number
  last_message?: { content?: string; created_at?: string; sender_id?: number; message_type?: string } | null
  updated_at?: string | null
  description?: string | null
  created_by_id?: number | null
  members?: { user_id: number; role: string; user?: User | null }[]
}

export type Attachment = { file_url: string; file_name: string; file_type: string; file_size: number }
export type Message = {
  id: number
  conversation_id: number
  sender_id: number
  content: string
  message_type: string
  created_at: string
  is_deleted: boolean
  expires_at?: string | null
  is_edited: boolean
  status: string
  attachments: Attachment[]
  sender?: User | null
  reply_to_id?: number | null
  reply_to?: { id: number; sender_name?: string; content: string } | null
  reactions?: { id: number; emoji: string; user_id: number }[]
  bookmarked?: boolean
  pinned_at?: string | null
}

export type StoryGroup = { user_id: number; username?: string; display_name?: string; avatar_url?: string | null; all_viewed?: boolean; stories: { id: number }[] }

export type Reel = {
  public_id: string
  creator_id: number
  creator: User
  caption: string
  status: string
  video_url?: string | null
  thumbnail_url?: string | null
  likes_count: number
  comments_count: number
  views_count: number
  liked: boolean
  bookmarked: boolean
  visibility?: string
  allow_comments?: boolean
  allow_download?: boolean
}

export type Notification = { id: number; type: string; actor?: User | null; entity_type: string; entity_id: number; read: boolean; created_at: string }

export type SearchResult = { people: User[]; posts: Post[]; communities: { id: number; name: string; description: string; member_count: number }[]; topics: { name: string }[] }
